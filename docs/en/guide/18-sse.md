# 18 — Mocking streams: Server-Sent Events

Not all communication is request/response. With **Server-Sent Events** (SSE) the client
opens an HTTP request that stays open, and the server pushes events into it at will: it is
the typical protocol for notifications, job progress, update feeds. On the frontend side,
consumption is the `EventSource` API:

```js
const es = new EventSource("/api/jobs/42/events");
es.addEventListener("progress", (e) => update(JSON.parse(e.data)));
es.addEventListener("done", () => completed());
```

Mocking such an endpoint with a static response makes no sense — you need a response that
*unfolds over time*. The **SSE** variant type does exactly that: the connection stays open
and the events go out following a timed **script**, or live from the endpoint's
**console**.

## The script

An SSE variant is created from the new-response menu ([chapter 8](08-endpoint-panel.md));
its content is the event lineup. The guiding example — the progress bar:

```json
{
  "type": "sse",
  "title": "Job progress",
  "retryMs": 3000,
  "script": [
    { "afterMs": 0,    "event": "progress", "data": { "percent": 10 } },
    { "afterMs": 1500, "event": "progress", "data": { "percent": 60 } },
    { "afterMs": 3000, "event": "done",     "data": { "percent": 100 } }
  ],
  "onEnd": "keep-open"
}
```

- each **`script`** entry has `afterMs` (the delay **from the previous message**, not from
  the start), `data` (JSON — serialized on the wire — or a string, multi-line too) and,
  optionally, `event` and `id` — the SSE protocol fields;
- the script may also be **empty**: a silent endpoint, fed only from the console;
- **`onEnd`** decides what happens once the script is exhausted: `keep-open` (default —
  the connection stays open for heartbeats and manual pushes), `close` (the server
  closes), `loop` (it starts over; at least one positive `afterMs` is required, otherwise
  it would be an instantaneous loop);
- **`retryMs`** is the SSE `retry:` field sent at the head of the connection: the hint to
  the client about how long to wait before reconnecting;
- **`presets`** are the console's ready-made messages (below).

The most important rule: the script plays **on every connection, independently for each**
— reconnecting means starting from the top. It is consistent with how SSE clients work
(`EventSource` reconnects on its own), and it makes every test run reproducible.

During silences the engine sends a **heartbeat** comment every 15 seconds, invisible to
clients but enough to keep the connection alive through intermediate proxies and
timeouts.

> 📷 **SCREENSHOT** — `18-editor-sse.png`
> What to show: the SSE variant in the endpoint panel with the three-event progress/done
> script visible.

## The console: manual direction

When the SSE variant is selected, the endpoint panel shows the **console** in place of the
body preview: the **open connections** (each with its position in the script), the
**history** of sent messages — with the origin distinguished: script or manual — and the
composer for live sending: optional `event` field, `data` field (JSON or text,
`Ctrl+Enter` to send), **broadcast to all open connections**. From the history, any
message re-sends with one click; the variant's `presets` appear as ready macros.

The console turns frontend testing into an interactive session: the app open alongside,
and you direct the events by hand — "and what if an error arrives now?" — watching the UI
react in real time. With no connected clients, a send only lands in the history (the
console says so).

> 📷 **SCREENSHOT** — `18-console-sse.png`
> What to show: the SSE console with one active connection, a few messages in the history
> with different origins (script and manual) and the composer at the bottom.

## The operational details

- SSE connections are **closed on hot reload and on shutdown**: the client reconnects on
  its own and the script starts over — no state left hanging;
- the **monitor** entry for an SSE request is born **when the connection closes** (that is
  when status and duration are final);
- an SSE variant **cannot be a sequence step**;
- via the admin API: `POST /mocks/:id/sse/push` (send) and `GET /mocks/:id/sse/connections`
  (connections) — to drive the direction from scripts or tests.

SSE is one-directional: server → client. When the channel must speak both ways, the
protocol is WebSocket — and the mock also needs *reply rules*:
[chapter 19](19-websocket.md).
