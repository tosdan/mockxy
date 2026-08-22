# 31 — Headless and Docker: configuring without an interface

Outside the desktop app there is no settings dialog: the engine is configured **only
through environment variables** (or CLI arguments), from a `.env` file or the process
environment. This chapter gives the map of the configuration levels, the variables grouped
by theme with the mapping to the dialog's switches, and the two Docker forms. The
exhaustive census — every key, every default — stays in
[CONFIGURAZIONI.md](../CONFIGURAZIONI.md), and the repository's `.env.example` is
commented variable by variable.

## The configuration levels

Mockxy's tuning lives on distinct, coexisting levels — having them clear avoids looking
for an option in the wrong place:

1. **Engine** — environment variables / `.env` / CLI: the core; everything else either
   goes through here or belongs to another level;
2. **Workspace** (desktop app only) — the dialog of
   [chapter 25](25-workspace-settings.md), which passes values to the engine as overrides;
   the headless server does **not** read `.mockxy/settings.json`;
3. **App global preferences** (desktop only) — language, recents, error log;
4. **Runtime** — the runtime bar's switches, in memory, never persisted;
5. **Per-mock** — the properties in the mock files (a variant's delay, templating,
   sequences);
6. **Docker / Compose** — variables read only by the orchestration, not by the engine.

## The variables, by theme

**Network and folders**

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | listening port |
| `HOST` | `127.0.0.1` | bind interface; `0.0.0.0` = exposed ([chapter 29](29-network-security.md)) |
| `MOCKS_DIR` | `mocks` | the mock definitions folder |
| `FILES_DIR` | `files` | the data files folder for `data()` |

**Proxy and behavior** (the switches of chapters 25–27)

| Variable | Default | Dialog equivalent |
|---|---|---|
| `BACKEND_URL` | — | Backend URL (absent = mock-only) |
| `PROXY_FALLBACK_ENABLED` | `true` | Proxy fallback |
| `CORS_ENABLED` | `false` | Automatic CORS |
| `ADAPT_PROXY_COOKIES` | `true` | Adapt proxied cookies |
| `REWRITE_PROXY_REDIRECTS` | `true` | Rewrite proxied redirects |
| `CASE_INSENSITIVE_FILTERS` | `true` | Case-insensitive filters |
| `REQUEST_TIMEOUT_MS` | `15000` | Backend timeout |

**Delays** — via CLI: `node index.js --delay=500 --delay-all`
([chapter 14](14-simulated-delays.md)).

**Monitor and dump** ([chapter 22](22-dump-history.md))

| Variable | Default | Dialog equivalent |
|---|---|---|
| `MONITOR_DUMP_DIR` | `monitor-dump` | — (derived from the workspace, on desktop) |
| `MONITOR_DUMP_INTERVAL_MS` | `30000` | Flush cadence |
| `MONITOR_DUMP_THRESHOLD` | `100` | Flush threshold |
| `MONITOR_DUMP_MAX_FILE_BYTES` | 50 MB | Max size per file |
| `MONITOR_DUMP_MAX_TOTAL_BYTES` | 1 GB | Folder total cap (`0` = never) |

**Administration and development**

| Variable | Default | What it does |
|---|---|---|
| `ADMIN_API_ENABLED` | dev `true`, prod `false` | the `/_admin/api` admin API |
| `ADMIN_ALLOWED_HOSTS` | — | extra hosts allowed toward the admin (DNS-rebinding guard) |
| `DEV_WATCH` | `true` (not in production) | mock hot reload |
| `CHOKIDAR_USEPOLLING` | `false` | polling watcher (Docker, network folders) |
| `LOG_LEVEL` | `info` | log verbosity |
| `NODE_ENV` | `development` | `production` turns off watch and (by default) admin |
| `UI_DIST_DIR` | — | serves the compiled interface under `/_admin/ui` |

To serve an existing workspace headless, point `MOCKS_DIR` and `FILES_DIR` at the
workspace's two shared folders ([chapter 24](24-mocks-as-files.md)); if the mocks folder
doesn't exist, with the watcher active it is created empty at startup. The local part
(`.mockxy/`) is irrelevant to the engine.

## Development Docker

The repository's compose (`docker compose up`) starts engine and interface with the
workspace **mounted from the local filesystem**: hot reload and git work as in direct
execution ([chapter 3](03-install-and-run.md)). Some variables are read **only by
compose**, not by the engine: `MOCKXY_HOST_PORT` and `MOCKXY_UI_HOST_PORT` (the host
ports) and `MOCKXY_DELAY` / `MOCKXY_DELAY_ALL` (translated into the delay flags). Inside
the container the bind is `HOST=0.0.0.0` out of necessity (the container's loopback isn't
reachable through port mapping) and the watcher runs in polling mode, because native
events on mounted volumes aren't reliable.

## The standalone image

`Dockerfile.standalone` (used by `docker-compose.staging.yml`) applies a different
principle: **the application is distributed, the data is mounted**. The image contains
only the engine, already configured for pure serving — admin API off, proxy fallback off,
watch off, `NODE_ENV=production`. Mocks and data files arrive at runtime as **read-only
bind mounts** on `/workspace/mocks` and `/workspace/files`:

- mocks are updated on the server's filesystem (a `git pull`), no rebuild and no image
  restart;
- to serve another workspace you change the two mounts;
- the local part (`.mockxy/`) **must never be mounted**.

It is the right answer to "I'd like the team to use these mocks": an internal server
serving the shared workspace, no interface, no code execution over the network, no proxy.
Handlers work (they are workspace files, `data()` included), but nobody can create new
ones remotely. Two notes for the internal network: the bind is already `0.0.0.0` (safe
here: the admin is off), and if colleagues' frontends call the server from the browser,
from other origins, `CORS_ENABLED=true` is needed.

## Typical setups

| Goal | Setup |
|---|---|
| Daily development without local Node | development compose |
| A local process that must only serve | `node index.js` with `NODE_ENV=production` |
| Mocks for the team on an internal server | standalone image + workspace bind mounts |
| CI: frontend e2e against the mocks | standalone image (or headless) in mock-only mode |

With the configuration censused, part VI closes. What remains is the practical part: the
[complete scenarios](32-scenarios.md), the [troubleshooting](33-troubleshooting.md) and
the [appendices](34-appendices.md).
