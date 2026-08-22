# 21 — From traffic to mocks: capture

Mockxy's most distinctive flow: a real response, observed in the monitor, becomes a mock
with everything ready — method and path from the request; status, headers and body from
the response. Nothing to transcribe, nothing to invent: you **freeze what the backend
actually answered**, at the moment the data is right.

## Single capture

From a monitor entry's detail, **"Create mock from this"** creates the endpoint with the
captured response as its first variant. The confirmation toast offers the **"Open the
created mock"** shortcut, taking you straight to the catalog panel for any touch-up.

The guiding example — the staging server about to be reset: the morning went into entering
orders through the app's forms, and `GET /api/orders` finally answers with well-populated
data. Before the next reseeding: monitor, the `GET /api/orders` entry, "Create mock from
this" — and that scenario is safe in a file, reproducible forever and versionable in git.
At the next reset the frontend still sees *its* data.

The transfer rules, designed so the mock is born clean:

- **masked** headers (`Authorization`, `Cookie`…) don't end up in the mock — no fossilized
  `***` — and neither do the ones the server recomputes on its own (`Content-Length` and
  the like);
- the captured response's CORS headers travel into the mock like any other (with automatic
  CORS on, the engine's policy wins over them anyway);
- a **non-reconstructable body** — binary, or truncated because beyond the 156 KB capture
  threshold — still produces the mock, but as a **skeleton to complete**: structure ready
  and body to fill in, with the condition flagged in the description. Better an explicit
  skeleton than a silently crippled mock.

## When the endpoint already exists

If the catalog already has an endpoint for that route and method, single capture neither
fails nor duplicates: the **"The mock already exists"** dialog proposes adding the
captured response as a **new variant** of the existing endpoint. On confirmation, the
variant is created with the title "from monitor · HH:mm:ss" and becomes **the selected
one**; the previous variants stay intact, ready to be reselected.

It is the natural way an endpoint's kit grows: today's real case joins the cases frozen
yesterday.

> 📷 **SCREENSHOT** — `21-dialog-esiste.png`
> What to show: the "The mock already exists" dialog with the add-as-variant question and
> the Cancel / "Add as variant" buttons.

## Bulk capture

The monitor's **"Select"** button enables multi-selection mode: you tick the entries —
typically all the calls of a screen you just navigated — and **"Create mock (N)"**
converts them in one go. The final summary accounts for every outcome: how many
**created**, how many **skeletons** to complete, how many **not created** (e.g. because
they already existed).

A deliberate difference from single capture: the batch **skips existing endpoints**
instead of proposing variant additions — a bulk operation must not fire a barrage of
questions. To add a variant to an endpoint that already exists, use single capture.

> 📷 **SCREENSHOT** — `21-selezione-multipla.png`
> What to show: the monitor in selection mode with several entries ticked and the "Create
> mock (N)" button active; ideally the summary toast with the counts too.

## The complete flow, with proxy all

The systematic version of the flow uses **proxy all** mode ([chapter 5](05-ui-tour.md)) as
the capture mode: existing mocks are suspended, everything goes through the real backend,
and the monitor records the *actual* behavior of the whole application — including routes
a mock would already cover. You navigate the application through the screens that matter,
return to the monitor, select and create in bulk. Then you switch proxy all off: the mocks
— old and new — return to service.

The created mock is an endpoint like any other: files on disk, variants, touch-ups from
the editor. From that moment the mock/real boundary has moved by one endpoint — which is
exactly Mockxy's design.

The live view forgets, though: 250 requests, then the oldest fall off. To capture *from
the past* — Tuesday's session, rediscovered useful on Thursday — you need the on-disk
archive: [the dump history](22-dump-history.md).
