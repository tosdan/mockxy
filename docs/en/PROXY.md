# The proxy fallback

The proxy fallback is what makes Mockxy a **movable boundary between mock and real**: requests
that have a mock get the mock, all the others continue on to the real backend. The boundary
moves one endpoint at a time — by adding a mock, disabling it, or turning the fallback off to
work in mock-only mode.

## The decision, request by request

The engine reserves for itself, case-insensitively, `/_admin/api` with every method and, when it
serves the UI (desktop app), `/_admin/ui` with `GET` and `HEAD`: there the engine itself answers.
Every other request, including the other paths under `/_admin` and the other methods on
`/_admin/ui`, goes through these steps (for WebSocket upgrades see [WEBSOCKET.md](WEBSOCKET.md)):

1. **Global checks.** With the mock server **off** or in **full proxy** mode (the two global
   switches in the UI), no mock, handler or middleware steps in: everything goes straight to
   the backend. Without a configured backend, the response is `501 Backend Not Configured`.
2. **CORS preflights.** With the CORS option enabled, the browser's `OPTIONS` preflights get
   an automatic answer before any forwarding (an explicit `OPTIONS` mock takes precedence).
3. **Route match.** The request is matched against the registered routes according to
   [the path convention](PATH.md): if the chosen route defines the method, the matching mock
   or [handler](HANDLER.md) answers (or the [middleware](MIDDLEWARE.md), which still goes
   through the backend).
4. **No mock.** For requests without a mock — route not found, or method not defined on the
   chosen route — the **proxy fallback** decides:
   - **enabled** (default) with a backend configured → the request is forwarded to the backend;
   - **disabled** → `404 Mock Not Found`, with the reason for the missed match in the body
     (`path_not_mocked` or `method_not_mocked`) and the route involved, if any;
   - enabled but **without a configured backend** → `501 Backend Not Configured`.

The fallback is controlled with `PROXY_FALLBACK_ENABLED` (headless) or with the «Proxy
fallback» switch in the workspace settings (desktop app); the backend with `BACKEND_URL` or the
«Backend URL» field. The complete inventory is in [CONFIGURAZIONI.md](CONFIGURAZIONI.md).

## What gets forwarded

The URL towards the backend is the configured base plus the request's path and query. **Only
path and query** are taken from the request: scheme, host and port are always those of
`BACKEND_URL`, however the request is written (`//other-host/x`, `/\other-host/x`,
`GET http://other-host/x` stay paths on the backend). A request therefore cannot carry the
cookies and the `Authorization` it comes with anywhere else.

If `BACKEND_URL` has a **path**, that path comes before the requested one, like nginx's
`proxy_pass` with a URI:

```
BACKEND_URL=https://gateway.example/service/v1
request:        GET /users?page=2
to the backend: GET https://gateway.example/service/v1/users?page=2
```

Mocks stay on the paths the client asks Mockxy for (`/users`), and `..` segments do not climb
above the `BACKEND_URL` path. On the way back the prefix is removed from
[redirects](REDIRECT.md#when-backend_url-has-a-path) and from the
[cookie `Path`](COOKIE.md#what-gets-adapted). The same holds for forwarded
[WebSocket upgrades](WEBSOCKET.md).

Request headers all pass through except the *hop-by-hop* ones (`Connection`,
`Transfer-Encoding` and the like, which belong to the single leg); `Host` is rewritten to the
backend's. The body travels **streaming**, without buffering: large uploads don't take up
memory.

The backend's response goes back to the client with the original status and headers (again
minus the hop-by-hop ones), plus the no-cache headers. Three options — the first two enabled by
default — adapt the response to the topology with Mockxy in the middle: the `Set-Cookie`
adaptation (`ADAPT_PROXY_COOKIES`), the rewriting of redirects pointing at the backend
(`REWRITE_PROXY_REDIRECTS`) and, when enabled, the engine's CORS policy (`CORS_ENABLED`).

## Https backends

With an `https` `BACKEND_URL` the proxy verifies the backend's certificate, as a browser does.
It trusts:

- the certificate authorities Node ships with;
- those of the **operating system's trust store** (Windows, macOS, the OpenSSL paths on
  Linux): the corporate CA installed on the machine, which the browser already accepts, works
  for Mockxy too with nothing to configure. The store is read at startup;
- those in the file named by **`NODE_EXTRA_CA_CERTS`** (a PEM file, a standard Node variable):
  the way to go for a container, where the CA is not in the system store.

  ```bash
  docker run -v ./corporate-ca.pem:/certs/ca.pem:ro -e NODE_EXTRA_CA_CERTS=/certs/ca.pem …
  ```

A certificate none of these knows — typically the **self-signed** one of a local backend — is
rejected, and the response is a `502` that says so (see below). For a backend you trust anyway
the verification can be turned off: `VERIFY_BACKEND_CERTIFICATE=false` (headless) or the
«Verify the backend certificate» switch in the workspace settings. When off, the proxy accepts
**any** certificate, even an expired one or one issued for another name: the engine reports it
in the log at startup. It applies to forwarded [WebSocket upgrades](WEBSOCKET.md) too. It is a
startup setting: it cannot be changed at runtime through the admin API.

## Errors and timeouts

- **Unreachable backend** (connection refused, DNS failure) → `502 Bad Gateway`.
- **Backend certificate not verified** → `502 Bad Gateway`, with a body that names the problem
  instead of the network: `details.code` is `BACKEND_CERTIFICATE_NOT_VERIFIED` and
  `details.reason` is Node's code (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` for an unknown CA,
  `DEPTH_ZERO_SELF_SIGNED_CERT` for a self-signed one, `CERT_HAS_EXPIRED`,
  `ERR_TLS_CERT_ALTNAME_INVALID` for a name that does not match). The log line carries
  `errorType: certificate_not_verified`. Remedies in [Https backends](#https-backends).
- **Timeout** (`requestTimeoutMs`): covers connecting, sending the request and waiting for the
  **first response headers**. Once exceeded, the response is still `502`. Once the response has
  started, the timeout **no longer applies**: a stream can stay silent for minutes or last for
  hours without being cut off — an upstream that dies midway shows up as a connection error.
- **Error after the response has started**: with the headers already sent there is no status
  left to change; the connection is closed *dirtily*, so the client perceives the truncation
  instead of mistaking it for a complete response.
- **Client walks away**: the leg towards the backend is closed immediately, without wasting
  upstream work.

## Where the response came from: `x-mock-source`

Every response carries the technical header **`x-mock-source`**, which is also the «Source»
entry in the monitor — the first diagnostic tool when a request doesn't do what you expect:

| Value | Meaning |
|---|---|
| `mock` | static response from a mock |
| `handler` | generated by a local handler |
| `middleware` | backend response transformed by a middleware |
| `backend` | proxied to the backend without transformations (including the middleware bypass on streams and over-threshold responses) |
| `mock-only` | `404` with the proxy fallback disabled |
| `backend-unconfigured` | `501` because no backend is configured |
| `cors-preflight` | `OPTIONS` preflight handled by the automatic CORS |
