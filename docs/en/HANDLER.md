# Handlers

When a static response isn't enough — because it has to echo a parameter, change based on the
received body, or build the result from a dataset — the variant can be a **handler**: a local
JavaScript script that receives the request and returns the response. It's the step above the
static mock, before having to bother a real backend.

A handler is attached to the endpoint through a [response file](RESPONSE.md) of type
`handler`, which points to a `*.handler.js` script in the same folder as the variants. Like any
variant, it activates when selected — the same endpoint can have a static variant and a dynamic
one and switch between them.

## The shape of the script

```js
module.exports = {
  async resolveResponse({ params, query, requestHeaders, jsonBody, data }) {
    const utenti = await data("utenti");
    const utente = utenti.find((u) => String(u.id) === params.id);
    if (!utente) {
      return { status: 404, jsonBody: { error: "not_found", id: params.id } };
    }
    return {
      status: 200,
      headers: { "x-fonte": "handler" },
      jsonBody: utente,
    };
  },
};
```

The script is a CommonJS module exporting an object with the **`resolveResponse`** function
(synchronous or `async`). It can require other local files with relative `require` calls: the
engine tracks their dependencies and recompiles when something changes (see [the response
file](RESPONSE.md)). It cannot declare `method`, `path` or `disabled`: routing belongs to the
endpoint file. The UI offers a starter template already in this shape.

## The context it receives

`resolveResponse` receives an object with:

- **`params`** — the route's path parameters (`/utenti/:id` → `params.id`), already
  percent-decoded. Always strings.
- **`query`** — the query parameters (Express object: string values, or arrays for repeated
  ones).
- **`requestHeaders`** — a copy of the request headers, names in lowercase.
- **the body, in three forms** (the request is buffered before calling the script):
  - **`bodyBuffer`** — the raw body as a `Buffer`, always present (empty when there is no
    body);
  - **`bodyText`** — the body as a UTF-8 string, only for textual content-types, otherwise
    `undefined`;
  - **`jsonBody`** — the body already parsed, when the content-type is JSON or the content has
    structured JSON form; otherwise `undefined`.
- **`data(name)`** — the accessor to the Data page's [data files](WORKSPACE.md): `await
  data("utenti")` returns the content of `utenti.json`. The read happens on every call
  (changes to the file are visible on the next request) and every handler receives its **own
  copy**: mutating it doesn't pollute other requests. A non-existent name is an explicit
  error, which becomes the handler's standard failure.
- **`sharedState`** — the ephemeral JSON store shared by **different handlers**. It is the
  primitive for stateful scenarios such as “POST adds an item, the next GET returns it”. Open
  a resource with `await sharedState.open(name, { seedKey, initialize })`, then use the
  resulting handle through `read()`, `mutate()` or `replace()`. See [Shared runtime
  state](#shared-runtime-state) for the full contract.
- **`state`** — a mutable object **persistent across calls** of the same endpoint (and shared
  by its variants): the memory for counters, per-resource state machines
  (`state[params.id] = ...`), outcomes that depend on history. It is **ephemeral and local to
  the engine** — not a database: it resets on restart and with the endpoint's
  [sequence](ENDPOINT.md) reset; it survives hot reloads instead, so iterating on the script
  doesn't restart your test from scratch.
- **`callCount`** — progressive number of handler invocations for this endpoint (1 on the
  first), same lifetime as `state`.
- **`firstRequestAt`** — timestamp (ms epoch) of the first invocation: `Date.now() -
  firstRequestAt` is the time elapsed since the round started, without looking at the absolute
  clock. With these three primitives a polling endpoint that changes outcome needs no hacks:

  ```js
  module.exports = {
    resolveResponse({ firstRequestAt }) {
      if (Date.now() - firstRequestAt < 15000) {
        return { status: 202, jsonBody: { status: "processing" } };
      }
      return { status: 200, jsonBody: { status: "completed" } };
    },
  };
  ```

  (for the simple case, with no code at all, there is the [variant sequence](ENDPOINT.md)).
- **`req`** — the raw Express request, for advanced cases. Beware: the body stream has already
  been consumed by the buffering — use the three forms above, don't re-read it.

The request body is buffered **up to 2 MB**: beyond that, the engine answers `413` without
even running the script.

## The result

`resolveResponse` returns an object:

- **`status`** — optional, default `200`; integer between 100 and 599.
- **`headers`** — optional. `Content-Length` is always recomputed by the engine, and when the
  response has a body any declared `Content-Encoding`, `Transfer-Encoding` and `ETag` are
  discarded as well: the body is built locally and that metadata would be stale.
- **`removeHeaders`** — optional: a list of names (case-insensitive) to remove from the
  declared headers. Useful when `headers` is built by spreading another source and some entry
  must be excluded.
- **`jsonBody`** *or* **`body`** — at most one of the two:
  - **`jsonBody`** — any serializable value: it goes out as JSON with
    `content-type: application/json` set by the engine;
  - **`body`** — a **string or a `Buffer`**, served as-is: the content-type is declared by the
    `headers`. It's the way to go for text, XML, or generated binary payloads;
  - **neither** — a response without a body (typical for `204`).
- **`applyListQuery`** — optional boolean, default `false`. When `true`, the engine applies the
  same [list filtering and pagination](LISTE.md) rules used by static mocks to `jsonBody`,
  including `X-Total-Count`. It requires `jsonBody`; a non-boolean value makes the result
  invalid.

Handler responses go out with no-cache headers and with `x-mock-source: handler`, and they
don't receive [simulated delays](RITARDI.md): a script that wants to be slow waits on its own.

## Shared runtime state

`state` belongs to one endpoint. `sharedState` instead lets multiple handlers reach the same
named resource. A data file can initialize it, but after opening, the live value remains only
in memory and never rewrites the file.

This is a complete example for a GET and a POST sharing `items`:

```js
// Repeat the same helper in both *.handler.js files.
function openItems({ sharedState, data }) {
  return sharedState.open("items", {
    seedKey: "items@v1",
    initialize: () => data("items"),
  });
}

// GET /items
module.exports = {
  async resolveResponse(context) {
    const items = await openItems(context);
    return {
      status: 200,
      jsonBody: items.read(),
      applyListQuery: true,
    };
  },
};
```

```js
// POST /items — in the other endpoint's script, with the same openItems().
module.exports = {
  async resolveResponse(context) {
    const items = await openItems(context);
    let created;
    try {
      created = items.mutate((draft) => {
        if (!Array.isArray(draft)) throw new Error("items must be an array");
        if (draft.some((item) => String(item.id) === String(context.jsonBody.id))) {
          const error = new Error("duplicate item");
          error.code = "DUPLICATE_ITEM";
          throw error;
        }
        const item = { ...context.jsonBody };
        draft.push(item);
        return item;
      });
    } catch (error) {
      if (error.code === "DUPLICATE_ITEM") {
        return { status: 409, jsonBody: { error: "duplicate_item" } };
      }
      throw error;
    }
    return { status: 201, jsonBody: created };
  },
};
```

The handle operations are:

- `read()` returns a JSON copy: mutating it does not change the store;
- `mutate(callback)` gives the callback a private draft and commits atomically only when the
  callback completes successfully. The callback must be synchronous; its return value is
  returned to the script but does not replace the root;
- `replace(value)` replaces the whole value and returns `undefined`.

Initializers and mutators cannot use any shared-state operation, directly or from their async
continuations. This prevents dependency cycles, hidden ordering between resources and partial
commits. Initialization itself may be asynchronous: if multiple requests concurrently open a
missing resource, only one factory is used and all others wait for the same result.

### What `seedKey` does

The name identifies the resource; `seedKey` declares the **logical shape** expected by its
handlers. Every handler opening `items` must use the same signature. If one still declares
`items@v1` while another moves to `items@v2`, the latter gets an explicit conflict instead of
silently operating on data with the wrong shape. The Monitor and **Data → Runtime state** page
show the name, signature and involved handler so the stale reference can be found.

`seedKey` does not compare factory source and does not validate the JSON schema: it is an
intentional declaration by the author. Bump it when the shape or initialization strategy
changes, then reset the resource. Do not derive it from a request body, query, time or other
per-request input; doing so would make the live value depend on whichever request arrived
first again.

Names and signatures follow these rules:

- the name is trimmed and lowercased, is 1–128 characters long and accepts only `a-z`, `0-9`,
  `.`, `_`, `-` (but not `.` or `..`);
- `seedKey` is case-sensitive and not normalized, is 1–256 characters long, and accepts no
  surrounding whitespace or control characters. It is not a secret: admin metadata exposes it.

### Lifetime, reset and concurrency

State survives handler hot reloads but is lost when the engine restarts. Reset one resource or
the whole store from **Data → Runtime state** or the [Admin API](ADMIN-API.md). A reset does not
change data files, `state`, `callCount` or sequence cursors; likewise, resetting a sequence does
not touch shared state.

A reset invalidates existing handles and in-flight initializations. It does not pause traffic:
a new request may immediately initialize the next generation. For deterministic tests, stop
clients and polling first, reset, then start the scenario.

Return, failure, timeout and client disconnect close the invocation facade, so late
continuations cannot update the store. If the client has already disappeared after the body is
read, the handler is not started and the request does not increment `callCount`; routing has
already selected any sequence step, however, and that cursor is not rolled back.

### Values, quotas and errors

The store accepts strict JSON and keeps a serialized copy. It rejects cycles, `undefined`,
functions, symbols, `BigInt`, non-finite numbers, class instances, accessors, non-enumerable
properties and depth beyond 100; `-0` is stored as its JSON-equivalent `0`. Default limits are
256 resources, 3 MiB per resource and 25 MiB in total.

Unhandled shared-state errors return a public response without the name, signature, values or
stack: generation conflicts are `409`, a closing runtime is `503`, and other errors are `500`.
Full details remain in the server log and, for request failures, in the corresponding Monitor
entry. A script may catch a known code and return a domain response; it must rethrow errors it
does not recognize. Do not add generic retries: only the scenario author knows whether earlier
effects are idempotent.

## Errors, timeouts and limits

A handler failure never brings down the server and always produces a service JSON response,
with the full detail (message and stack) in the **server log**:

- **an exception in the script or an invalid result** (non-object, status out of range, `body`
  and `jsonBody` together, `body` of an unsupported type) → `500 Handler Execution Failed`;
- **timeout** — the script gets the same timeout as requests to the backend
  (`requestTimeoutMs`): once exceeded, the response is `504 Handler Timeout`. A promise that
  never resolves doesn't leave the request hanging;
- **request body over 2 MB** → `413 Payload Too Large`.

Script validation (the file exists, `resolveResponse` is present) instead happens as early as
endpoint load time, with the per-endpoint degradation described in the [endpoint file
page](ENDPOINT.md).
