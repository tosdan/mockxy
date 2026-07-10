# The usage scenarios, step by step

Mockxy is built around one idea: **mocking is not an all-or-nothing choice** — the boundary
between mocked and real keeps moving throughout the life of a project. This guide walks through
the recurring scenarios the proxy+capture design was born from, giving for each one the
concrete sequence and the detail pages.

## "The staging database has been reset again"

The shared backend works, but the data entered by hand to try out the UI vanishes at every
reseeding. The defense is freezing the scenarios **while they exist**:

1. you work with the [proxy fallback](PROXY.md) active towards staging: no mocks, everything real;
2. you do data entry through the app's forms, until the scenarios are well populated;
3. in the [monitor](MONITOR.md) you select the responses that represent them — or you switch on
   the [history](STORICO.md) at the start of the session, to fish them back even days later;
4. **Create mock**, in bulk too: from that moment those endpoints answer with the frozen
   data, and the next reset doesn't touch them;
5. mocks are [files in git](WORKSPACE.md): the scenario is shared with the team.

## "The contract is ahead of the backend"

The OpenAPI spec is up to date, the API client regenerated — but the real endpoint still
answers in the old shape. Two routes, depending on how much real data matters:

- **real data, new shape**: a [proxy middleware](MIDDLEWARE.md) on the route adds or
  tweaks the fields the new contract expects, on top of the real response — you keep
  working with live data;
- **new shape and nothing else**: you capture the real response from the monitor, turn it into a
  mock and add the fields by hand ([catalog](CATALOGO.md)) — or you start over from the
  [spec import](OPENAPI.md), which is incremental and doesn't touch what exists.

When the backend catches up, you switch off the tweak and go back to the real thing.

## "The backend isn't there yet" (and the boundary moves)

At the start of a project you [import the spec](OPENAPI.md) or create the mocks by hand, and the
frontend starts right away, even in mock-only mode (fallback off). As the backend
matures, the boundary moves **one area at a time**:

- you point `BACKEND_URL` at the nascent backend and enable the [fallback](PROXY.md);
- you **disable** the mocks of the endpoints implemented by now — one by one or [whole
  collections at a time](CATALOGO.md): those requests go back to flowing to the real backend,
  the others stay mocked;
- for the quick comparison "how does the backend behave on *everything*?" there's the [full
  proxy](CONTROLLI.md), which suspends the mocks without losing them.

## "I can't reproduce this case"

A 500, a timeout, an empty list, a pathological dataset: you pin the response of **that
single endpoint** — a dedicated [variant](RESPONSE.md), or a [delay](RITARDI.md) for the
timeout — and let everything else pass through. The variants stay in the workspace: the hard
case can be summoned back with a switch, whenever it's needed again.
