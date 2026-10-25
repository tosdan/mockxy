# 13 — Copying endpoints and reusing work

A well-polished endpoint — the right headers, error-case variants, curated bodies — is
work worth reusing. The **Copy** button in the endpoint panel duplicates everything onto a
new method and/or path, with nothing to redo by hand.

## The dialog

The dialog shows the origin ("from GET /api/...") and asks for:

- **Method** — the new endpoint's, pre-filled with the original;
- **Path** — the new path, with the same validations as creation
  ([chapter 7](07-creating-endpoints.md)); the method+path pair must be new, an exact
  duplicate is not allowed;
- **Copy all responses** — when on, brings **all** the variants into the new endpoint
  (including the referenced handler and middleware scripts, which get duplicated); when
  off, copies **only the currently selected variant**. The second mode is the right choice
  when, of the original's many variants, you only need one as a starting point.

The new endpoint is independent of the original: from there on the two evolve separately.

> 📷 **SCREENSHOT** — `13-dialog-copia.png`
> What to show: the "Copy endpoint" dialog filled in, with the origin visible in the
> subtitle, the new path set and the "Copy all responses" switch on with its count.

## When it pays off

- **The method variant**: `GET /api/orders/:id` is ready, you need the `PUT` on the same
  path — copy with a method change, then adjust the response body. The headers and the
  structure remain.
- **The twin resource**: `GET /api/customers` is polished and you need
  `GET /api/suppliers` with the same shape — copy with a path change and swap the data.
- **The new API version**: the backend introduces `/api/v2/...` — you copy the v1
  endpoints onto the v2 path and apply the contract differences, keeping both versions
  alive during the transition.
- **The "model" endpoint**: in a team it can pay to keep a reference endpoint with the
  standard kit (200 + empty list + 500, company headers) to copy as the skeleton of every
  new mock.

An alternative to interface-driven copying, for mass rework: mocks are files, and an
endpoint folder can be duplicated from a file manager or a script too — with the caveats
about names and fields to update described in [chapter 24](24-mocks-as-files.md).

Next chapter, the last of the static-mock part: bringing into the picture the variable
that never exists locally — latency. [Simulated delays](14-simulated-delays.md).
