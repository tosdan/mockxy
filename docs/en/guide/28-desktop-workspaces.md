# 28 — The desktop app in full: multi-workspace and preferences

Chapter 3 covered starting up; here is the rest of the desktop app: managing **several
workspaces in parallel** — its exclusive capability — stable ports, global preferences and
the error log.

## Several workspaces, one engine each

Every open workspace has **its own engine on its own port**: separate configurations,
separate backends, separate monitors. The typical use case is two git worktrees with two
frontends pointing at two different mock sets, **at the same time** — or the main project
plus an experiments workspace.

The **workspace bar** manages them as tabs:

- **open** a folder ("Open…"): if it is already a workspace the engine starts; if it is
  an ordinary folder, initialization asks for explicit confirmation
  ([chapter 3](03-install-and-run.md)); if it is already open, its tab is focused — no
  duplicates;
- **switching** tabs reloads the window onto the corresponding engine's interface;
- **closing** a tab (with confirmation) shuts down its engine; the files on disk stay
  intact;
- the **recents** reopen previously used workspaces; removing an entry from the recents
  does not touch the folder.

The window uses a title bar integrated in the UI: the system titlebar is hidden, but
minimize/maximize/close remain native controls, and the workspace bar is also the window's
drag area.

> 📷 **SCREENSHOT** — `28-workspace-tabs.png`
> What to show: the app with two or three workspaces open as tabs and the "Recent" menu
> open, with the remove-from-recent action visible on one entry.

## Stable ports

On a workspace's first open, a free port is assigned and **saved in its local settings**:
the workspace always reopens there, so the frontend proxy configured against that address
never needs adjusting. Two distinct behaviors when a port turns out occupied:

- **at startup** (the saved port is taken by another process): the engine falls back to a
  free port and updates the saved value — the workspace starts anyway;
- **on an explicit change** from the settings dialog: the occupied port is rejected with
  an error, applying nothing — an intentional change must not produce a result other than
  the one requested.

## Workspace settings vs App preferences

The gear menu distinguishes two levels, and the distinction is worth having clear:

- **Workspace settings** — per-workspace, saved in the folder's `.mockxy/settings.json`:
  port, backend, engine behavior, dump ([chapter 25](25-workspace-settings.md));
- **App preferences** — global, valid for all workspaces: the language, the window
  geometry, the recents list, and the **error log** (below). They live in
  `mockxy-prefs.json` next to the executable: in the portable format, everything travels
  with the exe — moving the folder moves the preferences too.

> 📷 **SCREENSHOT** — `28-preferenze-app.png`
> What to show: the "App preferences" dialog with the error-log switch and the log
> folder's path visible.

## The error log

Errors also land on file: a **`logs/`** subfolder next to the executable (if not
writable, the fallback is the user data folder), one file per day
(`errors-YYYY-MM-DD.log`), created only when there is something to write.

Both the app's failures (failed startup, workspace that won't open) and the **error lines
of the open workspaces' engines** end up there — and this is where the log becomes
precious in daily work: the full detail of a `500 Handler Execution Failed` (message,
stack, offending file — [chapter 15](15-handlers.md)) has no other way out in the packaged
app, because there is no terminal to watch.

Writing is on by default and can be disabled from the App preferences, with immediate
effect.

## A note for interface developers

The interface is always served by the engine itself, in the desktop app too: every
workspace is self-sufficient. For UI development you use the browser
(`npm run dev:backend` + `npm run dev:frontend`, with automatic reload); the desktop app
uses the compiled UI, and `npm run dev:electron` rebuilds it before launching. Building
the executable is in [chapter 3](03-install-and-run.md).

One workspace per colleague is convenient; an engine reachable *by* colleagues is another
matter — and it requires awareness: [network exposure](29-network-security.md).
