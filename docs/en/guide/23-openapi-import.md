# 23 — The OpenAPI import

If the API has a spec, the workspace is not built by hand: the import generates **one mock
per declared endpoint**, with bodies derived from examples and schemas. The stated goal is
a **solid base to refine** — plausible, immediately working mocks, not realistic data: the
values that matter for your flows are fixed afterwards, from the catalog.

Import and monitor capture complement each other: capture starts from available traffic
(real data, but it needs a backend and some navigation), import from the spec (full
coverage in seconds, but sampled data). When both are available, the typical order is:
import for the complete skeleton, capture or touch-ups for the endpoints that matter.

## Formats and tolerance

Accepted specs are **OpenAPI 3.0 / 3.1 and Swagger 2.0**, in **JSON or YAML** (document up
to 12 MB). Older versions are automatically converted to the 3.1 structure, and `$ref`
references are resolved — nested or across components too: you pass the spec as it is,
with no pre-processing.

## What gets generated

For every path+method pair (imported methods: `get`, `post`, `put`, `delete`, `patch`;
`head` and `options` are excluded, consistently with manual creation):

- the **path**, converted to Mockxy's convention: `/users/{id}` → `/users/:id`;
- the **status**: the first `2xx` declared among the responses;
- the **body**: from the spec's **example** when there is one; otherwise **sampled from
  the schema**, deterministically — same spec, same values: re-running the import doesn't
  produce randomly different data;
- the **collection**: from the spec's **tags**, reusing by name the collections already in
  the catalog. Untagged endpoints stay in Unsorted.

The rule that makes the import **re-runnable**: endpoints already existing in the
workspace (same method+path pair) **are not touched** — the import only creates the new
ones. When the contract is updated, you re-run the import of the new spec: what's missing
gets added, and the touch-ups made in the meantime stay intact.

## The dialog

"Import OpenAPI" sits in the Catalog view's bar. The dialog accepts the document by drag
or file selection (`.json`, `.yaml`, `.yml`) and — before writing anything — shows the
**preview**: the counts (to create / already existing / collections) and the full endpoint
list, each marked "To create" or "Exists", filterable (all / to create / skipped). Only
**"Import"** executes the plan; the final summary counts created, skipped and failed.

> 📷 **SCREENSHOT** — `23-import-anteprima.png`
> What to show: the import dialog with the preview populated from a real spec — the counts
> at the top and the endpoint list with the "To create" / "Exists" actions, the filter
> visible.

> 📷 **SCREENSHOT** — `23-catalogo-dopo-import.png`
> What to show: the catalog right after the import, organized into collections derived
> from the spec's tags, making the operation's result visible.

## After the import

The import delivers a complete, working skeleton: from there, three typical moves:

- **refine the data that matters**: sampled bodies are plausible but generic — for the
  screens you actually work on, replace them with meaningful data (or capture from the
  real backend when it arrives);
- **equip the key endpoints with variants**: the 500 preset, the empty list
  ([chapters 8–9](08-endpoint-panel.md));
- **switch areas on and off**: the tag-derived collections let you enable/disable whole
  areas with the collection action ([chapter 6](06-catalog.md)) — mocks for the area not
  yet implemented, real backend for the rest.

Via the API the import can be automated (`POST /_admin/api/mocks/import/openapi`, with
`?dryRun=true` for the preview only; the content-type must be explicit —
`application/json` or `application/yaml`): a pipeline can re-import the spec on every
contract update. The automation picture is in [chapter 30](30-admin-api.md).

The import writes many files in one go — and it is the right moment to look at *what* it
writes: the anatomy of the workspace and its files is
[chapter 24](24-mocks-as-files.md).
