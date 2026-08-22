# 07 — Creating an endpoint and understanding paths

The first mock is created from the catalog's **"New"** button. The dialog asks for little
— method, path, and the content of the first response — but the path field deserves more
attention than it appears to require: the rules by which Mockxy matches requests to
declared paths are the most frequent cause of the "why isn't my mock answering?" question,
and knowing them upfront avoids nearly all the surprises.

## The "New" dialog

The fields, in order:

- **Type** — the nature of the endpoint's first variant: static mock, handler, middleware,
  SSE or WebSocket. In this chapter we create a static mock; for the other types the
  dialog replaces the response fields with a code editor pre-filled from a starting
  template (chapters 15, 16, 18, 19).
- **Method** — the HTTP method: GET, POST, PUT, PATCH, DELETE…
- **Path** — the path, absolute, with optional parameters (rules in the next section).
  Validation flags problems immediately: the path must start with `/`, the `^` character
  is reserved for internal use, and the path must be compatible with the collection
  convention.
- **Status and body** — the response status and the body, in JSON mode (validated: broken
  JSON does not save) or text mode, or a file dragged into the drop zone. They are the
  same controls as the response editor, described at length in
  [chapter 9](09-mock-response-editor.md).

On confirmation the endpoint appears in the catalog (in Unsorted, ready to be moved into a
collection) and is **immediately active**: the next matching request receives the mock. On
disk, an endpoint file was born together with its responses folder — the anatomy is in
[chapter 24](24-mocks-as-files.md).

> 📷 **SCREENSHOT** — `07-dialog-nuovo.png`
> What to show: the "New" dialog filled in for a realistic static mock — e.g.
> `GET /api/users/:id` with status 200 and a sample JSON body — ready to confirm.

> 📷 **SCREENSHOT** — `07-dialog-errore-path.png`
> What to show: the same dialog with a path validation error visible (e.g. a path without
> the leading `/` and its message).

## The path format

The path declares what the endpoint covers. The possible shapes:

```
/api/users                  exact path
/api/users/:id              named parameter
/api/users/:id/orders/:num  multiple parameters
/api/users?active=true      exact path + required query
```

- **`:name`** captures one path segment: `/api/users/:id` matches `/api/users/42` and
  `/api/users/mary`, and the captured value is available to templating and handlers. A
  parameter covers **one** segment: `/api/:id` matches `/api/42` but not `/api/42/extra`.
- The pattern covers **the whole path**, never a prefix: `/api/users` does not match
  `/api/users/extra`. This is also the reason behind the most classic missed match: the
  application calls `/api/v2/users` and the mock declares `/api/users` — the extra (or
  missing) prefix rules out the match entirely.
- A wildcard `*` is not supported, and `^` is forbidden.

## The choice happens in two stages

When a request arrives, Mockxy picks the endpoint in two steps, and the order has one
precise consequence:

1. **the path first** — among the registered routes, the most specific one matching the
   request's path and query is chosen;
2. **then the method** — inside the chosen route, the request's HTTP method is looked up.

The path choice is **final**: if the chosen route does not define the requested method,
the request goes to the fallback — a less specific route that might have had that method
is *not* looked up. Example: with `/api/users/:id` defining only `GET`, a
`POST /api/users/42` ends up at the fallback even if a more generic route with the `POST`
existed.

The outcome of the decision is always observable: the `x-mock-source` header says who
answered, and in mock-only mode the 404 body states the reason for the miss —
`path_not_mocked` (no route matches) or `method_not_mocked` (route found, method absent).

### Specificity

When several routes could match, the most specific one wins, in this order:

1. **exact** paths before parameterized ones — this is how `/api/users/me` can coexist
   with `/api/users/:id`: the `GET /api/users/me` request takes the exact route, all the
   others (`/api/users/42`…) fall to the parameter;
2. among parameterized paths, the one with **more static segments** wins
   (`/api/users/:id` beats `/api/:resource/:id`);
3. for the same path, the variant **with a declared query** is tried before its twin
   without one;
4. remaining ties are resolved deterministically, so behavior does not change between
   restarts.

## The declared query

If the path includes a query string, that query becomes a requirement of **exact equality
over the request's entire query**:

- parameter order does not matter (`?a=1&b=2` ≡ `?b=2&a=1`);
- names and values are compared case-sensitively;
- **no extra and no missing parameters**: `/api/users?active=true` does *not* match
  `?active=true&page=0` — the request with the extra parameter slides onto the twin
  without a query (if it exists) or to the fallback.

The last point is the most insidious, especially combined with chapter 11's automatic
pagination: a route with a declared query will never receive paginated requests, because
`page` and `size` are extra parameters. The declared query is meant to distinguish
**pointwise cases** — "this exact filter combination answers differently" — not to
constrain families of requests. For the general case, declare the path without a query and
let the automatic filters and pagination do the work.

For the same path, the route with a declared query is more specific: it is tried first,
and the twin without a query gathers everything else.

## One path, several methods

Different methods on the same path are distinct endpoints converging on the same route:
the `GET` and the `DELETE` of `/api/users/:id` coexist, each with its own variants. To
create them there is the "New" dialog — or, more convenient when the first one is already
polished, the endpoint **copy** onto the new method
([chapter 13](13-copying-endpoints.md)).

The endpoint exists and answers; the next step is its panel — description, enablement,
and above all the response variants: [chapter 8](08-endpoint-panel.md).
