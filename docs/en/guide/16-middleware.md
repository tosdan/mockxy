# 16 — Middleware: touching up the real backend's responses

The third way of answering sits halfway between the mock and the backend: with a
**middleware** variant, the request **really reaches the backend** through the proxy, but
the response passes through a local script that can modify it before it reaches the
application.

The positioning is precise: the mock (static or handler) beats the middleware when the
backend isn't there or isn't needed; the middleware beats the mock when **real data
matters** but the response needs touching up. The cases that justify it:

- **the contract runs ahead**: the regenerated client expects fields the backend doesn't
  send yet — the middleware adds them on top of the real response, and you keep working
  with live data instead of freezing a copy;
- **provoking a specific case without giving up the rest**: forcing `status: "SUSPENDED"`
  on the real user to see the frontend's banner, leaving the rest of the payload
  authentic;
- **masking or cleaning up**: hiding sensitive data in a demo, removing a stray header.

## Creating a middleware and the script's shape

From the endpoint panel: **New middleware response**, or **Clone into new middleware
response** from an existing variant. The script is a CommonJS module like the handler —
same editor, local `require`s with automatic recompilation, no method/path in the script —
but it exports **`transformResponse`**, which receives the **backend's response** and
returns the changes:

```js
module.exports = {
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: { ...headers, "x-environment": "mockxy" },
      jsonBody: { ...jsonBody, availableBalance: 0 },
    };
  },
};
```

When the middleware variant is selected, the engine forwards the request to the backend
(asking for an uncompressed response, so it can be inspected), buffers it and calls the
script.

## The received context

- **`status`** and **`headers`** — the backend response's status and headers;
- **the backend's body in three forms** — `bodyBuffer` (raw), `bodyText` (for textual
  content types), `jsonBody` (parsed when possible), as in the handler context;
- **`req`** — the incoming request, for transformations conditioned on who asked what;
- **`targetUrl`** — the full URL the request was forwarded to;
- **`data(name)`** — the data-file accessor, identical to the handlers': you can enrich
  the real response with your own data.

## The result

- **`undefined`** (or no `return`) — the backend's response passes **untouched**. It is
  the basis of conditional middleware: `if (jsonBody?.type !== "PREMIUM") return;` and you
  transform only the case that matters.
- An object with **`status`**, **`headers`**, **`removeHeaders`**, and **`jsonBody`** *or*
  **`body`** — with one important difference from handlers: the declared `headers` **merge
  on top of the backend's** (declared keys override, the rest passes), because the
  response starts from what the backend sent. `removeHeaders` is how you *remove* a header
  the backend set. With neither `body` nor `jsonBody`, the backend's body stays the
  original; only status and headers change.

Transformed responses go out with `x-mock-source: middleware`.

## Example: the new contract's fields

The backend still answers `{ "id": 7, "name": "Rossi Ltd" }`, the regenerated client also
expects `rating` and `tags`:

```js
module.exports = {
  async transformResponse({ jsonBody }) {
    if (!jsonBody) return; // non-JSON response: leave it alone
    return {
      jsonBody: { ...jsonBody, rating: "A", tags: ["long-standing-customer"] },
    };
  },
};
```

The new frontend works right away, on real records; when the backend catches up, you
disable the variant (or the endpoint) and nothing is thrown away.

## When the middleware is bypassed

The transformation requires buffering the response in memory, so the engine skips it —
with a warning in the log and an untouched passthrough — when that isn't feasible:

- **declared streams** (`text/event-stream`): they never end, buffering them would hang
  the request;
- **responses over 10 MB**, declared upfront or discovered while reading.

In these cases the response reaches the client intact but untransformed, marked
`x-mock-source: backend` — the signal to check when "the middleware isn't working".

The general picture of chapter 5 also applies: in **proxy all** mode middleware does not
intervene at all (the backend is observed in its natural state), and with the server off
neither.

## Errors and timeouts: fail-open

A failing middleware **does not break the response**: an exception, an invalid result or a
timeout (`requestTimeoutMs`) let the **backend's original response** through, with the
error in the log and the script reference. The philosophy: a broken touch-up must not deny
the frontend a response the backend already produced. The `502` stays reserved for real
backend communication problems.

It is a behavior worth knowing because it is silent on the client side: if the
transformation seems not to apply, the two clues are `x-mock-source` (`backend` instead of
`middleware`) and the log.

> 📷 **SCREENSHOT** — `16-editor-middleware.png`
> What to show: the middleware editor with the field-enrichment example script, in the
> context of the endpoint panel.

> 📷 **SCREENSHOT** — `16-monitor-confronto.png`
> What to show: the monitor with two requests to the same route, one served with
> "proxy/backend" source (before enabling the middleware) and one with "middleware"
> source, making the routing difference visible.

Handlers and middleware share the same ally: datasets kept out of the code. The page that
manages them — and the `data()` accessor already met twice — is
[chapter 17](17-data-page.md).
