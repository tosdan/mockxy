# Data files and `data()`

Data files are reusable JSON datasets, stored in the `files/` folder of the
[workspace](WORKSPACE.md) and read at runtime by [handlers](HANDLER.md) and
[middleware](MIDDLEWARE.md) through the **`data(name)`** accessor. They separate *data* from
*logic*: the script stays short and readable, the dataset is edited from the Data page (or with
an editor) without touching code, and it travels in git together with the mocks.

## The on-disk contract

- The folder is **flat**: no subfolders. Together with the constraint on names, this makes any
  path traversal impossible by construction.
- Allowed names are made of **lowercase letters, digits, `.`, `_`, `-`**, with the `.json`
  extension. The name, without the extension, is the identifier you pass to `data()`.
- The canonical form is **lowercase**: upload and rename normalize, so a workspace can't
  contain both `Utenti.json` and `utenti.json`, which on Windows/macOS would be the same file
  and on Linux two different ones.

## `data()` at runtime

`await data("utenti")` returns the content of `utenti.json` already parsed. The properties to
know:

- **lazy reading**: a file that is never referenced is never opened;
- **re-read on every call**: no cache — a change to the file is visible from the next request
  on, without restarts;
- **a copy per call**: every handler receives its own instance of the data; mutating it
  doesn't pollute other requests or later ones;
- **explicit errors**: an invalid name, a non-existent file (the message lists the available
  files, or flags the empty folder), malformed JSON or an unconfigured folder are exceptions
  with meaningful messages, which become the script's standard failure — the handler's `500`
  with the detail in the log, or the middleware's fail-open.

`data()` also accepts names with uppercase letters or with a stray extension
(`data("Utenti.json")`) and normalizes them to the canonical form.

## The Data page

The UI's Data page manages the folder: upload (`.json` only, in bulk or by drag & drop too),
viewing and editing the content, rename, delete, and the "Copy reference" button, which
produces the `data("name")` snippet ready to paste into a script. Content is **validated as
JSON before being written**: a malformed file is rejected without touching the disk, and
writes are atomic.

**Who uses it.** Every file shows the endpoints that reference it: handler and middleware
sources are scanned for `data("name")` calls written as **string literals**. A reference built
at runtime (from a variable, by concatenation) is not detectable: "no reference found" means
no direct one was found, not that the file is certainly unused.

**Safe rename.** When renaming a referenced file, you are offered (on by default, can be
turned off) to rewrite the `data("old")` → `data("new")` occurrences in the sources that use
it, with a runtime reload. The rewrite is all-or-nothing — either all the sources or none —
and the final summary reports the updated occurrences, reminding you that any dynamic
references must be checked by hand.

## Sizes

Every `data()` call re-reads and re-parses the file from disk: up to a megabyte you won't
notice, but a file of several megabytes on a busy endpoint is paid on every request. The page
flags files over **5 MB**; the upload limit is **25 MB** per file.

## Outside the desktop app

The headless server reads the same folder through `FILES_DIR` (in the repo:
`workspace/files`), and the standalone image receives it as a bind mount together with the
mocks — see [the workspace anatomy](WORKSPACE.md). Without a configured folder, the first
`data()` call fails with an explicit error.
