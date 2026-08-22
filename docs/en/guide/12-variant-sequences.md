# 12 — Variant sequences

Some endpoints don't have *one* right answer: they have a **series**. The emblematic case
is polling an asynchronous job — the frontend queries `GET /api/jobs/42` at intervals and
expects to see "queued", then "processing", finally "completed". With chapter 8's variants
alone you would have to switch the selection by hand between requests; a **sequence** does
it for you: it tells the endpoint to serve the variants in order, each for a number of
requests or a duration, then move on to the next.

A sequence is a **selection policy on top of the existing variants**: the contents stay in
the ordinary responses, the sequence only decides *which one* answers each request. Every
served variant follows the rules of its own nature — delays, automatic pagination,
templating.

## The dialog

The **Sequence** button in the endpoint panel opens the configuration. Prerequisite: at
least **two variants of mock or handler type** (SSE and WebSocket variants cannot be
steps; middleware neither) — with only one, the dialog invites you to create another.

The controls:

- **Sequence active** — the master switch. When off, the definition stays saved but the
  endpoint returns to the classic variant selection.
- **Mode** — how steps advance:
  - **By requests**: each step answers N requests, then the next one takes over;
  - **By time**: each step answers for N milliseconds **from its first request** (not from
    the server's clock: the count starts when somebody calls).
- **Steps** — the lineup: each step names the variant and the value (times or
  milliseconds); steps can be reordered, added and removed. The **last step may have no
  value**: it is the terminal state, marked "final". The same variant may appear in
  several steps (useful for "works → breaks → works again").
- **At the end** — once the last step is exhausted: **Stay on last** (default), or
  **Start over** from the first (in which case the last step needs a value too).
- **Auto-reset on inactivity** — with no requests for the given time, the sequence
  restarts from the first step at the next call. It is the detail that makes sequences
  convenient in repeated manual testing: the polling stops when the frontend sees the
  final outcome, you reload the page a few minutes later, and the story starts over
  without touching anything.

At the bottom, the dialog shows the **runtime state** — current step and requests served —
and the **"Start over"** button to reset the cursor immediately.

The validations: minimum 2 steps, each step must reference a variant, each non-final step
an integer value ≥ 1, and auto-reset an integer ≥ 1 (or empty to disable it).

> 📷 **SCREENSHOT** — `12-sequenza-richieste.png`
> What to show: the dialog filled in "By requests" mode with the job example's 3 steps
> (queued ×2, processing ×3, completed final), auto-reset set and the runtime state line
> visible.

> 📷 **SCREENSHOT** — `12-sequenza-tempo.png`
> What to show: the same dialog in "By time" mode, to document how the step fields change
> (unit in ms).

## The guiding example: the export job

The `GET /api/export/:id/status` endpoint has three mock variants: "Queued"
(`{"status": "QUEUED"}`), "Processing" (`{"status": "PROCESSING", "percent": 60}`),
"Completed" (`{"status": "DONE", "url": "/api/export/42/download"}`). The sequence: step 1
for 2 requests, step 2 for 3 requests, step 3 final; at the end "Stay on last"; auto-reset
30000 ms.

The frontend starts the export and polling begins: the first two responses say QUEUED, the
next three PROCESSING, then DONE — and the UI walks through spinner, progress bar and
download button, in one run, with no backend. Half a minute's pause and you can try again
from the top.

The "by time" variant of the same pattern serves clock-driven cases rather than
call-count-driven ones: "the service answers 503 for 30 seconds, then recovers" — two
steps, the first with the 503 variant for 30000 ms, the second final with the 200.

## How you spot an active sequence

- in the **catalog**, the endpoint carries the **SEQ** badge;
- in the **endpoint panel**, the tooltip warns that the endpoint is serving the steps,
  *not* the selected variant (the classic selection stays defined, but the sequence is in
  charge while active);
- in the **monitor**, every request served by a sequence carries the **"SEQ n/m"** badge
  with the step that served it: the progression can be read by scrolling the entries — and
  it is also the quickest way to verify the sequence does what you expect.

> 📷 **SCREENSHOT** — `12-monitor-seq.png`
> What to show: the monitor with several successive requests to the same endpoint and the
> SEQ 1/3 → 2/3 → 3/3 progression badges visible on the entries.

## The cursor is runtime state

The sequence's position is not written to a file: it resets on engine restart, on explicit
reset, on inactivity, and whenever the sequence definition changes. Endpoint changes that
don't touch the sequence (an updated description) don't reset it. In git, therefore, the
sequence's *definition* travels, never its momentary state.

Sequences close the "automatic" side of static mocks. The next two chapters are shorter
and operational: [copying endpoints](13-copying-endpoints.md) and
[simulating slowness](14-simulated-delays.md).
