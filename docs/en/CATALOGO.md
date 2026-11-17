# The mock catalog

The catalog is the working view over the workspace: the list of all endpoints, organizable
and searchable, from which every mock is created, edited and switched on. Mockxy's founding
rule applies: **the catalog and the files are two equivalent views over the same data** —
every action that changes a mock writes the [endpoint](ENDPOINT.md) and [response](RESPONSE.md)
files documented in their dedicated pages, and every change made by hand on the files shows up
in the catalog thanks to hot reload.

The rule is about **the workspace's data**. What is left out, on purpose, is the operational
state of a session, which is not data: the [global controls](CONTROLLI.md), which apply to the
whole engine, and the [temporary state](#temporary-state) of a single endpoint. They are not
written, do not appear in the files, and a restart drops them.

## Collections

Endpoints are organized into **collections**, nested too, reorderable and movable with drag &
drop. The organization is UI metadata (the `.collections.json` file in the mocks folder,
shared in git like the rest): it touches neither the served paths nor the position of the
folders on disk. Unassigned endpoints live in the virtual collection **Unsorted** (*Non
assegnati* in the Italian interface): no collection can take either name.

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

The list narrows down with free-text search and filters by method, selected variant type
(`mock`, `handler`, `middleware`, `sse`, `ws`, `sequence`) and state. A **SEQ** badge identifies
endpoints whose selected variant is a [sequence](RESPONSE.md). Each row shows the type with an
icon, the same used for the origin in the [monitor](MONITOR.md). With a filter on, the header
tells how many endpoints remain out of the total, the searched text is highlighted in the paths
and collections without results disappear; drag-and-drop reordering is paused, and a notice
reminds whoever tries to drag.

## Selection and keyboard

A click on an endpoint opens it in the detail; **Ctrl+click** (⌘+click on Mac) checks it without
opening it, and a second one unchecks it. The **Select** button next to «⋮» starts selection
mode: there a click checks the row instead of opening it, until **Done** closes the mode and keeps
the checks. **Esc** closes the mode and clears every check, from anywhere on the page except
text fields, menus and dialogs.

Checked rows have an indigo tint and a left edge of the same color; the one open in the detail
has a gradient towards the right and a light right edge, so the two marks never mix up.
Collections have a three-state checkbox: it checks every endpoint of the subtree,
sub-collections included (under a filter, only those the filter shows); Ctrl+click on the
collection does the same, while a plain click expands or collapses it. A fully checked collection
has the tint and a solid edge, a partly checked one has stripes and a dashed edge, and its counter
tells how many endpoints are checked out of the total. Bulk actions — enable,
disable, move, delete — act on every checked endpoint the filter shows, even inside collapsed
collections; what the filter hides is never touched.

The catalog also works from the keyboard, with a single Tab stop: the arrows move between rows
and expand or collapse collections, **Enter** opens the endpoint in the detail, **Space** checks
it (on a collection it checks the subtree). From the search field, Arrow Down enters the list.

The «⋮» menu next to «New» offers a **compact density**: one line per endpoint, with only what
tells them apart. The choice is kept for later visits.

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

### Temporary state

Enabling an endpoint or choosing a variant **saves to the files** of the workspace: it is the
decision that goes into git and that colleagues receive, and it is what you need when a mock
stands in for a backend that [is not there yet](SCENARI.md#the-new-feature-is-ready-its-backend-is-not).
The same gesture does not fit when the state is needed only for a moment — reproducing a bug on
an endpoint the backend already has, trying the error case, preparing a test: the file stays
modified, and sooner or later a state nobody chose ends up in a commit. For these cases there is
the **temporary state**, from the clock button next to the endpoint's switch:

- **turn on / turn off temporarily**, without touching the switch that saves;
- **serve temporarily** a variant other than the selected one;
- **back to what is saved**.

The temporary state lives in the engine's memory: the files do not change, `git status` stays
clean, and a restart drops it. It cannot go unnoticed: the catalog row carries the **TEMP**
mark (`TEMP ON`, `TEMP OFF`), the button in the detail says what is different, and the status
bar counts the endpoints in a temporary state with **Clear**, which brings them all back to
what is saved. It shows up also when a test set the scenario through the
[API](ADMIN-API.md#temporary-activation).

A normal save on the same endpoint wins: turning it off from the switch, or selecting a variant
from the dropdown, drops the temporary state of that field. Editing the data of a variant, or
creating one without "Activate now", does not touch it.

The switch, the dropdown and the catalog rows keep showing **what is saved**: an endpoint turned
on temporarily has its switch on "Disabled" and the `TEMP ON` mark. Both are true — the first
says what is in the file, the second what answers right now.

In the detail, a **banner** under the header puts them side by side: "now: Not found 404. In
the file: OK 200". **See what it answers** shows the variant being served, read-only, without
changing the one the detail is showing; in the variant dropdown, the one served now and the one
in the file are marked. There are two ways out of the banner: **Back to what is saved** removes
the temporary state, **Save this** writes it to the endpoint file — from then on it is the saved
decision, the one that goes to git.

The counter in the status bar opens the **list** of the endpoints in a temporary state, from any
page: for each one what answers now and what the file says, **Save this**, the X that puts it
back to what is saved, and the path, which opens the endpoint in the catalog. At the bottom,
**Save all to the files** and **Clear**.

In the desktop app, saving the [workspace settings](DESKTOP.md) restarts the engine and therefore
drops the temporary state; the dialog says so before saving. Which gesture to use, case by
case, is in [SCENARI.md](SCENARI.md#save-or-temporary-state).

The **Sequence** button creates a sequence variant or edits the selected one. The dialog sets a
request-count or duration criterion independently for each step, end behavior and inactivity
reset; in edit mode it also shows live state and can reset the cursor immediately.

## Variants and the editor

Each endpoint lists its own response variants: you add new ones, edit them, delete them, and
choose the **active** one — the one served, until a [temporary state](#temporary-state) makes
the engine serve another. The editor validates before writing:

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

The catalog and the open endpoint update on their own when an agent, another window or a change
to the files modifies them: while visible, the UI polls the engine every 2 seconds and reloads
everything when you return to the window. If the engine does not respond, the bar at the bottom
shows «Not up to date»; it also lists the errors of the last load, with what the runtime serves in
their place (for example the previous version of a broken handler).

The description, the variant form and the sequence dialog save to the resource they opened: if
an agent or another client activates a different variant in the meantime, your edit stays on the
original one. Automatic updates never touch an open draft: if its resource changes, a notice tells
you before you save. If the resource has changed, saving does not overwrite it: your draft is kept
and a panel lets you **compare** it with the current version, **reload** the current version in
place of your draft (with a confirmation if you edited it) or **save your version** after
reviewing it. If the resource was deleted, the text stays there to copy and saving is disabled.
Status, delay and template changed inline, activation and selection are immediate actions: the
last one wins.

The view remembers the last selected endpoint and collapsed collections in `localStorage`:
when returning to the catalog, even after a restart, it is restored as left. Values that no
longer exist are ignored, and the monitor's “go to mock” command always takes precedence.
