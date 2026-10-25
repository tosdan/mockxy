# 19 — Mocking WebSockets

WebSockets are the previous chapter's bidirectional twin — and a protocol of their own:
the connection starts from a normal HTTP **upgrade** request, after which client and
server exchange **frames** in both directions, with no request/response pairing anymore.
It is the typical channel for push notifications, chat, live updates. On the frontend
side:

```js
const ws = new WebSocket("ws://localhost:3000/api/notifications");
ws.onmessage = (e) => show(JSON.parse(e.data));
ws.send(JSON.stringify({ action: "subscribe", channel: "orders" }));
```

Mockxy treats WebSockets in two complementary ways: the **local mock** — an endpoint whose
selected variant is of type `ws` handles the handshake in-house and talks to the client
via script, rules and console — and the **passthrough**: every upgrade that does *not*
match a `ws` endpoint is forwarded to the real backend. The passthrough is half the value:
the common use case is an app that mocks the HTTP APIs but keeps the **real** notification
connection to the backend alive — and must not find it broken.

## The `ws` variant

```json
{
  "type": "ws",
  "title": "Notification channel",
  "script": [
    { "afterMs": 0,    "data": { "kind": "welcome" } },
    { "afterMs": 2000, "data": { "kind": "promo", "discount": 20 } }
  ],
  "onEnd": "keep-open",
  "rules": [
    { "match": { "equals": "ping" }, "reply": [{ "afterMs": 0, "data": "pong" }] },
    { "match": { "json": { "action": "subscribe" } },
      "reply": [{ "afterMs": 100, "data": { "result": "subscribed" } }] }
  ]
}
```

Three combinable mechanisms:

- **the script (`script`)** — the outgoing messages, with the same mechanics as SSE:
  `afterMs` from the previous message, `data` as JSON or string, playing **on every
  connection independently**. It may be empty (a silent endpoint: rules and console only).
  `onEnd` allows `keep-open` (default), `loop`, and `close` — here with optional
  `closeCode` and `closeReason` (code `1000` or `3000`–`4999`) to exercise how the
  frontend handles closures;
- **the rules (`rules`)** — the declarative replies to **incoming** messages. Each rule
  has a `match` with **exactly one** of `equals` (exact text), `contains` (substring) and
  `json` (the message is JSON and contains the given pairs — top-level subset comparison),
  and a `reply`: a lineup like the script, sent **only to the connection that spoke**.
  Rules are evaluated in order and **the first match wins**. A message with no matching
  rule is only recorded in the transcript: no default echo. The philosophy is stated — no
  logic in the rules: when real computation is needed, the right place is a handler on an
  HTTP endpoint;
- **the console** — the manual direction (below).

Two rules worth reading: the first is the classic ping/pong (the client sends the text
`ping`, gets `pong` back); the second answers a JSON subscribe message with a confirmation
— enough for the realistic "subscribe → confirm → events from the script" notification
flow.

> 📷 **SCREENSHOT** — `19-editor-ws.png`
> What to show: the WS variant in the endpoint panel with the script and at least one rule
> filled in (the subscribe/confirmation example).

## The console and the transcript

With the `ws` variant selected, the panel shows the console: the open **connections**
(with message counts and script position) and the **bidirectional transcript** — ▶ the
messages that went out (with their origin: script, rule, or manual) and ◀ those received
from clients. The composer **broadcasts** to all connections (`Ctrl+Enter`), any payload
in the transcript re-sends with one click, and the variant's `presets` serve as macros.

The transcript is also a diagnostic tool: you read the full conversation — what the
frontend really sent, which rule answered what — with no external tooling.

> 📷 **SCREENSHOT** — `19-console-ws.png`
> What to show: the WS console with an active connection and a transcript populated in
> both directions (▶/◀ arrows, different origins: script, rule, manual).

## Upgrade routing

When an upgrade request arrives, the engine consults the mock registry (with the server
active and outside proxy all): if the endpoint matches a `ws` variant, the connection is
served by the mock; otherwise the upgrade is **forwarded to the real backend**
(`BACKEND_URL` and active proxy fallback required). Upgrade connections do not cross the
HTTP pipeline: they don't appear in the monitor, and in server-off or proxy-all mode they
are always forwarded.

A *normal* HTTP request (no upgrade) on an endpoint whose selected variant is `ws`
receives **`426 Upgrade Required`** — the signal that a WebSocket channel is being called
as if it were a REST endpoint.

## The operational details

- during silences the engine sends a protocol **ping** every 30 seconds, permissively: a
  missed pong does not close the connection;
- on hot reload and shutdown the connections are closed: the client reconnects and the
  script starts over;
- a `ws` variant **cannot be a sequence step**;
- via the admin API: `POST /mocks/:id/ws/push` and `GET /mocks/:id/ws/connections`.

With SSE and WebSocket, part III closes: every response nature is covered. Part IV changes
perspective — no longer *building* responses, but *observing and capturing* the real ones:
starting with the [monitor](20-monitor.md).
