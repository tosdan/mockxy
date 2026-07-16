# Dogfooding — il collaudo da utente

La pratica: a ogni giro di feature si rifà un **collaudo da utente** sul flusso toccato —
app vera nel browser (UI compilata servita dal motore), workspace partito vuoto, backend
"reale" finto con endpoint credibili. Costa ~mezz'ora e trova in un giro ciò che centinaia
di test unitari verdi non possono vedere (è il metodo con cui è nato il backlog del collaudo
del 9 luglio 2026). Ogni affermazione che ne esce va **osservata davvero, non dedotta**; le
ipotesi non verificate si marcano come tali.

## Ambiente riproducibile (nel repo)

- `node scripts/dogfood-server.js` — avvia il motore su **:3344** con un workspace scratch
  locale (`.dogfood/`, gitignored) e la UI compilata.
- `node scripts/dogfood-backend.js` — avvia il backend finto su **:9333** (lista utenti,
  dettaglio, POST, un 500, uno lento).
- C'è anche la config `mockxy-dogfood` in `.claude/launch.json`.

Prerequisito: `npm run build:frontend:desktop` (la UI va servita dal motore sotto
`/_admin/ui/`, quindi con `--base-href=/_admin/ui/`).

Gli scenari d'origine su cui collaudare sono in [`docs/it/SCENARI.md`](../it/SCENARI.md);
gli esiti alimentano [`docs/progetto/`](../progetto/) (backlog e idee future).
