# Lists: automatic filters and pagination

When the body of a [mock](RESPONSE.md) is a list, Mockxy gives it real-API behavior:
requests can **filter** the items with query parameters and **paginate** the
result, without the mock having to anticipate anything. You define the full dataset once
and the combinations come by themselves — the alternative would be one mock for every
combination of filters and pages, which is exactly what a mock server should avoid.

The two features share the mechanics and the count header, and the **filter applies
before the page**: this page documents them together.

## When they kick in

Only on **JSON bodies of type `mock`** that are:

- an **array** (`[ ... ]`), or
- an **object with exactly one top-level array property** — for example
  `{ "items": [...], "meta": {...} }`. The shape of the response is preserved: the page or the
  filtered result replaces the array, the other properties pass through intact. With two or
  more array properties the automatism doesn't kick in (there would be no criterion to choose).

Left out: textual bodies, payloads from `file`, handler and middleware responses, proxied
responses.

## Filters

Every query parameter **whose name matches a top-level key of at least one
item** of the list becomes an equality filter; all the other parameters are
ignored (an existing mock keeps answering even requests with extraneous parameters).

```
GET /utenti?ruolo=admin              → only the items with "ruolo": "admin"
GET /utenti?ruolo=admin&attivo=true  → AND between different parameters
GET /utenti?ruolo=admin&ruolo=editor → OR between values of the same parameter
```

The comparison rules:

- the comparison happens on the **value converted to string**: `?id=3` finds both `"id": 3` and
  `"id": "3"`;
- by default it is **case-insensitive** (`?ruolo=ADMIN` finds `"ruolo": "admin"`); it becomes
  exact with the "Case-insensitive filters" switch in the workspace settings (desktop app) or
  with `CASE_INSENSITIVE_FILTERS=false` (headless). The parameter's *name*, instead, must
  match the key exactly, including case;
- only top-level keys with **scalar values** (strings, numbers, booleans) take part:
  `null`, objects and arrays never match — a filter on a nested key cannot be
  expressed;
- with at least one filter active, the items of the list that are not objects are excluded
  from the result;
- `page` and `size` are **reserved** for pagination and never become filters;
- repeated values come from the raw query string: `?a=1&a=2` is a real OR even when
  the framework's parser would represent them differently.

## Pagination

It kicks in **only when `page` and `size` are both present and valid**: `page` an integer from `0`
up (zero-based numbering), `size` an integer from `1` up. A single parameter, or invalid values,
disable pagination — the response comes back whole (possibly filtered), with no errors.

```
GET /utenti?page=0&size=10            → first 10 items
GET /utenti?ruolo=admin&page=1&size=5 → second page of admins only
```

A page beyond the end of the dataset returns an empty list with the status unchanged: it's the
behavior that frontend pagination components expect.

## `X-Total-Count`

When filtering or pagination is active, the response carries the **`X-Total-Count`** header with
the total number of items **after the filter and before the page** — the value the frontend
needs to compute the number of pages. If the mock declares its own `x-total-count` header (with
any combination of case), with filtering or pagination active **the computed value
wins**; with no automatisms active, the declared header passes through unchanged.

## Interaction with the query declared in the path

A mock whose `path` declares a query string requires the **exact equality of the entire
query** (see [the path convention](PATH.md)): filter and pagination parameters are
extra parameters, so those requests don't reach the variant with the declared query.
Automatic filters and pagination work best on mocks **without** a query in the path, which
accept any query.
