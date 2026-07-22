# 03 — Installing and running Mockxy

Mockxy runs in three forms: a portable **desktop app** for Windows, a local **Node.js
server**, a **Docker container**. The working features are the same; what changes is how
you configure them and a couple of exclusive capabilities (multi-workspace is
desktop-only). Alongside these sits the **standalone** Docker image, which is not a
development environment but a mock-only server for shared environments: it gets its space
in [chapter 31](31-headless-docker.md).

The compass for choosing:

| | Desktop app | Node server | Development Docker | Standalone image |
|---|---|---|---|---|
| What it's for | day-to-day development on Windows | development on your machine | same purpose, without local Node | serving mocks to others (intranet, demos) |
| Web interface + admin API | yes | yes | yes | **no** |
| Proxy fallback to the backend | yes | yes | yes | **no** (mock-only) |
| Mock hot reload | yes | yes | yes | no |
| Multiple workspaces in parallel | **yes** | no (one process per workspace) | no | no |
| Configuration | dialog in the interface | environment variables | environment variables | environment variables |

If you are on Windows and just want to start, the desktop app is the quickest way: zero
installation and zero manual configuration.

## The desktop app

The desktop app is a single **portable** executable: no installation, and the preferences
travel in files next to the executable — move the folder, everything moves with it. Engine
and interface are bundled: no Node required, no separate browser window.

The executable is downloaded from the repository releases (or built with
`npm run install:all && npm run dist:electron`, result in
`electron/dist/Mockxy-<version>-portable.exe`). It is not digitally signed: on first launch
Windows SmartScreen may show a warning — "More info" → "Run anyway".

### First launch and the welcome screen

Launched with no open workspaces, the app shows the welcome screen, from which you open a
folder (or reopen a recent one). The app distinguishes three cases:

- **new folder** — not yet a workspace: the app asks for **explicit confirmation** before
  initializing it, so a folder picked by mistake is not modified. On confirmation, it
  creates the `mockxy.json` marker, the `mocks/` and `files/` folders, a `.gitignore` and
  the local `.mockxy/` part;
- **workspace cloned from git** — the marker is there but the local part is missing: only
  `.mockxy/` is recreated, with default settings. It is the normal path when you clone the
  team's workspace;
- **complete workspace** — it just opens, on the port saved in its settings.

On first open a free port is assigned and **saved**: from then on the workspace always
reopens on the same port, so a frontend configured against that address never needs
touching again.

> 📷 **SCREENSHOT** — `03-benvenuto.png`
> What to show: the desktop app's welcome screen, no workspace open, with the
> open-folder button and the recent list (if any) visible.

> 📷 **SCREENSHOT** — `03-conferma-inizializzazione.png`
> What to show: the native confirmation dialog that appears when opening a folder not yet
> initialized as a workspace.

> 📷 **SCREENSHOT** — `03-workspace-vuoto.png`
> What to show: the app right after initializing a new workspace: empty catalog with the
> "Empty workspace" message inviting you to create the first mock or import from OpenAPI.

The desktop features that go beyond the first launch — several workspaces in parallel as
tabs, stable ports, global preferences, error log — have their own chapter,
[28](28-desktop-workspaces.md).

## The Node server

On macOS, Linux, or whenever you prefer the terminal, Mockxy runs as a normal Node
process. Requirement: **Node.js 24 or later** (the desktop and Docker distributions bundle
their own runtime and do not depend on the system Node).

```bash
git clone https://github.com/tosdan/mockxy.git
cd mockxy

npm install              # server dependencies
npm run install:frontend # web interface dependencies
cp .env.example .env     # starting configuration (optional: without it, defaults apply)

npm run dev:backend      # engine on http://localhost:3000
npm run dev:frontend     # interface on http://localhost:4207 (in a second terminal)
```

The repository ships a demo workspace with a few ready-made mocks, so verification is
immediate:

```bash
curl http://localhost:3000/api/hello
# {"hello":"world", ...}
```

The interface runs in the browser at `http://localhost:4207`. In this form the engine is
configured **only through environment variables** (or CLI arguments): the two essential
ones are `PORT` (default `3000`) and `BACKEND_URL` (the real backend to forward unmocked
requests to — without it, Mockxy works in mock-only mode). The `.env.example` file is
commented and documents every variable; the reasoned census is in
[chapter 31](31-headless-docker.md).

For a process that must only serve (no active development), `NODE_ENV=production` turns
off the file watcher and disables the admin API by default.

## Development Docker

Same purpose as direct execution, without Node installed locally. Requires Docker Compose
v2.24 or later:

```bash
docker compose up
# engine on http://localhost:3000, interface on http://localhost:4207
```

It also works on a fresh clone with no `.env` (if present it is read, otherwise defaults
apply); the host ports are changed with `MOCKXY_HOST_PORT` and `MOCKXY_UI_HOST_PORT`. The
qualifying point: **the workspace stays on the local filesystem**, mounted into the
container — hot reload, hand edits and git versioning work exactly as with direct
execution. One peculiarity: native filesystem events are not always reliable on mounted
volumes, and if file changes are not picked up you enable the polling watcher with
`CHOKIDAR_USEPOLLING=true`.

## Final check

Whichever route you chose, at this point you have: the engine listening on a port (the
desktop app shows it in the workspace bar; headless it is `PORT`), the interface
reachable, and an open workspace — empty or the demo one. A test request with `curl` or
from the browser must get a response, and show up in the Monitor view.

What remains is the step that gives all of this a purpose: making **your application**
talk to Mockxy instead of the backend. That is [chapter 4](04-connect-your-frontend.md).
