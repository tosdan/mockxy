# Global controls

In the top bar of the UI live two switches that govern the whole engine at runtime. They are
**two independent switches that produce three effective modes**:

| Mode | Mocks / handlers / middleware | Monitor | Proxy to the backend |
|---|---|---|---|
| **Active** (default) | yes | records | only for requests without a mock ([fallback](PROXY.md)) |
| **Full proxy** | no | records | everything |
| **Server off** | no | stopped | everything |

- **Full proxy** suspends the mocks without stopping anything: every request goes straight to
  the real backend, but the [monitor](MONITOR.md) keeps recording. It's the «observe the real
  backend» mode — to compare the real behavior with the mocks, or to capture traffic to turn
  into mocks. In this mode not even the middleware steps in: you see the backend truly as it
  is.
- **Server off** doesn't stop the process: the engine stays up as a **pure transparent
  proxy**, with mocks suspended *and* the monitor stopped. It serves to neutralize Mockxy
  without touching the configuration of the frontend pointing at it.

In both non-active modes, without a configured backend requests receive `501
Backend Not Configured`; [upgrade connections](WEBSOCKET.md) are always forwarded.

The state is **deliberately not persisted**: on every restart the engine goes back to active
mode. It's an operational switch, not workspace data — a forgotten «full proxy» doesn't
survive the session. Via API: `GET`/`PATCH /_admin/api/server`.
