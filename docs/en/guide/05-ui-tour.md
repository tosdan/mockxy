# 05 — The interface tour

A complete tour of the interface before starting to work in it: what's in the top bar,
what the views are, and — above all — the two global switches that govern the whole
engine. The rest of the guide takes this geography for granted.

> 📷 **SCREENSHOT** — `05-barra-superiore.png`
> What to show: the whole application with the top bar highlighted, annotated (arrows or
> boxes) over its areas: view switcher, runtime bar with the switches, language selector,
> gear menu. In the desktop app, include the workspace tab bar too.

## The four views

The switcher at the top toggles between the application's four views:

- **Catalog** — the list of all mocked endpoints, organized into collections: it is the
  main working view, where every mock is created and edited ([chapter 6](06-catalog.md));
- **Monitor** — the real-time traffic crossing Mockxy, mocked and proxied, with mock
  creation from observed requests ([chapter 20](20-monitor.md));
- **History** — the on-disk archive of captured traffic, to browse past sessions and
  create mocks even days later ([chapter 22](22-dump-history.md));
- **Data** — the reusable JSON files that handlers and middleware read with `data()`
  ([chapter 17](17-data-page.md)).

View state is **restored across navigation**: filters, selections and positions are found
as you left them when switching views — you can jump from the catalog to the monitor and
back without losing context.

## The runtime bar

Next to the view switcher lives the **runtime bar**: the engine's state and the switches
that govern it at runtime, always visible whatever the active view. Left to right:

- **Server on / Server off** — the mock engine's main switch;
- **mocking active / straight to backend** — the *proxy all* switch;
- **Monitor live / paused** — the indicator of live traffic capture, active across all
  views until paused;
- **Disk dump** — the switch for archiving traffic to disk, with the count of queued
  requests and the **flush** button to write them immediately (details in chapter 22).

## Two switches, three modes

The first two switches are independent, and they produce **three effective modes**:

| Mode | Mocks / handlers / middleware / SSE / WS | Monitor | Proxy to the backend |
|---|---|---|---|
| **Active** (default) | yes | records | only for requests with no mock |
| **Proxy all** | no | records | everything |
| **Server off** | no | stopped | everything |

**Proxy all** ("straight to backend") suspends all mocks without stopping anything: every
request goes to the real backend, but the monitor keeps recording. It is the "observe the
real backend" mode — to compare real behavior with your mocks, or to capture traffic to
turn into mocks (the flow of chapter 21). In this mode not even middleware intervenes: the
backend is seen exactly as it is.

**Server off** does not terminate the process: the engine stays up as a **pure transparent
proxy**, with mocks suspended *and* the monitor stopped. It serves to neutralize Mockxy
without touching the frontend configuration that points at it — the app keeps working
against the real backend, and Mockxy in the middle does nothing anymore, not even
recording.

In both non-active modes, with no backend configured requests receive
`501 Backend Not Configured`.

A deliberate detail: the state of these switches is **not saved** — on every restart the
engine returns to active mode. They are operational switches, not workspace data: a
"proxy all" left on by mistake does not survive the session.

> 📷 **SCREENSHOT** — `05-proxy-totale.png`
> What to show: the runtime bar with proxy all active ("straight to backend"), to compare
> with the previous screenshot in normal mode: how the interface signals the mode must be
> evident.

## Language, gear and the workspace bar

The **language** selector (Italian / English) takes effect immediately, no restarts. Where
the choice is remembered depends on how you use Mockxy: in the browser, the browser itself
stores it (on first access it follows the system locale); in the desktop app it is a
global preference, applies to all workspaces and covers the native dialogs too. Engine
logs stay in English either way.

The **gear** menu distinguishes two destinations best not confused:

- **Workspace settings** — everything about the active workspace: port, backend URL,
  engine behavior, dump. The full dialog is [chapter 25](25-workspace-settings.md);
- **App preferences** (desktop only) — the global preferences, independent of the
  workspace, such as the on-disk error log ([chapter 28](28-desktop-workspaces.md)).

In the desktop app, above everything sits the **workspace bar**: one tab per open
workspace (each with its own engine on its own port), the "Open…" button and the recent
list. Multi-workspace management is covered in chapter 28.

## From here on

The geography is complete: views, global switches, settings. The next step is the real
work, and it starts from the view you'll spend most time in: the
[mock catalog](06-catalog.md).
