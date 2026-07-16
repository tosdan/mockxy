# Mockxy configuration

A complete census of every configurable option, by **level**. Mockxy is configured on distinct
levels that coexist:

1. **Engine** — environment variables / `.env` / CLI arguments, materialized in `src/config.js`
   (`loadConfig`). It's the core: everything else either goes through here (as overrides) or belongs to another level.
2. **Workspace** (desktop app) — per-workspace local settings in `<workspace>/.mockxy/settings.json`,
   editable from the **Workspace settings dialog**. They are passed to the engine as overrides and, on
   change, the workspace's engine **restarts**.
3. **Global app preferences** (desktop app) — `mockxy-prefs.json` in Electron's user data directory
   (next to the executable only in the Windows portable build).
4. **Operational runtime** — in-memory switches, not persisted (runtime-bar / admin API).
5. **Per-mock** — properties of the single endpoint/variant, in the mock files.
6. **Docker / Compose** — container-level and orchestration-level variables.

> Important note: the **packaged** desktop app has no `.env` next to the executable, so the
> engine options that are not exposed as a workspace setting stay at their **default**.
> That's why the per-workspace behavioral options live in the dialog (level 2).

---

## 1. Engine (`src/config.js`)

Every option is read from `overrides` (passed by the desktop app/tests) **or** from the indicated
environment variable, with a fallback to the default. The "Workspace dialog" column says whether it
can also be set per-workspace from the desktop app.

| Key (`config`) | Env var / CLI | Default | What it does | Workspace dialog |
|---|---|---|---|---|
| `port` | `PORT` | `3000` | Port the engine listens on | ✅ |
| `host` | `HOST` | `127.0.0.1` | Bind interface; `0.0.0.0` = all (the admin API writes files and executes code: exposing on the network is an explicit choice, at the user's own risk) | ✅ ("Reachable from the whole network" toggle: 127.0.0.1 ↔ 0.0.0.0) |
| `backendUrl` | `BACKEND_URL` | — | URL of the real backend for the proxy; absent = mock-only | ✅ |
| `proxyFallbackEnabled` | `PROXY_FALLBACK_ENABLED` | `true` | On an unmocked request: proxy to the backend (`true`) vs mock-only `404` (`false`) | ✅ |
| `caseInsensitiveFilters` | `CASE_INSENSITIVE_FILTERS` | `true` | Automatic filters on lists (`?key=value`): value comparison without distinguishing upper and lower case | ✅ |
| `corsEnabled` | `CORS_ENABLED` | `false` | The engine's CORS handling: answers preflights and sets the headers (origin reflected, credentials allowed) on every response served, overriding the policy of captured mocks and of the proxied backend. Only needed for direct cross-origin browser calls | ✅ |
| `adaptProxyCookies` | `ADAPT_PROXY_COOKIES` | `true` | Adapts proxied `Set-Cookie` headers: removes `Domain`, `Secure` and `SameSite=None` so session cookies bind to Mockxy's host and survive over http; name/value and other attributes untouched | ✅ |
| `rewriteProxyRedirects` | `REWRITE_PROXY_REDIRECTS` | `true` | Rewrites the `Location` of proxied redirects pointing at the backend's origin towards the host the client used to reach Mockxy (path and query preserved); relative ones and third-party hosts untouched | ✅ |
| `globalDelayMs` | `MOCKXY_DELAY` · `--delay` · `npm_config_delay` | `0` | Delay (ms) applied to mocks without their own `delayMs` | ✅ |
| `delayAllRequests` | `MOCKXY_DELAY_ALL` · `--delay-all` · `npm_config_delay_all` | `false` | Applies the global delay to proxied requests too | ✅ |
| `requestTimeoutMs` | `REQUEST_TIMEOUT_MS` | `15000` | Timeout (ms) towards backend/handlers | ✅ |
| `monitorDumpIntervalMs` | `MONITOR_DUMP_INTERVAL_MS` | `30000` | How often the monitor dumps are flushed to disk | ✅ |
| `monitorDumpThreshold` | `MONITOR_DUMP_THRESHOLD` | `100` | Pending entries that force a flush ahead of the cadence | ✅ |
| `monitorDumpMaxFileBytes` | `MONITOR_DUMP_MAX_FILE_BYTES` | `52428800` (50 MB) | Maximum size of each dump file (then rotation) | ✅ |
| `monitorDumpMaxTotalBytes` | `MONITOR_DUMP_MAX_TOTAL_BYTES` | `1073741824` (1 GB) | Total cap on the dump folder; `0` = pruning disabled | ✅ |
| `adminApiEnabled` | `ADMIN_API_ENABLED` | dev: `true`, prod: `false` | Enables the `/_admin/api` admin API (mocks, monitor, etc.) | ❌ (desktop forces `true`) |
| `adminAllowedHosts` | `ADMIN_ALLOWED_HOSTS` | `[]` | Extra hosts allowed in the Host header towards the admin API (DNS-rebinding guard), besides loopback names | ❌ |
| `logLevel` | `LOG_LEVEL` | `info` | Minimum logger level | ❌ |
| `mocksDir` | `MOCKS_DIR` | `mocks` | Folder of the mock definitions | ❌ (derived from the workspace) |
| `filesDir` | `FILES_DIR` | `files` | Folder of the JSON data files for `data()` (Data page) | ❌ (derived from the workspace) |
| `monitorDumpDir` | `MONITOR_DUMP_DIR` | `monitor-dump` | Folder of the monitor dumps | ❌ (derived: `<workspace>/.mockxy/monitor-dump`) |
| `uiDistDir` | `UI_DIST_DIR` | — | Folder of the compiled UI to serve under `/_admin/ui` | ❌ (set by the desktop app) |
| `devWatch` / `watchEnabled` | `DEV_WATCH` | `true` (not in production) | Automatic mock reloading in development | ❌ |
| `watchUsePolling` | `CHOKIDAR_USEPOLLING` | `false` | Polling watcher (for Docker/network folders) | ❌ |
| `nodeEnv` | `NODE_ENV` | `development` | Environment; `production` disables watch and (by default) the admin API | ❌ |

**CLI / npm.** The delay can also be passed on the command line: `npm run dev:backend -- --delay=500`
and `--delay-all`; in Docker/Compose the same values arrive via `npm_config_delay` /
`npm_config_delay_all` (see §6). Parsing in `parseCliArgs` (`src/config.js`).

---

## 2. Workspace settings (`<workspace>/.mockxy/settings.json`)

Local (outside git), managed by `electron/workspace.js` (`readSettings`/`updateSettings`) and
editable from the **Workspace settings dialog** (`mockxy-ui/.../workspace-settings-dialog.ts`, opened
from the gear icon in the workspace bar). The flow goes through Electron IPC
(`window.desktop.getWorkspace`/`updateWorkspace` → `electron/main.js`), **not** through the HTTP admin API.
Every field is optional: if absent, the engine default applies. On save the workspace's engine
restarts and the window reloads.

Persisted fields:

- `port`, `backendUrl`, `host` — the workspace's networking (`host`: `127.0.0.1` loopback vs `0.0.0.0` whole network, at the user's own risk).
- `caseInsensitiveFilters` — case-insensitive filters.
- `proxyFallbackEnabled` — proxy fallback on a mock miss.
- `globalDelayMs`, `delayAllRequests` — simulated latency.
- `requestTimeoutMs` — backend/handler timeout.
- `monitorDumpIntervalMs`, `monitorDumpThreshold`, `monitorDumpMaxFileBytes`, `monitorDumpMaxTotalBytes`
  — retention/rotation of the monitor dumps.

Semantics and defaults: identical to the corresponding rows of the table in §1.

The workspace **title** doesn't live here but in the shared, git-tracked placeholder `<workspace>/mockxy.json`
(`{ "formatVersion": 1, "title"?: string }`), because it's meant to be shared with the team; it's still
editable from the same dialog.

---

## 3. Global app preferences (`mockxy-prefs.json`)

Cross-workspace user preferences, saved in Electron's user data directory
(`electron/global-prefs.js`); in the Windows portable build they are instead next to the executable.
Not per-workspace.

- `recentWorkspaces` — list of recently opened workspaces (most recent first).
- `window` — size/position/state of the last window, to reopen it as it was.
- `language` — UI language (`it` / `en`), changeable from the language selector at the bottom of the
  runtime-bar (shared between the app and the welcome screen).
- `errorLogEnabled` — enables writing the [error log](DESKTOP.md) to disk; defaults to `true`,
  can be changed from the **App preferences** dialog and applies immediately without a restart.

---

## 4. Operational runtime (in memory, not persisted)

"Workbench" switches in the runtime-bar; they reset on restart. Applied via
`PATCH /_admin/api/server` (state in `src/server-state.js`) and `PATCH /_admin/api/monitoring/dump`.

- `serverEnabled` — server ON/OFF (OFF = pure passthrough, no mocks/monitor).
- `proxyAll` — forwards **all** requests to the backend (no mocks, but the monitor stays active).
- Monitor: live capture (pause/start, runtime only) and dump writing to disk ON/OFF (persisted
  backend-side) + manual flush.

> Be careful not to confuse `proxyAll` (runtime, bypasses all mocks) and `serverEnabled` (runtime,
> switches the engine off) with `proxyFallbackEnabled` (workspace config, which only concerns the
> behavior on **mock misses**).

---

## 5. Per-mock (mock files)

Properties of the single endpoint/variant, editable from the mock editor (persisted via
`/_admin/api/mocks`). Different scope from this document; in short: `method`, `path`, `enabled`,
`status`, `headers`, `delayMs`, `templated`, response type (JSON/text/file mock, handler,
middleware, SSE, WebSocket), selectable variants (also per query string), variant sequence,
`description`, collection enabling.

---

## 6. Docker / Compose

`docker-compose.yml` sets the container environment and a few orchestration knobs:

- Host port mapping: `MOCKXY_HOST_PORT` (engine, default `3000`), `MOCKXY_UI_HOST_PORT` (UI, default `4207`).
- Simulated delay: `MOCKXY_DELAY` / `MOCKXY_DELAY_ALL` → passed as `npm_config_delay` /
  `npm_config_delay_all`.
- Container env: `HOST=0.0.0.0` (the container's loopback is not reachable through the port mapping),
  `ADMIN_API_ENABLED=true`, `PROXY_FALLBACK_ENABLED=true`, `DEV_WATCH=true`, `CHOKIDAR_USEPOLLING=true`
  (native events are unreliable on mounted volumes), `MOCKS_DIR`, `MONITOR_DUMP_DIR`.

The `.env.example` file documents the engine variables for headless use (`node index.js` / Docker).

---

_Last updated: July 16, 2026._
