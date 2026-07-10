# The endpoint file

Every mocked endpoint is declared by an **endpoint file**: a JSON that says which method and
path the endpoint covers, whether it is enabled, which response variants exist and which one is
currently served. It is the entry point for everything concerning that endpoint: the engine
discovers endpoints by looking for these files, and the UI creates and edits them on the
user's behalf — but they remain plain JSON files, editable by hand with any editor and
hot-reloaded when the watch is active.

## Location and name

The engine walks the mocks folder recursively and collects every file whose name ends in
`.endpoint.json`. The file name is `<METHOD>.endpoint.json` (e.g. `GET.endpoint.json`), so
the same folder can host multiple methods for the same path. The response variants live in the
sibling subfolder `<METHOD>.responses/`.

```
mocks/api/utenti/{id}/
├── GET.endpoint.json        # declares GET /api/utenti/:id
├── GET.responses/           # response variants of the GET
│   ├── 001.response.json
│   └── 002.response.json
└── DELETE.endpoint.json     # same path, different method
```

The folder's location is **a convention, not a constraint**: the served path is the one
declared in the `path` field, not the one reconstructed from the folders. The UI creates the
folders mirroring the API path (with `{id}` for parameters, because `:` is not allowed in
folder names on Windows), and it's the recommended form by hand too: it keeps the
workspace navigable.

## The fields

```json
{
  "method": "GET",
  "path": "/api/utenti/:id",
  "description": "Dettaglio utente",
  "enabled": true,
  "responseFiles": ["001.response.json", "002.response.json"],
  "selectedResponseFile": "001.response.json"
}
```

- **`method`** — one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` (uppercase).
  It must match the method in the file name: the redundancy is deliberate, so the file's
  content is self-sufficient even outside its context.
- **`path`** — the served path, with optional parameters (`/api/utenti/:id`) and query string.
  The format rules and the precedence between routes are documented in the page on the path
  convention.
- **`description`** — free text, optional; shown in the UI's catalog.
- **`enabled`** — required. When `false` the endpoint is not registered: the requests that
  would have reached it follow the fallback flow (proxy to the real backend, or `404` in
  mock-only mode). It's the switch to "go real" one endpoint at a time.
- **`responseFiles`** — the list of available variants: names of files inside
  `<METHOD>.responses/`, without paths (file name only, `.response.json` suffix), without
  duplicates, at least one entry. The order is the one shown by the UI.
- **`selectedResponseFile`** — the variant currently served; it must be one of those listed in
  `responseFiles`. Changing variant means changing this field — from the UI or by hand.

The content of the variants (status, headers, body or binary file, delay, mock/handler/
middleware type) is documented in the page on the response format.

## Validation and errors

The file is validated on load: recognized method consistent with the file name, non-empty and
well-formed path, boolean `enabled`, variant list non-empty and without duplicates, selected
variant present in the list. Names in `responseFiles` that try to escape the folder (path
separators, relative references) are rejected.

Two properties of the loading worth knowing:

- **degradation is per-endpoint**: a broken file — invalid JSON, missing selected variant,
  failed validation — is skipped and reported, without preventing the other endpoints from
  loading. At startup the error appears as a warning in the log; on hot reload the endpoint
  keeps the last valid version until the file is correct again;
- **duplicates are an error**: two endpoint files declaring the same method+path pair (in
  different folders) are in conflict — the first one encountered wins, the second is reported
  and ignored.

## Editing by hand

Any change to the file — switching the selected variant, disabling the endpoint, adding an
entry to `responseFiles` after creating the variant's file — is picked up by the hot reload
when the watch is active (`DEV_WATCH`, on by default in development). No restart is needed, nor
going through the UI: files and UI are two equivalent views on the same data.

For mocks written in the old v1 format there is the migration script
`node scripts/migrate-mocks-v2.js <folder>`.
