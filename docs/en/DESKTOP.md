# The desktop app

The Windows desktop app is available as a **portable** executable and as a **per-user NSIS
installer**. Both include the engine and UI and offer **multiple workspaces in parallel**. The
portable build needs no installation and keeps preferences next to the executable; the installer
creates a Start menu entry and keeps data in the Windows user data folder.

The UI is always served by the engine itself, in development too: this way every workspace is
self-sufficient and behaves the same in every context.

The window uses a title bar integrated into the UI: the system title bar is hidden, while
minimize/maximize/close remain native controls. The workspace bar doubles as the draggable
area and automatically reserves room for the window controls.

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

Open tabs are saved on every open, switch or close. On the next launch the app reopens all
those workspaces and returns to the tab that was active; if a folder no longer exists or a
workspace fails to start, the others are still restored.

For a recovery launch without opening any workspace, use the one-shot
`--no-restore-workspaces` option. It does not erase the saved session:

```powershell
.\Mockxy-<version>-portable.exe --no-restore-workspaces
```

For the installed build, the same option can be passed to `Mockxy.exe` in the installation
folder. With the current one-click installer, the complete command is:

```powershell
& "$env:LOCALAPPDATA\Programs\mockxy-desktop\Mockxy.exe" --no-restore-workspaces
```

The installer also creates a **Mockxy - start without workspaces** Start menu entry that runs
this command directly. Dragging the normal Start entry may instead create a
`com.mockxy.desktop` application reference without an editable Target field.

```bash
./Mockxy-<version>.AppImage --no-restore-workspaces
```

Command-line arguments reach the Electron app normally in both formats. On Linux the AppImage
must be executable; if Mockxy is launched from a `.desktop` entry, the option can temporarily
be added to its `Exec` line, or the terminal can be used.

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

## The error log (`logs/`)

Errors are also written to files, in a **`logs/`** subfolder. For the Windows portable and Linux
AppImage builds it lives next to the launched artifact; for an NSIS installation it lives in the
user data folder, so it survives upgrades and uninstalls. Development uses `electron/logs/`,
which is git-ignored. If the primary location is not writable, the fallback is the user data
folder. One file per day (`errors-YYYY-MM-DD.log`) is created only when there is something to
write.

It collects both app failures (startup errors, a workspace that won't open, unexpected
exceptions) and the **error lines of the engines** of the open workspaces — for example the
full detail of a `500 Handler Execution Failed`, which in the packaged app would otherwise
have no way out ([troubleshooting](TROUBLESHOOTING.md)).

Disk logging is enabled by default. From the gear menu, **App preferences** can disable or
re-enable it without a restart; the global `errorLogEnabled` choice is stored in
`mockxy-prefs.json` ([configuration](CONFIGURAZIONI.md)).

## Update notifications

Packaged desktop builds, including Windows portable, NSIS and AppImage, check for a newer stable
release on `tosdan/mockxy`. The first check starts about five seconds after the window opens
and is not repeated automatically more than once every 24 hours. Local development performs
no automatic checks; future Microsoft Store builds leave updates entirely to the Store.

The check calls the GitHub Releases API without credentials and stores only the last
successful check time and the latest release metadata in global preferences. A network
error, timeout, or temporary GitHub rate limit does not prevent startup and produces no
automatic warning.

When a newer version exists, a non-blocking banner appears. **View release** opens the
verified release page in the system browser; **Ignore this version** hides only that version,
so the next one is offered normally. **App preferences → Updates** shows the installed and
latest versions and provides **Check for updates**: unlike an automatic check, a manual one
also reports that Mockxy is current or that the service is unavailable.

This first implementation **does not download or install anything automatically**. The user
chooses the artifact on the release page and remains in control of the update.

## Global preferences and packaging

The gear menu separates settings for the active **workspace** from **App preferences**.
Global preferences — language, window geometry, workspace session, list of recents, error
logging and update state — live next to the Windows executable in portable format, so everything
travels with the exe. The NSIS and Linux builds use the user data folder instead. Portable
preferences are not imported automatically into an installation, while workspace folders remain
independent and can be opened from either build.

The NSIS installer is one-click, x64 and limited to the current user: it asks for explicit
confirmation before installing, needs no administrator privileges, creates both the normal and
recovery Start menu entries but no desktop shortcuts, and launches Mockxy when it finishes.
Uninstalling removes both entries and the app but preserves preferences, session and logs; it
never deletes workspaces. To upgrade, manually download and run the newer setup.

To build each artifact:

```bash
npm run install:all
npm run dist:electron:win
# electron/dist/Mockxy-<version>-portable.exe

npm run dist:electron:nsis
# electron/dist/Mockxy-<version>-setup-x64.exe

npm run dist:electron:linux
# electron/dist/Mockxy-<version>-x86_64.AppImage
```

The directly downloaded portable and installer are not signed, so SmartScreen may ask for
confirmation ("More info" → "Run anyway"). Code signing and automatic updates will be evaluated
separately.

For UI **development** you use the browser (`npm run dev:backend` +
`npm run dev:frontend`, with automatic reload); the desktop app uses the compiled UI, which
`npm run dev:electron` rebuilds before starting it.
