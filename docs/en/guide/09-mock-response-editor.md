# 09 — The mock response editor

This chapter walks the static-response editor control by control: status, title, delay,
headers, and the body in its three forms. It is the daily craft tool — everything you need
to build precise, realistic responses, ready for the error cases.

> 📷 **SCREENSHOT** — `09-editor-json.png`
> What to show: the editor of a mock response in its most common configuration — status
> 200, two or three headers set, a realistic JSON body in the syntax-highlighted editor,
> the delay field visible.

## Title, status and delay

- **Title** — the variant's label in the response list. Best kept descriptive of the
  *case* ("User found", "Empty cart", "Server error"), not the technical content.
- **Status** — the combobox suggests the common codes with their description, but accepts
  any integer between 100 and 599: a 418 or a company-specific custom code too, if needed.
- **Delay (ms)** — the delay applied before answering, specific to this variant. Useful
  for the single slow endpoint (the heavy search, the export). When greater than zero it
  wins over the workspace's global delay — the two do not add up; the full picture of
  delays is in [chapter 14](14-simulated-delays.md).

## Headers

Headers are added row by row: the name via a combobox suggesting the well-known headers
(but accepting any name), the free value, per-row removal.

The **"Insert bundle"** menu adds ready-made header sets for the recurring cases:

- **CORS (development)** — the cross-origin permission headers for one response, when you
  handle CORS by hand on a single mock instead of using the automatic option;
- **CORS preflight** — the set for a preflight `OPTIONS` response;
- **No-cache** — the directives that stop the browser from caching the response: the
  countermeasure to the classic "I changed the mock but still see the old data";
- **Security headers** — the standard security headers, to reproduce the responses of a
  backend that sets them;
- **Auth: Bearer** — the sample authorization header.

A bundle inserts the rows; the values remain editable one by one.

> 📷 **SCREENSHOT** — `09-bundle-header.png`
> What to show: the "Insert bundle" menu open above the header list, with the available
> bundles listed.

## The body: three forms

### JSON

The default mode. The editor validates the syntax as you type and **broken JSON does not
save**: the "Invalid JSON" message blocks saving until the document is correct again. If
the body is a list, the response automatically takes part in query-string pagination and
filtering ([chapter 11](11-lists-pagination-filters.md)).

### Text

For everything that isn't JSON: XML, CSV, HTML, plain text. In text mode the content is
served **as is**, and the content-type is yours to declare: the dedicated control sets the
`content-type` header (the editor proposes `text/plain` as a base). It is the road for
mocking the CSV export, the SOAP response, the HTML error page.

### File

For binary or heavy payloads — images, PDFs, archives, videos — the "File" source accepts
an upload by drag or click (up to **12 MB** from the interface). The file is saved next to
the response and served **streaming on every request**: the content never goes through the
server's memory, so even downloads of hundreds of MB (for files placed in the workspace by
hand) cost nothing. The content-type is inferred from the file and can be overridden with
an explicit header; with no indication, the response goes out as
`application/octet-stream`.

The typical use case: the `GET /api/documents/:id/pdf` endpoint behind the frontend's
download button — you upload a sample PDF and the whole download flow can be exercised,
progress bar included.

> 📷 **SCREENSHOT** — `09-editor-file.png`
> What to show: the editor in file-body mode with a file already uploaded (e.g. a PDF):
> file name, content-type hint and the drag-to-replace zone. This documents the editor's
> alternative state versus the JSON screenshot.

## Response presets

The **"Response preset"** menu applies ready-made status and body in one go for the
standard cases: the errors **400, 401, 403, 404, 409, 422, 429, 500, 503** — each with a
plausible error body — and **"Paginated list"**, which sets a sample list body ready for
automatic pagination. Applying asks for confirmation, because it **replaces** the current
status and body.

The error presets are the accelerator for the practice recommended in chapter 8: giving
every important endpoint its error variant. New response → "500 Internal Server Error"
preset → title "Server error" → save: ten seconds, and the test case is ready forever.

> 📷 **SCREENSHOT** — `09-preset-response.png`
> What to show: the preset menu open, with the HTTP errors and "Paginated list" in the
> list; ideally also the replacement confirmation dialog.

## The Template switch

On JSON and text bodies, the **Template** switch enables `{{...}}` placeholders — request
values and generated helpers straight in the body and headers. It is a change of nature
significant enough to deserve a chapter of its own, the [next one](10-templating.md).

## The code editor

The body fields (and the scripts, later on) use an editor with syntax highlighting, search
and replace, automatic document formatting/indentation, line comment and section folding.
The full shortcut list is in the interface's dedicated dialog, summarized in the
[appendices](34-appendices.md).

## Saving

**Save** validates and writes: on disk the change is a plain save of the response file,
and the endpoint serves it from the next request — no restart, no intermediate step.
**Cancel** discards the draft and closes the editor.

With the editor in hand, the next three chapters multiply its value:
[templating](10-templating.md), [automatic lists](11-lists-pagination-filters.md) and
[sequences](12-variant-sequences.md).
