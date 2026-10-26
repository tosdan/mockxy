# Rewriting proxied redirects

Third piece of the «browser → Mockxy → real backend» topology, after [automatic
CORS](CORS.md) and the [cookie adaptation](COOKIE.md): **redirects**. A backend that answers a
login — or a missing trailing slash — with an absolute `Location` towards its *own* address
(`Location: https://staging.example/home`) would take the browser out of Mockxy: from that
navigation on, requests would go straight to the backend, and the proxy, the adapted cookies
and the CORS policy would drop out of the loop with no signal at all.

That's why, **by default**, Mockxy rewrites the `Location` headers of proxied redirects that
point at the backend. The option is `REWRITE_PROXY_REDIRECTS` (headless) or the «Rewrite
proxied redirects» switch in the workspace settings.

## The rule

On every proxied response with a `Location` header:

- if the value is an **absolute URL whose origin matches the configured backend's**
  (`BACKEND_URL`), scheme, host and port are replaced with **the address the client used to
  reach Mockxy** (the request's `Host` header, `http` scheme: Mockxy doesn't do TLS); path,
  query and fragment pass through intact:

  ```
  request:        GET http://192.168.1.10:3000/login
  backend:        Location: https://staging.example/home?benvenuto=1
  to the client:  Location: http://192.168.1.10:3000/home?benvenuto=1
  ```

- **relative `Location` values** (`/home`) pass through intact: they are already correct by
  definition, because the browser resolves them against the host it is talking to;
- redirects towards **third-party hosts** — the corporate SSO, a CDN, a payment provider —
  pass through intact: rewriting them would send the browser onto a path that doesn't exist on
  Mockxy, breaking legitimate flows that *must* leave.

The rewriting uses the request's `Host` header, so it produces the right address both on
`localhost` and via LAN IP, with no configuration. If `BACKEND_URL` or the `Host` header
cannot be parsed, the rewriting simply doesn't kick in and everything passes as it was.

When to turn it off: to observe the backend's original redirects through the proxy — for
example when you are debugging the staging redirect chain itself.

## Behind a reverse proxy

If a reverse proxy (nginx, Traefik, an Ingress) sits in front of Mockxy and serves the site over
https, the browser is not talking to Mockxy: the `Host` header may be the internal one, and the
`http` scheme is wrong. The rewritten redirect would send the browser to `http://`: one extra
hop at best, a cleartext or HSTS-blocked request at worst.

With **`TRUST_PROXY=true`** the rewriting uses the public address, from the headers the proxy
sets:

- **`X-Forwarded-Proto`** for the scheme (`http` or `https`);
- **`X-Forwarded-Host`** for host and port; when it is missing, the `Host` header stays (nginx
  passes it with `proxy_set_header Host $http_host`).

```
request:    GET /login   Host: mockxy:3000
            X-Forwarded-Proto: https   X-Forwarded-Host: staging.app
backend:    Location: http://backend:8080/home
to client:  Location: https://staging.app/home
```

With several proxies in a chain, the first value of each header wins: the one from the proxy
facing the client. An invalid value (a scheme other than `http`/`https`, a host with a path or
credentials) is ignored, and the rewriting falls back on `http` and the `Host` header.

The option is off by default: without a proxy in front, anyone can send those headers. The
damage would stay confined to the sender's own response, but trust belongs only to a proxy that
is really there. The deployment picture is in [DEPLOYMENT.md](DEPLOYMENT.md#behind-a-reverse-proxy).
