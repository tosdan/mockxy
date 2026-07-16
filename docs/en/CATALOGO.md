# The mock catalog

The catalog is the working view over the workspace: the list of all endpoints, organizable
and searchable, from which every mock is created, edited and switched on. Mockxy's founding
rule applies: **the catalog and the files are two equivalent views over the same data** —
every UI action writes the [endpoint](ENDPOINT.md) and [response](RESPONSE.md) files
documented in their dedicated pages, and every change made by hand on the files shows up in
the catalog thanks to hot reload.

## Collections

Endpoints are organized into **collections**, nested too, reorderable and movable with drag &
drop. The organization is UI metadata (the `.collections.json` file in the mocks folder,
shared in git like the rest): it touches neither the served paths nor the position of the
folders on disk. Unassigned endpoints live in the virtual collection of the *unsorted* ones.

Three semantics to know:

- **Dissolve collection** removes the grouping without deleting its mocks: the whole collection
  subtree disappears and its endpoints go back to Unsorted;
- **Erase collection** permanently erases the whole subtree, its endpoints, and all their variants.
  The same action on Unsorted erases every unassigned endpoint, including those hidden by the
  current filters;
- **the collection-level enable switch is a bulk action**: it writes the same `enabled`
  state onto *all* the endpoints of the subtree, file by file. It's the quick way to switch
  off a whole area («the whole master-data area to the real backend»), but it's a uniform
  write: re-enabling the collection re-enables everything, including what had been
  individually disabled before.

The list narrows down with free-text search and filters by method, active variant type
(`mock`, `handler`, `middleware`, `sse`, `ws`) and state. A **SEQ** badge identifies endpoints
with an active [variant sequence](ENDPOINT.md).

## Endpoints

From the catalog you create an endpoint by choosing method, path (with parameters, following
[the path convention](PATH.md)) and the type of the first variant — static mock, or
[handler](HANDLER.md) or [middleware](MIDDLEWARE.md) with a starter template already in the
right shape. Each endpoint can then be:

- **edited** in method, path and description;
- **duplicated** onto a new method+path, choosing whether to copy the variants too — the
  quick route for the «like the GET, but as a POST»;
- **enabled/disabled**: when off, its requests follow the [fallback](PROXY.md);
- **deleted**, along with its variants.

The **Sequence** button opens the setup for steps, request-count or duration criteria, end
behavior and inactivity reset. The same dialog shows the current runtime step and can reset
the cursor immediately.

## Variants and the editor

Each endpoint lists its own response variants: you add new ones, edit them, delete them, and
choose the **active** one — the one actually served. The editor validates before writing:

- the **status** with a combobox that suggests the common codes but accepts any integer
  100–599;
- the **path** following the convention, with explained errors;
- the JSON **body** with syntactic validation (broken JSON is not saved), or in text mode
  with an explicit content-type;
- the **headers** with presets for the common cases;
- the variant's **delay** in milliseconds ([delays](RITARDI.md)).

On JSON or textual mocks the **Template** toggle enables the placeholders described in the
[response reference](RESPONSE.md). For `sse` and `ws` variants the body preview is replaced by
their console: connections and history/transcript, a manual broadcast composer and macros
configured in the presets. They are added from the new-response menu and their scripts are
edited on disk or through the admin API.

To serve a **binary file** (images, PDFs, archives) you upload the file directly onto the
variant — up to 12 MB via the UI — with the content-type remembered; the payload is served
streaming as documented in the [responses page](RESPONSE.md).

The view remembers the last selected endpoint and collapsed collections in `localStorage`:
when returning to the catalog, even after a restart, it is restored as left. Values that no
longer exist are ignored, and the monitor's “go to mock” command always takes precedence.
