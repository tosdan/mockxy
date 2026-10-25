# 14 — Simulating slowness: delays

Locally every response arrives in a few milliseconds, and the frontend always looks
perfect: spinners never show, race conditions never surface, timeouts never fire. Those
are bugs that only appear at the customer's, on a real network. Simulated delays bring
latency back into the picture during development — to see the interface the way a real
user will.

## The three levels

1. **Per variant** — the **Delay (ms)** field in the response editor
   ([chapter 9](09-mock-response-editor.md)): the delay of that single response. It is the
   tool for the *single slow endpoint* — the heavy search, the export, the upload — where
   the frontend must show a dedicated waiting state.
2. **Global** — a delay applied to **every mock that declares no delay of its own**: the
   slow-network emulation for the whole application. Precedence rule: when a variant has a
   delay greater than zero, it **wins over the global one** — the two do not add up.
3. **On the proxy too** — by default the global delay concerns mocks only; the dedicated
   option extends it to **requests forwarded to the real backend** (proxy all included).
   The delay applies before forwarding and adds to the backend's real time; the backend
   timeout is not consumed by it. It is for when you want uniform slowness across
   everything, not just the mocked part.

Never delayed: **handler** responses (a script that wants to be slow waits internally,
with a timer), and the engine's service responses (the mock-only 404, the 501 with no
backend, CORS preflights).

## Where it is configured

- **Per variant**: the Delay field in the response editor.
- **Global and proxy** — depending on the execution form:
  - desktop app: workspace settings, "Global delay (ms)" and "Delay proxied requests too"
    (the workspace engine restarts on save);
  - command line: `node index.js --delay=500 --delay-all` (or
    `npm run dev:backend -- --delay=500`);
  - Docker Compose: the `MOCKXY_DELAY` and `MOCKXY_DELAY_ALL` variables, which compose
    translates into the launch flags.

> 📷 **SCREENSHOT** — `14-impostazioni-ritardi.png`
> What to show: the Behavior section of the workspace settings dialog with "Global delay
> (ms)" set (e.g. 800) and the "Delay proxied requests too" switch visible.

## What to watch in the frontend

A few checks that delays finally make possible:

- **loading states**: do spinners and skeletons actually appear? do they stay visible
  without "flashing"? do they disappear at the right moment?
- **double-submit protection**: with a 2-second `POST`, does the submit button disable?
  does clicking twice create two resources?
- **race conditions**: two in-flight requests returning in reverse order (a slow search
  overtaken by the next one) — does the UI show the right result or the last to arrive?
- **timeouts and cancellation**: with a per-variant delay beyond the frontend HTTP
  client's timeout, does the intended error handling kick in? does navigating away cancel
  pending requests?

The typical working pattern: a moderate global delay (300–800 ms) always on during
development, to live the app at realistic speed; targeted, generous delays (3000+ ms) on
the variants of the endpoints whose waiting state you are polishing; one variant with a
delay beyond the client timeout to try the edge case.

This closes part II: static mocks, with all their levers. Part III moves to responses
that *compute* — starting with [JavaScript handlers](15-handlers.md).
