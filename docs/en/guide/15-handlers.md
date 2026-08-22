# 15 — Handlers: responses computed in JavaScript

Templating, automatic lists and sequences cover a lot — but sooner or later you need an
`if`: "if field X is missing answer 400", "answer with the resource the client just
created", "filter the dataset with real logic". For these cases the variant can be a
**handler**: a local JavaScript script that receives the request and builds the response.
It is the step above the static mock, before having to bother a real backend — and it
never touches the backend: everything happens locally.

Like every variant, the handler coexists with the others in the response list: the same
endpoint can hold the static variant and the dynamic one, and you switch between them with
the selection.

## Creating a handler

Two roads from the endpoint panel ([chapter 8](08-endpoint-panel.md)):

- **New handler response** — starts from a working template, to adapt;
- **Clone into new handler response** — from an existing mock response: the template
  arrives **with the static body already inside** as a starting point. It is the
  recommended road when the static mock already exists: you add the logic around data that
  is already right.

The editor is the same code editor of chapter 9 (highlighting, search, JavaScript
autocompletion); the "Regenerate template" button restores the starting template if you
need to start over.

## The script's shape

The script is a CommonJS module exporting the **`resolveResponse`** function (sync or
`async`):

```js
module.exports = {
  async resolveResponse({ params, query, requestHeaders, jsonBody, data }) {
    const users = await data("users");
    const user = users.find((u) => String(u.id) === params.id);
    if (!user) {
      return { status: 404, jsonBody: { error: "not_found", id: params.id } };
    }
    return {
      status: 200,
      headers: { "x-source": "handler" },
      jsonBody: user,
    };
  },
};
```

Three lines of guided reading: the context received as the argument carries everything
needed from the request (`params.id` is the route's `:id`); the `return` describes the
response — status, optional headers and `jsonBody`; and `data("users")` reads a dataset
from the Data page ([chapter 17](17-data-page.md)), keeping the data out of the code.

The script **does not declare** method, path or enablement: routing belongs to the
endpoint file, and the source of truth stays single. It may, however, require other local
files with relative `require`s — utilities shared across handlers — and the engine tracks
the dependencies: when the script *or one of its dependencies* changes, recompilation is
automatic.

## The received context

| Field | Content |
|---|---|
| `params` | the path parameters, already decoded; always strings |
| `query` | the query parameters (string values, or arrays for repeated ones) |
| `requestHeaders` | the request headers, lowercase names |
| `bodyBuffer` / `bodyText` / `jsonBody` | the request body in three forms: raw (always present), text (for textual content types), parsed (when it is JSON) |
| `data(name)` | the accessor to the Data page's files |
| `state` | mutable memory persisting across the endpoint's calls |
| `callCount` | progressive invocation number (1 on the first) |
| `firstRequestAt` | timestamp of the first invocation |
| `req` | the raw Express request, for advanced cases (read the body from the three forms above: the stream has already been consumed) |

The request body is buffered up to **2 MB**: beyond that, the engine answers `413` without
even running the script.

### State: mocks that remember

`state`, `callCount` and `firstRequestAt` are the most powerful part of the contract.
`state` is a mutable object that **survives across requests** to the same endpoint
(shared among its variants): the memory for counters, per-resource state machines
(`state[params.id] = ...`), outcomes that depend on history. It is ephemeral and local to
the engine — not a database: it resets on restart and with the endpoint's sequence reset;
it survives hot reload, though, so iterating on the script doesn't restart your test run.

An example with `firstRequestAt` — the polling that changes outcome after 15 seconds:

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

(for this specific case, without writing code, a [sequence](12-variant-sequences.md) is
enough — the handler earns its place when there is other logic around).

## The result

`resolveResponse` returns an object with:

- **`status`** — optional, default `200`;
- **`headers`** — optional; `Content-Length` is always recomputed by the engine;
- **`removeHeaders`** — a list of names to strip from the declared headers, useful when
  `headers` is spread from another source;
- **`jsonBody`** *or* **`body`** — at most one of the two: `jsonBody` is any serializable
  value and goes out as JSON (content-type set by the engine); `body` is a string or a
  `Buffer` served as is (content-type in the headers). Neither = a bodiless response, the
  typical `204`.

Handler responses go out with `x-mock-source: handler` and receive no simulated delays: a
script that wants to be slow waits internally.

## Errors and timeouts

A broken handler never takes the server down, and never leaves requests hanging:

- exception in the script or invalid result → **`500 Handler Execution Failed`**;
- script not answering within the timeout (`requestTimeoutMs`, the same as the proxy —
  default 15 s) → **`504 Handler Timeout`**: the classic never-resolving promise, the
  fetch without a timeout;
- request body over 2 MB → **`413 Payload Too Large`**.

In every case the client receives a JSON service response and **the full detail —
message, stack, offending file — lands in the server log**: the terminal when headless,
the `logs/` folder in the desktop app ([chapter 28](28-desktop-workspaces.md)).

## Full scenario: an in-memory CRUD

The handlers' showpiece: letting the frontend work as if the backend existed.

```js
// POST /api/notes — the handler of the POST endpoint
module.exports = {
  resolveResponse({ jsonBody, state }) {
    state.notes ??= [];
    if (!jsonBody?.text) {
      return { status: 400, jsonBody: { error: "text is required" } };
    }
    const note = { id: state.notes.length + 1, text: jsonBody.text, createdAt: new Date().toISOString() };
    state.notes.push(note);
    return { status: 201, jsonBody: note };
  },
};
```

```js
// GET /api/notes — the list reflects what was created
module.exports = {
  resolveResponse({ state }) {
    return { jsonBody: state.notes ?? [] };
  },
};
```

Mind the detail already mentioned: `state` is per-endpoint, and `GET /api/notes` and
`POST /api/notes` are different endpoints (same path, different methods) — so they do not
share memory. The practical road for a cross-method CRUD is keeping the dataset in a data
file and using `state` for the mutations only, or handling the whole case on one endpoint
with data from `data()`. Chapter 17 shows the complete data-file + handler pattern.

> 📷 **SCREENSHOT** — `15-editor-handler.png`
> What to show: the handler editor with a complete, readable script (the 404/200 example
> with `data()` works well), in the context of the endpoint panel.

> 📷 **SCREENSHOT** — `15-monitor-stateful.png`
> What to show: the monitor with several successive requests to the same handler endpoint
> whose responses differ due to state (e.g. a counter growing in the body, or a POST's 201
> followed by a GET listing the created element).

The handler computes everything locally. When instead the backend exists, works, and only
needs *touching up*, the right type is the next one: the
[proxy middleware](16-middleware.md).
