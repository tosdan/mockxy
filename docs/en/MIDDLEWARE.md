# Proxy middleware

Middleware is the third way to respond, halfway between the mock and the real backend: the
request **really reaches the backend** through the proxy, but the response goes through a local
script that can modify it before it reaches the client. It's for when the backend exists and
should be used, but its response needs touching up: masking sensitive data, forcing a field to
trigger a specific case in the frontend, enriching a payload that isn't complete yet.

A middleware is attached to the endpoint through a [response file](RESPONSE.md) of type
`middleware`, which points to a `*.middleware.js` script. Everything that holds for handler
scripts holds here too: CommonJS module, local `require` calls with recompilation on change, no
`method`/`path`/`disabled` in the script.

## The shape of the script

```js
module.exports = {
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: { ...headers, "x-ambiente": "mockxy" },
      jsonBody: { ...jsonBody, saldoDisponibile: 0 },
    };
  },
};
```

When the middleware variant is selected, the engine forwards the request to the backend
(asking for the response **uncompressed**, so it's inspectable), buffers it in full and calls
**`transformResponse`**.

## The context it receives

- **`status`** — the status of the backend response.
- **`headers`** — a copy of the backend response headers.
- **the backend body, in three forms** — `bodyBuffer` (raw, always present), `bodyText`
  (for textual content-types) and `jsonBody` (parsed when possible), with the same semantics
  as the [handler context](HANDLER.md). If the backend answered compressed anyway, the body is
  decompressed for inspection (gzip, deflate, brotli) with a safety cap of 50 MB decompressed:
  beyond that, or with an unsupported compression, `bodyText` and `jsonBody` are absent and
  `bodyBuffer` stays in compressed form.
- **`req`** — the incoming Express request.
- **`targetUrl`** — the full URL the request was forwarded to.
- **`data(name)`** — the data files accessor, identical to the handlers' one.

## The result

- **`undefined`** (or no `return`) — the backend response passes through **untouched**: useful
  for conditional middleware that only transforms certain cases.
- An **object** with:
  - **`status`** — optional; default: the backend's status.
  - **`headers`** — optional; unlike handlers, these headers **merge on top of the backend's**
    (the response starts from what the backend sent): declared keys override, keys with an
    `undefined` value are ignored, the rest passes through.
  - **`removeHeaders`** — a list of names (case-insensitive) removed from the merged result:
    it's the way to **remove** a header set by the backend.
  - **`jsonBody`** *or* **`body`** (string or `Buffer`) — same rules as handlers, including the
    `content-type: application/json` forced for `jsonBody` and the discarding of body-dependent
    headers (`Content-Length`, `Content-Encoding`, `Transfer-Encoding`, `ETag`).
  - **neither `body` nor `jsonBody`** — the backend body stays as it was; only status and
    headers change. It's the "touch up the headers without touching the payload" case.

Transformed responses go out with `x-mock-source: middleware`.

## When the middleware is bypassed

The transformation requires buffering the response in RAM, so the engine skips it — with a
warning in the log and intact passthrough forwarding — when it's not feasible or wouldn't make
sense:

- **declared streams** (`text/event-stream`, typical of SSE): they never end, and buffering
  them would leave the request hanging;
- **responses over 10 MB** — both when the backend declares it upfront (`Content-Length`) and
  when the limit is exceeded while reading: in that case the prefix already read is forwarded
  and the rest continues streaming.

In these cases the response reaches the client **intact but untransformed**, marked
`x-mock-source: backend`.

## Errors and timeouts: fail-open

A middleware that fails **doesn't break the response**: if the script throws an exception,
returns an invalid result or exceeds the timeout (`requestTimeoutMs`, the same as the proxy's),
the engine forwards the **original backend response** and records the error in the log with a
reference to the script. The philosophy is that a broken touch-up must not deny the frontend a
response the backend has already produced.

The `502` stays reserved for genuine communication problems with the backend (unreachable,
error while reading the response).

Middleware works on proxied requests, so the [global delay extended to the
proxy](RITARDI.md) applies to it as well.
