# 08 — The endpoint panel

Selecting an endpoint in the catalog, the right-hand panel shows its details: identity,
state, and the list of response variants. It is the single mock's command center, and the
place where you learn Mockxy's most useful move: keeping several responses ready and
changing the endpoint's behavior with one click.

> 📷 **SCREENSHOT** — `08-scheda-endpoint.png`
> What to show: the full panel of an endpoint with three realistic variants (e.g. "200
> with data", "Empty list", "500 Internal Server Error"), the selection clearly on the
> first, the enable switch and the action bar (Copy, Sequence, Delete).

## The identity

At the top of the panel: the method badge, the path, and the **description** — a
free-text, inline-editable field worth using when the workspace is shared: two lines on
*why* a mock exists ("reproduces bug #1234", "demo data for client X") save questions for
whoever comes next. A tooltip on the path shows the **endpoint file's location on disk**,
handy when you want to open the file by hand.

The **Enabled/Disabled** switch governs the whole endpoint: when disabled, the endpoint
stays in the catalog with all its variants, but requests on that route go back to
following the fallback — to the real backend, or to the 404 in mock-only mode. It is the
operation that moves the mock/real boundary backwards: the backend has implemented the
real endpoint, the mock switches off, and stays there ready for next time.

The action bar completes the identity: **Copy** duplicates the endpoint onto a new
method/path ([chapter 13](13-copying-endpoints.md)), **Sequence** opens the variant
sequence configuration ([chapter 12](12-variant-sequences.md)), **Delete** removes
endpoint and variants, with confirmation.

## The response variants

The response list is the heart of the panel. Every endpoint has at least one; the
**selected** one is what the endpoint serves, and the selection changes with a click. The
others stay intact, ready to be reselected.

The practical value is all here: a well-equipped endpoint has its "happy" variant and,
next to it, the cases the frontend must handle — the empty list, the 404, the 500. Trying
how the interface reacts to an error becomes: click on the error variant, refresh the app,
click to go back. No file touched, no content lost.

Each variant has a free **title** ("User found", "Server error"), best kept meaningful: it
is what you read when choosing.

### Adding a response

The add button opens a menu with the five possible natures, plus two shortcuts:

| Entry | What it creates | Deep dive |
|---|---|---|
| New **mock** response | static response: status, headers, body | [chapter 9](09-mock-response-editor.md) |
| New **handler** response | JavaScript script that computes the response | [chapter 15](15-handlers.md) |
| New **middleware** response | script that transforms the real backend's response | [chapter 16](16-middleware.md) |
| New **SSE** response (stream) | event stream with script and console | [chapter 18](18-sse.md) |
| New **WebSocket** response (channel) | mocked WS channel with script, rules and console | [chapter 19](19-websocket.md) |
| **Clone into new handler response** | a handler pre-filled with the current mock's body | [chapter 15](15-handlers.md) |
| **Clone into new middleware response** | a middleware, starting from the current response | [chapter 16](16-middleware.md) |

The two clone entries deserve a note: they are a mock's natural growth path. You start
from a static response; when logic is needed, "Clone into handler" creates the dynamic
variant **with the static body already inside as a starting point** — you add the logic
around data that is already right, instead of starting from scratch. The static original
stays in the list, reselectable at any time.

> 📷 **SCREENSHOT** — `08-menu-aggiungi-response.png`
> What to show: the add-response menu open, with the five types and the two clone entries
> visible.

### Editing and deleting

The actions on the selected variant: **edit** opens the editor (chapter 9 covers it for
static mocks; for scripts, the code editor opens), **delete** removes it with confirmation
— with one constraint: **at least one response must remain** per endpoint. If the goal is
for the endpoint to stop answering, the right move is disabling it, not emptying it.

## Choosing the right type

A quick compass, which the following chapters justify in detail:

- **mock** when the response can be written by hand — by far the most frequent case, and
  with templating, automatic pagination and sequences it covers more than it seems;
- **handler** when logic or state is needed: answering based on the received body,
  generating data, simulating a CRUD;
- **middleware** when the backend is there and should be used, but its response needs
  touching up;
- **SSE / WebSocket** when the endpoint is not request/response but a stream or a channel.

The next step is the editor you build the static response with — status, headers, the body
in its three forms, delays and presets: [chapter 9](09-mock-response-editor.md).
