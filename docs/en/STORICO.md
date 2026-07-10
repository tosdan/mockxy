# The dump history

The [monitor](MONITOR.md)'s live view keeps the last 250 requests in memory: enough for live
observation, not for going back to yesterday's session. The **dump history** is the monitor's
persistent memory: captured traffic is poured to disk, and the «History» page lets you browse
it and **create mocks in bulk** even days later — the trial session run against staging
becomes a workspace of mocks when you need it, not only at the instant of capture.

## Turning it on

Writing to disk **doesn't start on its own**: you turn it on with the switch on the History
page (or via the admin API) and turn it off the same way — on shutdown the remaining buffer
is written out, losing nothing. Flush cadence and threshold can also be adjusted at runtime;
destination folder, rotation and total cap come from the configuration (see
[CONFIGURAZIONI.md](CONFIGURAZIONI.md)). In the desktop app the folder is the local part of
the [workspace](WORKSPACE.md) (`.mockxy/monitor-dump`), out of git.

## How it writes

The writer is a subscriber of the monitor: it receives every recorded entry — already
**masked** and with the same capture limits as the live view — and accumulates it in a buffer
**independent of the 250-entry cap in RAM**: the view forgets, the archive doesn't. The write
happens at the first of: pending-entry threshold (default 100), time cadence (default 30
seconds), manual flush.

The format is **append-only NDJSON** — one entry per line, readable with command-line tools
too. Files are named with the capture session's timestamp and **rotate by size** (default
50 MB); writes are serialized, and a write error is logged without stopping either the
monitor or the server.

## Retention

The folder has a **total cap** (default 1 GB, deliberately generous): once exceeded, the
oldest files are deleted — **never** the one currently being written. Pruning protects the
disk from unbounded growth, it doesn't select what to keep: to preserve an important session,
turn it into mocks (or copy the file). With the cap at `0` pruning is disabled.

## The History page

Besides the capture switch and the manual flush, the page lists the dump files and browses
them with continuous scrolling (reading is paginated, even on very large archives). From a
file — whole, or from a selection of entries — you **create mocks in bulk**, with the same
carry-over rules as the live view ([monitor](MONITOR.md)): masked and recomputable headers
excluded, skeletons to complete for bodies that can't be reconstructed. Files are deleted
individually from the page.

## Privacy

Sensitive headers are masked already at capture time, but **bodies and query strings can
contain personal data or secrets** — and in the dumps they persist on disk. The folder is
excluded from git by construction and must not be shared nor mounted on remote servers (see
[the workspace anatomy](WORKSPACE.md) and the README's warnings).
