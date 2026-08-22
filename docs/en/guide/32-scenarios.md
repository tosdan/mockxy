# 32 — Complete scenarios, start to finish

The previous chapters covered the features one by one; here they come together. Five
recurring frontend-development scenarios, each walked in full — context, sequence of
actions, result — with pointers to the detail chapters. They are the very scenarios
Mockxy's design was born from.

## 1. "The backend doesn't exist yet"

**Context.** New project: the API is agreed, an OpenAPI spec exists, the backend is a
month away. The frontend must start now.

1. You create the workspace in the frontend's repository
   ([chapter 3](03-install-and-run.md)) and **import the spec**
   ([chapter 23](23-openapi-import.md)): one mock per endpoint, organized into collections
   from the tags, in seconds.
2. You work in **mock-only mode** — empty Backend URL, or fallback off
   ([chapter 26](26-proxy-fallback.md)): what isn't mocked fails explicitly, and no call
   disappears into the void.
3. As the screens take shape, you **refine the mocks that matter**: meaningful data on the
   sampled bodies ([chapter 9](09-mock-response-editor.md)), a 50-element dataset on the
   table's endpoint for pagination and filters
   ([chapter 11](11-lists-pagination-filters.md)), error variants on the critical flows
   ([chapter 8](08-endpoint-panel.md)).
4. The backend starts existing: you set `BACKEND_URL`, turn on the **proxy fallback**, and
   **disable the mocks one area at a time** — whole collections at once
   ([chapter 6](06-catalog.md)). Those areas' requests flow back to the real thing; the
   rest stays mocked. Nothing is thrown away: the disabled mocks sit ready for the
   backend's next regression.
5. For the quick "how does the backend behave on *everything*?" comparison there is
   **proxy all** ([chapter 5](05-ui-tour.md)), which suspends the mocks without losing
   them.

**Result.** The frontend never waited for the backend, and the transition to the real one
happened one area at a time, reversibly.

## 2. "Staging got reset again"

**Context.** The shared backend works, but the data entered by hand to try the screens
vanishes at every nightly reseeding.

1. You work normally with the **fallback active** toward staging: no mocks, everything
   real. At the session's start it pays to turn on the **disk dump**
   ([chapter 22](22-dump-history.md)): the live view forgets, the archive doesn't.
2. You do **data entry through the app's forms**, until the scenarios are well populated —
   the customer with three open orders, the case file in the state you need.
3. In the **monitor** you select the responses that represent the scenarios
   ([chapter 20](20-monitor.md)) and **create the mocks in bulk**
   ([chapter 21](21-traffic-to-mocks.md)) — or do it tomorrow from the **history**, at
   leisure.
4. From that moment those endpoints answer with the frozen data: the next reset doesn't
   touch them. And the mocks are **files in git** ([chapter 24](24-mocks-as-files.md)):
   the scenario ships to the team in the next commit.

**Result.** The morning of data entry became a permanent asset of the repository.

## 3. "I need to test the error case"

**Context.** You need to see how the frontend reacts to a 500, a timeout, an empty list —
and the real environment won't produce them on demand.

1. On the endpoint in question (existing, or captured on the spot from the monitor) you
   add the **variants**: the "500 Internal Server Error" preset, the empty list, the
   variant with a **delay** beyond the client's timeout for the timeout case
   ([chapters 8, 9 and 14](08-endpoint-panel.md)).
2. You **select the error variant**, try the UI, go back to the normal variant: one click
   each way. The rest of the application keeps talking to the real backend.
3. For the "breaks, then recovers" case there is the **sequence**
   ([chapter 12](12-variant-sequences.md)): 503 for 30 seconds, then 200 again — with
   auto-reset rearming the scenario between test runs.
4. If the error case is needed **in e2e tests**, variant selection is automated via the
   **admin API** ([chapter 30](30-admin-api.md)): the test activates it, verifies, and
   restores.

**Result.** The frontend's error branches — often the least tested — become reproducible
on demand, forever.

## 4. "The contract is ahead of the backend"

**Context.** The spec has been updated and the API client regenerated, but the real
endpoint still answers in the old shape.

Two roads, depending on how much the real data matters:

- **real data, new shape** — a **middleware** on the route adds the fields the new
  contract expects, on top of the real response ([chapter 16](16-middleware.md)): you keep
  working with live data, and when the backend catches up you switch the variant off;
- **new shape, full stop** — you **capture** the real response from the monitor, turn it
  into a mock and add the fields by hand ([chapter 21](21-traffic-to-mocks.md)); or you
  re-run the **import** of the updated spec, which is incremental and doesn't touch what
  exists ([chapter 23](23-openapi-import.md)).

**Result.** Frontend and contract advance together, without waiting for the backend and
without giving up real data where it matters.

## 5. "Demo tomorrow, and it must be offline"

**Context.** A demo at the customer's, network not guaranteed, unstable test
environments: you need a fully autonomous application with presentable data.

1. You start from the existing workspace and verify **coverage**: navigate the whole demo
   with the monitor open and the "Real backend" filter ([chapter 20](20-monitor.md)) —
   what shows up there is what still depends on the network. Capture it all in bulk.
2. You switch to **mock-only** ([chapter 26](26-proxy-fallback.md)): from now on an
   uncovered endpoint fails in rehearsal, not in front of the customer.
3. You curate the **data** (plausible names, no `test123` — [chapter 17](17-data-page.md)
   for the datasets) and the **credibility**: a moderate global delay
   ([chapter 14](14-simulated-delays.md)) so the app doesn't look fake, sequences for the
   asynchronous flows the demo crosses ([chapter 12](12-variant-sequences.md)).
4. The demo's workspace goes onto a branch or gets copied: it is a self-contained folder
   ([chapter 24](24-mocks-as-files.md)) — reusable next time, or servable to colleagues
   with the standalone image ([chapter 31](31-headless-docker.md)).

**Result.** The demo runs from the laptop, identical in the hotel and in the meeting
room.

---

Five scenarios, one idea: the boundary between mocked and real is a **working tool**, not
an architectural choice. When something along the way doesn't behave as expected, the next
chapter is the toolbox: [troubleshooting](33-troubleshooting.md).
