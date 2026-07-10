# The monitor

The monitor is Mockxy's second pillar, next to the proxy: it **observes real traffic** —
mocked and proxied — and lets you **turn it into mocks** with one click. It's the tool that
moves the mock/real boundary in practice: you navigate the application against the real
backend, look at what went through, and what you need becomes a mock.

The live view keeps the last **250 requests** in memory; beyond that window, traffic is
archived to disk by the monitor dumps (the «Dump history» page of the UI), with configurable
rotation and retention — see [CONFIGURAZIONI.md](CONFIGURAZIONI.md).

## What gets recorded

Every request served by the engine, with three deliberate exclusions: the admin API and UI
traffic (`/_admin/...`), the [automatic CORS preflights](CORS.md) and the [upgrade
connections](WEBSOCKET.md), which don't go through the HTTP pipeline.

The entry is written **once the response completes** and contains: method, path and full URL,
status, latency, the **origin** (the same values as the `x-mock-source` header — the
[taxonomy](PROXY.md) is the monitor's legend), the matched route and any references to the
middleware involved, plus request and response headers and bodies.

## Masking and capture limits

- Sensitive headers — `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`,
  `X-Api-Key`, `X-Auth-Token` — are **masked** (`***`) already at capture time: secrets enter
  neither the view nor the on-disk archives. The rest of the payload, though, can still
  contain personal data: that's why the archives stay out of git.
- Bodies are captured up to **156 KB** each: beyond that, the preview is truncated (and the
  entry says so, along with the real byte count).
- **Compressed** payloads are decompressed for the preview; if the capture is truncated,
  decompression isn't possible and a placeholder with the size remains. **Binary** payloads
  show a placeholder with the byte count. JSON is reformatted for readability.

## When it records

Recording follows the global **server** switch: with the server off the monitor is stopped;
in **full proxy** mode it stays active — that's precisely the «observe the real backend to
capture» scenario ([the full flow](PROXY.md)). The «Live / Paused» badge at the top of the
page reflects the state of the UI's live connection (updates arrive as a stream), not a
switch of its own.

## The page

The list filters by free text, method, status class and response origin — the «Served by»
filter, with one option per origin (mock, proxy, handler, middleware, miss) plus the combined
«**Real backend**» option: everything that didn't come out of the workspace's mocks or
handlers, the natural view when observing the traffic flowing through the real backend. An
entry's detail shows the complete request and response (headers and body), exports to JSON
and copies as a cURL command ready to re-run; from entries served by a mock you jump straight
to the endpoint that generated them. The list can be cleared at any time (the on-disk archive
is untouched).

## From traffic to mock

From an entry's detail — or in bulk, selecting multiple entries — you create a mock with the
structure already in place: method and path from the request, status, headers and body from
the response. The carry-over rules:

- **masked** headers don't end up in the mock (no fossilized `***`), and neither do the ones
  the server recomputes on its own (`Content-Length` and the like);
- a body that **can't be reconstructed** — binary, or truncated because it exceeded the
  capture threshold — still produces the mock, but as a **skeleton to complete**, flagged in
  the description;
- the CORS headers of the captured response travel in the mock like all the others: with the
  [Automatic CORS](CORS.md) option on, it's the engine's policy that wins over them;
- if for that route and method **the endpoint already exists**, instead of an error the app
  offers to add the captured response as a **new variant** of the existing endpoint: the
  variant is created with the title «from monitor · HH:mm:ss» and becomes the **selected**
  one (the others stay intact, ready to be reselected). **Bulk** creation, instead, keeps
  skipping existing endpoints, on purpose: a batch must not fire off question after question.

The created mock is an endpoint like any other ([endpoint file](ENDPOINT.md) + variant): you
refine it from the catalog or by hand, and from that moment the mock/real boundary has moved
by one endpoint. The confirmation toast offers the **«Open the created mock»** shortcut, and
the detail of a backend entry shows **«Go to mock»** when its route is *today* covered by a
catalog endpoint (even a disabled one, flagged as such). Coverage is a **derived** fact,
asked of the engine on the spot: the captured entry is never altered, and the link appears or
disappears on its own, following the catalog's evolution.
