# 11 — Lists with automatic pagination and filters

Nearly every frontend has a table or a list with a paginator and a search — and mocking
them with static responses would be a nightmare: you would need one mock per combination
of page and filter. Mockxy avoids that at the root: when a mock's body is a **list**,
requests can paginate and filter it with plain query parameters, without the mock having
to anticipate anything. You define the full dataset **once**, and every combination comes
for free.

## When it kicks in

The automation applies only to **JSON bodies of `mock` type** that are:

- an **array** (`[ ... ]`), or
- an **object with exactly one top-level array property** — the common "envelope" shape,
  e.g. `{ "items": [...], "meta": {...} }`. The response's shape is preserved: the page or
  the filtered set replaces the array, the other properties pass through intact. With two
  or more array properties the automation does not activate (there would be no criterion
  to choose).

Text bodies, file payloads, handler and middleware responses, and proxied responses stay
out. A templated body ([chapter 10](10-templating.md)) participates normally: the template
applies first.

## Pagination

It activates when **`page` and `size` are both present and valid**: `page` an integer from
`0` up (zero-based), `size` an integer from `1` up.

```
GET /api/users?page=0&size=10   → the first 10 elements
GET /api/users?page=2&size=10   → the 21st through 30th
```

Only one of the two parameters, or invalid values, deactivate pagination: the response
comes back whole, with no errors. A page beyond the end of the dataset returns an **empty
list** with the status unchanged — exactly what pagination components expect.

## Filters

Every query parameter **whose name matches a top-level key** of the elements becomes an
equality filter; parameters matching no key are ignored (the mock keeps answering requests
with extraneous parameters too).

```
GET /api/users?role=admin              → only elements with "role": "admin"
GET /api/users?role=admin&active=true  → AND across different parameters
GET /api/users?role=admin&role=editor  → OR across values of the same parameter
```

The comparison rules:

- the comparison happens on the value **converted to string**: `?id=3` finds both
  `"id": 3` and `"id": "3"`;
- by default it is **case-insensitive** (`?role=ADMIN` finds `"role": "admin"`); it
  becomes exact with the "Case-insensitive filters" switch in the workspace settings, or
  `CASE_INSENSITIVE_FILTERS=false` headless. The parameter's **name**, instead, must match
  the key exactly, capitals included;
- only top-level keys with **scalar values** (strings, numbers, booleans) take part: a
  filter on a nested key cannot be expressed;
- `page` and `size` are reserved for pagination and never become filters.

The **filter applies before the page**: `?role=admin&page=1&size=5` is the second page of
the admins only.

## `X-Total-Count`

With a filter or pagination active, the response carries the **`X-Total-Count`** header:
the total number of elements **after the filter and before the page** — the number the
frontend needs to compute how many pages to show. If the mock declares its own
`x-total-count`, the computed value wins while the automations are active; otherwise the
declared header passes unchanged.

## In practice: the table without a backend

The complete scenario: the frontend has a users table with a paginator and a role filter,
and the backend isn't there. You create `GET /api/users` with an array body of 50
plausible users (the "Paginated list" preset is a good base, or a loop in any generator) —
and that's it: the paginator calls `?page=N&size=10` and receives the right pages with the
total in the header, the role dropdown calls `?role=admin` and receives the subset. One
mock, the whole grid working.

> 📷 **SCREENSHOT** — `11-lista-monitor.png`
> What to show: the monitor detail of a `GET /api/users?role=admin&page=0&size=10` request
> served by the mock: in the response, the body with only the filtered first-page elements
> and, in the headers, `X-Total-Count` clearly visible.

## The limits, stated

Equality is the only operator: no `>`/`<`, no partial search (`?name=mar` does not find
"Mario"), no sorting, no nested keys. It is a simplicity choice: it covers the bulk of
real grids, and when the frontend needs richer semantics — full-text search, server-side
sort — the right step up is a handler that reads the dataset and applies real logic
([chapter 15](15-handlers.md), with the data kept out of the code as in
[chapter 17](17-data-page.md)).

One warning already given in chapter 7, and which really bites here: a route with a
**declared query in the path** demands exact equality of the entire query — `page`, `size`
and the filters are extra parameters, and those requests never reach it. Automatic
pagination and filters work on mocks **without** a query in the path.

So far the endpoint answers the same way until you change the variant by hand. The next
chapter automates that too: [variant sequences](12-variant-sequences.md).
