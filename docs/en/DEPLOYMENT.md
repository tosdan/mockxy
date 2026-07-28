# Running Mockxy: the deployment paths

Besides the [desktop app](DESKTOP.md), Mockxy runs in three ways. The compass for choosing:

| | Direct run | Development Docker | Standalone image |
|---|---|---|---|
| What it's for | development on your own machine | same purpose, without local Node | serving mocks to others (intranet, demos) |
| Admin API + UI | yes | yes | **no** |
| Proxy fallback | yes | yes | **no** (mock-only) |
| Hot reload of mocks | yes | yes | no |

In all cases the engine's configuration goes **through environment variables only** (or CLI):
the complete census is in [CONFIGURAZIONI.md](CONFIGURAZIONI.md), and the `.env.example` file
documents every variable — including host ports, which only concern Docker Compose.

## Direct run

```bash
npm install
cp .env.example .env      # recommended: configure at least BACKEND_URL and PORT
npm run dev:backend       # development, with mock watching
node index.js             # plain run
node index.js --delay=500 --delay-all   # with simulated latency (see docs/RITARDI.md)
```

The file is technically optional, but for real headless use you should create it and review
at least `BACKEND_URL` and `PORT`. Without `.env` the server listens on port `3000` and, with
no configured backend, stays in mock-only mode. Defaults are convenient for a first trial;
they do not replace an explicit configuration choice.

With `NODE_ENV=production` mock watching turns off and the admin API is disabled by default:
the right setup for a process that only has to serve.

## Development Docker

`docker compose up` starts the complete environment: the engine (host port `3000`) and the UI
with automatic reload (host port `4207`). Here too `.env` is technically optional but
recommended for real use; host ports can be changed with `MOCKXY_HOST_PORT` and
`MOCKXY_UI_HOST_PORT`.

The qualifying point is that **the workspace stays on the local filesystem**, mounted into the
container: hot reload, hand edits and git versioning work exactly as in the direct run. On
mounted volumes native filesystem events aren't reliable, so the watcher works in polling mode
where needed (`CHOKIDAR_USEPOLLING`).

## Standalone image

`Dockerfile.standalone` (used by `docker-compose.staging.yml`) applies the principle
**the application is distributed, the data is mounted**: the image contains only the engine,
already configured for pure serving — admin off, proxy fallback off, watch off,
`NODE_ENV=production`. Mocks and data files arrive at runtime as **read-only bind mounts**
on `/workspace/mocks` and `/workspace/files`:

- mocks are updated on the server's filesystem (a `git pull`), **with no rebuild** and no
  restart of the image;
- to serve another workspace you change the two mounts;
- the workspace's local part (`.mockxy`) **must never be mounted** ([anatomy](WORKSPACE.md)).

Two notes for use on an internal network: the bind is already `0.0.0.0` (safe here: the admin
is off — the full picture is in [RETE.md](RETE.md)), and if your colleagues' frontends call the
server **from the browser, from other origins**, you need `CORS_ENABLED=true`
([automatic CORS](CORS.md)).
