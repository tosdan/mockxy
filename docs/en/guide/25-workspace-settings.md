# 25 — The workspace settings

The **Workspace settings** dialog (from the gear menu, in the desktop app) gathers all the
active workspace's tuning. This chapter walks it entry by entry, with pointers to the
chapter that goes deeper on each topic — it is part VI's catalog chapter, and will serve
as a reference.

Two general rules before the entries:

- **on save, the workspace's engine restarts** and the window reloads: open SSE/WS
  connections are closed (clients reconnect), and the runtime state — global switches,
  sequence cursors, handler `state` — is reset;
- almost everything is **local to the machine**: the settings live in
  `.mockxy/settings.json`, out of git ([chapter 24](24-mocks-as-files.md)). The only
  shared entry is the **title**, which sits in the `mockxy.json` marker because it is a
  project label, not a personal preference. One machine's port and backend URL would make
  no sense on a colleague's — the separation is designed that way.

For those running Mockxy headless: each of these entries exists as an environment
variable, with the same semantics — the full mapping is in
[chapter 31](31-headless-docker.md).

> 📷 **SCREENSHOT** — `25-dialog-alto.png`
> What to show: the upper part of the dialog — folder (read-only), title, port, Backend
> URL and the "Reachable from the whole network" switch with its warning visible.

## Identity and network

- **Folder** — the workspace's path, read-only: a workspace is not "moved" from the
  dialog.
- **Title** — the name shown in the tabs, shared with the team via git; empty = folder
  name.
- **Port** — this workspace engine's port (1024–65535). An explicit change to an occupied
  port is rejected with an error, applying nothing; stable-port management is in
  [chapter 28](28-desktop-workspaces.md).
- **Backend URL** — the real backend to forward unmocked requests to; must be an absolute
  URL (`http://localhost:8080`). **Empty = mock-only mode.**
- **Reachable from the whole network** — off (default): this computer only (`127.0.0.1`);
  on: bind on `0.0.0.0`, reachable from other devices. The warning accompanying the switch
  is not boilerplate: the admin API executes code, and whoever reaches the port can
  execute code on the machine — the full picture is in
  [chapter 29](29-network-security.md).

## Behavior

> 📷 **SCREENSHOT** — `25-dialog-comportamento.png`
> What to show: the dialog's Behavior section with all the switches and numeric fields
> visible.

- **Proxy fallback** — on (default): requests with no mock are forwarded to the backend;
  off: they answer 404 (mock-only). Not to be confused with the runtime bar's *proxy all*:
  the fallback decides behavior on **mock misses** and is a persistent configuration;
  proxy all bypasses **all** mocks and is a runtime switch that doesn't survive restarts.
- **Automatic CORS** — off by default: answers browser preflights and sets the CORS
  headers on every served response, overriding the policy of captured mocks and of the
  proxied backend. Needed only when a frontend on another origin calls Mockxy directly
  ([chapter 27](27-proxy-topology.md)).
- **Adapt proxied cookies** — on by default: removes `Domain`, `Secure` and
  `SameSite=None` from the `Set-Cookie` headers forwarded from the backend, so session
  cookies bind to Mockxy and survive over http. Turn off to observe the backend's original
  `Set-Cookie` headers ([chapter 27](27-proxy-topology.md)).
- **Rewrite proxied redirects** — on by default: proxied redirects pointing at the
  backend's own address are rewritten toward Mockxy, so the browser doesn't "escape"
  ([chapter 27](27-proxy-topology.md)).
- **Case-insensitive filters** — on by default: the automatic list filters
  (`?key=value`) compare values ignoring case
  ([chapter 11](11-lists-pagination-filters.md)).
- **Global delay (ms)** and **Delay proxied requests too** — simulated latency
  ([chapter 14](14-simulated-delays.md)).
- **Backend timeout (ms)** — default 15000: the maximum wait for proxied requests (up to
  the first response headers) **and for handler and middleware execution**
  ([chapters 15–16 and 26](26-proxy-fallback.md)).

## Monitor · on-disk dump

> 📷 **SCREENSHOT** — `25-dialog-dump.png`
> What to show: the "Monitor · on-disk dump" section with the four numeric fields and the
> defaults visible in the hints.

The four parameters of [chapter 22](22-dump-history.md)'s on-disk archive:

- **Flush cadence (ms)** — how often to write to disk (default 30000);
- **Flush threshold (entries)** — the number of pending entries that forces an early
  write (default 100);
- **Max size per file (bytes)** — beyond this, the dump file rotates (default 50 MB);
- **Folder total cap (bytes)** — once exceeded, the oldest dumps are deleted; `0`
  disables pruning (default 1 GB).

## What is not here

Three things often looked for in this dialog that live elsewhere: the **runtime switches**
(server, proxy all, dump) live in the runtime bar and are not persisted; the app's
**global preferences** (language, error log) are in the "App preferences" dialog
([chapter 28](28-desktop-workspaces.md)); and the **per-mock** properties (a variant's
delay, templating, sequences) are in the mock files, via the editor.

The next three pages go deeper into the topics this dialog governs: the
[proxy fallback and its errors](26-proxy-fallback.md), the
[browser–proxy–backend topology](27-proxy-topology.md), and the
[desktop multi-workspace](28-desktop-workspaces.md).
