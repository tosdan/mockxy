# The Mockxy guide — project and conventions

This folder hosts the Mockxy **user guide**: a complete walkthrough that starts from zero
and covers **all** of the application's features. It is not the reference documentation
(that lives in [`docs/en/`](../) and is organized per feature, for consultation): it is a
**course**, meant to be read in order, that explains what every feature does, how to use it
from the interface, and why it is useful — with concrete examples drawn from frontend web
app development.

This is the English translation of the Italian guide in [`docs/it/guida/`](../../it/guida/),
which is where the guide is authored first (including the content map, `MAPPA.md`).

## Audience and tone

It is a **public user guide**: the register is that of professional technical
documentation, not a beginners' tutorial. It must nonetheless remain fully accessible to a
junior frontend developer: they know what an HTTP call, JSON and a dev server are, but
familiarity with the finer points (CORS, session cookies, reverse proxies, SSE,
WebSocket…) must not be taken for granted. Writing rules:

- **Clear, never simplistic**: written for a professional who can read technical
  documentation. No patronizing tone, no cheerleading, no rhetorical questions or
  artificial enthusiasm: clarity comes from context and examples, not from lowering the
  register.
- **The right context at the right time**: every concept that enters the picture is
  introduced with a sentence or two before being used — the way good documentation does,
  not the way a lesson does. When a real deep dive is needed, the necessary minimum is
  explained here with a link to the reference page for the rest.
- **Not telegraphic**: features are not listed, they are told — what they do, how they are
  used, and at least one real frontend-development scenario where they earn their keep.
- **But not heavy either**: plain sentences, examples before theory, short sections with
  descriptive headings. The reader must be able to resume from any chapter.
- Each chapter ideally closes with a hook into the next one, so the guide also reads as a
  continuous path.

## The screenshot convention

Screenshots are provided by the human author. The text contains **placeholders** that
describe exactly what the image must show — the state the app must be in, which sample
data must be visible — so the shot can be prepared without rereading the chapter. Format:

```markdown
> 📷 **SCREENSHOT** — `proposed-file-name.png`
> What to show: [page or dialog, app state, sample data visible, the element the eye
> should land on, if any].
```

Granularity: **whole views** are photographed (a page, a dialog, a panel in its context),
never a single button or toggle. When the same interface takes **different states for
different features** (e.g. the response editor in text-body vs file-body mode, the sequence
dialog in "by requests" vs "by time" mode), multiple screenshots are planned, one per
state.

## Structure and workflow

- The guide is authored in Italian first (`docs/it/guida/`, including the content map
  `MAPPA.md`); this English tree mirrors it chapter by chapter with English slugs.
- File naming: two-digit numeric prefix + slug, e.g. `07-creating-endpoints.md`.
- Sources for writing: the reference pages in `docs/en/`, the interface strings in
  `mockxy-ui/src/i18n/en.json` (to quote controls by their exact names), and the code when
  a behavior needs verifying.

## Progress

| Phase | Status |
|---|---|
| Translation of Part I — Getting started (01–05) | ✅ |
| Translation of Part II — Day-to-day mocking (06–14) | ✅ |
| Translation of Part III — Dynamic responses and streaming (15–19) | ✅ |
| Translation of Part IV — Observing and capturing traffic (20–22) | ✅ |
| Translation of Part V — Import and mocks as files (23–24) | ✅ |
| Translation of Part VI — Configuration and administration (25–31) | ✅ |
| Translation of Part VII — Practice and quick reference (32–34) | ✅ |
| Screenshots | ⬜ |
