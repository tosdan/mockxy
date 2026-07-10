# Troubleshooting

The toolbox is always the same, in this order: the **`x-mock-source`** header on the response
(who actually answered — [the taxonomy](PROXY.md)), the **[monitor](MONITOR.md)**
(what arrived and what was decided), and the **server log** (the errors with the offending
file). Below, the recurring symptoms by area.

## The mock doesn't answer

- **The request reaches the backend (or the 404) instead of the mock.** The mock-only 404 body
  already says a lot: `path_not_mocked` = no route matches (watch out for prefixes like `/api`
  and for the match on the whole path); `method_not_mocked` = the route is there but doesn't
  define that method — and there is **no** falling back to less specific routes
  ([the path convention](PATH.md)).
- **The endpoint has a query declared in the path.** The declared query requires **exact
  equality of the whole query**: one extra parameter — `page`, `size`, a filter — rules it out
  and the request slides to the query-less twin or to the fallback ([details](PATH.md)).
- **It answers, but with the wrong variant.** Only the **selected** variant counts
  ([endpoint file](ENDPOINT.md)); the others coexist inert, even if invalid.
- **The endpoint vanished after a hand edit.** An invalid file doesn't stop the server:
  the endpoint is skipped with a warning in the log (or keeps the last valid version on
  reload). A method+path **duplicate** in another folder is likewise discarded and
  reported ([per-endpoint degradation](ENDPOINT.md)).
- **It was a collection.** The collection switch writes `enabled` **in bulk** on the
  subtree: turning it back on also turns back on what had been switched off individually
  ([catalog](CATALOGO.md)).

## Filters and pagination

- **The filter doesn't filter.** The parameter's *name* must match the top-level key exactly
  (including case: it's the *value* that is case-insensitive), and the key must have scalar
  values ([lists](LISTE.md)).
- **Pagination doesn't kick in.** You need **both** `page` and `size`, valid; and the body
  must be an array or an object with *exactly one* top-level array.
- **`X-Total-Count` isn't the one declared in the mock.** With a filter or pagination active
  the computed value always wins.

## Errors from the proxy

- **`501 Backend Not Configured`** — the request was meant to reach the backend but
  `BACKEND_URL` isn't set (or you want mock-only mode: `PROXY_FALLBACK_ENABLED=false`).
- **`502 Bad Gateway`** — backend unreachable **or** timeout: the timeout only covers up to
  the first response headers ([full semantics](PROXY.md)). A backend that dies mid-stream
  shows up as a network error on the client side (explicit truncation), not as a 502.

## Handlers and middleware

- **`500 Handler Execution Failed`** — exception or invalid result in the script: the
  details, with the stack, are in the log ([the contract](HANDLER.md)).
- **`504 Handler Timeout`** — almost always a promise that never resolves (a fetch without a
  timeout); the file is named in the log.
- **`413 Payload Too Large`** — the request body exceeds 2 MB: the handler isn't even
  executed.
- **The middleware doesn't transform.** Responses over 10 MB and streams (`text/event-stream`)
  pass through intact with `x-mock-source: backend` and a warning in the log; a middleware
  that *fails* is fail-open: it lets the original response through ([middleware](MIDDLEWARE.md)).

## CORS, cookies and redirects

- **CORS error in the console** (missing `Access-Control-Allow-Origin`) — the frontend calls
  Mockxy from another origin and the option is off: [automatic CORS](CORS.md), or the dev
  server's proxy ([the two paths](FRONTEND.md)).
- **I turned CORS off but the browser still "works"** — preflights stay cached for up to
  10 minutes.
- **The login doesn't stick** — the login must go through Mockxy, the frontend must send the
  credentials (`withCredentials`), and [cookie adaptation](COOKIE.md) must be active;
  cross-site over http cookies don't travel anyway (use the token).
- **After a redirect the app talks to the backend directly** — the [redirect
  rewriting](REDIRECT.md) was disabled, or the `Location` points at a third-party host (which
  passes through untouched on purpose).

## Monitor and history

- **The monitor is empty** — the server is off ([global controls](CONTROLLI.md): full proxy
  records, server off doesn't), or you're looking at traffic the monitor excludes on
  purpose: admin/UI, preflights, WebSocket ([what it records](MONITOR.md)).
- **The history doesn't write** — writing to disk is **opt-in at runtime**: it must be turned
  on from the History page ([how it works](STORICO.md)).

## Reload and environments

- **File changes are not reloaded** — where native filesystem events don't arrive (Docker
  with mounted volumes, network shares) you need polling:
  `CHOKIDAR_USEPOLLING=true`.
- **`data()` fails** — the error message lists the available files; watch out for the
  lowercase canonical name and, outside the desktop app, for `FILES_DIR` being configured
  ([data files](DATI.md)).
- **Desktop app: port rejected** — an explicit change to a busy port is not applied; at
  startup, instead, the engine falls back to a free port on its own
  ([the desktop app](DESKTOP.md)).
