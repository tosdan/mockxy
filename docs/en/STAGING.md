# Mockxy in a shared staging

The scenario: an internal staging environment, used by the whole team and by QA, with its own
deployed frontend. The frontend is often ahead of the backend: the calls the backend already
implements go to the real backend, the others get a mock. As the backend releases, the boundary
moves towards the real thing (the "[backend isn't there
yet](SCENARI.md#the-backend-isnt-there-yet-and-the-boundary-moves)" scenario, shared by many
people).

Staging is a **frozen** environment: everyone gets the behavior written in git, and Mockxy fills
the gaps without becoming a workbench. Mocks are written and tried locally, with the [desktop
app](DESKTOP.md); they reach staging through a PR.

## The profile

No new image is needed: it is the [standalone image](DEPLOYMENT.md#standalone-image) with the
proxy fallback on. The sample compose is `docker-compose.staging-proxy.yml`:

| | Value | Why |
|---|---|---|
| Proxy fallback | on, `BACKEND_URL` required | where there is no mock, the backend answers |
| `TRUST_PROXY` | `true` | a reverse proxy sits in front (below) |
| Admin API and interface | off | nothing to protect |
| Mock watch | off | mocks change only with an update |
| Port | on the host's loopback only | the reverse proxy reaches it, the network does not |

**Why the admin API is off.** The admin API has no authentication and can create handlers, that
is, run JavaScript on the server. With it off there is nothing to protect; in exchange there is no
interface, Monitor or History, and traffic is read from the [logs](#reading-the-traffic). Only
the [health check](ADMIN-API.md#health) and the `404` on the rest of `/_admin/api` stay active.

**One instance, one backend.** Each staging has its own container, with a single `BACKEND_URL`.
If staging exposes several services, the reverse proxy routes them; if mocks are needed on
several services, use one Mockxy instance per service. No replicas behind a load balancer:
sequences and handler state live in the process memory.

## The topology

```text
browser ──https──► reverse proxy ──► /       deployed frontend (static files)
                                └──► /api/   Mockxy ──► mock, or staging backend
```

Frontend and API share the same origin: [CORS](CORS.md) is not needed. An example with nginx:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl;
    server_name staging.example.internal;
    root /srv/frontend;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $http_host;
        # Only if the frontend uses WebSockets under /api.
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

- **`TRUST_PROXY`.** With the `X-Forwarded-*` headers, the backend's [redirects](REDIRECT.md) and
  [cookies](COOKIE.md) go out with the public https address: why `$http_host` is explained in
  [DEPLOYMENT.md](DEPLOYMENT.md#behind-a-reverse-proxy).
- **Paths do not change.** `proxy_pass` without a path leaves `/api/...` as it is, and Mockxy
  forwards it that way to the backend: mocks are declared with the backend's own paths.
- **Technical headers for the backend.** If the backend wants an environment header or a
  technical token, the reverse proxy adds it (`proxy_set_header X-Env staging;`): Mockxy forwards
  it untouched.

## Starting

```bash
export BACKEND_URL=http://backend-staging:8080
export MOCKXY_WORKSPACE=/srv/mockxy-mocks          # checkout of the mocks repository
MOCKS_VERSION=$(git -C "$MOCKXY_WORKSPACE" rev-parse --short HEAD) \
  docker compose -f docker-compose.staging-proxy.yml up -d --wait
```

| Variable | Default | |
|---|---|---|
| `BACKEND_URL` | none | required: without it, compose stops with a message |
| `MOCKXY_WORKSPACE` | `./workspace` | folder with `mocks/` and `files/`, mounted read-only |
| `MOCKS_VERSION` | empty | the version of the mocks, shown by the health check and in the startup log |
| `MOCKXY_HOST_PORT` | `3000` | port on the host's loopback |

`--wait` waits for the health check to answer `200`, usually within a few seconds. With a broken
file the command fails after about a minute (the `healthcheck` timings) and the container stays
`unhealthy`.

**Backend on https with an internal CA.** Node does not know the company CA: mount the
certificate and point to it with `NODE_EXTRA_CA_CERTS`, Node's standard variable. The two lines
are already in the compose, commented out:

```yaml
    environment:
      - NODE_EXTRA_CA_CERTS=/certs/ca.pem
    volumes:
      - ./certs/ca.pem:/certs/ca.pem:ro
```

## Updating the mocks

After a change to the mocks is merged: stop, pull, start.

```bash
docker compose -f docker-compose.staging-proxy.yml stop
git -C "$MOCKXY_WORKSPACE" pull
MOCKS_VERSION=$(git -C "$MOCKXY_WORKSPACE" rev-parse --short HEAD) \
  docker compose -f docker-compose.staging-proxy.yml up -d --wait
```

- **Stop first.** Data files and file responses are read at every request: with the engine
  running, old definitions and new data would coexist during the pull. A few seconds of downtime
  beat inconsistent responses.
- **The restart resets state.** Sequences, handler memory and shared handler state start over at
  every update.
- **A broken file does not stop the engine.** The broken file's endpoint is not registered and
  its requests **go to the backend**, which often answers `404` or something unexpected. The
  health check reports it (`503`, `status: "degraded"`, with the file's path); the error message
  is in the startup log (`docker compose -f docker-compose.staging-proxy.yml logs mockxy`). Fix
  it with a new PR, or go back to the previous version.

```bash
curl -s http://127.0.0.1:3000/_admin/api/health
```

The health check answers on Mockxy's port, not through the reverse proxy, which sends only
`/api/` to Mockxy.

### Variant: one folder per version

For a shorter downtime and an immediate return to the previous version, each version of the mocks
gets its own folder and a `current` link points to the one in use. The served folder never
changes under the engine.

```bash
cd /srv/mockxy-mocks                       # holds repo/, releases/ and current
git -C repo fetch
SHA=$(git -C repo rev-parse --short origin/main)
git -C repo worktree add --detach "../releases/$SHA" "$SHA"
ln -sfn "releases/$SHA" current
MOCKXY_WORKSPACE=/srv/mockxy-mocks/current MOCKS_VERSION=$SHA \
  docker compose -f docker-compose.staging-proxy.yml up -d --wait
```

To go back, move `current` to the previous folder and run `up` again with its `MOCKS_VERSION`.
Always `up`, not `restart`: a restart would follow the link, but the health check and the logs
would still report the old version.

## Reading the traffic

With the admin API off, traffic is read from the container's JSON logs. Every request ends with a
«Request completed» line that tells who answered (`mode`: `mock`, `handler`, `backend`, …) and,
for mocks, which endpoint and which variant ([the details](DEPLOYMENT.md#updating-and-checking)).
For example, the requests served by mocks in the last hour, with [jq](https://jqlang.org/):

```bash
docker compose -f docker-compose.staging-proxy.yml logs --since 1h --no-log-prefix mockxy \
  | jq -c 'select(.msg == "Request completed." and .mode != "backend")'
```

The browser can tell who answered too: every response carries the
[`x-mock-source`](PROXY.md#where-the-response-came-from-x-mock-source) header.

## Writing mocks for staging

Staging serves everyone the same behavior. A few rules for the mocks that reach it:

- **The selected variant is everyone's.** In git, select the normal case. Errors, empty lists and
  edge cases are tried locally with the desktop app.
- **Sequences with `resetAfterMs`, or none.** The cursor of a [sequence](RESPONSE.md#sequence-response)
  is one per endpoint: requests from different people consume it for each other. With
  `resetAfterMs` it starts over after a pause; otherwise a plain variant is better.
- **Shared handler state is the staging database.** An item created by one person shows up for
  everyone, and everything starts over from the seed file at every update
  ([shared runtime state](HANDLER.md#shared-runtime-state)).
- **The backend's own paths.** A mock answers in place of the backend, on the same path: when the
  backend arrives, turning the mock off is enough.

## Moving the boundary

When the backend releases an endpoint to staging, a PR on the mocks repository **disables** it
(`"enabled": false` in the [endpoint file](ENDPOINT.md#the-fields)) or removes it; after the
merge, [update](#updating-the-mocks) staging. From then on requests go to the backend, and
`x-mock-source` confirms it.

Mockxy does not do this on its own: a forgotten mock keeps answering even when the backend is
ready, and hides the real behavior in end-to-end tests. It is worth tying the step to the
backend's process, for example with an item in its release checklist: "is there a mock for this
endpoint? PR that disables it".

## What is not there

Choices made to keep staging simple, to be revisited on a concrete need: a read-only interface
(catalog, Monitor and History without actions), scenarios or variants per person, automatic
fallback to the mock when the backend does not implement an endpoint, several backends per
instance, headers added by the engine towards the backend, and mTLS.
