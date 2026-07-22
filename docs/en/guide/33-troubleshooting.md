# 33 — When something goes wrong: troubleshooting

Diagnosis in Mockxy always uses the same three tools, in this order:

1. **`x-mock-source`** on the response — *who* actually answered
   ([the taxonomy](26-proxy-fallback.md));
2. the **monitor** — *what* came in and what was decided
   ([chapter 20](20-monitor.md));
3. the **server log** — the errors, with the offending file: the terminal when headless,
   the `logs/` folder in the desktop app ([chapter 28](28-desktop-workspaces.md)).

Nearly every symptom is solved without going past the first or second step. Below, the
recurring cases by area, in symptom → diagnosis → remedy form.

## The mock doesn't answer

- **The request reaches the backend (or the 404) instead of the mock.** In mock-only mode
  the 404 body already says it all: `path_not_mocked` = no route matches — watch the
  prefixes (an extra or missing `/api`) and remember the match covers the whole path;
  `method_not_mocked` = the route exists but doesn't define that method, and there is
  **no** falling back to less specific routes
  ([chapter 7](07-creating-endpoints.md)). With the fallback on, the same diagnosis is
  done from the monitor: "backend" as the source where you expected "mock".
- **The endpoint has a declared query in the path.** The declared query demands exact
  equality of the *entire* query: one extra parameter — `page`, `size`, a filter —
  excludes it, and the request slides onto the query-less twin or to the fallback
  ([chapter 7](07-creating-endpoints.md)).
- **It answers, but with the wrong variant.** Only the **selected** variant counts; and if
  the endpoint has an **active sequence**, the sequence is in charge, not the selection —
  the SEQ badge in the catalog flags it ([chapter 12](12-variant-sequences.md)).
- **The endpoint vanished after a hand edit.** An invalid file doesn't stop the server:
  the endpoint is skipped with a warning in the log, or keeps its last valid version on
  reload. A **duplicate** method+path in another folder is also discarded and flagged
  ([chapter 24](24-mocks-as-files.md)).
- **"It was on, I swear".** A collection's switch writes the state **in bulk** onto the
  subtree: re-enabling the collection also re-enables what had been switched off
  individually ([chapter 6](06-catalog.md)). And a **proxy all** left on bypasses all
  mocks — the runtime bar shows it ([chapter 5](05-ui-tour.md)).

## Filters and pagination

- **The filter doesn't filter.** The parameter's *name* must match the top-level key
  exactly (it is the *value* that is case-insensitive), and the key must hold scalar
  values ([chapter 11](11-lists-pagination-filters.md)).
- **Pagination doesn't kick in.** **Both** `page` and `size` are required, and valid; and
  the body must be an array, or an object with a single top-level array.
- **`X-Total-Count` isn't the one declared in the mock.** With the automations active the
  computed value always wins.

## Errors from the proxy

- **`501 Backend Not Configured`** — the backend was needed but `BACKEND_URL` isn't set:
  configure it, or knowingly switch to mock-only
  ([chapter 26](26-proxy-fallback.md)).
- **`502 Bad Gateway`** — backend unreachable, **or** a timeout: the timeout only covers
  up to the first response headers. A backend dying mid-stream shows up as a network error
  on the client, not as a 502.

## Handlers and middleware

- **`500 Handler Execution Failed`** — an exception or an invalid result in the script:
  stack and file are in the log ([chapter 15](15-handlers.md)). A classic:
  `data is not defined` — `resolveResponse` is missing `data` among the destructured
  context fields.
- **`504 Handler Timeout`** — almost always a promise that never resolves (a fetch
  without a timeout); the file is in the log.
- **`413 Payload Too Large`** — the request body exceeds 2 MB: the script doesn't even
  run.
- **The middleware doesn't transform.** Three possibilities, all readable from
  `x-mock-source`: response over 10 MB or a stream (`backend`, with a warning in the log);
  a failed middleware — fail-open, the original passes (`backend`, error in the log);
  proxy all active (middleware doesn't intervene at all).
  [Chapter 16](16-middleware.md).

## CORS, cookies and redirects

- **CORS error in the console.** The frontend calls Mockxy from another origin and
  automatic CORS is off: turn it on — or, better, go through the dev server proxy, where
  the problem doesn't exist ([chapters 4 and 27](04-connect-your-frontend.md)).
- **I turned CORS off but the browser still "works".** Preflights stay cached for up to
  10 minutes.
- **The login doesn't stick.** The login must **go through Mockxy**, the frontend must
  send credentials (`credentials: 'include'` / `withCredentials`), and cookie adaptation
  must be on. Cross-site over http, cookies don't travel anyway: use the token there
  ([chapter 27](27-proxy-topology.md)).
- **After a redirect the app talks to the backend directly.** Redirect rewriting was
  turned off, or the `Location` points at a third-party host — which passes intact on
  purpose ([chapter 27](27-proxy-topology.md)).

## Monitor and history

- **The monitor is empty.** The server is off (proxy all records, server off doesn't); or
  you are looking at traffic the monitor excludes on purpose: admin/UI, preflights,
  WebSocket upgrades ([chapter 20](20-monitor.md)). If *one specific app call* doesn't
  show up, that call isn't going through Mockxy: base URL or proxy rule
  ([chapter 4](04-connect-your-frontend.md)).
- **The history doesn't write.** On-disk writing is opt-in: turn it on with the Dump
  switch ([chapter 22](22-dump-history.md)).

## Reload and environments

- **File changes are not picked up.** Where filesystem events don't arrive (Docker with
  mounted volumes, network folders) you need polling: `CHOKIDAR_USEPOLLING=true`
  ([chapter 31](31-headless-docker.md)).
- **`data()` fails.** The error message lists the available files; mind the canonical
  lowercase name and, outside the desktop, the `FILES_DIR` configuration
  ([chapter 17](17-data-page.md)).
- **Desktop app: port rejected.** An explicit change to an occupied port is not applied;
  at startup, instead, the engine falls back to a free port on its own
  ([chapter 28](28-desktop-workspaces.md)).

> 📷 **SCREENSHOT** — `33-diagnosi-monitor.png`
> What to show: the monitor used for diagnosis — a request with an unexpected source
> ("backend" where "mock" was expected) open in the detail, with the actually-called path
> in evidence. May reuse chapter 26 material if equivalent.

What remains are the pure-consultation pages — shortcuts, glossary and the "where do I do
what" index: the [appendices](34-appendices.md).
