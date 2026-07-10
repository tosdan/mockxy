# The path convention

This page describes how Mockxy decides, request by request, **which endpoint answers**:
the format of the paths declared in the [endpoint files](ENDPOINT.md), the precedence rules
when multiple routes could match, and the role of the HTTP method. It's the mechanics behind
the most frequent doubt — "why doesn't my mock answer?" — and knowing it in advance avoids
most surprises.

## The choice happens in two steps

1. **The path first**: among the registered routes, the most specific one whose pattern
   matches the request's path and query is chosen.
2. **Then the method**: within the chosen route, the request's HTTP method is looked up.

The important consequence is that **the path choice is final**: if the chosen route doesn't
define the requested method, the request goes to the fallback (proxy to the backend, or `404`
in mock-only mode) — a less specific route that might have had that method is *not*
searched. Example: with `/api/utenti/:id` defining only `GET`, a `POST /api/utenti/42`
ends up at the fallback even if a more generic route with the `POST` existed.

The outcome of the decision is observable: the `x-mock-source` header says who answered, and
the body of the mock-only `404` reports the reason — `method_not_mocked` (route found, method
missing) or `path_not_mocked` (no route matches).

## The path format

The endpoint file's `path` field declares an **absolute** path (it starts with `/`), with
optional **named parameters** and an optional **required query string**:

```
/api/utenti                  exact path
/api/utenti/:id              named parameter
/api/utenti/:id/ordini/:num  multiple parameters
/api/utenti?attivo=true      exact path + required query
```

- **`:name`** captures a path segment; the value reaches the handlers already decoded
  (percent-decoding). A parameter covers *one* segment: `/api/:id` matches `/api/42` but
  not `/api/42/extra`.
- The pattern covers **the whole path**, never a prefix: `/api/utenti` doesn't match
  `/api/utenti/extra`.
- The **`^` character is forbidden** in the path: it is reserved for internal use (it encodes
  the query part in the names of the derived folders on disk).
- A **bare `*` is not supported** and is rejected on load: the endpoint is invalid
  and is discarded with a warning, following the per-endpoint degradation described
  in the [page on the endpoint file](ENDPOINT.md).

## The declared query

If the `path` includes a query string, that query becomes a **requirement of exact equality
on the request's entire query**:

- the order of the parameters doesn't matter: `?a=1&b=2` and `?b=2&a=1` are equivalent;
- names and values are compared **case-sensitively** (`?attivo=true` ≠ `?ATTIVO=true`);
- **no extra parameters and no missing ones**: `/api/utenti?attivo=true` does *not* match
  `?attivo=true&page=0` — the request with the extra parameter slides to the query-less twin
  (if it exists) or to the fallback.

The last point is the trickiest, especially in combination with automatic pagination: a
variant with a declared query will not receive paginated requests, because `page` and `size`
are extra parameters. The declared query is meant to distinguish *specific cases* ("this
exact combination of filters answers differently"), not to constrain families of requests.

For the same path, the route **with** a declared query is more specific than its twin without —
it is tried first, and the twin (which accepts any query) catches everything else.

## Specificity

When multiple routes could match, the trial order is:

1. **exact paths** (without parameters) before those **with parameters**;
2. among paths with parameters, the one with **more static segments** wins
   (`/api/utenti/:id` beats `/api/:risorsa/:id`);
3. for the same path, the variant **with a declared query** before its twin without;
4. remaining ties are resolved deterministically (stable file order), so the
   behavior doesn't change from one restart to the next.

## One path, multiple methods

All the endpoint files declaring the same `path` — even from different folders — flow into
the **same route**, each with its own method: that's how the `GET` and `DELETE` of
`/api/utenti/:id` coexist. Two files declaring the same method+path pair are instead a
conflict, handled as described in the [page on the endpoint file](ENDPOINT.md).
