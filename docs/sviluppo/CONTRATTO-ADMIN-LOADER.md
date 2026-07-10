# Il contratto del workspace duplicato tra admin e loader — censimento e piano

Nato dalla code review del 9 luglio 2026 (scheda
`archived/code-review-2026-07-09/04-struttura-scorporo-admin.md`, punto 4). Questo documento spiega
cos'è il "contratto" duplicato, censisce le copie, descrive cosa succede quando divergono, elenca
le recinzioni già in piedi e le strade per chiudere il debito.

## Di cosa parliamo

Due parti del motore devono conoscere **la stessa cosa**: com'è fatto un workspace su disco e cosa
rende validi i suoi file.

- Il **loader** (`src/mocks/endpoint-loader.js` e vicini): legge il workspace e costruisce le rotte
  servite dal runtime. Per lui un file invalido va scartato con un errore aggregato nei
  `loadErrors`.
- L'area **admin** (`src/admin/*`): crea, modifica, elenca e cancella quegli stessi file via API.
  Per lei un input invalido va rifiutato con un errore HTTP 400.

Questa conoscenza — chiamiamola *il contratto del workspace*: suffissi dei nomi file, struttura
delle cartelle, regole di validazione di endpoint e response, guardie anti path-traversal — oggi è
**implementata due volte**, in copie scritte indipendentemente. Le copie al momento concordano
(verificato dalla review, funzione per funzione), ma niente le tiene allineate se non la
disciplina di chi le modifica.

## Perché non è urgente (stato al 9-10 lug 2026)

Non è un bug: è **debito di manutenzione**. Il rischio è tutto nel futuro, e tre recinzioni sono
già in piedi:

1. l'unica divergenza reale trovata (l'admin rifiutava in lettura `response.file` con
   sottocartelle, che il loader accetta e serve — spegneva l'intero catalogo admin) è stata
   **fixata** il 9 lug, allineando testualmente la regola admin a quella del loader;
2. esiste un **test di equivalenza** (`test/mock-catalog-listing.test.js`): lo stesso workspace con
   asset in sottocartella deve passare sia dal loader sia dal listing admin — fa da guardia alla
   regola più delicata;
3. il listing admin ora **degrada per-endpoint** (un file illeggibile viene saltato e segnalato in
   `loadErrors`, non spegne più il catalogo), come già faceva il runtime: una futura divergenza
   farebbe meno danno.

In più, due pezzi del cluster sono già stati unificati: la busta transazionale di rollback (ora
un solo `commitWithRollback` in `admin-fs.js`) e il default-trappola di `resolveAdminFilePath`.

## I due modi in cui una divergenza farebbe male

- **L'admin scrive ciò che il loader non carica**: es. un cambio di suffisso o della convenzione
  delle cartelle aggiornato solo lato admin → l'endpoint compare nel catalogo ma il runtime non lo
  scansiona: **a catalogo ma mai servito, senza alcun errore**. È il sintomo peggiore perché è
  silenzioso.
- **Il loader serve ciò che l'admin rifiuta**: file validi per il runtime che l'admin non sa
  leggere o elencare. Era il bug fixato il 9 lug; oggi, grazie alla degradazione per-endpoint,
  il danno residuo sarebbe un endpoint mancante dal catalogo con segnalazione, non un catalogo morto.

## Censimento delle duplicazioni (dalla review, aggiornato)

I dettagli forensi (righe esatte, verdetti) sono nella scheda 04 §4; qui l'elenco ragionato:

1. **Costanti di layout in tre posti**: `ENDPOINT_SUFFIX`, `RESPONSE_SUFFIX`,
   `RESPONSES_DIR_SUFFIX` definite in `src/admin/mock-ids.js` e (con un rename) in
   `src/mocks/data-file-usage.js`, mentre `endpoint-loader.js` le esporta già tutte. Idem
   `extractMethodFromEndpointFileName` (copia in `src/admin/endpoint-files.js`). *È il punto più
   pericoloso: un cambio di convenzione aggiornato in una copia sola produce il sintomo silenzioso.*
2. **Doppio validatore del formato**: `normalizeEndpointConfig`/`normalizeEndpointResponse`
   (admin, `endpoint-files.js`) vs `validateEndpointConfig`/`validateMockResponse` (loader).
   Stesse regole, stili diversi (l'admin si ferma al primo errore, il loader li aggrega tutti).
   `HTTP_METHOD_PATTERN` duplicato.
3. **Prologo metodo+path in quattro copie** su tre moduli admin (la sequenza "metodo valido →
   path non vuoto → formato path" wrappata in 400).
4. **Guardia anti path-traversal in due copie**: `isInsideDir` (admin, `mock-ids.js`) vs
   `assertInsideDir`/`resolveLocalFile` (loader). Essendo un controllo di sicurezza, due copie =
   due punti da correggere identicamente.
5. **Walk ricorsivo dei file duplicato**: `listFiles` (admin, `admin-fs.js`, con un `existsSync`
   sincrono che blocca l'event loop) vs `listEndpointFiles` (loader, async).
6. **`readJsonFile` duplicata** (differiscono solo per la factory d'errore: 400 vs `Error`).
7. **`validateHeaderValue` duplicata** (il predicato del loader non è esportato: per riusare
   bisogna prima esportare).
8. **`setHeaderCaseInsensitive` (admin) duplica `removeHeader`** di `src/utils/http-body-utils.js`.
9. **Split path/query e carattere riservato `^` ricopiati** in `route-folders.js` rispetto a
   `route-groups.js` (anche qui: simboli del loader non esportati).

Trappola trasversale: **l'omonimo `toPosixRelativePath`** — due funzioni con lo stesso nome e
semantica incompatibile (una a un argomento in `mock-ids.js`, una a due in `data-file-usage.js`).
Chi "deduplicasse" alla cieca importando quella sbagliata otterrebbe id calcolati sul percorso
assoluto, **senza errori**. Da rinominare prima di ogni consolidamento.

## Le strade per chiudere il debito

### A. Proprietario unico del contratto (la soluzione vera)

Un modulo in `src/mocks` (es. un `file-layout.js`, o l'esistente `endpoint-loader.js` che già
esporta metà dei simboli) diventa l'unica casa di: costanti di layout, predicati sui nomi file,
validatori del formato. I validatori si parametrizzano sulla **factory d'errore** (il loader passa
`Error`, l'admin passa `createAdminError(400, ...)`), così ciascun lato conserva il proprio stile
di fallimento. L'admin importa e avvolge; le copie si cancellano.

Migrazione consigliata **a gradini**, ogni gradino committabile e verificabile da solo:

1. le **costanti** (punto 1): rischio quasi nullo, elimina il pericolo peggiore — mezz'ora;
2. i **predicati semplici** (punti 4, 6, 7, 8, 9 — esportando dal loader ciò che manca, e
   rinominando prima l'omonimo `toPosixRelativePath`);
3. il **walk dei file** (punto 5), passando l'admin alla versione async del loader;
4. per ultimi i **validatori interi** (punti 2 e 3): è il gradino con più superficie — da fare con
   la suite admin-api come rete e col test di equivalenza esteso ai nuovi casi.

### B. Recinzione più larga senza rimuovere le copie (il compromesso)

Se il refactoring non si vuole pagare: estendere il test di equivalenza a un piccolo generatore di
workspace (endpoint con response di ogni tipo, asset in sottocartelle, header strani, nomi al
limite) con l'asserzione unica "tutto ciò che il loader accetta, l'admin lo elenca e lo rilegge".
Non elimina la doppia manutenzione, ma trasforma la divergenza da sintomo silenzioso a test rosso.

### C. La regola d'ordine (vale comunque, qualunque strada si scelga)

**La prima modifica al formato del workspace o alle regole di validazione si fa DOPO il gradino 1
(costanti) e idealmente dopo il gradino relativo all'area toccata.** È esattamente il momento in
cui la duplicazione morde; pagare il debito a ridosso di quella modifica è il miglior rapporto
rischio/beneficio, pagarlo "a freddo" è manutenzione pura, rimandarlo oltre quella modifica è il
modo in cui nasce il sintomo silenzioso.
