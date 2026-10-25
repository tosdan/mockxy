# 30 — The admin API: automating Mockxy

Mockxy's whole interface is built on a REST API under **`/_admin/api`**: there is no UI
operation that doesn't go through it. The useful consequence is that **everything the
interface does can be automated** — and for a frontend developer the use cases are
concrete: the e2e suite preparing the mocks' state before each test, the script populating
a workspace from scratch, the pipeline re-importing the spec on every contract update.

This chapter teaches the model and develops three complete examples; the route-by-route
reference is in [ADMIN-API.md](../ADMIN-API.md).

## The model

- **When it answers**: on in development, off in production (`ADMIN_API_ENABLED`); when
  off, every route answers 404. **No authentication** — the exposure rules and the
  protections (the `Host`-header guard, JSON-only mutations as anti-CSRF) are those of
  [chapter 29](29-network-security.md).
- **The resources** mirror the guide's concepts: `/mocks` (endpoints and variants, with
  selection, sequences and the SSE/WS consoles), `/mocks/collections`,
  `/mocks/import/openapi`, `/files` (the data files), `/monitoring` (live monitor and
  dumps), `/server` (the global switches).
- **Immediate effect**: catalog mutations reload the runtime — the change is served from
  the next request, no restarts.
- **Errors** are structured JSON (`{ error, message, details? }`) with the appropriate
  status.
- An endpoint's **`:id`** is an opaque identifier obtained from the lists
  (`GET /mocks`): you read it and pass it back, you don't construct it.

A practical trick for discovering the right bodies: the interface *is* a client of this
API — any operation done from the UI can be observed in the browser DevTools, request and
body included, ready to reproduce in a script.

## Example 1: a setup script

Creating a mock and suspending mocking wholesale, from the terminal:

```bash
BASE=http://localhost:3000/_admin/api

# create an endpoint with its first variant (static mock)
curl -s -X POST "$BASE/mocks" \
  -H "content-type: application/json" \
  -d '{
    "config": { "method": "GET", "path": "/api/users/:id", "status": 200 },
    "body": { "id": 1, "name": "Ada" },
    "description": "Created by script"
  }'

# proxy all: everything to the backend (the runtime bar's switch, via API)
curl -s -X PATCH "$BASE/server" \
  -H "content-type: application/json" -d '{"proxyAll": true}'

# and its twin: turning the mock server off/on
curl -s -X PATCH "$BASE/server" \
  -H "content-type: application/json" -d '{"serverEnabled": true, "proxyAll": false}'
```

Note the explicit `content-type: application/json` on every mutation: without it, the
request is rejected — that is the anti-CSRF defense.

## Example 2: the e2e test that exercises the error case

The most valuable use case: a Playwright test that must watch the frontend react to a 500
— impossible to produce on demand with a real backend, trivial by selecting the error
variant before the test:

```js
const BASE = "http://localhost:3000/_admin/api";

async function selectVariant(request, method, path, titleContains) {
  const { items } = await (await request.get(`${BASE}/mocks`)).json();
  const mock = items.find((m) => m.method === method && m.path === path);
  const detail = await (await request.get(`${BASE}/mocks/${mock.id}`)).json();
  const variant = detail.responses.find((r) => r.title?.includes(titleContains));
  await request.put(`${BASE}/mocks/${mock.id}`, {
    data: { selectedResponseFile: variant.fileName },
  });
}

test("shows the error banner when the user list fails", async ({ page, request }) => {
  await selectVariant(request, "GET", "/api/users", "500");
  await page.goto("/users");
  await expect(page.getByRole("alert")).toContainText("Try again later");
});

test.afterEach(async ({ request }) => {
  await selectVariant(request, "GET", "/api/users", "200");
});
```

The same pattern covers resetting sequences (`POST /mocks/:id/sequence/reset`) and driving
SSE/WS from tests (`POST /mocks/:id/sse/push`, `POST /mocks/:id/ws/push`): the test pushes
the event and verifies the UI's reaction.

## Example 3: the pipeline that re-imports the spec

[Chapter 23](23-openapi-import.md)'s OpenAPI import is idempotent on existing endpoints,
so it lends itself to running on every contract update:

```bash
# preview first: what would be created?
curl -s -X POST "$BASE/mocks/import/openapi?dryRun=true" \
  -H "content-type: application/yaml" --data-binary @openapi.yaml

# then the real import
curl -s -X POST "$BASE/mocks/import/openapi" \
  -H "content-type: application/yaml" --data-binary @openapi.yaml
```

(The content-type must be `application/yaml` or `application/json`; `text/plain` is
rejected with 415, on purpose.)

## The perimeter of the other surfaces

Two things that do *not* go through the admin API, so you don't look for them in vain: the
desktop app's **workspace settings** (port, backend, behavior — they travel on an internal
app channel, [chapter 25](25-workspace-settings.md)) and the application's **global
preferences**. Via the API you govern the engine: mocks, monitor, data, runtime switches.

One last configuration remains to census — the engine's, outside the desktop app:
[environment variables, Docker and the standalone image](31-headless-docker.md).
