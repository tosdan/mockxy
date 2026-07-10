# The admin API — reference

Mockxy's entire UI is built on the **admin API** under `/_admin/api`: there is no UI
operation that doesn't go through here. The useful consequence is that **everything the UI
does can be automated** — setup scripts that populate a workspace, e2e suites that reset the
state between tests, pipelines that import an updated spec.

## When it answers and how it protects itself

- Enabled with `ADMIN_API_ENABLED` (default: on in development, off in production). When off,
  every route answers `404` with an explicit message.
- **No authentication**: it creates handlers, i.e. it writes files and executes code. The
  protections and the exposure rules are in the page on [network exposure](RETE.md) (anti
  DNS-rebinding guard on the `Host` header, warning on non-loopback binds).
- Mutations only accept **explicit JSON**: that's also the anti-CSRF defense — a cross-origin
  request with `content-type: application/json` triggers the browser's preflight and dies
  there. The only structural exception is the OpenAPI import, which accepts YAML but
  **rejects `text/plain` with `415`** precisely to avoid opening the "simple" request hole.

## Conventions

- An endpoint's **`:id`** is the endpoint file's relative path encoded base64url: you obtain
  it from the lists and treat it as **opaque**.
- **Errors** are JSON `{ error, message, details? }` with the appropriate status
  (`400` invalid input, `404` not found, `415` media type, `500`).
- Catalog mutations **reload the runtime immediately**: the change is served from the next
  request on, without restarts. Data files reload nothing ([`data()`
  re-reads on every call](DATI.md)), with one exception: the rename with reference rewriting
  reloads, because it touched the handlers' sources.

## Catalog and endpoints

| Method and path | What it does |
|---|---|
| `GET /mocks` | the whole catalog: endpoints, collections and orderings. An unreadable endpoint file (invalid JSON, missing selected variant) doesn't fail the request: that endpoint is skipped and reported in `loadErrors` (`[{ configFilePath, message }]`), as the runtime does at load time |
| `GET /mocks/resolve?method&path` | the endpoint that would cover a concrete request today (path with optional query), disabled ones included; `{ mock: null }` if none. A derived fact using the serving's matching, used by the monitor for "go to mock" |
| `POST /mocks` | creates an endpoint (static mock, or handler/middleware with source); if one already exists for route+method it answers `409` with `details.existingMockId`, so the client can offer to add a variant to that endpoint |
| `GET /mocks/:id` | detail of an endpoint with its variants |
| `PUT /mocks/:id` | updates the definition (including `enabled` and the selected variant) |
| `PUT /mocks/:id/endpoint` | updates method, path, description |
| `POST /mocks/:id/copy` | duplicates onto a new method+path — body `{ method, path, copyResponses }` |
| `PUT /mocks/:id/collection` | assigns the endpoint to a collection |
| `DELETE /mocks/:id` | deletes endpoint and variants |

## Response variants

| Method and path | What it does |
|---|---|
| `POST /mocks/:id/responses` | adds a variant |
| `PUT /mocks/:id/responses/:file` | updates a variant |
| `PUT /mocks/:id/responses/:file/file` | uploads the raw bytes that make the variant [file-backed](RESPONSE.md) — body `application/octet-stream` (up to 12 MB), MIME type and name in the query (`?contentType=…&filename=…`) |
| `DELETE /mocks/:id/responses/:file` | deletes a variant |

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
| `POST /mocks/import/openapi` | imports the spec (raw JSON/YAML body, up to 12 MB) — [generation rules](OPENAPI.md) |
| `POST /mocks/import/openapi?dryRun=true` | just the plan with the counts, without writing anything |

## Data files

| Method and path | What it does |
|---|---|
| `GET /files` | list with metadata and the endpoints using them (`usedBy`) |
| `GET /files/:name` | content of a data file |
| `PUT /files/:name` | creates (`201`) or replaces (`200`) — raw bytes up to 25 MB, JSON validated before writing |
| `PATCH /files/:name` | renames — body `{ name, rewriteReferences }` ([safe rename](DATI.md)) |
| `DELETE /files/:name` | deletes the file |

## Monitor and history

| Method and path | What it does |
|---|---|
| `GET /monitoring/requests` | the in-RAM entries, most recent first |
| `DELETE /monitoring/requests` | clears the live view (the archives are untouched) |
| `GET /monitoring/requests/stream` | live event stream (SSE) |
| `GET /monitoring/dump` | state of the disk writing |
| `PATCH /monitoring/dump` | turns it on/off and adjusts cadence/threshold at runtime — body `{ enabled?, intervalMs?, threshold? }` |
| `POST /monitoring/dump/flush` | manual flush; answers with the number of entries written |
| `GET /monitoring/dumps` | list of the dump files |
| `GET /monitoring/dumps/read` | cursor-paginated reading (`?fileIndex&lineIndex&limit`) |
| `POST /monitoring/dumps/create-mocks` | creates mocks in bulk from a file or from a selection of entries |
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
curl -s -X POST http://localhost:3000/_admin/api/monitoring/dump/flush
```

For the exact structure of the create and update bodies, the most reliable source is the UI
itself: every one of its actions is a call to these routes, observable from the browser's
developer tools.
