# 34 — Appendices

The quick-consultation pages: the editor shortcuts, the interface language, the glossary
of the guide's terms, and the "where do I do what" index for using the guide as a
reference once read.

## The editor shortcuts

The code editor (response bodies, handler and middleware scripts) offers these shortcuts —
the list is also available in the app, in the dedicated dialog next to the editor; on
macOS use ⌘ instead of Ctrl:

| Function | Shortcut |
|---|---|
| Search and replace | `Ctrl` `F` |
| Autocomplete (JavaScript) | `Ctrl` `Space` |
| Format / indent the document | `Shift` `Alt` `F` |
| Indent / outdent | `Tab` / `Shift` `Tab` |
| Comment line | `Ctrl` `/` |
| Undo / redo | `Ctrl` `Z` / `Ctrl` `Y` |
| Collapse / expand section | `Ctrl` `Shift` `[` / `Ctrl` `Shift` `]` |

In the SSE and WebSocket consoles, `Ctrl` `Enter` in the composer sends the message.

> 📷 **SCREENSHOT** — `34-dialog-scorciatoie.png`
> What to show: the editor shortcuts dialog open over a code editor.

## The interface language

The interface is available in Italian and English; it changes from the selector in the top
bar, with immediate effect. Where the choice lives: in the **browser** (headless), the
browser itself remembers it, per machine — on first access it follows the system locale;
in the **desktop app** it is a global preference next to the executable, applies to all
workspaces and covers the native dialogs too. Engine logs stay in English.

## Glossary

| Term | Meaning |
|---|---|
| **Workspace** | the folder containing an entire mock environment: endpoints, data files, local settings, captured traffic ([ch. 2](02-core-concepts.md), [24](24-mocks-as-files.md)) |
| **Endpoint** | a mocked HTTP method + path, with its variants ([ch. 7](07-creating-endpoints.md)) |
| **Variant / response** | one of an endpoint's ready responses; exactly one is **selected** and gets served ([ch. 8](08-endpoint-panel.md)) |
| **Collection** | the grouping of endpoints in the catalog; pure interface metadata ([ch. 6](06-catalog.md)) |
| **Unsorted** | the virtual collection of unassigned endpoints |
| **Proxy fallback** | forwarding of mock-less requests to the real backend ([ch. 26](26-proxy-fallback.md)) |
| **Mock-only** | the mode with fallback off (or no backend): mock-less requests get a 404 |
| **Proxy all** | the runtime switch that suspends all mocks, monitor still on ([ch. 5](05-ui-tour.md)) |
| **Source** | who produced a response — the `x-mock-source` values, the monitor's "Served by" column |
| **Handler** | a local JavaScript script that computes the response ([ch. 15](15-handlers.md)) |
| **Middleware** | a script that transforms the proxied real backend's response ([ch. 16](16-middleware.md)) |
| **Data file** | a reusable JSON dataset on the Data page, read with `data()` ([ch. 17](17-data-page.md)) |
| **Script (SSE/WS)** | the timed lineup of an SSE or WS variant's messages ([ch. 18–19](18-sse.md)) |
| **Sequence** | the policy serving variants in order, by requests or by time ([ch. 12](12-variant-sequences.md)) |
| **Templating** | the `{{...}}` placeholders resolved with request values ([ch. 10](10-templating.md)) |
| **Dump / history** | the monitor traffic's on-disk archive ([ch. 22](22-dump-history.md)) |
| **Skeleton** | a mock created from a capture with a non-reconstructable body: structure ready, body to complete ([ch. 21](21-traffic-to-mocks.md)) |
| **Hot reload** | the automatic re-reading of workspace files on change ([ch. 24](24-mocks-as-files.md)) |
| **Per-endpoint degradation** | a broken file excludes that endpoint, never the whole server ([ch. 24](24-mocks-as-files.md)) |
| **Admin API** | the REST API under `/_admin/api` the interface is built on ([ch. 30](30-admin-api.md)) |

## Where do I do what

| I want to… | Chapter |
|---|---|
| install / run Mockxy | [3](03-install-and-run.md) |
| connect my frontend | [4](04-connect-your-frontend.md) |
| understand the global switches | [5](05-ui-tour.md) |
| organize endpoints into folders | [6](06-catalog.md) |
| create an endpoint / see why it doesn't match | [7](07-creating-endpoints.md) |
| keep several responses ready and switch on the fly | [8](08-endpoint-panel.md) |
| status, headers, body, binary files, presets | [9](09-mock-response-editor.md) |
| echo request parameters without code | [10](10-templating.md) |
| paginate and filter a mocked list | [11](11-lists-pagination-filters.md) |
| a response that evolves over time (polling) | [12](12-variant-sequences.md) |
| duplicate an endpoint | [13](13-copying-endpoints.md) |
| simulate slowness and timeouts | [14](14-simulated-delays.md) |
| write JavaScript logic / stateful mocks | [15](15-handlers.md) |
| touch up the real backend's response | [16](16-middleware.md) |
| reusable datasets with `data()` | [17](17-data-page.md) |
| mock an SSE stream | [18](18-sse.md) |
| mock a WebSocket | [19](19-websocket.md) |
| observe traffic / diagnose | [20](20-monitor.md), [33](33-troubleshooting.md) |
| turn real traffic into mocks | [21](21-traffic-to-mocks.md) |
| archive traffic and capture from the past | [22](22-dump-history.md) |
| generate mocks from an OpenAPI spec | [23](23-openapi-import.md) |
| version mocks in git / edit them by hand | [24](24-mocks-as-files.md) |
| all the workspace settings | [25](25-workspace-settings.md) |
| mock-only, 404/501/502, timeouts | [26](26-proxy-fallback.md) |
| CORS, logins that don't stick, redirects | [27](27-proxy-topology.md) |
| multiple workspaces, preferences, error log | [28](28-desktop-workspaces.md) |
| expose Mockxy on the LAN | [29](29-network-security.md) |
| automate from scripts and e2e tests | [30](30-admin-api.md) |
| environment variables, Docker, standalone | [31](31-headless-docker.md) |
| the complete workflows | [32](32-scenarios.md) |

End of the road. For the quick overview there is the
[project README](../../../README.md); for the reference detail, the pages in
[`docs/en/`](../README.md).
