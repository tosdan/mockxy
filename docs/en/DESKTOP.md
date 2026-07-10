# The desktop app

The Windows desktop app is a single **portable** executable: no installation, engine and UI
built in, preferences that travel next to the executable. It's the quickest way to use
Mockxy — and the only one that offers **multiple workspaces in parallel**.

The UI is always served by the engine itself, in development too: this way every workspace is
self-sufficient and behaves the same in every context.

## Multiple workspaces, one engine each

Every open workspace has its **own engine on its own port** — the typical use case is two git
worktrees with two frontends pointing at two different mock sets, at the same time. The
workspace bar manages them as tabs:

- **opening** a folder: if it's already a workspace the engine starts; if it's an ordinary
  folder, initialization requires an **explicit confirmation** ([what gets created](WORKSPACE.md));
  if it's already open, you switch to its tab (no duplicates);
- **switching** workspace reloads the window onto the active engine's UI;
- **closing** a tab (with confirmation) shuts the engine down; the files on disk stay intact;
- the **recents** reopen previously used workspaces; removing an entry from the recents
  doesn't touch the folder.

**Ports are stable**: on first opening a free port is assigned and saved in the local
settings — the workspace always reopens there, so the configured frontends don't need
retouching. If at startup the saved port turns out to be busy, the engine falls back to a free
one and updates the saved value; an **explicit change** to a busy port, instead, is rejected
with an error, without applying anything.

## The workspace settings

The settings dialog is governed by a simple rule: the **title** is the only shared entry (it
lives in the workspace's marker file, in git — it's a label of the project); everything else
is **local** to the machine: port, backend URL, network exposure (with its
[warning](RETE.md)), the engine behavior options and dump retention. The entries are cataloged,
with their defaults, in [CONFIGURAZIONI.md](CONFIGURAZIONI.md).

On save the changes are applied by **restarting the workspace's engine** and reloading the
window; the folder is shown read-only (a workspace can't be "moved" from the dialog). The
settings file and its local nature are documented in the
[workspace anatomy](WORKSPACE.md) — and they never touch the headless flavor, which is
configured through environment variables only.

## Global preferences and packaging

The **global** preferences — language, window geometry, list of recents — live next to the
executable: in portable format, everything travels along with the exe. To build:

```bash
npm run install:all
npm run dist:electron
# output in electron/dist/Mockxy-<version>-portable.exe
```

The executable is not signed: on first launch SmartScreen may ask for confirmation
("More info" → "Run anyway").

For UI **development** you use the browser (`npm run dev:backend` +
`npm run dev:frontend`, with automatic reload); the desktop app uses the compiled UI, which
`npm run dev:electron` rebuilds before starting it.
