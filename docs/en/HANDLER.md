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

Handler responses go out with no-cache headers and with `x-mock-source: handler`, and they
don't receive [simulated delays](RITARDI.md): a script that wants to be slow waits on its own.

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
