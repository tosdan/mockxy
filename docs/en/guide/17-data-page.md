# 17 — The Data page and `data()`

A handler with fifty users pasted inside the script is unreadable and unmaintainable.
**Data files** separate data from logic: reusable JSON datasets, saved in the workspace's
`files/` folder, managed from the **Data** page and read at runtime by handlers and
middleware through the **`data(name)`** accessor. The script stays short, the dataset is
edited without touching code, and it travels in git together with the mocks.

## The on-disk contract

- The `files/` folder is **flat**: no subfolders (together with the name constraint, this
  rules out any path traversal by construction).
- Allowed names: **lowercase letters, digits, `.`, `_`, `-`**, with the `.json`
  extension. The name without the extension is the identifier passed to `data()`:
  `users.json` → `data("users")`.
- The canonical form is **lowercase**: upload and rename normalize, so a workspace cannot
  hold `Users.json` and `users.json` — which on Windows and macOS would be the same file,
  and on Linux two different ones.

## `data()` at runtime

`await data("users")` returns the parsed content. The properties worth knowing:

- **lazy reading** — a file never referenced is never opened;
- **re-read on every call** — no cache: a change to the file is visible from the next
  request, no restarts;
- **a copy per call** — every handler receives its own instance: mutating it (filtering,
  sorting, enriching) does not pollute other requests;
- **explicit errors** — invalid name, missing file (the message lists the available
  files), malformed JSON: exceptions with articulate messages, which become the handler's
  usual 500 (or the middleware's fail-open) with the detail in the log.

`data()` tolerates capitals or a stray extension in the reference (`data("Users.json")`)
and normalizes on its own.

## The page

The Data page manages the folder in full:

- **upload** — `.json` only, in bulk or by dragging; the content is **validated as JSON
  before being written**: a malformed file is rejected without touching the disk.
  Re-uploading a file with the same name replaces it;
- **preview and edit** — selecting a file shows and edits its content;
- **copy reference** — produces the `data('name')` snippet ready to paste into a script;
- **rename** and **delete**, with the safeguards described below.

The page flags files **over 5 MB** with a dedicated badge: every `data()` call re-reads
and re-parses the file from disk, and a large file on a busy endpoint is paid on every
request. The upload limit is 25 MB per file.

> 📷 **SCREENSHOT** — `17-pagina-dati.png`
> What to show: the Data page with a few files uploaded, one selected with its content
> preview visible and the "used by N" badge in evidence.

## Traceability: who uses what

Every file shows **which endpoints reference it**: handler and middleware sources are
scanned for `data("name")` calls written as string literals. The "used by N" badge opens
the endpoint list. An honest caveat accompanies the feature: a reference built at runtime
(name from a variable, concatenation) cannot be detected — "no direct reference found"
means no *direct* reference, not that the file is certainly unused.

Two safeguards rest on this map:

- **safe rename** — renaming a referenced file, the "also update the data() references in
  the handlers" option (on by default) rewrites the occurrences in the sources that use
  it. The rewrite is all-or-nothing, with a final summary and a runtime reload — and the
  reminder to check any dynamic references by hand;
- **delete warning** — deleting a used file, the confirmation states how many endpoints
  will break.

> 📷 **SCREENSHOT** — `17-rinomina-riferimenti.png`
> What to show: a file in rename mode with the "also update the data() references in the
> handlers (N)" option visible and on.

## The complete pattern: dataset + handler

The example that closes the loop with chapter 15. You upload `users.json` — fifty
plausible users — on the Data page, and the handler of `GET /api/users` becomes five
lines:

```js
module.exports = {
  async resolveResponse({ query, data }) {
    const users = await data("users");
    const active = users.filter((u) => u.active);
    return {
      jsonBody: query.q
        ? active.filter((u) => u.name.toLowerCase().includes(String(query.q).toLowerCase()))
        : active,
    };
  },
};
```

The partial search that chapter 11's automatic filters don't offer, in a readable handler
— and the dataset is curated from the Data page, not in the code. Updating the demo's data
doesn't require opening a script.

## Outside the desktop app

The headless server reads the same folder through `FILES_DIR`, and the standalone image
receives it as a bind mount together with the mocks: handlers using `data()` work
everywhere. With no folder configured, the first call fails with an explicit error.

With data and logic in their places, what remains are the protocols that aren't
request/response: streams. Starting with [Server-Sent Events](18-sse.md).
