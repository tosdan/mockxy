# Contributing to Mockxy

Thanks for helping improve **Mockxy Mock Server**. This guide covers the local
setup, how to run things, and the conventions we follow so changes stay
reviewable and the `main` branch stays green.

> Language note: the project is bilingual in the UI, the READMEs
> ([README.md](README.md) in English, [README.it.md](README.it.md) in Italian)
> and the docs (`docs/en/`, `docs/it/`). User-facing documentation changes
> should update both languages in the same round.
> Issues and PRs can be in English or Italian.

## Prerequisites

- **Node.js ≥ 24** and npm.
- For the desktop app build: Windows (the portable target is Windows-only for
  now). Day-to-day UI/engine work runs on any OS via the browser.

## Setup

Install every package (engine, UI, desktop shell) in one go:

```bash
npm run install:all
```

## Repository layout

- `src/` — the mock engine (Node/Express). No framework UI here.
- `mockxy-ui/` — the Angular 21 admin UI (Tailwind + shadcn/spartan-ng components).
- `electron/` — the desktop shell that runs the engine in-process and shows the UI.
- `test/` — engine + Electron-module tests (Jest).
- `e2e/` — end-to-end UI↔engine tests (Playwright, `npm run test:e2e`).
- `workspace/` — a demo workspace with example mocks used during development.
- `docs/` — per-feature documentation (`docs/en/` and `docs/it/` user pages,
  plus `docs/sviluppo/` for engine-development docs and `docs/progetto/` for
  living work documents — these last two are internal and Italian-only).
- `archived/` — completed plans and reviews, kept as internal history.

## Running it

**Engine + UI in the browser (hot reload — best for UI work):**

```bash
npm run dev:backend   # terminal 1 — engine on http://localhost:3000
npm run dev:frontend  # terminal 2 — Angular dev server on http://localhost:4207
```

**Desktop app (Electron):**

```bash
npm run dev:electron
```

See [README.md](README.md) for the full picture (mock file format, handlers,
middleware, Docker, packaging).

## Tests and build

Run these locally before opening a PR — CI runs the same on every PR:

```bash
npm test                       # engine + Electron-module tests (Jest)
npm --prefix mockxy-ui test -- --watch=false   # UI tests (Vitest)
npm run build:frontend         # UI production build (AOT — catches template/type errors)
```

A broken spec blocks the whole UI suite, so keep specs green. Components and
stores that use the bilingual i18n need the shared Transloco testing helper in
their TestBed (`mockxy-ui/src/app/testing/transloco-testing.ts`).

## Code style

- The UI is formatted with **Prettier** (`mockxy-ui/.prettierrc`). Run your
  editor's format-on-save, or `npx prettier --write` on the files you touched.
- Match the surrounding code: comment density, naming, and idiom. Comments in
  this repo are mostly in Italian — keep that consistent within a file.
- UI strings are translated: add new user-facing text as i18n keys
  (`mockxy-ui/src/i18n/{it,en}.json`) rather than hardcoding it. Keep technical
  terms (HTTP methods, status names, "handler", "middleware") untranslated.

## Refactoring policy

File length alone is not debt: don't split files just because they are long.
The criterion is **reasons to change** — when a file keeps changing for two
unrelated reasons, that's a real seam and the split pays for itself. Two rules:

- **Boy-scout, not campaigns**: when you touch a big file to build a feature,
  extract the part you are working on (following the patterns the codebase
  already uses, e.g. the `mocks-next` page layout: component folder with
  sub-components and a separate store). No blanket decomposition drives.
- Refactors ride on the test suites (engine Jest + UI Vitest): green before,
  green after, in the same PR as the extraction.

## Branches and pull requests

- Branch off `main` with a short, descriptive name (e.g. `openapi-import-fix`).
- Keep commits focused; write the commit subject in the imperative.
- Open a PR against `main`. Make sure the tests above pass and the build is clean.
- One reviewer approval before merge; prefer fast-forward / small PRs over large
  ones so review stays manageable.

## License

By contributing you agree that your contributions are licensed under the
project's license, **GPL-3.0-or-later** (see [LICENSE](LICENSE)).
