# Detailed documentation

Per-feature deep dives, complementary to the main [README](../../README.md) (which remains the
overview and the quickstart). The plan that produced these pages is complete and archived
([archived/PIANO-DOCS.md](../../archived/PIANO-DOCS.md)); the living rule: every new feature or
changed behavior updates the relevant page in the same round as the code.

## Pages

- [Anatomy of a workspace](WORKSPACE.md) — the folder structure: the shared part
  (mocks, data files, placeholder) and the local part (settings, captured traffic), lifecycle,
  what to share with your team.
- [The endpoint file](ENDPOINT.md) — the JSON that declares each mocked endpoint: name and
  location, fields, variants and the selected variant, validation, per-endpoint degradation and
  hot reload.
- [The response file](RESPONSE.md) — the variants: static responses (status, headers, JSON or
  textual body, file payload served streaming, delay), handlers and middleware as links to
  scripts, validation of the selected variant only.
- [The path convention](PATH.md) — how the answering endpoint is chosen: named parameters,
  declared query (exact equality), specificity rules, method check after the route has been
  chosen and diagnosing missed matches.
- [Lists: filters and pagination](LISTE.md) — the automatic behaviors on list bodies: equality
  filters from query parameters (AND/OR, comparison as strings, configurable
  case-insensitivity), pagination with `page`/`size` and the `X-Total-Count` header.
- [Simulated delays](RITARDI.md) — per-variant latency, global and extended to the proxy:
  precedence rules, what never gets delayed and where each level is configured.
- [Handlers](HANDLER.md) — responses computed by local scripts: the contract of
  `resolveResponse`, the context received (params, query, headers, body in three forms,
  `data()`), the result format, errors, timeouts and limits.
- [Proxy middleware](MIDDLEWARE.md) — transforming the real backend's responses: the
  contract of `transformResponse`, headers merged on top of the backend's, the bypass cases
  (streams, over 10 MB) and the fail-open behavior on errors.
- [Data files and `data()`](DATI.md) — the reusable JSON datasets: the on-disk contract
  (canonical names, flat folder), re-read and per-call copy semantics, the Data page
  (upload, safe rename with reference rewriting), size limits.
- [The proxy fallback](PROXY.md) — the request-by-request mock/proxy decision, what gets
  forwarded to the backend, errors and timeout semantics (up to the first headers), and the
  full taxonomy of the `x-mock-source` header.
- [Automatic CORS](CORS.md) — when you need it (browser frontend on another origin), the
  origin-reflecting policy that wins over captured mocks and proxied responses, the automatic
  preflights and the precedence of `OPTIONS` mocks.
- [Proxied cookie adaptation](COOKIE.md) — why the backend's `Set-Cookie` headers need
  adapting (Domain, Secure, SameSite=None), how a session works through Mockxy and the
  limits that remain (different sites over http).
- [Proxied redirect rewriting](REDIRECT.md) — absolute `Location` values pointing at the
  backend mapped back to Mockxy's address; relative ones and third-party hosts untouched.
- [WebSocket and upgrades](WEBSOCKET.md) — pure passthrough to the backend: handshake
  forwarded, tunnel with no inactivity timeout, honest refusals (501 without a backend, 404 in
  mock-only mode).
- [Network exposure](RETE.md) — loopback by default and why, how to expose (env, dialog,
  Docker), the admin API's anti DNS-rebinding defense and the reminder for the LAN case.
- [The mock catalog](CATALOGO.md) — the working view: nested collections and their
  semantics (deletion that doesn't touch the mocks, bulk enabling), creating/copying/
  editing endpoints, variants and the editor with its validations, binary file upload.
- [The monitor](MONITOR.md) — traffic capture: what gets recorded and what is excluded,
  secret masking and capture limits, the page's filters and turning traffic into mocks
  (skeletons included).
- [The dump history](STORICO.md) — the monitor's persistent memory: switched on at runtime,
  NDJSON with per-session and per-size rotation, retention with a total cap, bulk mock
  creation from the archives.
- [Global controls](CONTROLLI.md) — two switches, three modes (active, full proxy, server
  off as a pure proxy): what stays on in each one and why the state is not persisted.
- [OpenAPI import](OPENAPI.md) — the base to refine: accepted formats, what gets
  generated (paths, statuses, bodies from examples or sampled), existing mocks never touched,
  dry-run preview and the anti-CSRF defense on the endpoint.
- [The UI language](LINGUA.md) — Italian and English: where the choice lives in the
  browser and in the desktop app, native dialogs included.
- [The admin API](ADMIN-API.md) — the complete reference of the routes under `/_admin/api`
  (catalog, variants, collections, import, data files, monitor, server state), with the
  conventions on ids, errors, runtime reload and the anti-CSRF defenses.
- [The desktop app](DESKTOP.md) — multiple workspaces in parallel with one engine each, the
  tab bar, stable ports, the settings dialog (shared title, the rest local),
  portable preferences and packaging.
- [Deployment options](DEPLOYMENT.md) — direct run, development Docker (workspace
  mounted from the filesystem) and standalone image (engine only, read-only bind mounts), with
  a compass for choosing.

## Guides

- [The usage scenarios](SCENARI.md) — the step-by-step walkthroughs behind the proxy+capture
  design: staging reset, contract ahead of the backend, the mock/real boundary that moves, the
  hard-to-reproduce case.
- [Wiring up the frontend](FRONTEND.md) — dev-server proxy or direct cross-origin calls:
  what each route requires and how to verify that everything goes through Mockxy.
- [Troubleshooting](TROUBLESHOOTING.md) — symptom by symptom, area by area, with the
  toolbox (`x-mock-source`, monitor, logs) and pointers to the detail pages.
- [Configuration](CONFIGURAZIONI.md) — the complete census: every engine option, its
  environment variable, its default and whether it appears in the workspace dialog.

## For Mockxy developers

The pages above are for those who **use** Mockxy. If you work **on its code**, the rest lives in
two thematic folders (internal docs, Italian):

- [`sviluppo/`](../sviluppo/) — [development troubleshooting](../sviluppo/TROUBLESHOOTING-DEV.md)
  (environment, tests, builds — e.g. the watcher crash with 8.3 short paths on Windows), the
  [e2e server architecture note](../sviluppo/E2E-ARCHITETTURA-SERVER.md) and the two open
  technical analyses ([admin mutation concurrency](../sviluppo/CONCORRENZA-ADMIN.md),
  [the admin/loader duplicated workspace contract](../sviluppo/CONTRATTO-ADMIN-LOADER.md)).
- [`progetto/`](../progetto/) — the living working documents: [product backlog](../progetto/BACKLOG-PRODOTTO.md),
  [future ideas](../progetto/IDEE-FUTURE.md), [TODO](../progetto/TODO.md) and the
  [publication checklist](../progetto/PUBBLICAZIONE.md).
