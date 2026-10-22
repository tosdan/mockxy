# 10 — Templating: responses that echo the request

A static mock always answers the same thing — and that limit shows up early.
`GET /api/users/42` and `GET /api/users/99` receive the same body, and a frontend showing
"user 42" after asking for 99 makes manual testing confusing. **Templating** solves this
class of problems without writing code: with the **Template** switch on, the `{{...}}`
placeholders in the body and headers are replaced with values taken from the request.

## Before and after

The static mock:

```json
{ "id": 1, "name": "Demo user", "role": "user" }
```

The same mock, templated:

```json
{
  "id": "{{params.id | number}}",
  "name": "User {{params.id}}",
  "role": "{{query.role}}",
  "requestedAt": "{{now}}"
}
```

Now `GET /api/users/42?role=admin` answers `{"id": 42, "name": "User 42", "role":
"admin", "requestedAt": "2026-07-17T10:30:00.000Z"}` — and 99 answers with 99. Templating
also works in **headers**: a `location: /api/users/{{params.id}}` on a 201 response is the
classic case.

## The sources

| Placeholder | Value |
|---|---|
| `{{params.<name>}}` | the path parameter (`:id` → `params.id`) |
| `{{query.<name>}}` | the query parameter (first value, if repeated) |
| `{{headers.<name>}}` | the request header (lowercase names) |
| `{{body.<dot.path>}}` | a field of the request's JSON body, nested too (`body.customer.email`) |

`body.*` is the source that makes templating useful on `POST`s: the mock for
`POST /api/orders` can answer with an order containing the data the form just sent —
`{"customer": "{{body.customer.name}}", "total": "{{body.total | number}}"}` — and the
frontend sees "saved" exactly what it shipped.

## The generated helpers

| Helper | Value |
|---|---|
| `{{now}}` | current date/time in ISO 8601 |
| `{{nowMs}}` | epoch in milliseconds |
| `{{uuid}}` | a fresh UUID on every request |
| `{{randomInt min max}}` | a random integer in the range |

Typical uses: `uuid` for the id of the resource "just created" by a POST, `now` for
`createdAt`/`updatedAt` fields that must look fresh, `randomInt` for data that should vary
between requests (a notification counter, a price).

## The type filter

Placeholders produce strings — but realistic JSON has real numbers and booleans. When
**the entire value** of a string is a single placeholder, the filter after the pipe
converts its type:

- `"{{params.id | number}}"` → `42` (no quotes; non-numeric → `null`);
- `"{{query.active | boolean}}"` → `true`/`false`;
- `"{{body.address | json}}"` → the request body's subtree, as is — useful to bounce whole
  structures back.

The rule to remember: the filter only applies when the placeholder is **alone** in the
value. `"User {{params.id | number}}"` stays a string — type conversion inside text would
make no sense.

## Tolerance and limits

- **Unresolved placeholder** (a typo, a missing parameter): the response goes out anyway —
  empty string, or `null` with a filter — and the engine logs a warning with the offending
  placeholder. A typo does not break the test run.
- **Escape**: `\{{` produces a literal `{{`, for the rare bodies that really contain
  double braces.
- The template applies **before** automatic pagination and filters: a templated list body
  takes part in them like a static one.
- **Not allowed on responses with a file payload** (chapter 9's "File" source).
- **No conditions, loops or expressions.** This is a design choice: templating covers
  echoing values, not logic. When an `if` is needed — "if field X is missing answer 400" —
  the right step up is the handler ([chapter 15](15-handlers.md)).

> 📷 **SCREENSHOT** — `10-editor-template.png`
> What to show: the response editor with the Template switch on and a body using several
> sources and helpers (params, query, body.*, now, uuid, a `| number` filter).

> 📷 **SCREENSHOT** — `10-monitor-risolto.png`
> What to show: the monitor detail of a request served by that mock, with the response
> body's placeholders resolved — the request's id bounced into the body, the real
> timestamp. The "after" of the previous screenshot.

Templating makes the single value dynamic; the next chapter makes a whole list dynamic —
automatic pagination and filters on array bodies:
[chapter 11](11-lists-pagination-filters.md).
