# OpenAPI import

If the API has a spec, you don't build the workspace by hand: the import generates **one mock
for every declared endpoint**. The stated goal is a **solid base to refine** — plausible,
immediately working mocks, not realistic data: the values that matter for your own flow get
fixed afterwards, from the catalog or by hand.

## Formats and interpretation

**OpenAPI 3.0 / 3.1 and Swagger 2.0** specs are accepted, in **JSON or YAML**. Older versions
are automatically converted to the 3.1 structure and `$ref` references are resolved, even
nested or across components: you pass the spec as-is.

## What gets generated

For every path+method pair in the spec (imported methods: `get`, `post`, `put`,
`delete`, `patch`):

- the **path** converted to [Mockxy's convention](PATH.md): `/users/{id}` →
  `/users/:id`;
- the **status**: the first `2xx` declared among the responses;
- the **body**: from the spec's **example** when there is one; otherwise **sampled from the
  schema** deterministically (same spec → same values);
- the **collection** in the catalog: from the spec's **tags**, reusing by name the collections
  already present (the comparison ignores case and accents, like manual creation). A tag named
  like the default collection `Unsorted` doesn't create one: those mocks stay unassigned. A
  tag whose collection can't be created doesn't block the import: its mocks are created
  anyway, without a collection.

Endpoints **already existing** in the workspace (same method+path pair) are not touched: the
import only creates the new ones. Re-running the import after a spec update adds what's
missing without overwriting the touch-ups made in the meantime.

## Preview

From the UI (top bar) the import always starts with a **preview**: the complete plan — what
would be created, what would be skipped because it already exists, with the counts — without
writing anything. Via API it's `POST /_admin/api/mocks/import/openapi?dryRun=true`.

## Path prefix

The wizard's **Prefix (optional)** field prepends a root to **every** imported path: with `/be`,
`/users/{id}` becomes `/be/users/:id`. It's for when the front-end calls the API under a context
the spec doesn't declare in its paths.

- If the spec's `servers` declare a path after host and port (e.g.
  `https://api.example.com/be/v1`), the one from the **first server that has one** is pre-filled
  — it stays a suggestion: confirm it, change it, or clear the field.
- The field shows up **once the document is loaded**, below the _All / To create / Skipped_
  filters. Every change recomputes the plan, so the list shows the final paths and the counts
  stay true: with a different prefix the same endpoint is a new mock, not a duplicate of the
  existing one.
- Via API it's the `prefix` parameter (`?prefix=/be`), valid with `dryRun` too. A missing leading
  slash or an extra trailing one is normalized; a value that can't produce valid paths (spaces,
  `?`, `#`, the reserved `^` character) is rejected with `400`.

## Limits and notes

- Document up to **12 MB**.
- The API endpoint requires an **explicit content-type** (`application/json`,
  `application/yaml` and variants); `text/plain` is rejected with `415` on purpose — it's the
  anti-CSRF defense: a cross-origin `POST text/plain` would leave the browser without a
  preflight.
- The spec's `head` and `options` are not imported, consistently with the methods offered by
  mock creation.
