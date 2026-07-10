# Simulated delays

Locally every response arrives within a few milliseconds, and the frontend always looks
perfect: spinners are never seen, race conditions don't show up, timeouts never fire. Simulated
delays bring latency back into the picture — to see the interface the way a user on a real
network will see it.

## The three levels

1. **Per variant** — the `delayMs` field in the [response file](RESPONSE.md) of type `mock`:
   a delay in milliseconds applied before responding, specific to that variant. Useful to
   simulate the single slow endpoint (the heavy search, the export).
2. **Global** — a delay applied to **all mocks that don't declare their own `delayMs`**.
   When a variant has a `delayMs` greater than zero, **it wins over the global one**: the two
   don't add up.
3. **On the proxy too** — by default the global delay only concerns mocks; with the dedicated
   option it extends to **proxied requests** towards the real backend (including the
   full-proxy passthrough). The delay adds to the backend's real time and is applied *before*
   forwarding: the timeout towards the backend is not consumed by it.

## What doesn't receive delays

- **Handler responses**: a script that wants to simulate slowness can simply wait on its own
  (`await` on a timer) — the engine adds nothing.
- Local service responses: the `404` in mock-only mode, the `501` without a configured
  backend, the automatic CORS preflights.

## Where it's configured

- **Desktop app**: workspace settings, the "Global delay (ms)" and "Delay proxied requests
  too" entries (per-workspace, the engine restarts on change).
- **Command line**: `--delay=<ms>` and `--delay-all` flags
  (`node index.js --delay=500 --delay-all`, or `npm run dev:backend -- --delay=500`).
- **Docker Compose**: `MOCKXY_DELAY` and `MOCKXY_DELAY_ALL` variables, which the compose
  translates into the launch flags — the engine alone doesn't read them.

The complete inventory, with the defaults, is in [CONFIGURAZIONI.md](CONFIGURAZIONI.md).
