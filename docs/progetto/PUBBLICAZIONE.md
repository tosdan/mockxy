# Checklist per la pubblicazione su repo pubblico

Piano deciso: il progetto diventa pubblico su un **repo nuovo creato ad hoc**, con un **singolo
commit iniziale** che contiene tutta l'applicazione. Questo repo resta privato e continua a
essere il posto di lavoro quotidiano (coi mock fiscali veri nel workspace): la bonifica si fa
sulla **copia esportata**, non qui. Audit dei contenuti fatto il 10 lug 2026 sui file tracciati.

## La procedura giusta per esportare (il punto più importante)

**Non copiare la working directory.** La cartella di lavoro contiene file non tracciati e
ignorati che NON devono partire: `.env`, `.dogfood/`, `monitor-dump/`, `node_modules`, e
tutto ciò che vive dentro `workspace-vu-ish/` senza essere tracciato. Copiando la cartella a
mano partirebbero tutti. Usare invece:

```bash
git archive HEAD -o ../mockxy-export.tar
# oppure: clone fresco e rimozione di .git
```

che per costruzione esporta **solo i file tracciati**. La bonifica sotto si applica alla copia
estratta, poi `git init`, commit unico, push sul repo nuovo.

## Bonifiche obbligatorie sulla copia (bloccanti)

1. **Dati personali nel workspace demo.** ~~Da bonificare~~ **FATTO (10 lug 2026)**: il
   workspace di lavoro (dominio fiscale reale, incluso il nominativo con codice fiscale emerso
   dall'audit) è stato rinominato in `workspace-vu-ish/` e resta solo qui — **non va copiato**,
   come `archived/`. Al suo posto, `workspace/` contiene ora un **demo neutro verificato dal
   vivo** (quickstart `/api/ciao`, lista con paginazione e filtri automatici, handler con
   `data()` e parametro di percorso, endpoint a due varianti per simulare un guasto).
2. **Username reale negli esempi.** ~~Da anonimizzare~~ **FATTO (10 lug 2026)**: gli esempi dei
   percorsi corti 8.3 nella pagina di troubleshooting di sviluppo e nei commenti del codice
   (`src/server.js`, `test/helpers.js`) usano ora un nome di fantasia. L'unica traccia residua
   è in una scheda dentro `archived/`, che non si pubblica.
3. **La cartella `archived/`**: contiene i piani completati e la revisione pre-rilascio, che
   include la traccia dell'audit sui dati personali (nominativo incluso). **Non copiarla**: è
   nata apposta come contenitore unico dell'archivio interno (10 lug 2026).

## Riferimenti al mondo privato (bloccanti finché non decisi)

4. **La suite di accettazione è un repo privato.** `README.md` (riga ~485) la linka e
   `.github/workflows/acceptance.yml` la clona col secret `ACCEPTANCE_REPO_TOKEN`: sul repo
   pubblico il link è morto e il workflow fallisce a ogni push. Due strade:
   - pubblicare anche `mockxy-acceptance-tests` (previo **stesso audit**: anche lì c'è un
     workspace di fixture da controllare), togliendo i due secret incrociati che non servono più
     tra repo pubblici;
   - oppure escludere `acceptance.yml` dalla copia e riformulare il paragrafo del README.
5. **Metadati di package.json**: `author` è vuoto e `repository` assente — compilare con il
   nome/URL del repo pubblico (anche in `mockxy-ui/package.json` ed `electron/package.json` se
   si vuole essere completi). Nel README, sostituire anche il placeholder
   `github.com/<tuo-utente>/mockxy` dell'avvio rapido con l'URL vero.
6. **Documentazione inglese**: ~~README.en.md era solo "WIP"~~ **FATTO (10 lug 2026)** — il
   progetto ora si presenta in inglese: `README.md` è la traduzione integrale (verificata
   claim-per-claim contro compose, Dockerfile, script npm e config di build), l'italiano vive
   in `README.it.md` coi badge lingua incrociati, e le 29 pagine della doc utente esistono in
   `docs/en/` e `docs/it/` (traduzioni verificate: struttura combaciante pagina per pagina,
   nessun residuo, link integri). Regola viva in CONTRIBUTING: la doc utente si aggiorna in
   entrambe le lingue nello stesso giro.

## Decisioni deliberate (non bloccanti, ma da prendere consapevolmente)

7. **I documenti di lavoro interni**: BACKLOG-PRODOTTO.md, IDEE-FUTURE.md,
   CONCORRENZA-ADMIN.md, CONTRATTO-ADMIN-LOADER.md, TODO.md, E2E-ARCHITETTURA-SERVER.md e
   questo stesso PUBBLICAZIONE.md. Nessun segreto (verificato), tutto in italiano, pieni di
   contesto interno. Tenerli è una scelta di stile ("engineering culture" in vetrina), toglierli
   alleggerisce. Da decidere in blocco. (I piani completati e la cartella della code review
   stanno già in `archived/`, esclusa dal punto 3; `previous-readme/` è stato eliminato il
   10 lug. Nota: i due documenti di analisi CONCORRENZA-ADMIN e CONTRATTO-ADMIN-LOADER linkano
   schede dentro `archived/` — se si pubblicano, quei link vanno tolti o le frasi riformulate.)
8. **La licenza**: GPL-3.0-or-later, con file LICENSE presente e CONTRIBUTING coerente. Va bene
   così se il copyleft è voluto; se si preferisce l'adozione facile (MIT/Apache-2.0), il momento
   di cambiare è prima del primo commit pubblico, dopo è per sempre.
9. **Vulnerabilità dipendenze**: `npm audit` segnala 1 moderate sul motore e 3 sulla UI (1
   high). Su un repo pubblico Dependabot le mostrerà a tutti dal giorno uno: sistemarle o
   almeno conoscerle prima.

## Sul repo nuovo, appena creato

- Actions: impostare subito la policy delle azioni consentite (lezione del 9 lug: il default
  restrittivo blocca `actions/checkout` e simili) e verificare il primo run di CI.
- Attivare **secret scanning** e **Dependabot** (gratuiti sui repo pubblici).
- Branch protection su `main` se si accetteranno PR esterne.
- Nome, descrizione, topics; verificare che il nome "mockxy" sia libero su npm se un giorno si
  vorrà pubblicare il pacchetto.
- Prima del push: rilanciare sulla copia la stessa scansione fatta qui (pattern di segreti,
  email, nominativi, codici fiscali) come ultima rete.

## Cose da NON fare

- **Non** copiare la working directory (vedi sopra: è il modo in cui i file ignorati scappano).
- **Non** riusare sul repo pubblico i PAT o i secret esistenti: tra repo pubblici non servono, e
  ogni segreto in meno è un problema in meno.
- **Non** pubblicare la suite di accettazione senza averle fatto lo stesso audit del motore.
- **Non** dimenticare che dal primo push in poi ogni contenuto pubblicato è permanente (cache,
  fork, archive.org): la disciplina sui segreti da quel momento è per sempre, e un segreto
  sfuggito si **ruota**, non si cancella.
- **Non** dare per buono questo audit fra qualche mese: se la pubblicazione slitta, la scansione
  va rifatta sui contenuti nel frattempo cambiati.
