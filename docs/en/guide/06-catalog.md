# 06 — The mock catalog

The catalog is the working view over the workspace: the list of all endpoints, organizable
and searchable, from which every mock is created, edited and switched on. The page is
split in two: on the left the tree of endpoints organized into collections, on the right
the panel of the selected endpoint (the subject of [chapter 8](08-endpoint-panel.md)); the
divider between the two panels drags to resize, and a double click resets it.

The founding rule applies here too: the catalog and the files on disk are **two equivalent
views over the same data**. Every action on the page writes the workspace files, and every
hand-made change to the files shows up in the catalog thanks to hot reload.

> 📷 **SCREENSHOT** — `06-catalogo-panoramica.png`
> What to show: the catalog populated with nested collections (e.g. `users` with a
> sub-collection, `orders`, plus a few endpoints in Unsorted), one endpoint selected with
> its panel visible on the right, and the footer with the counters. The "normal" working
> view, no filters active.

## Collections

Endpoints are organized into **collections**, nested if needed, to keep a growing
workspace tidy — typically one collection per functional area of the API (`users`,
`orders`, `billing`…). They are created from the "New collection" button at the top of the
tree (or "New sub-collection" from an existing collection's menu), and reordered and moved
by **dragging**: both collections and individual endpoints can be dragged from one
collection to another. As an alternative to drag & drop, each element's menu offers "Move
up", "Move down" and "Move to collection" with a destination picker (including the top
level).

Two properties to know so you can use them without fear:

- the organization is **interface metadata**: it lives in the `.collections.json` file of
  the mocks folder (shared in git like the rest) and touches neither the served paths nor
  the position of folders on disk — reordering cannot break anything;
- endpoints not assigned to any collection live in the virtual **Unsorted** collection,
  which is the default destination of new mocks.

### Collection actions

Each collection's menu gathers, besides the moves, four actions whose effect is worth
understanding well:

- **Enable all / Disable all** — a bulk action: it writes the same state onto *all* the
  endpoints of the subtree, file by file. It is the quick way to switch off a whole area
  ("all of user management goes back to the real backend"), but it is a uniform write:
  re-enabling the collection re-enables everything, including what had been disabled
  individually before.
- **Dissolve collection** — removes the grouping without deleting the mocks: the
  collection and its sub-collections disappear, and the endpoints they contained return to
  Unsorted.
- **Erase collection** — permanently deletes the whole subtree: collection,
  sub-collections and **all contained endpoints** with their variants. The confirmation
  states the count of what is about to disappear.
- On Unsorted, the equivalent action is **"Erase all endpoints"**: it removes all
  unassigned endpoints — **including those momentarily hidden by the current filters**, a
  detail to keep in mind before confirming.

> 📷 **SCREENSHOT** — `06-menu-collection.png`
> What to show: a collection's context menu open, with the move entries, "Enable/Disable
> all", "New sub-collection", "Dissolve" and "Erase" visible.

## Search and filters

The "Filter the catalog…" box narrows the tree with free-text search; the filters button
opens the panel with two combinable criteria:

- **Type** — the nature of each endpoint's active variant: Mock, Handler, Middleware, SSE,
  WebSocket (or All);
- **Status** — Active, Inactive, or All.

Search and filters combine; when no endpoint matches, a dedicated message says so and
"Reset filters" brings back the full view. The "Expand all" and "Collapse all" buttons act
on the tree's folders.

> 📷 **SCREENSHOT** — `06-filtri-attivi.png`
> What to show: the filter panel open with one filter active (e.g. Type = Handler) and the
> tree reduced to the matching endpoints only.

## The endpoint row

Each endpoint appears in the tree with its method badge, its path and an **enable switch**
operable straight from the list: disabling an endpoint does not delete it — its requests
go back to following the fallback (proxy to the backend, or 404 in mock-only). A **SEQ**
badge marks endpoints with an active variant sequence
([chapter 12](12-variant-sequences.md)).

The footer sums up the workspace's numbers: total endpoints and collections, and the
active/total ratio.

## Reloading from disk

The "Reload from disk" button forces a re-read of the workspace. With hot reload active it
is rarely needed — file changes are picked up on their own — but it is the right move
after massive external operations (a `git pull`, a branch switch, a script that rewrote
the mocks) or when the watcher is off.

The view, finally, **remembers your position**: the last selected endpoint and the
collapsed collections are saved in the browser, and returning to the catalog — even after
a restart — you find it as you left it.

The catalog fills up in three ways: creating endpoints by hand ("New"), importing an
OpenAPI spec ("Import OpenAPI", [chapter 23](23-openapi-import.md)), or capturing traffic
from the monitor ([chapter 21](21-traffic-to-mocks.md)). We start with the first: guided
creation and the path rules are [chapter 7](07-creating-endpoints.md).
