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
