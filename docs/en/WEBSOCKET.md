# WebSockets and upgrade requests

WebSockets are a different protocol: negotiated with an HTTP *upgrade* request, then
bidirectional frames that have nothing of the request/response pair. Mockxy treats them in
two complementary ways:

- **local mock** — an endpoint whose selected variant is of type [`ws`](RESPONSE.md) handles
  the handshake locally: message script, reply rules and a console with manual direction, no
  backend needed;
- **passthrough to the real backend** — everything else: the use case is the app that mocks
  its HTTP APIs but keeps a live connection to the backend for notifications or updates — and
  must not find it broken.

On upgrade the engine consults the mock registry (with the server on and outside Proxy All):
if the endpoint matches a `ws` variant the connection is served by the mock, otherwise the
tunnel described below applies. The rest of this page documents the **passthrough**.

## How it works

Upgrade requests don't go through the HTTP pipeline: no mocks, handlers, middleware,
[topology adaptations](CORS.md) or monitor. The engine handles them on a dedicated track:

1. **the handshake is forwarded to the backend** as-is (headers recreated correctly for the
   new leg, `Host` rewritten), protected by the request timeout;
2. if the backend accepts (`101 Switching Protocols`), the two sockets are **glued
   together**: bytes one way, bytes the other, with cross-closing — and **no inactivity
   timeout**, because a WebSocket can legitimately stay silent for a long time. The tunnel,
   once established, is protocol-agnostic;
3. if the backend **rejects** the handshake (e.g. `401` for missing authentication), its
   response is forwarded honestly to the client, so the error is diagnosable.

On server shutdown the active tunnels are closed explicitly: an open WebSocket never holds
the shutdown hostage.

## When the upgrade is rejected locally

Three cases get an HTTP rejection response without contacting anyone:

- **backend not configured** → `501`: for an upgrade that did not match a `ws` mock, without
  `BACKEND_URL` there is nowhere to forward it;
- **proxy fallback disabled** (mock mode) → `404`: mock-only mode applies to upgrades too;
- **`/_admin/...` paths** → `404`: the admin API has no upgrade endpoints.

In *full proxy* mode upgrades are always forwarded, consistently with the rest of the
traffic.
