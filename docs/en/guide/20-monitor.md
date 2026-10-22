# 20 — The monitor

The monitor is Mockxy's second pillar, next to the proxy: the real-time view of **all the
traffic** crossing the engine — mocked and proxied — with the full detail of every
exchange. It is the daily diagnostic tool ("what actually came in? who answered?") and,
from the next chapter, the source from which mocks are created with a click.

> 📷 **SCREENSHOT** — `20-monitor-panoramica.png`
> What to show: the monitor full of mixed traffic — entries served by mocks, handlers and
> the backend — with the source column clearly readable, the stats at the top (requests,
> errors, avg ms) and the filter bar visible.

## What gets recorded

Every request served by the engine, with three deliberate exclusions: the traffic of the
admin API and the interface itself (`/_admin/...`), the automatic CORS preflights, and
the WebSocket upgrade connections (which don't cross the HTTP pipeline).

The entry is written once the response completes and contains method, path and full URL,
status, latency, the **source** — the same values as the `x-mock-source` header, of which
the monitor is the visual legend — the matched route, and the headers and bodies of both
request and response. For endpoints with an active sequence, the entry also records the
step that served the request (**SEQ n/m** badge,
[chapter 12](12-variant-sequences.md)).

### The capture limits

Three rules worth knowing, because they explain what you see (and don't):

- the **sensitive headers** — `Authorization`, `Cookie`, `Set-Cookie`,
  `Proxy-Authorization`, `X-Api-Key`, `X-Auth-Token` — are **masked (`***`) at capture
  time**: secrets enter neither the view nor the on-disk archives. The rest of the payload
  may still contain personal data — which is why the archives stay out of git;
- **bodies** are captured up to **156 KB** each: beyond that, the preview is truncated and
  the entry says so, with the real byte count;
- **compressed** payloads are decompressed for the preview (unless truncated); **binary**
  ones show a placeholder with the size; JSON is pretty-printed.

The live view keeps the last **250 requests** in memory: for the window beyond that, there
is the on-disk archive of [chapter 22](22-dump-history.md).

## When it records

Recording follows the server's global switch ([chapter 5](05-ui-tour.md)): with the server
off, the monitor is stopped; in **proxy all it stays active** — that is precisely the
"observe the real backend to capture" mode. The "Live / Paused" badge at the top of the
page reflects the interface's live connection state (updates arrive streaming), and the
pause switch in the runtime bar suspends the view's updating.

## Reading the list

The columns: method and path, status, source, latency and time. The filters, combinable:

- **free text** over path and URL;
- **HTTP method**;
- **status class** (2xx … 5xx);
- **source** ("Served by") — one entry per value (mock, handler, middleware, proxy, miss)
  plus the combined **"Real backend"** entry: everything that did *not* come out of the
  workspace's mocks or handlers — the natural view when observing the traffic that flows
  through the real backend.

The **"Clear"** button empties the live list at any time (the on-disk archive is not
touched); **"Export"** saves the entries as JSON.

> 📷 **SCREENSHOT** — `20-monitor-filtri.png`
> What to show: the monitor with the source filter set to "Real backend" and the list
> narrowed accordingly; the method and status-class filters visible too.

## An entry's detail

Selecting an entry opens the detail, in four sections: request headers and body, response
headers and body (the panels resize by dragging the divider). From here:

- **copy as cURL** — the command ready to re-run in a terminal: the quickest way to
  reproduce a call outside the browser, attach it to an issue, or replay it varying a
  parameter;
- **export** the entry as JSON;
- **"Open the definition in the catalog"** — on entries served by a mock, the direct jump
  to the endpoint that generated them;
- **"Go to mock"** — on entries that went through the backend whose route is *today*
  covered by a catalog endpoint, the link to that endpoint (flagged even when disabled).
  Coverage is computed on the spot: the badge appears and disappears following the
  catalog's evolution, and the captured entry is never altered.

> 📷 **SCREENSHOT** — `20-monitor-dettaglio.png`
> What to show: an entry's detail with the four request/response × headers/body sections
> visible and the actions (cURL, export) in evidence.

## The working method

The monitor is the fixed second step of the diagnosis introduced in chapter 2: first
`x-mock-source` on the response (who answered), then the monitor (what came in and what
was decided), then the log (the errors with the offending file). Most of the "why isn't my
mock answering?" cases are solved here, looking at the path *actually* called and the
source *actually* assigned — [chapter 33](33-troubleshooting.md) catalogs the cases.

Observing is half the job; the other half is **capturing**: turning monitor entries into
mocks, one at a time or in bulk — [chapter 21](21-traffic-to-mocks.md).
