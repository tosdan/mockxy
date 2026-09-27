# The admin API — reference

Mockxy's entire UI is built on the **admin API** under `/_admin/api`: there is no UI
operation that doesn't go through here. The useful consequence is that **everything the UI
does can be automated** — setup scripts that populate a workspace, e2e suites that reset the
state between tests, pipelines that import an updated spec.

## When it answers and how it protects itself

- Enabled with `ADMIN_API_ENABLED` (default: on in development, off in production). When off,
  every route answers `404` with an explicit message.
- The `/_admin/api` namespace is **reserved**: a method or path that is not listed below
  answers `404` with `details.code: "ADMIN_ROUTE_NOT_FOUND"`. It never falls through to mock
  serving or to the backend proxy, and a mock declared under `/_admin/api` is never served,
  WebSocket upgrades included.
- **No authentication**: it creates handlers, i.e. it writes files and executes code. The
  protections and the exposure rules are in the page on [network exposure](RETE.md) (anti
  DNS-rebinding guard on the `Host` header, warning on non-loopback binds).
- Mutations only accept **explicit JSON**: that's also the anti-CSRF defense — a cross-origin
  request with `content-type: application/json` triggers the browser's preflight and dies
  there. The only structural exception is the OpenAPI import, which accepts YAML but
  **rejects `text/plain` with `415`** precisely to avoid opening the "simple" request hole.
- Parameterless POST operations (`sequence/reset`, `monitoring/dump/flush`, and both shared
  state resets) still require `Content-Type: application/json` and a body exactly equal to
  `{}`. A missing or empty body, `null`, arrays, scalars and non-empty objects return `400`; a
  different media type returns `415`. One form keeps the contract explicit and uniform.

## Conventions

- An endpoint's **`:id`** is the endpoint file's relative path encoded base64url: you obtain
  it from the lists and treat it as **opaque**.
- **Errors** are JSON `{ error, message, details? }` with the appropriate status
  (`400` invalid input, `403` unexpected `Host` header, `404` not found, `409` conflict,
  `415` unsupported media type, `500` unexpected failure). Newer errors add a stable code in
  `details.code`, so a client does not have to parse the text.
- Catalog mutations **wait for the reload pass containing their write and check its
  outcome**: the next request sees the change. A `2xx` means the files are written **and** the
  runtime reflects the requested effect on the endpoints involved: served when enabled, gone
  when disabled or deleted. A load error on those endpoints, a failed reload or a write error
  undoes the change; errors of unrelated endpoints do not fail a valid mutation. There is no
  isolation from traffic while writing: the guarantee is a consistent state at the end.
- **Failed mutations** carry `details.code` and `details.rollback` (`not_needed`, `restored`
  or `failed`):
  - `400 MUTATION_REJECTED`: invalid input (nothing to restore) or a change the runtime cannot
    apply (files restored);
  - `500 RUNTIME_APPLY_FAILED`: the runtime reload failed as a whole; files restored;
  - `500 MUTATION_FAILED`: unexpected error while writing; files restored;
  - `500 ROLLBACK_FAILED`: the restore failed too (`rollback: "failed"`, with `cause` and
    `recoveryError`), even just because after the restore an endpoint involved is not served as
    it was before: it is no longer served, or the rejected version is still served because the
    restore could not reload it. The workspace state must not be assumed consistent.
- **One mutation at a time** per workspace: mutations are queued, while reads, traffic and the
  SSE/WS console pushes do not wait for them. A client that disconnects does not cut a running
  mutation short.
- **Reads during a change:** an endpoint's detail is not an atomic snapshot of several files. If
  a file is missing during the read, the detail is built once more from the definition read
  again, following its selection; an endpoint deleted meanwhile answers `404`. If the file is
  still missing, the answer is `409` with `details: { code: "READ_INCONSISTENT", retryable: true }`
  and no partial detail: repeat the read at most once automatically. The message names the
  missing file, which may also have been deleted by hand.
- Data files reload nothing ([`data()` re-reads on every call](DATI.md)), with one exception:
  the rename with reference rewriting reloads, because it touched the handlers' sources, and
  checks the rewritten handlers like any other mutation.

## Catalog and endpoints

| Method and path | What it does |
|---|---|
| `GET /mocks` | the whole catalog: endpoints, collections and orderings; each endpoint also exposes `sequenceActive` for the SEQ badge. An unreadable endpoint file (invalid JSON, missing selected variant) doesn't fail the request: that endpoint is skipped and reported in `loadErrors` (`[{ configFilePath, message }]`), as the runtime does at load time |
| `GET /mocks/resolve?method&path` | the endpoint that would cover a concrete request today (path with optional query), disabled ones included; `{ mock: null }` if none. A derived fact using the serving's matching, used by the monitor for "go to mock" |
| `POST /mocks` | creates an endpoint (static mock, or handler/middleware with source); if one already exists for route+method it answers `409` with `details.existingMockId`, so the client can offer to add a variant to that endpoint |
| `GET /mocks/:id` | detail with variants and normalized configuration of the selected response; with `type: sequence` it exposes `sequence` and `sequenceState`, never `endpoint.sequence`. `409 READ_INCONSISTENT` if a referenced file is still missing on the second attempt |
| `PUT /mocks/:id` | selects a response with `{ selectedResponseFile }`, or updates the selected ordinary response; the legacy `{ sequence }` body is rejected |
| `GET /mocks/:id/sequence/state` | lightweight live state of the selected sequence: `{ sequenceFile, sequenceState }`; `400` on another type |
| `POST /mocks/:id/sequence/reset` | clears cursor and handler memory for the selected sequence; body `{}`; responds `{ sequenceFile, sequenceState }` |
| `POST /mocks/:id/sse/push` | manual push of the [SSE](RESPONSE.md) console: body `{ data, event?, id? }`, broadcast to every open connection — responds `{ delivered, connections }`. The target is the definition the runtime serves, including the previous route kept when a new selection fails to load, not the selection on disk: `404` if the runtime does not serve the endpoint, `400` if it serves it with another type, middleware included. The same holds for the other three console routes |
| `GET /mocks/:id/sse/connections` | SSE console state: open connections (with script position) and history of sent messages |
| `POST /mocks/:id/ws/push` | manual push of the [WS](RESPONSE.md) console: body `{ data }`, broadcast to every open connection — responds `{ delivered, connections }` |
| `GET /mocks/:id/ws/connections` | WS console state: open connections (with script position) and the bidirectional transcript (sent and received) |
| `PUT /mocks/:id/endpoint` | updates **only** `description` and `enabled` (any other field is a `400`): method and path are fixed at creation — the path determines the files' folder — and are changed with `POST /mocks/:id/copy` |
| `POST /mocks/:id/copy` | duplicates onto a new method+path — body `{ method, path, copyResponses }`; with `?dryRun=true`, returns the plan without writing or reloading |
| `PATCH /mocks/enabled` | enables or disables a list of endpoints — body `{ ids, enabled }`, with a non-empty `ids` (duplicates are collapsed); an unknown id fails the request before anything is written; answers with the refreshed catalog `{ items, collections, childOrder }`. It is the route behind the catalog's multi-selection |
| `PUT /mocks/:id/collection` | assigns the endpoint to a collection |
| `DELETE /mocks/:id` | deletes endpoint and variants |

## Response variants

| Method and path | What it does |
|---|---|
| `POST /mocks/:id/responses` | adds and selects a `mock`, `handler`, `middleware`, `sse`, `ws`, or `sequence` variant; generic cloning also supports sequences |
| `PUT /mocks/:id/responses/:file` | updates a variant; for sequences it edits title/steps/end/reset and validates the complete graph |
| `PUT /mocks/:id/responses/:file/file` | uploads the raw bytes that make the variant [file-backed](RESPONSE.md) — body `application/octet-stream` (up to 12 MB), MIME type and name in the query (`?contentType=…&filename=…`) |
| `DELETE /mocks/:id/responses/:file` | deletes a variant; returns `409` with `details.referencedBy` when a sequence uses it |

## Collections

| Method and path | What it does |
|---|---|
| `POST /mocks/collections` | creates a collection (nested too) |
| `PATCH /mocks/collections/order` | reorders the root collections |
| `PATCH /mocks/collections/:id/parent` | moves a collection within the tree |
| `PATCH /mocks/collections/:id/items/order` | reorders a collection's endpoints |
| `PATCH /mocks/collections/:key/children/order` | reorders the sub-collections |
| `PATCH /mocks/collections/:id/enabled` | enables/disables the subtree **in bulk** ([semantics](CATALOGO.md)) |
| `DELETE /mocks/collections/:id` | **dissolves** the subtree; its endpoints go back to Unsorted |
| `DELETE /mocks/collections/:id/contents` | permanently erases the subtree and all contained endpoints; with `id=unsorted`, erases all and only unassigned endpoints — response `{ deleted }` |

## OpenAPI import

| Method and path | What it does |
|---|---|
| `POST /mocks/import/openapi` | imports the spec (raw JSON/YAML body, up to 12 MB) — [generation rules](OPENAPI.md). It goes item by item: `items` reports `writeOutcome` and `runtimeOutcome` for each operation, `runtime.status` says whether the runtime is `applied` or `degraded`; if the final reload fails it answers `500 BATCH_RUNTIME_FAILED` with the full result in `details.result`. If restoring a failed item does not succeed, it stops there and answers `500 ROLLBACK_FAILED`, with the items processed so far in `details.result`. A collection that cannot be assigned does not undo the endpoint: it ends up in the item's `error` |
| `POST /mocks/import/openapi?dryRun=true` | just the plan with the counts, without writing anything |
| `POST /mocks/import/openapi?prefix=/be` | prepends `/be` to every imported path (works with `dryRun` too); the plan reports the applied `prefix` and the `suggestedPrefix` derived from `servers` |

## Data files

| Method and path | What it does |
|---|---|
| `GET /files` | list with metadata and the endpoints using them (`usedBy`) |
| `GET /files/:name` | content of a data file |
| `PUT /files/:name` | creates (`201`) or replaces (`200`) — raw bytes up to 25 MB, JSON validated before writing |
| `PATCH /files/:name` | renames — body `{ name, rewriteReferences }` ([safe rename](DATI.md)) |
| `DELETE /files/:name` | deletes the file |

## Shared runtime state

| Method and path | What it does |
|---|---|
| `GET /runtime/shared-state` | lists store metadata, current usage and limits; it never exposes values |
| `POST /runtime/shared-state/:name/reset` | idempotently invalidates one resource; body `{}`; responds `{ name, reset }` |
| `POST /runtime/shared-state/reset` | invalidates every resource; body `{}`; responds `{ resetCount }` |

The list exposes name, `seedKey`, status (`initializing` or `ready`), version, occupied bytes,
timestamps and initialization/last-access origin. It helps find handlers using a stale
signature, while remaining an administrative surface: the live JSON is never included. A
reset does not write data files or alter sequences, `state`, `callCount` or `firstRequestAt`.

A reset linearizes invalidation but does not pause traffic: a later request may immediately
initialize a new generation. In deterministic suites, stop clients and polling first, reset,
then start the scenario.

## Monitor and history

| Method and path | What it does |
|---|---|
| `GET /monitoring/requests` | the in-RAM entries, most recent first |
| `DELETE /monitoring/requests` | clears the live view (the archives are untouched) |
| `GET /monitoring/requests/stream` | live event stream (SSE) |
| `GET /monitoring/dump` | state of the disk writing |
| `PATCH /monitoring/dump` | turns it on/off and adjusts cadence/threshold at runtime — body `{ enabled?, intervalMs?, threshold? }` |
| `POST /monitoring/dump/flush` | manual flush; body `{}`; answers with the number of entries written |
| `GET /monitoring/dumps` | list of the dump files |
| `GET /monitoring/dumps/read` | cursor-paginated reading (`?fileIndex&lineIndex&limit`) |
| `POST /monitoring/dumps/create-mocks` | creates mocks in bulk from a file or from a selection of entries; like the import, it reports `items` (with each entry's `key`) and `runtime`, and answers the same batch errors |
| `DELETE /monitoring/dumps/:file` | deletes a dump file |

## Server state

| Method and path | What it does |
|---|---|
| `GET /server` | `{ serverEnabled, proxyAll }` — [the three modes](CONTROLLI.md) |
| `PATCH /server` | partial update of the two booleans |

## Examples

```bash
# the full catalog
curl -s http://localhost:3000/_admin/api/mocks

# suspend the mocks: full proxy to the backend
curl -s -X PATCH http://localhost:3000/_admin/api/server \
  -H "content-type: application/json" -d '{"proxyAll": true}'

# preview an OpenAPI import without creating anything
curl -s -X POST "http://localhost:3000/_admin/api/mocks/import/openapi?dryRun=true" \
  -H "content-type: application/yaml" --data-binary @openapi.yaml

# turn on the history's disk writing and force a flush
curl -s -X PATCH http://localhost:3000/_admin/api/monitoring/dump \
  -H "content-type: application/json" -d '{"enabled": true}'
curl -s -X POST http://localhost:3000/_admin/api/monitoring/dump/flush \
  -H "content-type: application/json" -d '{}'

# runtime state (metadata only) and idempotent reset of "items"
curl -s http://localhost:3000/_admin/api/runtime/shared-state
curl -s -X POST http://localhost:3000/_admin/api/runtime/shared-state/items/reset \
  -H "content-type: application/json" -d '{}'

# copy preview: also reports preserved literal sharedState references
curl -s -X POST "http://localhost:3000/_admin/api/mocks/ID/copy?dryRun=true" \
  -H "content-type: application/json" \
  -d '{"method":"GET","path":"/items-copy","copyResponses":true}'
```

Preview and real copy use the same planner. The dry run responds `200` with planned files,
literal `sharedState.open("name", ...)` references and warnings; the copy responds `201`. The
dry run creates no directories, writes no files and does not reload the runtime. Dynamic names
or names hidden in helpers cannot be detected, while comments or strings can cause a
conservative warning: preview informs but neither enables nor blocks commit. Copy does not
rewrite the name or `seedKey`, because sharing the resource may be intentional.

## The machine-readable description

For the exact structure of every request and response body there is an OpenAPI 3.1 description
of this API: [`docs/admin-api.openapi.yaml`](../admin-api.openapi.yaml). It documents the
schemas, the status codes and the payload variants route by route, and it can be loaded into a
client generator, a request tool, or an agent that needs to drive Mockxy on its own.

The second reliable source stays the UI itself: every one of its actions is a call to these
routes, observable from the browser's developer tools.
