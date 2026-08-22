# 24 — Mocks are files: inside the workspace

Everything the interface does writes plain JSON files — and this chapter opens the hood.
Knowing the structure serves three very concrete purposes: **versioning** the mocks in git
and sharing them with the team, **editing them by hand** when your editor is faster than
the interface (a search-and-replace across fifty mocks), and **understanding what you are
committing** when the workspace lives in the frontend's repository.

## The structure

```
my-workspace/
├── mockxy.json              # marker: identifies the folder as a workspace   (shared)
├── .gitignore               # generated/updated on every open                (shared)
├── mocks/                   # endpoint definitions                           (shared)
│   ├── api/users/
│   │   ├── GET.endpoint.json
│   │   └── GET.responses/
│   │       └── 001.response.json
│   └── .collections.json    # the catalog's collection organization (UI)
├── files/                   # JSON data files for handlers and middleware    (shared)
└── .mockxy/                 # local part                                     (out of git)
    ├── settings.json        # the desktop app's per-workspace settings
    └── monitor-dump/        # captured traffic, archived to disk (NDJSON)
```

The dividing line is the **`.mockxy/`** subfolder: above it is the **shared part** — what
describes the mocks, destined for git — below it the **local part**, which must not leave
the machine. The separation is not a convention to memorize: the `.gitignore` generated on
open already excludes `.mockxy/`, and it is re-checked on every subsequent open (a
customized `.gitignore` is otherwise left alone).

Why the local part stays local: `settings.json` holds the port and backend URL — which
would make no sense on a colleague's machine — and `monitor-dump/` holds real traffic,
which may include personal data. The workspace **title** is the only shared setting (it
lives in the `mockxy.json` marker): it is a project label, not a preference.

## The endpoint file

Every endpoint is declared by a `<METHOD>.endpoint.json` — so the same folder hosts
several methods of the same path — with the variants in the twin
`<METHOD>.responses/` subfolder:

```json
{
  "method": "GET",
  "path": "/api/users/:id",
  "description": "User detail",
  "enabled": true,
  "responseFiles": ["001.response.json", "002.response.json"],
  "selectedResponseFile": "001.response.json"
}
```

Every field corresponds to something already met in the interface: `enabled` is the
endpoint's switch, `responseFiles` the variant list (in display order),
`selectedResponseFile` the selected variant — **changing variant by hand means changing
this field**. Chapter 12's sequence lives here too, in the `sequence` field, as a
selection policy on top of the variants.

A useful detail: the folder's position is a convention, not a constraint — the served path
is the `path` field's, not the one reconstructed from folders. The interface creates
folders mirroring the API path (with `{id}` instead of `:id`, because `:` is not allowed
in Windows folder names), and it is the recommended shape by hand too: it keeps the
workspace navigable.

## The response file

Every variant is a standalone file in `<METHOD>.responses/`:

```json
{
  "type": "mock",
  "title": "User found",
  "status": 200,
  "headers": { "x-example": "true" },
  "delayMs": 150,
  "body": { "id": 1, "name": "Ada", "role": "admin" }
}
```

The `type` field distinguishes the five natures — `mock`, `handler`, `middleware`, `sse`,
`ws` — and the rest mirrors chapter 9's editor: `status`, `headers`, `delayMs`,
`templated`, and `body` *or* `file` (the binary payload served streaming). Handler and
middleware variants are just the link: `sourceFile` points to the `.handler.js` or
`.middleware.js` script in the same folder. The complete field-by-field format is in the
[reference documentation](../RESPONSE.md).

> 📷 **SCREENSHOT** — `24-due-viste.png`
> What to show: a text editor with an endpoint file and a response file open, side by side
> with the interface showing the same endpoint in the catalog — the "two views over the
> same data" made visible.

## Hot reload

With the watcher active (`DEV_WATCH`, the default in development; always on in the desktop
app), any file change is picked up on the fly: you change `selectedResponseFile` in your
editor, save, and the next request serves the other variant — the interface updates by
itself. It also works constructively: a new endpoint can be created entirely by hand
(folder, endpoint file, variant) and appears in the catalog.

The safety net is **per-endpoint degradation**: a broken file — invalid JSON, missing
selected variant, failed validation — **does not take the server down**. The endpoint is
skipped with a warning in the log (naming the offending file), and on hot reload the last
valid version stays in force until the file is correct again. **Duplicates** are handled
too: two files declaring the same method+path pair are in conflict — the first one found
wins, the second is flagged and ignored.

Two related tools: the catalog's "Reload from disk" button, to force a re-read after
massive external operations (a `git pull`, a branch switch); and the
`node scripts/migrate-mocks-v2.js <folder>` script to convert mocks written in the old v1
format.

## Working as a team

The consolidated pattern: the workspace lives **in the frontend's repository** (a
`mockxy/` folder or similar), and travels with the code. A few practices follow:

- mocks **enter code review** like any other file: a wrong contract in a mock shows up in
  the diff;
- git conflicts are rare and readable — small files, one per variant. The typical friction
  point is `selectedResponseFile` when two people select different variants: best treat
  the selection as working state and not fight over it, or normalize it before
  committing;
- **handlers and middleware are code**: whoever opens a workspace runs its scripts — a
  workspace deserves the same trust you grant a repository you clone and execute;
- before publishing a workspace outside the team, check that mock bodies — often born from
  captures of real traffic — contain no sensitive data.

The headless server and the Docker images serve the same workspace by pointing `MOCKS_DIR`
and `FILES_DIR` at the two shared folders; the local part is irrelevant to the engine and
must never be mounted ([chapter 31](31-headless-docker.md)).

With the files clear, part VI tackles the tuning: starting from the panel that gathers it
all, the [workspace settings](25-workspace-settings.md).
