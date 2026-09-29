# The admin API — reference

Mockxy's entire UI is built on the **admin API** under `/_admin/api`: there is no UI
operation that doesn't go through here. The useful consequence is that **everything the UI
does can be automated** — setup scripts that populate a workspace, e2e suites that reset the
state between tests, pipelines that import an updated spec.

**The contract evolves with the app.** The admin API follows Mockxy's versions, and a minor
release may change its contract: the [release notes](../progetto/NOTE-RILASCIO-next.md) say what
changes for clients. A client using the most recent capabilities (revisions, inactive variants,
the paged monitor) first reads the version from `GET /info` and the contract from
`GET /openapi.yaml`. If the runtime does not expose these routes, or does not declare the ones
it needs, the client stops before any change and names the update required: a capability is
never discovered by trying a write.

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
    restore could not reload it. The workspace state must not be assumed consistent:
    `GET /runtime/status` shows the outcome of the last load and the per-file errors.
- **One mutation at a time** per workspace: mutations are queued, while reads, traffic and the
  SSE/WS console pushes do not wait for them. A client that disconnects does not cut a running
  mutation short.
- **Reads during a change:** an endpoint's detail is not an atomic snapshot of several files. If
  a file is missing during the read, the detail is built once more from the definition read
  again, following its selection; an endpoint deleted meanwhile answers `404`. If the file is
  still missing, the answer is `409` with `details: { code: "READ_INCONSISTENT", retryable: true }`
  and no partial detail: repeat the read at most once automatically. The message names the
  missing file, which may also have been deleted by hand.
- **Drafts protected by revision:** the detail reports `descriptionRevision` and
  `responseRevision` (the selected variant), the variant read reports `revision`. They are
  content tokens (`rev-v1:…`) computed from the very data returned: a description covers its
  value only, a variant its persisted definition and the bytes of its direct source and asset.
  Going back to the same content gives back the same token, also after a restart. Whoever saves
  from a draft sends `expectedRevision` (for the upload, the `X-Mockxy-Expected-Revision` header):
  the check runs in the queue against the actual content, and if it changed the answer is
  `409 REVISION_CONFLICT` with `details.resource`, `expectedRevision` and `currentRevision`, with
  nothing written or reloaded. Do not retry blindly: read again, compare, and save deliberately
  with the new revision. Without a precondition everything works as before.
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
| `PUT /mocks/:id` | selects a response with `{ selectedResponseFile }`, or updates the selected ordinary response; the legacy `{ sequence }` body is rejected. In the update `expectedRevision` protects the selected variant (the token includes the file name); a protected payload that would change `enabled`, or a protected selection change, is a `400` |
| `GET /mocks/:id/sequence/state` | lightweight live state of the selected sequence: `{ sequenceFile, sequenceState }`; `400` on another type |
| `POST /mocks/:id/sequence/reset` | clears cursor and handler memory for the selected sequence; body `{}`; responds `{ sequenceFile, sequenceState }` |
| `POST /mocks/:id/sse/push` | manual push of the [SSE](RESPONSE.md) console: body `{ data, event?, id? }`, broadcast to every open connection — responds `{ delivered, connections }`. The target is the definition the runtime serves, including the previous route kept when a new selection fails to load, not the selection on disk: `404` if the runtime does not serve the endpoint, `400` if it serves it with another type, middleware included. The same holds for the other three console routes |
| `GET /mocks/:id/sse/connections` | SSE console state: open connections (with script position) and history of sent messages |
| `POST /mocks/:id/ws/push` | manual push of the [WS](RESPONSE.md) console: body `{ data }`, broadcast to every open connection — responds `{ delivered, connections }` |
| `GET /mocks/:id/ws/connections` | WS console state: open connections (with script position) and the bidirectional transcript (sent and received) |
| `PUT /mocks/:id/endpoint` | updates **only** `description` and `enabled` (any other field is a `400`): method and path are fixed at creation — the path determines the files' folder — and are changed with `POST /mocks/:id/copy`. With `expectedRevision` (the `descriptionRevision` read) it protects the description only: send it with `description` and without `enabled` |
| `POST /mocks/:id/copy` | duplicates onto a new method+path — body `{ method, path, copyResponses }`; with `?dryRun=true`, returns the plan without writing or reloading |
| `PATCH /mocks/enabled` | enables or disables a list of endpoints — body `{ ids, enabled }`, with a non-empty `ids` (duplicates are collapsed); an unknown id fails the request before anything is written; answers with the refreshed catalog `{ items, collections, childOrder }`. It is the route behind the catalog's multi-selection |
| `PUT /mocks/:id/collection` | assigns the endpoint to a collection |
| `DELETE /mocks/:id` | deletes endpoint and variants |

## Response variants

| Method and path | What it does |
|---|---|
| `GET /mocks/:id/responses/:file` | one variant by filename, selected or not: `{ id, responseFile, selected, active, response, source, fileInfo }`, with the source of handlers and middleware and the metadata (`name`, `size`) of a file-backed mock's asset, never the binary content. `active` tells whether it is the selected variant or a step of the selected sequence: check it before treating a change as harmless; if the selected variant cannot be read the answer is `400`, never a guessed `active`. Reading it changes neither selection nor scenario; a variant no longer listed is `404`, a missing file follows the `READ_INCONSISTENT` procedure of the detail |
| `POST /mocks/:id/responses` | adds and selects a `mock`, `handler`, `middleware`, `sse`, `ws`, or `sequence` variant; generic cloning also supports sequences. With `select: false` it prepares the variant without activating it: selection, sequence cursor and handler memory do not change, validation is the same. The response reports `createdResponseFile` |
| `PUT /mocks/:id/responses/:file` | updates a variant; for sequences it edits title/steps/end/reset and validates the complete graph. The response reports `updatedResponseFile`, independent of the selected variant in the detail |
| `PUT /mocks/:id/responses/:file/file` | uploads the raw bytes that make the variant [file-backed](RESPONSE.md) — body `application/octet-stream` (up to 12 MB), MIME type and name in the query (`?contentType=…&filename=…`). The precondition goes in the `X-Mockxy-Expected-Revision` header |
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
| `GET /monitoring/requests` | without a query: every in-RAM entry, complete, most recent first (`{ items }`, as before). With `view=page`: a [cursor page](#reading-the-monitor-page-by-page), in ascending order, with filters and declared loss |
| `GET /monitoring/requests/:id?runtimeId=…` | one complete entry by id, in the given runtime: `{ runtimeId, item }`; `409 RUNTIME_CHANGED` if the engine restarted, `404 REQUEST_NOT_AVAILABLE` if the entry was evicted, cleared or never existed |
| `POST /monitoring/requests/create-mocks` | creates mocks from monitor entries, in the order given — body `{ runtimeId, ids, onConflict, selectAddedVariants?, newEndpointEnabled }`; [rules and outcomes](#creating-mocks-from-traffic) |
| `DELETE /monitoring/requests` | clears the live view (the archives are untouched) |
| `GET /monitoring/requests/stream` | live event stream (SSE); the first event, `snapshot`, carries the current entries and the `runtimeId` their IDs belong to |
| `GET /monitoring/dump` | state of the disk writing |
| `PATCH /monitoring/dump` | turns it on/off and adjusts cadence/threshold at runtime — body `{ enabled?, intervalMs?, threshold? }` |
| `POST /monitoring/dump/flush` | manual flush; body `{}`; answers with the number of entries written |
| `GET /monitoring/dumps` | list of the dump files |
| `GET /monitoring/dumps/read` | cursor-paginated reading (`?fileIndex&lineIndex&limit`) |
| `POST /monitoring/dumps/create-mocks` | creates mocks in bulk from a file or from a selection of entries (`file` or `keys`), with the same [rules and outcomes](#creating-mocks-from-traffic) as the monitor; the options are optional, with the historical defaults `onConflict: "skip"`, `selectAddedVariants: false`, `newEndpointEnabled: true`. It keeps its counts (`created`, `createdEmpty`, `skippedExisting`, `failed`) and adds `addedVariants`; `items` carry each entry's `key` |
| `DELETE /monitoring/dumps/:file` | deletes a dump file |

### Reading the monitor page by page

With `view=page` the monitor answers the question an agent or a test asks: "what went through
since I last looked". The monitor stays an in-memory buffer of the latest entries, not an archive:
the dump is there for durable capture.

| Parameter | Meaning |
|---|---|
| `limit` | entries per page, from 1 to 250; default 50 |
| `fields` | `summary` (default: identity, outcome, `matchedRoutePath`, `sequenceStep`, `sharedStateError`; no bodies, no headers) or `full` (the complete entry, truncation flags included) |
| `method`, `path`, `status`, `source` | filters combined with AND, exact match; the method is case-insensitive, `path` is the path without query string |
| `since` | the exclusive id to resume from (`cursor.since` of the previous page), or `latest` to start from now; absent to read the available buffer |
| `runtimeId`, `generation` | those of the cursor: required with a numeric `since`, forbidden otherwise |

The answer is `{ items, cursor, hasMore, gap, gapReason, available }`. Ids are decimal strings,
increasing within a runtime; `generation` grows at every clear, even of an already empty buffer,
and a clear never reuses ids. Each page returns up to `limit` matches after the cursor: if more
remain, `hasMore` is `true` and `cursor.since` is the last id returned; otherwise `cursor.since`
is the last id assigned (`available.highWatermark`), also with no match. Traffic arriving
meanwhile lands in the next page, with no loss and no duplicate. To read incrementally, send back
the cursor's `since`, `runtimeId` and `generation` with the same filters; changing filters needs a
fresh read (no `since`, or `since=latest`), while `limit` and `fields` may change between pages.

If the engine restarted (`runtime_changed`), the monitor was cleared (`cleared`) or the entries
after the cursor were already evicted (`evicted`), the answer is still `200` with `gap: true`, the
reason, and the page starting at the first entry available. **With `gap: true` an empty list does
not mean "no requests"**: the lost range may have held some. A `since` beyond the last id assigned
in the same runtime is `400 CURSOR_AHEAD`.

Any parameter requires `view=page`, and an unknown parameter is a `400` with
`details.code: "INVALID_QUERY"` and its name in `details.parameter`: earlier versions ignored
these parameters, and a misspelled filter looked like an empty monitor.

```bash
# from now on: the cursor to resume from after the action
curl -s "http://localhost:3000/_admin/api/monitoring/requests?view=page&since=latest"
# the GETs on /api/orders that arrived after that cursor
curl -s "http://localhost:3000/_admin/api/monitoring/requests?view=page&method=GET&path=/api/orders&since=41&runtimeId=…&generation=1"
```

### Creating mocks from traffic

The monitor and the history turn a captured response into a mock with the same rules:

- **Route and method:** the route that served it (`matchedRoutePath`, when present and not `n/d`),
  otherwise the request path; the method in uppercase. No parametric route is inferred.
- **Status and delay:** the captured status; `delayMs` 0.
- **Body:** empty → `{}`; valid JSON → the value; other text → the string. A truncated body or a
  `[binary payload: …]`/`[compressed payload: …]` placeholder becomes `{}` and the draft is
  **incomplete**: a new endpoint gets the description `[da completare] …`, an added variant a
  title starting with `[da completare]`, and the item the warning `INCOMPLETE_CAPTURE` with
  `reason` `truncated` or `binary`. It is not a faithful copy and is never presented as one.
- **Headers:** those of the captured response, without `content-length`, `content-encoding`,
  `transfer-encoding`, `connection`, `keep-alive`, `date`, empty values and masked `***` values (a
  masked value is never restored); multiple values are joined with `, `.
- **Conflict:** on the destination's identity, exact method and route, against the catalog and the
  items already processed in the same batch. `onConflict: "skip"` leaves it as it is;
  `"add-variant"` adds a variant (titled with the source and the UTC capture time, e.g.
  `monitor · 10:11:12`), keeps the endpoint's enabled state and selects it only with
  `selectAddedVariants: true`. Several equivalent destinations are an error of the item, with
  `candidates`, never an arbitrary choice; an endpoint file in the folder derived from the route
  that does not declare that identity fails the item too. A new endpoint gets the variant
  selected, and is enabled only with `newEndpointEnabled: true`.

From the monitor `runtimeId` is required and must be the current one, because ids restart at every
start: otherwise `409 RUNTIME_CHANGED` before writing. `onConflict` and `newEndpointEnabled` are
required too: a capture never activates anything implicitly. The entries are copied at the start
of the turn in the mutation queue, so a later eviction does not invalidate a capture already
taken; an id no longer available is a skipped item with `captureOutcome: "unavailable"`, and the
others go on. To prepare without touching what is served, send `newEndpointEnabled: false` and
`selectAddedVariants: false`, and check the incomplete items before activating them.

The `201` answer reports per item `writeOutcome` (`created`, `variant_added`, `skipped`,
`failed`), `runtimeOutcome`, `captureOutcome` (`complete`, `incomplete`, `unavailable`) and
`warnings`, with the `id` and `responseFile` written; from the monitor also `requestId` and
`counts`. A batch is **not idempotent**: if the answer is lost, read the catalog again and stop
unless you can tell with certainty which items were created, rather than retrying blindly. The
conversion deletes neither captures nor dump files.

When several items of the same batch select a variant on the same endpoint (created endpoints
included), the runtime serves the last one: the earlier ones have `runtimeOutcome:
"not_applicable"` and the warning `SUPERSEDED`, with `by` naming the variant that replaced them. A
batch that fails after writing (`BATCH_RUNTIME_FAILED`, `ROLLBACK_FAILED`) reports in
`details.result` the result in the shape of the `201`, counts included.

## Server state

| Method and path | What it does |
|---|---|
| `GET /server` | `{ serverEnabled, proxyAll }` — [the three modes](CONTROLLI.md) |
| `PATCH /server` | partial update of the two booleans |

## Runtime

| Method and path | What it does |
|---|---|
| `GET /info` | who answers and on what: `version`, `runtimeId` and `startedAt` (new at every start), `workspace` (canonical `id`, `root`, `mocksDir`, `filesDir`; `root` only from the desktop app), the `listener` actually in use, the `watcher` (`state` among `disabled`, `starting`, `ready`, `error`) and `revisions` (`catalog`, `server`, `dump`, `diagnostics`, `config`). Revisions start at 1 and grow when the resource changes: they tell what to read again and are not write preconditions. It never scans the workspace |
| `GET /config` | effective configuration, read-only: `{ runtimeId, startup, effective, overrides, persisted }`, with only the nine keys that upcoming versions will let you change at runtime (`backendUrl` is `null` without a backend). No other environment variable. For now `effective` equals `startup` and `overrides` is `{}`; `runtimeId` changes at every start |
| `GET /runtime/status` | outcome of the last load of the workspace, `200` even when degraded or failed: `lastAttempt` (`id`, timestamps, `reasons` among `startup`, `admin`, `watcher`, `status` `applied`, `degraded` or `failed`), `lastAppliedAttemptId`, per-file `errors` (`endpointId`, `filePath`, `message`, `serving`: `retained` when the previous version is still served, `missing` when nothing serves it) and `fatalError`. Only the last attempt, no history |
| `GET /openapi.yaml` | the [contract](#the-machine-readable-description) of the running version, as `application/yaml` |

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

## Preparing a scenario through the API

A test or an agent that has to try out a feature prepares the scenario **explicitly**, whatever
state the previous session left: there is no "undo", and none is needed.

1. **Check the instance:** `GET /info` (the right `workspace`), `GET /openapi.yaml` (the routes
   you will use) and `GET /config` (the startup configuration the test depends on, which cannot
   be changed through the API yet: the environment prepares it). If anything does not match,
   stop.
2. **Prepare the content:** resolve endpoints and variants from the catalog by method, path and
   file name, never by title or from the current selection. Read each variant
   (`GET /mocks/:id/responses/:file`) and save it with the `revision` you read as
   `expectedRevision`; create with `select: false`. Check `active`: a variant that is not
   selected may be a step of the selected sequence. If the outcome of a create is uncertain, read
   again before retrying.
3. **Activate:** once preparing succeeded, `PATCH /server` with `serverEnabled: true` and
   `proxyAll: false`, select the intended variants, enable the endpoints.
4. **Reset:** for a sequence, select it and call `POST /mocks/:id/sequence/reset` even if it was
   already selected; for shared state, reset only the resources involved.
5. **No timed waits:** a successful mutation is already served. Checking reads through the admin
   API do not consume sequence steps.
6. **Check the traffic:** take a `since=latest` monitor cursor before the action, then read the
   entries after it ([paged monitor](#reading-the-monitor-page-by-page)); with `gap: true` the
   check cannot conclude.

The repository holds a complete example, run with the Playwright suite:
[`e2e/agent-setup.spec.js`](../../e2e/agent-setup.spec.js), with the helper
[`e2e/agent-setup/mockxy-admin.js`](../../e2e/agent-setup/mockxy-admin.js) and the fixture
workspace `workspace-agent-test/`. The same setup reaches the same result starting from another
selected variant with the sequence already consumed, from disabled endpoints with Proxy All on,
and repeated several times without any restore. The helper stops with a diagnostic message on a
wrong workspace, an unverifiable contract, a different configuration, a failed precondition, a
change not applied or monitor traffic lost.

Limits to know:

- **Changes outside the API:** an editor, the watcher or another process do not go through the
  mutation queue. One mutation at a time and the preconditions hold for API calls; an external
  write made after the check stays outside.
- **Runtime memory:** sequence cursors, handler memory, shared state and the monitor live in
  memory and start over at every start. Resetting a sequence also clears that endpoint's handler
  memory, but needs the sequence selected: it is not a reset of any handler. A handler whose
  local memory no reset clears is tested on a fresh test runtime, or with a specific reset
  documented in the workspace.

## The machine-readable description

For the exact structure of every request and response body there is an OpenAPI 3.1 description
of this API: [`src/admin/admin-api.openapi.yaml`](../../src/admin/admin-api.openapi.yaml). It
documents the schemas, the status codes and the payload variants route by route, and it can be
loaded into a client generator, a request tool, or an agent that needs to drive Mockxy on its
own. A running engine serves it as is from `GET /_admin/api/openapi.yaml`, from the desktop app
and the development Docker image too: it is the contract of the version that answers, under the
same enablement rules as the other admin routes.

The second reliable source stays the UI itself: every one of its actions is a call to these
routes, observable from the browser's developer tools.
