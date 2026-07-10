# Anatomy of a workspace

A **workspace** is the folder that contains everything defining a mock environment: the
endpoint definitions, the reusable data files, the local settings and the captured traffic. It
is a self-sufficient, portable unit: the same folder is versioned in git, shared with the team,
opened in the desktop app and served with the headless server or with the standalone Docker
image.

The principle governing the structure is the separation between the **shared part** (what
describes the mocks, meant for git) and the **local part** (personal settings and working data,
which must not leave the machine). The boundary line is the `.mockxy/` subfolder.

## Structure

```
mio-workspace/
├── mockxy.json              # marker: marks the folder as a workspace       (shared)
├── .gitignore               # generated/updated on every open               (shared)
├── mocks/                   # endpoint definitions                          (shared)
│   ├── api/utenti/
│   │   ├── GET.endpoint.json
│   │   └── GET.responses/
│   │       └── 001.response.json
│   └── .collections.json    # collection layout of the catalog (UI)
├── files/                   # JSON data files for handlers and middleware   (shared)
└── .mockxy/                 # local part                                    (outside git)
    ├── settings.json        # per-workspace settings of the desktop app
    └── monitor-dump/        # captured traffic, archived to disk (NDJSON)
```

## The shared part

**`mockxy.json`** is the marker that identifies the folder as a workspace. It contains the
format version and, if set from the settings dialog, the workspace's custom **title** — the
only shared setting, because it is a label of the project and not a personal preference.
Without a title, the displayed name is the folder's.

**`mocks/`** contains the endpoint definitions: one folder per endpoint mirroring the API
path, with one definition file per HTTP method and the response variants in a dedicated
subfolder. The `.collections.json` file at the root stores the collection layout of the
catalog used by the UI (groupings and ordering). The file format is documented in the pages
dedicated to the endpoint and response formats.

**`files/`** contains the JSON data files of the Data page: reusable datasets that handlers and
middleware read at runtime through the `data()` accessor. The folder is flat (no
subfolders) and file names are normalized to lowercase.

**`.gitignore`** is generated on first open and re-checked on every subsequent open: the line
excluding the local part (`.mockxy/`) is added if missing, and any lines written by previous
versions and no longer in use are removed. The rest of the file is not touched: a customized
`.gitignore` stays intact.

## The local part: `.mockxy/`

**`settings.json`** collects the per-workspace settings managed by the desktop app's
dialog: port, backend URL for the proxy, bind interface, engine behavior
(case-insensitive filters, proxy fallback, automatic CORS, proxied cookie adaptation,
redirect rewriting, simulated latency, timeout) and monitor dump retention. Two
properties of these settings:

- they are **local by definition**: the port and backend URL of one developer's machine make
  no sense on a colleague's — that's why they live outside git;
- they are **read only by the desktop app**, which passes them to the engine when the workspace
  starts. The headless server does not read this file: it is configured exclusively through
  environment variables (see [CONFIGURAZIONI.md](CONFIGURAZIONI.md), which catalogs both routes
  and the defaults).

**`monitor-dump/`** is the on-disk archive of the traffic captured by the monitor, in
append-only NDJSON format with size-based rotation and pruning beyond a configurable cap. It
contains real requests and responses: it may include personal data or secrets, and must not be
shared or mounted on remote servers.

## Lifecycle

When opening a folder, the desktop app distinguishes three cases:

- **new folder** — it gets initialized: marker, `mocks/`, `files/`, `.gitignore` and the local
  part. Initialization requires explicit confirmation, so a folder picked by mistake is not
  modified;
- **workspace cloned from git** — the marker is there but the local part isn't: only
  `.mockxy/` is recreated, with the engine defaults as settings. This is the normal path when a
  colleague clones the team's workspace;
- **complete workspace** — nothing is touched; the port saved in the settings wins over the
  proposed default.

On first open a free port is assigned (and saved); from then on the workspace always reopens on
the same port, so the clients configured against that address keep working.

## What to share with the team

Everything except `.mockxy/`, which the generated `.gitignore` already excludes. Two caveats:

- **handlers and middleware are code**: whoever opens a workspace executes its scripts. The
  same trust applies that you grant to any repository you clone and run;
- before publishing a workspace outside the team, check that the mock bodies (often born from
  captures of real traffic) don't contain sensitive data.

## The same workspace, without the desktop app

The headless server and the Docker images serve a workspace by pointing the `MOCKS_DIR` and
`FILES_DIR` environment variables at the two shared subfolders. The local part is irrelevant to
the engine and — in the case of the standalone image for shared environments — **must not be
mounted**: the bind mounts cover only `mocks/` and `files/`.

If the folder indicated by `MOCKS_DIR` doesn't exist yet, the server with the watch enabled
(the default in development) **creates it empty at startup**: you can start from zero and add
mocks on the fly, without restarts.
