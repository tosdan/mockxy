# The response file

Every response variant of an endpoint is a **response file**: a JSON inside the
`<METHOD>.responses/` folder next to the [endpoint file](ENDPOINT.md), describing *how* to
respond when that variant is selected. Variants let you keep several behaviors ready for the
same endpoint — the populated case, the empty list, the error — and switch from one to the
other by changing only the selected variant, without touching the contents.

The `type` field distinguishes three natures of response:

- **`mock`** — a static response described in the file itself (status, headers, body or payload from a file);
- **`handler`** — a response computed by a local JavaScript script;
- **`middleware`** — a transformation applied to the response of the proxied real backend.

The UI creates the files with progressive names (`001.response.json`, `002.response.json`, …),
but any name ending in `.response.json` is valid, as long as it is a plain file name
(no paths) and listed in the endpoint file's `responseFiles`.

## `mock` response

```json
{
  "type": "mock",
  "title": "Utente trovato",
  "status": 200,
  "headers": { "x-esempio": "true" },
  "delayMs": 150,
  "body": { "id": 1, "nome": "Ada", "ruolo": "admin" }
}
```

- **`title`** — optional label of the variant, shown by the UI.
- **`status`** — required: an integer between 100 and 599.
- **`headers`** — optional: an object with primitive values (strings, numbers, booleans) or
  arrays of strings for multi-value headers.
- **`delayMs`** — optional: delay in milliseconds before the response, non-negative
  integer. When greater than zero it **wins over the server's global delay**; at zero or
  absent, the global delay (if any) applies.
- **`body`** or **`file`** — exactly one of the two:
  - **JSON `body`** (object, array, number, boolean) — served as JSON. If it is an array, or an
    object with a single top-level array, the response takes part in automatic pagination and
    filters on the query string;
  - **string `body`** — served **as-is, with no implicit content-type**: the content-type is
    declared by the user in the headers (the UI's editor adds `text/plain` when you
    pick text mode). It's the way to go for XML, CSV, HTML or any non-JSON textual
    payload;
  - **`file`** — path of a file inside the `<METHOD>.responses/` folder (even in a
    subfolder, e.g. `assets/img.png`), served **streaming on every request**: the
    content is never loaded into memory, so even payloads of hundreds of MB
    (downloads, images, PDFs) don't weigh on the server. Without a `content-type` declared in
    the headers, the response goes out as `application/octet-stream`.

## `handler` response

```json
{
  "type": "handler",
  "title": "Ordine calcolato",
  "sourceFile": "001.handler.js"
}
```

The response file is only the link: the logic lives in the script indicated by
**`sourceFile`** — a file name ending in `.handler.js`, in the same
`<METHOD>.responses/` folder. The script exports an object with the `resolveResponse`
function, which receives the request context and returns status, headers and body. The full
contract is documented in the page on handlers.

The script **cannot** declare `method`, `path` or `disabled`: those properties belong to the
endpoint file, and their presence in the script is a validation error — there is only one
source of truth about routing.

Scripts can require other local files (relative `require`s): the engine tracks these
dependencies and recompiles the script when the source **or one of the dependencies** changes
on disk; as long as nothing changes, the compiled definition is reused across reloads.

## `middleware` response

```json
{
  "type": "middleware",
  "title": "Maschera i dati sensibili",
  "sourceFile": "001.middleware.js"
}
```

Same structure as the handler, with the **`.middleware.js`** suffix and the exported function
`transformResponse`: the engine forwards the request to the real backend and passes the
response to the script, which can modify it before it reaches the client. Limits and contract
are documented in the page on proxy middleware.

## Validation and errors

The file of the **selected** variant is validated when the endpoint loads: recognized `type`,
valid status for mocks, `body`/`file` mutually exclusive and one of the two present, script
existing and with the expected function for handlers and middleware, `file` payload existing on
disk. An error in these checks doesn't bring down the server: the per-endpoint degradation
described in the [page on the endpoint file](ENDPOINT.md) applies — the endpoint is skipped
with a warning, and on hot reload the last valid version stays in force.

The **non-selected** variants are not validated until they become the active one: an
incomplete variant file can live in the workspace with no effects, as long as nobody selects it.
