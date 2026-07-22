# 22 — The dump history: the monitor that doesn't forget

The monitor's live view keeps the last 250 requests in memory: enough for real-time
observation, not for coming back to yesterday's session. The **dump history** is the
persistent memory: captured traffic is poured to disk, and the **History** page lets you
browse it and create mocks **even days later** — Tuesday's test session on staging becomes
a mock set on Thursday, when it's actually needed.

## Turning on-disk capture on

Writing does **not start on its own**: it is turned on with the **Dump** switch in the
runtime bar (visible from every view) and turned off the same way — on shutdown the
remaining buffer is written, losing nothing. Next to the switch, the count of queued
requests and the **flush** button to write them to disk immediately.

The writer receives every entry the monitor records — already masked, with the same
capture limits as the live view — and accumulates it in a buffer **independent of the
250-entry RAM cap**: the view forgets, the archive doesn't. Writing triggers at the first
of: pending-entry threshold (default 100), time cadence (default 30 seconds), manual
flush.

> 📷 **SCREENSHOT** — `22-runtime-bar-dump.png`
> What to show: the runtime bar with the dump active and the queued-request count visible
> (tooltip or badge), plus the flush button.

## The on-disk format

The archive is **append-only NDJSON** — one JSON entry per line, readable with
command-line tools too (`grep`, `jq`). Files are named with the capture session's
timestamp and **rotate by size** (default 50 MB); the folder has a **total cap** (default
1 GB): once exceeded, the oldest files are deleted — never the one currently being
written. Pruning protects the disk, it doesn't choose what to keep: an important session
is preserved by turning it into mocks (or copying the file). Cadence, threshold, rotation
size and cap are tuned from the workspace settings
([chapter 25](25-workspace-settings.md)) or from the environment variables when headless.

In the desktop app the folder is `.mockxy/monitor-dump` — the workspace's **local part**,
out of git by construction: sensitive headers are masked at capture, but bodies and query
strings may contain personal data, and dumps must not be shared or mounted on remote
servers.

## The History page

The page lists the **dump files** on disk; loading one, the entries browse with continuous
scrolling (reading is paginated: even very large archives open without weight). The list
looks like the monitor's — method, path, status, source — and an entry's detail shows the
same four request/response sections, read-only; bodies beyond the capture threshold are
marked "truncated".

From here mocks are created **in bulk**, at two granularities:

- selecting the loaded entries (with the "Select loaded" / "Deselect" shortcuts) and
  confirming with **"Create mock (N)"**;
- from a **whole file**, with the dedicated action on the file's row.

The same transfer rules as [chapter 21](21-traffic-to-mocks.md) apply — masked headers
excluded, skeletons for non-reconstructable bodies — and the batch behavior: endpoints
that already exist are skipped. The final summary counts created, skeletons, already
existing and failed. Files are deleted individually from the page.

> 📷 **SCREENSHOT** — `22-storico-pagina.png`
> What to show: the History page with several dump files listed, one loaded, a few entries
> selected and the "Create mock (N)" button active; the read-only detail of one entry
> visible too.

## Live or history?

The compass is simple: the **live monitor** serves while you work — immediate diagnosis,
capturing the screen just navigated; the **history** serves when temporal distance matters
— the data-entry session to freeze calmly, last week's backend behavior to compare, the
long capture campaign that would overflow the 250 entries. If the session's goal is
capturing, turn the dump on *before* navigating: the live view may forget, the archive
won't.

Part IV closes the observe–capture–mock cycle. Part V covers the two ways of populating
and owning the workspace wholesale: the [OpenAPI import](23-openapi-import.md) and
[mocks as files](24-mocks-as-files.md).
