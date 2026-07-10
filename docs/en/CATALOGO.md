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

Two semantics to know:

- **deleting a collection doesn't delete its mocks**: the whole subtree of collections
  disappears and the endpoints it contained go back among the unsorted ones;
- **the collection-level enable switch is a bulk action**: it writes the same `enabled`
  state onto *all* the endpoints of the subtree, file by file. It's the quick way to switch
  off a whole area («the whole master-data area to the real backend»), but it's a uniform
  write: re-enabling the collection re-enables everything, including what had been
  individually disabled before.

The list narrows down with free-text search and the filters by method, active variant type
(mock, handler, middleware) and state.

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

To serve a **binary file** (images, PDFs, archives) you upload the file directly onto the
variant — up to 12 MB via the UI — with the content-type remembered; the payload is served
streaming as documented in the [responses page](RESPONSE.md).
