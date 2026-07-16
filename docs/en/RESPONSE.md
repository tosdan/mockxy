# The response file

Every response variant of an endpoint is a **response file**: a JSON inside the
`<METHOD>.responses/` folder next to the [endpoint file](ENDPOINT.md), describing *how* to
respond when that variant is selected. Variants let you keep several behaviors ready for the
same endpoint — the populated case, the empty list, the error — and switch from one to the
other by changing only the selected variant, without touching the contents.

The `type` field distinguishes four natures of response:

- **`mock`** — a static response described in the file itself (status, headers, body or payload from a file);
- **`handler`** — a response computed by a local JavaScript script;
- **`middleware`** — a transformation applied to the response of the proxied real backend;
- **`sse`** — a Server-Sent Events stream: the connection stays open and events go out
  following a script (or the console's manual direction).

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
- **`templated`** — optional, default `false`: enables [templating](#templating) of the
  `{{...}}` placeholders in body and headers. Not allowed on `file`-backed responses.
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

## Templating

With **`templated: true`** the `{{...}}` placeholders in the body (JSON or text) and in the
headers are replaced with values from the request: the «echo back the id you asked for» case
without reaching for a handler.

```json
{
  "type": "mock",
  "status": 200,
  "templated": true,
  "headers": { "location": "/api/utenti/{{params.id}}" },
  "body": {
    "id": "{{params.id | number}}",
    "nome": "Utente {{params.id}}",
    "ruolo": "{{query.ruolo}}",
    "richiestoAlle": "{{now}}"
  }
}
```

- **Sources**: `params.<name>` (path parameters), `query.<name>` (first value if repeated),
  `headers.<name>` (lowercase names), `body.<dot.path>` (the request's JSON body, read only
  when referenced).
- **Generated helpers**: `now` (ISO 8601), `nowMs` (epoch ms), `uuid`, `randomInt min max`.
- **Type filter**: when the whole string value is a single placeholder,
  `"{{params.id | number}}"` produces the number without quotes (non-numeric → `null`);
  `| boolean` and `| json` (the body subtree as-is) also exist.
- **Unresolved placeholder**: the response is served anyway (empty string; `null` with a
  filter) and the engine logs a warning with the placeholder — a typo doesn't break your test
  run. Escape: `\{{` produces a literal `{{`.
- The template is applied **before** [automatic pagination and filters](LISTE.md): a templated
  array body takes part in them like a static one.
- No conditionals, loops or expressions: when you need logic, the right step up is a handler.

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

## `sse` response

```json
{
  "type": "sse",
  "title": "Job progress",
  "retryMs": 3000,
  "script": [
    { "afterMs": 0,    "event": "progress", "data": { "percent": 10 } },
    { "afterMs": 1500, "event": "progress", "data": { "percent": 60 } },
    { "afterMs": 3000, "event": "done",     "data": { "percent": 100 } }
  ],
  "onEnd": "keep-open",
  "presets": [
    { "label": "Error", "event": "error", "data": { "message": "boom" } }
  ]
}
```

When the selected variant is of type `sse`, the endpoint answers with a `text/event-stream`
that stays open: the **script** plays **on every connection, independently for each one** —
reconnecting means starting over.

- **`script`** — the event timeline, possibly empty (a silent endpoint, fed only from the
  console). Each entry: **`afterMs`** (delay from the previous message, integer ≥ 0), **`data`**
  (JSON — serialized — or a string, multi-line allowed), optional **`event`** and **`id`**
  (the SSE protocol fields).
- **`onEnd`** — once the script is over: **`keep-open`** (default: the connection stays open
  for heartbeats and manual pushes), **`close`** (the server closes), **`loop`** (start over;
  at least one positive `afterMs` is required).
- **`retryMs`** — optional: the SSE `retry:` field sent at the start of the connection.
- **`presets`** — optional: the ready-made messages (macros) of the endpoint's console.

During silences the engine sends a **heartbeat** comment every 15 seconds (invisible to
clients). Connections are closed on hot reload and shutdown: the SSE client reconnects on its
own and the script starts over. The **console** in the endpoint detail shows open connections
and history, and allows manual direction (broadcast to every connection) — via API:
`POST /mocks/:id/sse/push` and `GET /mocks/:id/sse/connections`. The [monitor](MONITOR.md)
entry is written when the connection closes. An `sse` variant cannot be a step of a
[sequence](ENDPOINT.md).

## Validation and errors

The file of the **selected** variant is validated when the endpoint loads: recognized `type`,
valid status for mocks, `body`/`file` mutually exclusive and one of the two present, script
existing and with the expected function for handlers and middleware, `file` payload existing on
disk. An error in these checks doesn't bring down the server: the per-endpoint degradation
described in the [page on the endpoint file](ENDPOINT.md) applies — the endpoint is skipped
with a warning, and on hot reload the last valid version stays in force.

The **non-selected** variants are not validated until they become the active one: an
incomplete variant file can live in the workspace with no effects, as long as nobody selects it.
