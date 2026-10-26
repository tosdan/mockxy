---
description: Convenzioni reali del progetto (UI Angular, motore Node, test, documentazione) per chi scrive o rivede codice in Mockxy.
applyTo: '**/*.ts,**/*.js,**/*.html,**/*.css'
---

# Convenzioni di Mockxy

Il repository ha tre parti: il motore (`src/`, Node/Express), la UI di amministrazione (`mockxy-ui/`, Angular 21) e la shell desktop (`electron/`). Setup, comandi e politica di refactoring sono in `CONTRIBUTING.md`; le regole Angular generiche (standalone, signal, `input()`/`output()`, `OnPush`, `inject()`, control flow nativo, binding nell'oggetto `host`) sono in `mockxy-ui/AGENTS.md`. Qui ci sono le convenzioni specifiche del progetto.

Regola generale: segui lo stile del codice intorno (densità dei commenti, nomi, idiomi) invece di imporne uno nuovo.

## UI (`mockxy-ui/`)

- **Niente librerie di componenti complete** (niente PrimeNG, Angular Material o simili). Prima di creare un elemento di UI riusa i componenti in `mockxy-ui/src/app/ui/` (`ui-button`, `ui-dialog`, `ui-select`, `ui-menu`, `ui-tooltip`, `ui-toast`, `ui-tabs`, `ui-switch`, `ui-code-editor`, ...). La pagina `pages/design-system` (rotta `/design-system`) li mostra tutti.
- **Primitive**: i componenti `ui-*` sono costruiti su `@spartan-ng/brain` (checkbox, switch, tabs) e sull'Angular CDK (dialog, menu, overlay, portal, tree, drag-drop, clipboard), che danno comportamento e accessibilità; lo stile lo aggiungono i componenti `ui-*`. Una nuova primitiva va incapsulata in un componente `ui-*` invece di essere usata con lo stile ripetuto nelle pagine.
- **Nuovi componenti `ui-*`**: una cartella per componente, varianti con `cva` (class-variance-authority), classi combinate con `cn()` di `ui/cn.ts` (clsx + tailwind-merge) e un input `class` (alias) per gli override dall'esterno. Vedi `ui-button` come riferimento.
- **Stile**: Tailwind v4 con le utility dei design token definiti in `src/styles.css` (`bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-brand`, i colori di metodo e di status, ...). Non usare colori letterali dove esiste un token. Il CSS custom (file del componente o `styles.css`) serve solo dove le utility non bastano, con un commento che spiega il perché.
- **Icone**: `@ng-icons/lucide` con `provideIcons` nel componente.
- **Testi**: ogni testo visibile all'utente è una chiave Transloco presente sia in `src/i18n/it.json` sia in `src/i18n/en.json`. I termini tecnici (metodi HTTP, nomi degli status, "handler", "middleware") restano non tradotti.
- **Stato**: store `@Injectable` basati su signal, con il signal scrivibile privato ed esposto con `asReadonly()`. Gli store globali stanno in `shared/` con `providedIn: 'root'`; quelli di pagina sono forniti dalla pagina (`providers: [...]`). Per le pagine segui il layout di `pages/mocks-next`: una cartella per pagina con sotto-componenti e uno store separato.
- **Formattazione**: Prettier (`mockxy-ui/.prettierrc`: apici singoli, riga massima 100).

## Motore e desktop (`src/`, `electron/`)

- Node ≥ 24, CommonJS (`require` / `module.exports`), Express 5, stringhe tra doppi apici.
- Le dipendenze si passano dall'esterno per poterle sostituire nei test: factory come `createHealthRouter({ runtimeStatus, config })`, classi che ricevono ad esempio `now` nel costruttore.
- Una modifica alle rotte dell'admin API (`src/admin/admin-api.js`) aggiorna nella stessa PR il contratto `src/admin/admin-api.openapi.yaml`: lo verificano `test/admin-openapi-contract.test.js` e `npm run check:admin-openapi`.

## Test

- Motore ed Electron: Jest in `test/` (`*.test.js`, `*.electron.test.js` per i moduli desktop), con `supertest` per le rotte e gli helper di `test/helpers.js` (`createTempDir`, `createNoopLogger`, ...).
- UI: Vitest con TestBed, spec `*.spec.ts` accanto al file. I componenti e gli store che usano i testi tradotti importano `translocoTesting()` da `src/app/testing/transloco-testing.ts`; lì ci sono anche i fake condivisi (`runtime-sync-testing.ts`, `runtime-config-testing.ts`).
- End-to-end: Playwright in `e2e/`.
- Un comportamento nuovo o corretto arriva con il suo test nella stessa PR.

## Commenti e documentazione

- **Non esistono README per modulo** e non vanno creati. Il codice si documenta con i commenti; il comportamento per l'utente con le pagine in `docs/`.
- I commenti sono in italiano e spiegano il perché: vincoli, casi limite, motivi di una scelta non ovvia, rimandi ai documenti di design (`docs/progetto/...`). Non parafrasano il codice. Un commento d'intestazione per modulo e un `/** ... */` breve sui simboli esportati quando servono; non serve un commento su ogni funzione.
- Una modifica visibile all'utente aggiorna insieme `docs/it/` e `docs/en/` (e `README.md` / `README.it.md` se toccano quanto vi è descritto). `docs/progetto/` (analisi, design, note di rilascio) e `docs/sviluppo/` (documentazione per chi sviluppa il motore) sono interni e solo in italiano.

## Progettazione del codice

- Funzioni piccole e, dove possibile, pure, con una responsabilità chiara; niente duplicazioni che cambierebbero insieme.
- La lunghezza di un file da sola non è un problema: si separa quando un file cambia per due motivi indipendenti (vedi "Refactoring policy" in `CONTRIBUTING.md`).
