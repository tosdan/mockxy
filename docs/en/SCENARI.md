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

If the same boundary lives in a staging used by the whole team, the walkthrough is in
[STAGING.md](STAGING.md): mocks arrive through a PR and the boundary moves the same way.

### “The frontend must already exercise GET → POST → GET”

A static response is not enough when the frontend creates an item and expects it in the next
list. Use [handler shared runtime state](HANDLER.md):

1. prepare `files/items.json` with the initial dataset;
2. make GET and POST separate handlers that both open `items` with the same
   `seedKey: "items@v1"` and `initialize: () => data("items")`;
3. have GET return `items.read()` and, when needed, `applyListQuery: true` to preserve filters
   and pagination;
4. have POST validate the body and use `items.mutate(draft => ...)` to append it atomically;
5. before each run, stop frontend polling and reset `items` from **Data → Runtime state** or the
   Admin API; the next GET starts again from the seed file.

The file is never rewritten: it is the baseline versioned in git, while added items live only in
the process. Multiple browsers share the same resource. When its shape changes, bump `seedKey`,
use the Monitor to find any handler still declaring the previous signature, and reset explicitly.
A restart or actual engine replacement clears everything anyway.

## "The new feature is ready, its backend is not"

A frontend feature needs new endpoints, and whoever works on the backend cannot deliver them
at the same moment: coordinating that tightly on one feature is rare. The mocks become part of
the feature, until the backend arrives:

1. you create the mocks of the new endpoints and leave them **on**: you work against them until
   the feature is done, then commit them that way;
2. the feature goes into the frontend's development branch. From then on the frontend
   **depends** on those endpoints: whoever starts it needs them to answer, and whether the mock
   or the backend does makes little difference. Git is what hands everyone the mocks already
   on, with the right variant;
3. when the backend confirms it implements them, the mocks are turned **off**: another save and
   another commit, and from there everyone's requests go to the backend.

This is why turning on, turning off and choosing the variant **save to the files**: here the
state of an endpoint is a team decision, and it has to reach colleagues the way code does. The
two scenarios that follow are the other case — a state that lasts as long as a debugging
session or a test, and that must not reach git.

## "I can't reproduce this case"

A 500, a timeout, an empty list, a pathological dataset: you pin the response of **that
single endpoint** — a dedicated [variant](RESPONSE.md), or a [delay](RITARDI.md) for the
timeout — and let everything else pass through. The variants stay in the workspace: the hard
case can be summoned back whenever it's needed again.

Often the endpoint already exists in the backend, and the mock is only there to return the data
that triggers a bug: once the bug is fixed — usually within the day — the backend has to answer
again. Turn it on in a [temporary state](CATALOGO.md#temporary-state):

1. if the case that triggers the bug does not exist yet, create a variant for it, without
   "Activate now", or adjust the data of an existing one. This is content, and it is saved to
   the files as always: once the bug is fixed you decide whether to keep it, to summon the case
   back, or to discard it with git;
2. from the clock button, turn the endpoint on **temporarily** and, if needed, serve that
   variant temporarily;
3. once the bug is fixed, **Back to what is saved**: requests go to the backend again. Even if
   you forget, the file still says `"enabled": false`: it does not end up enabled in a commit by
   mistake, and a restart turns it off anyway.

## "Each end-to-end test needs a world of its own"

A repository of mocks dedicated to the tests, in which **everything is off**: each test
declares the scenario it needs — which endpoints answer, and with which variant — and the next
one declares its own, possibly with another variant of the same endpoints.

1. the test, in its setup, calls [`PUT /activation`](ADMIN-API.md#temporary-activation) once,
   with the list of endpoints to turn on and the variant of each;
2. the declaration **replaces** the previous one: whatever the test does not name goes back to
   off, so no teardown is needed, and an interrupted test leaves nothing to the next;
3. nothing is written to the files: the repository stays as it is in git, whatever happens
   during the run.

Before the temporary state the same test turned the endpoints on by saving them and turned them
off again at the end: an interrupted run left the files modified, and the next test started
from a scenario that was not its own.

In the desktop app the test repository opens in a tab of its own, next to the workspace you
develop on: each workspace has its own engine, on its own port, and its own temporary state.
The scenario of a test does not touch the other workspace.

There is one engine per workspace: tests that change the scenario run one at a time against the
same instance.

## Save, or temporary state?

| Situation | Gesture | Where it lives | Who receives it |
|---|---|---|---|
| The mocks of a feature whose backend is not there yet | switch and variant dropdown | in the files, in git | the whole team, and [staging](STAGING.md) |
| The backend has delivered: go real | switch (off) | in the files, in git | the whole team |
| A mock turned on to reproduce a bug | clock button | in the engine's memory | only who uses that engine, until the restart |
| The scenario of a test | `PUT /activation` | in the engine's memory | only that test |

One question decides: **do colleagues have to find it this way?** If yes, save. If it is
needed only now, it is temporary state.
