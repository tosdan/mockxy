# Piano — Mockxy pilotabile da agent e test tramite API

Data: 26 settembre 2026. Stato: **piano e contratti di implementazione definiti; implementazione non iniziata**.

Base esaminata: `ace8860c9d5b2d019147e0a090bad9ab1c0d5713`.
Fonti: [analisi aggiornata](ANALISI-PILOTAGGIO-DA-AGENT.md) e [review con arbitraggio D01–D04](REVIEW-ANALISI-PILOTAGGIO-DA-AGENT.md).

Il §13 fissa i contratti osservabili e i casi limite dei passi S0–S8. È parte vincolante del piano, insieme ai criteri di accettazione: nomi, default, status ed effetti non sono alternative lasciate a chi implementa. D01–D04 restano prevalenti. Le API nuove descritte qui sono **da implementare**, non disponibili nella base esaminata.

Restano liberi struttura dei moduli, nomi interni, organizzazione dei test e ottimizzazioni che preservano questi contratti. Un limite scoperto nel codice che richieda un comportamento diverso va riportato nel piano prima di cambiare il contratto; non va risolto con un default implicito.

## 1. Risultato da ottenere

Un agent o un test prepara via API le condizioni necessarie al proprio scenario, attende un esito verificabile e prova il comportamento del frontend. Il setup funziona anche se la sessione precedente ha lasciato altre varianti selezionate o altri flag attivi. La GUI può restare aperta e mostrare i cambiamenti senza perdere bozze o interrompere stream invariati.

Il primo caso completo è **leggere → preparare/aggiornare varianti → configurare e attivare lo scenario → verificare**. Il ripristino della sessione precedente non fa parte del risultato richiesto. Playwright è uno dei client possibili per i test browser; non occorre un SDK o un protocollo dedicato all'agent.

### Decisioni vincolanti

| Decisione | Conseguenza implementativa |
|---|---|
| D01 — collaborazione B | Serializzazione delle mutazioni API e controllo della revisione sulle bozze; conservazione di bersaglio e contenuto del form su aggiornamenti esterni |
| D02 — stream invariati | Reload e preparazione di varianti inattive non chiudono SSE/WS estranei al cambiamento attivo |
| D03 — ordine | Prima mock esistenti, poi traffico → mock, infine modifiche alla configurazione runtime |
| D04 — setup esplicito | Nessun undo, snapshot di sessione o ripristino protetto dedicato; il client imposta ciò che serve al test |

Restano fuori: merge automatico delle bozze, coordinamento distribuito tra processi, isolamento automatico fra test concorrenti sulle stesse risorse, nuove API batch generali per gli scenari, MCP, gestione del contenitore desktop. Le revisioni proteggono dagli incidenti; chi modifica lo stesso scenario mentre viene provato deve coordinarsi.

Il rollback interno di una mutazione fallita rimane nel contratto delle operazioni che lo promettono. È diverso dall'annullare un lavoro riuscito.

**Terminologia operativa:** per lo scenario selezionato, il perimetro delle varianti attive comprende la variante selezionata e, se è una sequence, tutte le varianti referenziate dai suoi step. Il loader le carica e può servirle senza un ulteriore cambio di selezione. “Inattiva” significa quindi non selezionata **e non referenziata dalla sequence selezionata**; l'effettivo serving dipende inoltre da abilitazione dell'endpoint e modalità del server. Modificare uno step non selezionato può cambiare le risposte del frontend. Oggi gli step ammettono solo mock e handler, non SSE/WS: questa precisazione non estende il formato delle sequence.

## 2. Ordine di consegna e dipendenze

Ogni passo è un insieme di modifiche verificabile e può essere suddiviso in commit piccoli. I passi non sono tutti necessari per pubblicare una singola correzione, ma **S0–S6 insieme completano il primo caso d'uso approvato**.

| Passo | Risultato | Dipendenze | Stato |
|---|---|---|---|
| S0 | Correggere default, namespace admin e guardia del contratto | Nessuna | Da fare |
| S1 | Serializzare mutazioni e rendere affidabili esiti/reload | S0 | Da fare |
| S2 | Esporre identità, configurazione effettiva e diagnostica | S1 per gli esiti coerenti | Da fare |
| S3 | Leggere/preparare varianti inattive e preservare stream | S1 | Da fare |
| S4 | Proteggere bozze e sincronizzare GUI senza perderle | S1–S3; bozza stabile prima del polling del dettaglio | Da fare |
| S5 | Rendere il Monitor interrogabile e la perdita di traffico rilevabile | S2 per l'identità runtime | Da fare |
| S6 | Consegnare setup ripetibile, esempio Playwright e flusso nello skill | S0–S5 | Da fare |
| S7 | Centralizzare creazione di mock dal traffico | Primo caso completato | Successivo |
| S8 | Consentire modifiche effimere della configurazione runtime | S7 secondo D03 | Successivo |

Documentazione, OpenAPI e test dei contratti cambiano nello stesso passo dell'implementazione. Il numero 49 descrive la base attuale, non è un numero da congelare nei test. Le note di rilascio e la matrice documentale del §12 fanno parte della consegna di ogni passo, non di un riallineamento successivo.

## 3. S0 — Fondamenta dell'admin API

**Modifiche.** Correggere il fallback di `ADMIN_API_ENABLED` in `loadConfig` senza perdere gli override espliciti. Aggiungere un 404 JSON finale al router admin prima del serving ordinario. Aggiungere il confronto metodo/percorso router–OpenAPI e allineare le rotte già esistenti nelle guide IT/EN e nella reference dello skill.

Il controllo sulle chiamate della UI resta una convenzione verificabile: includere i trasporti usati intenzionalmente e non presentarlo come prova di equivalenza dei comportamenti.

**Migrazione da dichiarare nello stesso passo:** il fix del default accende l'admin in development anche per chi finora avviava senza flag e si affidava al comportamento difettoso. Il [Dockerfile di sviluppo](../../Dockerfile) imposta `HOST=0.0.0.0`; senza compose, flag esplicito o `NODE_ENV=production`, il nuovo default rende quindi l'admin raggiungibile attraverso le porte pubblicate. Su bind non loopback la guardia Host interviene solo se è configurata un'allowlist esplicita. Documentare `ADMIN_API_ENABLED=false` per mantenere l'admin spenta, e il port mapping su loopback per l'uso locale. Verificare l'avviso all'avvio già presente. La [standalone](../../Dockerfile.standalone) e i compose dei test che impostano il flag esplicitamente devono mantenere il comportamento scelto. Il 404 conclusivo riserva il namespace admin e interrompe eventuali dipendenze dal precedente fallthrough: dichiararlo nelle note, senza conservarlo come compatibilità.

**Punti del codice:** [config.js](../../src/config.js), [admin-api.js](../../src/admin/admin-api.js), [app.js](../../src/app.js), [OpenAPI](../admin-api.openapi.yaml), [test del contratto](../../test/admin-openapi-contract.test.js).

**Accettazione:**

- Senza flag o `.env` interferenti: admin attiva in development e disattiva in production; valori espliciti prevalenti. Coprire anche bind `0.0.0.0`, avviso iniziale e comportamento della guardia Host con/senza allowlist; controllare Docker di sviluppo senza compose e standalone con flag esplicito.
- GET e POST sconosciute sotto `/_admin/api` restituiscono l'errore admin e non raggiungono un backend sentinella, anche con fallback attivo.
- Aggiungere o togliere un'operazione da un solo lato router/spec fa fallire il confronto.

## 4. S1 — Mutazioni serializzate ed esito applicato

**Gate.** Una mutazione API alla volta per workspace. Usare una coda esterna distinta da quella non rientrante delle collezioni. Il turno comprende letture, controlli, scritture, reload, validazione e rollback eventuale. Un errore non deve bloccare le richieste successive. La disconnessione del client non deve liberare la coda mentre l'operazione sta ancora scrivendo: la durata segue l'operazione, non soltanto gli eventi del socket HTTP. Il serving ordinario e le letture informative rimangono concorrenti. Le letture che restituiscono una bozza con il suo token usano invece una breve sezione coerente nello stesso gate (§13, C1/C4).

**Reload.** Esaminare tutte le quindici rotte censite. Le sette lacune note sono: toggle endpoint/collezione, delete endpoint/contenuto collezione, import OpenAPI, creazione dallo storico, rinomina dati con riscrittura. Non basta controllare una promise rigettata: il reload risolve anche con esito negativo.

| Tipo di operazione | Garanzia da implementare |
|---|---|
| Mutazione singola con backup | Fallimento globale o errore sulle risorse coinvolte → errore e rollback; verificare anche l'esito del rollback |
| Toggle di massa | Validare tutte le risorse coinvolte e ripristinare il gruppo sul fallimento previsto dal contratto |
| Eliminazione/rinomina | Verificare l'effetto finale sulle risorse/rotte coinvolte; non cercare soltanto errori su un percorso ormai eliminato |
| Import/creazione dallo storico | Conservare gli esiti parziali intenzionali, distinguendo elementi scritti da elementi applicati e rendendo esplicito un fallimento del reload finale |

Un errore su un endpoint estraneo non deve far fallire indiscriminatamente una mutazione valida. Il contratto garantisce coerenza al termine, non una transazione isolata per tutto il traffico durante il batch. Se anche il recupero fallisce, l'API segnala lo stato incerto/degradato; non dichiara un rollback riuscito.

Correggere subito `saveDescription` perché invii solo `description`, eliminando la riabilitazione involontaria tramite il vecchio `enabled`. Simmetricamente, il toggle GUI invia soltanto `enabled`: non reinvia una descrizione letta prima dell’azione.

**Punti del codice:** [admin-fs.js](../../src/admin/admin-fs.js), [endpoint-operations.js](../../src/admin/endpoint-operations.js), [collection-operations.js](../../src/admin/collection-operations.js), [openapi-admin-import.js](../../src/admin/openapi-admin-import.js), [dump-to-mock.js](../../src/admin/dump-to-mock.js), [server.js](../../src/server.js), [store GUI](../../mockxy-ui/src/app/pages/mocks-next/mocks-next.store.ts).

**Accettazione:** riprodurre il caso dell'handler non compilabile e del toggle; verificare interleaving di due mutazioni, recupero da errore e disconnessione del client; un GET informativo resta possibile mentre è in corso una mutazione; una lettura di bozza attende se necessario per restituire contenuto e token coerenti. I test non devono confondere un errore estraneo con un errore sulla risorsa modificata. Verificare separatamente delete, rinomina e batch parziali.

## 5. S2 — Identità, contratto distribuito e diagnostica

**Superficie API da implementare:**

| Rotta | Contenuto e funzione |
|---|---|
| `GET /_admin/api/info` | Versione, `runtimeId`, avvio, workspace/percorsi canonici, indirizzo effettivo, watcher e revisioni leggere delle risorse osservabili |
| `GET /_admin/api/config` | Configurazione effettiva ammessa, in sola lettura; nessuna esportazione indiscriminata dell'ambiente |
| `GET /_admin/api/runtime/status` | Esito del caricamento iniziale/ultimo reload, applicazione completa/degradata/fallita ed errori per endpoint |
| `GET /_admin/api/openapi.yaml` | Contratto della versione in esecuzione, disponibile anche dal pacchetto desktop |

Separare la diagnostica dettagliata dal riepilogo piccolo evita di scaricare tutti gli errori a ogni polling. Il §13, C2 fissa campi e semantica da riportare nell'OpenAPI del passo; queste rotte non sono ancora disponibili.

Il `runtimeId` cambia a ogni avvio; l'identità del workspace resta distinta. Per headless senza marker usare i percorsi reali delle directory configurate, senza inventare una radice desktop. Riportare l'indirizzo realmente in ascolto anche quando la porta assegnata differisce da quella richiesta.

Conservare tentativo di caricamento, ultima applicazione e diagnostica per file. Indicare per le definizioni in errore se è stata mantenuta la vecchia rotta oppure non è disponibile. Aggiornare questo stato anche se il comportamento servito è invariato; dopo una correzione riuscita rimuovere l'errore corrente. Non introdurre uno storico illimitato dei tentativi.

Distinguere revisioni per catalogo, modalità server, dump, diagnostica e configurazione. Il token del catalogo deve cambiare anche per metadati/varianti inattive; non può essere derivato solo dal comportamento attivo. Calcolare le informazioni durante le operazioni/scansioni pertinenti, senza rileggere l'intero workspace a ogni ping. Per risorse non coperte da eventi affidabili, usare una rilettura mirata all'apertura/focus finché non esiste una revisione attendibile.

Il primo GET distingue valori di avvio, effettivi e override runtime (§13, C2/C8). La provenienza dettagliata CLI/env/default è esclusa da questa consegna.

**Distribuzione dello spec:** spostare la fonte canonica da `docs/admin-api.openapi.yaml` a `src/admin/admin-api.openapi.yaml` durante S2. È un percorso pianificato, non ancora esistente. [.dockerignore](../../.dockerignore) esclude `docs/`, mentre Docker include `src/` ed Electron copia `../src`: la collocazione proposta copre entrambi i pacchetti. Risolvere il file rispetto al modulo server, senza dipendere dalla cwd o dal checkout. Mantenere una sola fonte modificabile; aggiornare insieme lo script [validate-admin-openapi.js](../../scripts/validate-admin-openapi.js), i test di parità, i link delle guide IT/EN, le reference degli skill e gli esempi correnti dell'analisi. I documenti storici possono conservare il vecchio percorso qualificato come storico; non mantenere una seconda copia in `docs/`: aggiornare i collegamenti alla fonte in `src/`.

**Accettazione:** handler invalido all'avvio e dopo reload visibile via API; caso con rotta mantenuta e caso senza rotta; errore risolto; nuovo `runtimeId` dopo restart; identità corretta anche con più runtime; spec leggibile sia nel layout Electron sia nell'immagine Docker di sviluppo senza checkout o `docs/`, uguale alla fonte validata. Nella standalone il file può essere presente, ma la rotta deve restare disabilitata con l'admin. La GUI userà questa diagnostica in S4.

## 6. S3 — Varianti inattive e stream preservati

Aggiungere `GET /mocks/:id/responses/:file` con il contenuto della variante richiesta e gli stessi criteri di sicurezza dei percorsi esistenti. Per asset binari esporre i metadati appropriati, senza convertirli implicitamente in grandi payload JSON. Aggiungere `select: false` alla creazione di varianti; per compatibilità il valore omesso conserva l'attuale selezione automatica. GUI e skill devono scegliere esplicitamente la preparazione senza attivazione quando è l'intento.

La variante preparata va validata anche quando non è attiva: la sola riuscita del reload della variante selezionata non dimostra che un nuovo script o una sequence inattiva sia valida. Questo è un contratto della scrittura via API, non un cambiamento implicito del caricamento passivo da disco: una variante esclusa dal perimetro attivo può restare incompleta sul filesystem finché non viene attivata. Uno step della sequence selezionata fa invece parte del perimetro attivo e viene già caricato/validato.

Non azzerare cursori o memoria soltanto perché è stata creata una variante realmente inattiva. Per preparare senza effetti una modifica a uno step attivo, creare una variante separata non referenziata; se necessario preparare anche una sequence alternativa, senza riscrivere gli step della sequence in uso. Verificare le dipendenze attive prima di chiamare “non invasivo” un aggiornamento per filename.

Riconciliare gli stream per endpoint confrontando disponibilità e scenario attivo. Gli store aggiungono la chiusura per chiave; lo shutdown continua a chiudere tutto. SSE/WS hanno definizioni dichiarative: confrontare i campi che governano copione/regole/chiusura, escludendo descrizione, titolo e preset della console. Applicare la tabella del §13, C3 anche a cambio di variante attiva, disabilitazione, eliminazione e vecchia rotta mantenuta su errore: due filename diversi con la stessa definizione effettiva preservano gli stream.

Non serve impedire ogni scansione duplicata del watcher. Serve che una scansione senza cambiamenti pertinenti non provochi chiusure né revisioni fittizie del comportamento. Gli aggiornamenti di catalogo e diagnostica restano indipendenti.

**Punti del codice:** [mock-catalog.js](../../src/admin/mock-catalog.js), [endpoint-operations.js](../../src/admin/endpoint-operations.js), [server.js](../../src/server.js), [sse-connections.js](../../src/mocks/sse-connections.js), [ws-connections.js](../../src/mocks/ws-connections.js).

**Accettazione:** leggere una variante inattiva non cambia selezione; creazione `select: false` non cambia risposta o scenario corrente; input invalido rifiutato dalla scrittura API anche se inattivo, senza introdurre la validazione globale delle varianti non caricate dal filesystem. Aggiungere un caso in cui si modifica una variante non selezionata usata da uno step attivo: il cambiamento deve essere riconosciuto come modifica dello scenario; preparare la variante separata lascia lo scenario invariato. Stream SSE e WS aperti sopravvivono a descrizione, variante inattiva sullo stesso endpoint, endpoint estraneo ed eco del watcher. Cambiamenti allo scenario attivo chiudono soltanto le connessioni interessate; gli store e lo shutdown non lasciano connessioni residue.

Una rotta di reload esplicito per writer esterni è esclusa da S0–S8. Le mutazioni API attendono già l’applicazione necessaria; non aggiungere `POST /runtime/reload` come dipendenza del setup.

## 7. S4 — Protezione delle bozze e sincronizzazione GUI

**Contratto di scrittura.** Restituire token opachi per revisione della descrizione e della singola variante. La revisione della variante copre il contenuto realmente riscritto, inclusi sorgenti o asset pertinenti; non basta l'hash del solo endpoint. Token e contenuto letti devono appartenere allo stesso snapshot logico rispetto alle mutazioni API.

**Strategia del token:** usare SHA-256 sul contenuto con serializzazione deterministica dei dati pertinenti, identità della risorsa e versione del formato del token. Per la descrizione coprire il solo campo; per la variante includere sorgenti/asset effettivamente modificati dall'operazione. Legare il token ai contenuti letti e ricontrollarlo nello stesso turno del gate che scrive; una lettura composta non deve restituire contenuto e token di due versioni API diverse.

Per asset grandi calcolare l'hash sui byte anche in streaming. `mtime + dimensione` non è una precondizione affidabile: contenuti diversi possono conservare entrambi i metadati. Può aiutare un'ottimizzazione solo se non sostituisce il confronto del contenuto al salvataggio; l'euristica della cache degli script non è automaticamente un contratto adatto a evitare sovrascritture.

I token descrivono il contenuto corrente, non la cronologia: tornare allo stesso contenuto può produrre lo stesso token. Lo stesso workspace/risorsa con contenuto e formato invariati conserva il token dopo un riavvio. Una modifica esterna persistente al momento del confronto può così essere rilevata, ma un writer esterno che scrive dopo il controllo resta fuori dal gate e dalla garanzia D01.

Per i payload JSON usare `expectedRevision`, verificata dentro il gate prima della scrittura; conflitto `409` distinguibile dagli altri conflitti esistenti. Il controllo rimane facoltativo per i client precedenti e obbligatorio nei salvataggi da bozza della GUI e nel flusso di editing dello skill. Per gli upload raw che modificano la variante usare `X-Mockxy-Expected-Revision`, con lo stesso conflitto `409 REVISION_CONFLICT`; non usare `If-Match` e non inserire dati di controllo nel file caricato. Ambito e regole sono fissati nel §13, C4.

Tutti i percorsi che modificano la risorsa devono aggiornare/influenzare la sua revisione, compresi upload e forma legacy di `PUT /mocks/:id` che modifica la risposta ordinaria selezionata. Anche il percorso legacy deve onorare la precondizione quando inviata. La selezione come azione immediata non acquisisce una precondizione dedicata al ripristino.

**Bozza.** All'apertura conservare endpoint, variante, contenuto e revisione iniziali. Un aggiornamento remoto non cambia questi riferimenti. Al conflitto preservare il testo locale, permettere di consultare la versione corrente e scegliere fra ricarica e confronto con successivo salvataggio deliberato contro la nuova revisione, secondo §13, C4. Nessun merge automatico. Aggiornare descrizione, form della variante e dialog sequence; una modifica al body di A non deve finire in B dopo un cambio remoto di selezione.

**Sincronizzazione.** Introdurla soltanto con queste protezioni già collegate. Rilettura immediata al focus/ritorno visibile; polling del riepilogo ogni 2 secondi mentre la finestra è visibile, senza richieste sovrapposte. Rileggere i dettagli quando cambia la revisione pertinente. Obiettivo iniziale di verifica: cambiamenti visibili entro 5 secondi in una sessione locale con richieste riuscite; errori di collegamento mostrati come stato non aggiornato. Intervallo e margine sono parametri tecnici del piano, non una garanzia in presenza di rete indisponibile.

Al nuovo `runtimeId` risincronizzare le risorse, lo stato runtime e i cursori del Monitor; verificare che l'istanza corrisponda ancora al workspace richiesto. Conservare le bozze e i token basati sul contenuto: il solo riavvio non li invalida, mentre contenuto/identità/formato diversi richiedono il confronto o la riconciliazione appropriati. La status bar mostra gli errori del runtime oltre a quelli del catalogo. Riletture in ritardo non devono sovrascrivere risposte più recenti; chiudere polling/subscription allo smontaggio dello store interessato.

**Punti UI:** [mocks-next.store.ts](../../mockxy-ui/src/app/pages/mocks-next/mocks-next.store.ts), [response-draft.ts](../../mockxy-ui/src/app/pages/mocks-next/detail/response-draft.ts), [dialog sequence](../../mockxy-ui/src/app/pages/mocks-next/sequence/mocks-next-sequence-dialog.ts), [server-status.store.ts](../../mockxy-ui/src/app/shared/server-status.store.ts), [monitor-dump.store.ts](../../mockxy-ui/src/app/shared/monitor-dump.store.ts), [workspace-summary.store.ts](../../mockxy-ui/src/app/shared/workspace-summary.store.ts).

**Accettazione:** due salvataggi dalla stessa versione producono un successo e un conflitto; varianti diverse non confliggono; descrizione non riabilita l'endpoint; bozza A resta A mentre l'agent attiva B; riconnessione mostra Proxy All corretto senza refresh manuale; diagnostica cambia anche con vecchia rotta ancora servita. Verificare anche keyboard/focus e stringhe IT/EN della gestione conflitti, secondo le istruzioni UI. Aggiungere prove di token stabile dopo restart a contenuto invariato, contenuto diverso della stessa lunghezza con mtime conservato, descrizione invariata con toggle esterno e lettura/salvataggio concorrenti: nessun falso successo ottenuto da token calcolati su dati diversi da quelli letti.

## 8. S5 — Monitor interrogabile

Estendere la lista con la modalità esplicita `view=page`, filtri, `limit` predefinito 50 e massimo 250, proiezione sommario senza body, cursore e lettura per ID (§13, C5). Validare i parametri supportati invece di ignorarli silenziosamente. I percorsi statici come `/stream` devono restare distinti dalla rotta parametrica del dettaglio.

Definire `since` come ID strettamente maggiore nel runtime indicato. Per le pagine incrementali restituire in ordine crescente e avanzare il cursore senza saltare le voci non ancora restituite. Conservare la vista corrente `{items}` più-recente-prima per le chiamate senza query e il protocollo SSE esistente. La nuova busta e l’ordine crescente si applicano solo a `view=page`; non migrare obbligatoriamente il Monitor GUI alla nuova modalità. Il cursore deve avere una semantica precisa anche quando un filtro non trova corrispondenze.

La busta deve permettere di distinguere runtime, intervallo disponibile, pagina successiva e perdita (`gap`). Gestire espulsione, `clear` anche a buffer vuoto e riavvio. Il dettaglio di un ID non disponibile restituisce un errore esplicito; i body troncati restano riconoscibili. Non si trasforma il Monitor in un archivio durevole: per quello esiste il dump.

**Punti del codice:** [request-monitor.js](../../src/monitoring/request-monitor.js), [admin-api.js](../../src/admin/admin-api.js), service/types Angular e pagina Monitor.

**Accettazione:** filtri realmente applicati; nessun body nel sommario; due o più pagine senza buchi/duplicati introdotti dalla paginazione; nuovo traffico durante la lettura; cursore espulso, clear e restart riconoscibili. “Nessun elemento” non deve essere usato per concludere “nessuna richiesta” quando c'è un gap. Long polling rinviato.

## 9. S6 — Primo caso completo: setup ripetibile via API

Realizzare un helper di test/esempio come composizione di chiamate HTTP esistenti ed estese; non è una nuova API server di scenari. Identificare il runtime/workspace e selezionare risorse per ID/filename risolti, senza dipendere dalla selezione corrente o da titoli non univoci. Prima di modificare una variante per prepararla, verificare anche se è uno step della sequence selezionata: “non selezionata” non significa necessariamente “inattiva”.

Un setup esemplificativo per una feature deve:

1. Verificare identità dell'istanza e configurazione richiesta dal test. Parametri di avvio non ancora mutabili vanno predisposti dall'ambiente di test, con errore esplicito se non corrispondono.
2. Leggere e preparare/aggiornare le varianti necessarie, con revisione attesa e `select: false` sulle creazioni. Se occorre evitare effetti sullo scenario in uso, preparare varianti separate dagli step attivi. Se l’esito di una creazione è incerto, rileggere prima di ritentare; non duplicare varianti alla cieca.
3. Dopo il successo della preparazione, impostare `serverEnabled: true` e `proxyAll: false` se il caso richiede i mock; selezionare le varianti previste, abilitare gli endpoint necessari e impostare le altre condizioni da cui dipende il test.
4. Per una sequence, selezionarla e chiamare il reset esplicito anche se era già selezionata. Per stato condiviso, resettare solo le risorse pertinenti e inizializzarle attraverso il comportamento previsto dagli handler.
5. Attendere e controllare gli esiti delle mutazioni; non usare un ritardo fisso per sperare che il watcher abbia finito. Eventuali letture amministrative di verifica non devono consumare uno step della sequence prima del test.
6. Ottenere un riferimento al Monitor prima dell'azione del browser, eseguire l'azione e verificare risposta e traffico attesi senza includere richieste di una prova precedente.

**Limite già individuato:** il reset sequence azzera anche la memoria handler di quell'endpoint, ma oggi richiede una sequence selezionata; non è un reset generale di qualsiasi handler ordinario. Non promettere ripetibilità universale di stato locale arbitrario. Il primo esempio usa mock statici e sequence; i casi con stato condiviso usano i reset disponibili; per un handler con memoria locale non azzerabile usare un runtime di test isolato/fresco oppure documentare il reset specifico del workspace. Una nuova rotta di reset va motivata da un caso concreto, non introdotta come undo implicito.

**Prova centrale:** partire una volta con altre varianti attive e una volta con endpoint disabilitati/Proxy All attivo; eseguire lo stesso setup e ottenere lo stesso risultato browser. Ripetere senza ripristinare lo stato iniziale nel mezzo. Affiancare un caso sequence già consumata che riparta correttamente dopo il setup.

Usare un workspace di prova, non il workspace di sviluppo dell'utente. La suite attuale [Playwright](../../playwright.config.js) esegue con un worker e usa helper di reset: aggiungere il caso senza trasformare quei reset di fixture in una funzionalità pubblica di undo. Non migrare tutta la suite. Le esecuzioni parallele che mutano gli stessi mock devono usare risorse/istanze distinte o essere serializzate.

**Skill e documentazione.** Aggiornare il flusso di `mockxy-workspace/SKILL.md` e verificare i contratti degli altri tre skill (`mockxy-static-mock`, `mockxy-realtime-mock`, `mockxy-dynamic-mock`) secondo la matrice del §12: bivio offline/live, identità dell'istanza, lettura/preparazione/attivazione e dipendenze sequence, revisioni sulle bozze, conferma dell'applicazione e retry. Gli aggiornamenti delle singole semantiche accompagnano S2–S4, non aspettano tutti S6. Includere un esempio Playwright di setup esplicito senza obbligo di ripristino. Le guide utente e gli errori visibili cambiano in IT/EN; il piano interno rimane in italiano.

**Uscita del primo caso:** tutte le verifiche S0–S6 superate, API documentate e disponibili nel desktop, esempio ripetibile eseguibile, nessun requisito di undo. I dati da disco fuori dalla coda HTTP e i limiti della memoria runtime sono dichiarati.

## 10. S7 — Secondo caso: creare dal traffico

Centralizzare la trasformazione usata da Monitor e Storico: percorso, header da escludere, body incompleto/binario e descrizione della bozza. Introdurre `POST /monitoring/requests/create-mocks` con il contratto del §13, C7 e strategia `skip`/`add-variant` esplicita e opzione di selezione delle varianti aggiunte; nel flusso di preparazione usare variante inattiva. Per nuovi endpoint dichiarare esplicitamente l'abilitazione desiderata, evitando di nascondere l'attivazione dietro una semplice cattura.

Ogni elemento restituisce esito e identificatori: creato, variante aggiunta, saltato, cattura non disponibile, incompleto o fallito. Un body non ricostruibile non viene presentato come riproduzione fedele. Applicare lo stesso vocabolario degli esiti allo Storico preservando i campi compatibili; la GUI usa il server e rimuove la trasformazione duplicata.

**Accettazione:** cattura valida, endpoint esistente per entrambe le strategie, più catture sullo stesso endpoint, cattura espulsa, body troncato/binario, headers mascherati, risultati parziali e variante aggiunta senza cambio di selezione. Nessun retry cieco quando manca la risposta al batch.

## 11. S8 — Terzo caso: condizioni runtime

Aggiungere `PATCH /config` con `set`/`unset` e la whitelist del §13, C8 per le leve supportate: backend, fallback, CORS, ritardo globale/estensione al proxy, timeout, filtri, adattamento cookie e redirect. Validazione completa prima dell'applicazione; nessun effetto parziale di un PATCH invalido. I limiti del dump si estendono sulla sua API esistente, con validazione coerente.

Override effimeri, rimovibili e dichiarati come tali. Distinguere valori di avvio da valori effettivi; mostrare gli override nella GUI desktop/browser. Un riavvio li elimina. Ogni richiesta acquisisce uno snapshot coerente; le connessioni già aperte non vengono migrate su un nuovo backend. Host, porta e persistenza restano fuori.

**Accettazione:** richiesta in attesa di un ritardo mentre cambia il backend; nessun miscuglio fra vecchia e nuova configurazione; PATCH invalido senza effetti; reset degli override e restart; indicazione GUI del valore effettivo; test di latenza e timeout senza aspettative dipendenti da timing troppo stretto.

## 12. Verifica e manutenzione del contratto

### Matrice dei documenti da aggiornare con il codice

| Destinazione | Contratto da riallineare | Passo |
|---|---|---|
| [RESPONSE IT](../it/RESPONSE.md) e [EN](../en/RESPONSE.md) | Chiusura mirata SSE/WS; varianti attive tramite sequence; validazione API distinta dal caricamento da disco | S3 |
| [ADMIN-API IT](../it/ADMIN-API.md) e [EN](../en/ADMIN-API.md) | Rotte, `select: false`, revisioni/esiti, nuovo percorso canonico OpenAPI e Monitor | S0–S5, poi S7/S8 |
| [workspace/SKILL.md](../../../mockxy-skills/skills/mockxy-workspace/SKILL.md) e [reference API](../../../mockxy-skills/skills/mockxy-workspace/references/admin-api.md) | Flusso live, preparazione/attivazione, selezione esplicita e compatibilità quando `select` è omesso | S2–S4, completamento S6 |
| [static-mock/SKILL.md](../../../mockxy-skills/skills/mockxy-static-mock/SKILL.md), [mock-response](../../../mockxy-skills/skills/mockxy-static-mock/references/mock-response.md), [sequences](../../../mockxy-skills/skills/mockxy-static-mock/references/sequences.md) | Perimetro attivo degli step; validazione in scrittura API rispetto a caricamento passivo | S3/S6 |
| [realtime-mock/SKILL.md](../../../mockxy-skills/skills/mockxy-realtime-mock/SKILL.md), [SSE](../../../mockxy-skills/skills/mockxy-realtime-mock/references/sse-variant.md), [WS](../../../mockxy-skills/skills/mockxy-realtime-mock/references/ws-variant.md) | Sostituire “chiusura a ogni hot reload” con condizioni effettive di chiusura e mantenimento | S3 |
| [dynamic-mock/SKILL.md](../../../mockxy-skills/skills/mockxy-dynamic-mock/SKILL.md), [handler](../../../mockxy-skills/skills/mockxy-dynamic-mock/references/handler-contract.md), [shared-state](../../../mockxy-skills/skills/mockxy-dynamic-mock/references/shared-state.md) | Verificare istruzioni su handler usati come step, validazione e reset disponibili; correggere solo i contratti interessati | S3/S6 |
| [NOTE-RILASCIO-next.md](NOTE-RILASCIO-next.md) | Default admin, namespace riservato, stream, compatibilità Monitor e migrazioni dei client | S0/S3/S5 e ogni successivo cambiamento incompatibile |

Gli skill sono pubblicabili separatamente: rispettare il loro AGENTS.md e mantenerli autosufficienti, usando rimandi ad altri skill per nome senza dipendenze tra cartelle. Aggiornare i validatori solo quando cambia il contratto che controllano: la validazione più forte delle scritture API non implica da sola che il loader debba rifiutare tutte le bozze su disco.

Le note di rilascio vanno scritte al completamento del relativo cambiamento, senza presentare ora le proposte come già implementate. Evidenziare soprattutto il nuovo comportamento del default admin su bind di rete; per il Monitor dichiarare la nuova modalità `view=page` e la conservazione di forma/ordinamento delle chiamate senza query e dello stream SSE.


Per ogni passo eseguire i test mirati ai comportamenti toccati. Prima di consegnare modifiche applicative completare i controlli previsti da [CONTRIBUTING.md](../../CONTRIBUTING.md): `npm test`, test frontend e build frontend; aggiungere i test Playwright pertinenti al flusso integrato. Verificare i moduli/risorse Electron quando cambia il pacchetto. Non servono test applicativi per la sola redazione di questo piano.

| Requisito della review | Passi che lo verificano |
|---|---|
| R01 — bozze e concorrenza | S1, S4 |
| R02 — applicazione e rollback | S1, S2, S6 |
| R03 — preparazione varianti | S3, S6 |
| R04 — configurazione | S2 lettura, S8 scrittura |
| R05 — sincronizzazione | S2, S4 |
| R06 — Monitor | S5, S7 |
| R07 — identità e skill | S2, S6 |
| R08 — contratto e test | S0 e aggiornamenti in ogni passo |
| R09 dopo D04 — retry senza duplicazioni, nessun ripristino dedicato | S6, S7 |
| R10 — reload aggiuntivi senza effetti inutili | S3 |
| R11 — diagnostica runtime | S2, S4 |

Aggiornare [CONCORRENZA-ADMIN.md](../sviluppo/CONCORRENZA-ADMIN.md) insieme all'implementazione S1/S4: distinguere garanzie nuove da writer esterni e azioni immediate. Aggiornare le guide del reload/stream quando cambia la chiusura delle connessioni. Leggere le istruzioni locali degli altri repository prima di modificarne gli skill; questo piano non li ha ancora modificati.

Non c'è un ulteriore arbitraggio di prodotto pendente. Gli eventuali gap scoperti durante l’implementazione vanno risolti nel perimetro D01–D04 e dei contratti seguenti, documentando limiti reali senza introdurre funzionalità di ripristino o collaborazione più ampie per precauzione.


## 13. Contratti vincolanti e casi limite

### C0 — Convenzioni comuni

Tutti i percorsi seguenti sono relativi a `/_admin/api`. Il formato degli errori rimane `{error, message, details}`; i nuovi errori aggiungono `details.code` stabile, senza richiedere ai client di interpretare il testo. Gli esempi di campi sono prescrizioni di schema, non valori del runtime attuale. L’OpenAPI deve descrivere anche le risposte negative e i campi nullable.

Le rotte esistenti conservano status e campi positivi, salvo le modifiche dichiarate qui. Aggiungere campi è ammesso; sostituire una risposta esistente con una nuova busta non lo è. I nuovi input rifiutano campi sconosciuti, valori di tipo errato e parametri ripetuti con `400 INVALID_ARGUMENT`; le rotte legacy mantengono la compatibilità degli input precedenti. Il 404 conclusivo del namespace usa `404 ADMIN_ROUTE_NOT_FOUND`; non raggiunge il proxy né il serving dei mock.

### C1 — Serializzazione, fallimento e rollback (S1)

**Confine del gate.** Nello stesso processo, usare il percorso canonico di `mocksDir` come chiave della coda. Tutte le operazioni admin di mutazione entrano nel gate dopo parsing e limiti del body, prima di leggere lo stato che decide la scrittura. Includere controlli di revisione, flag, reset runtime e clear del Monitor; i produttori di traffico continuano a funzionare. Le chiamate interne di un batch non rientrano nella stessa coda: usano il contesto dell’operazione già acquisito. Le letture di dettaglio/variante con token entrano nel medesimo gate per la sola costruzione della risposta; `/info`, diagnostica e Monitor leggono snapshot in memoria senza attendere il batch. Nessuna garanzia tra processi distinti o contro editor esterni.

Prima di modificare file, determinare i file da ripristinare e gli endpoint interessati: anche i consumatori attivi di una variante/asset condiviso e i sorgenti riscritti da una rinomina. Il successo significa che i file sono scritti e il runtime installato riflette l’effetto richiesto sulle risorse coinvolte. Una variante inattiva deve essere validata direttamente, pur non comparendo nel runtime.

| Caso | Risposta ed effetto obbligatori |
|---|---|
| Input/variante non valido, individuato prima della scrittura | `400 MUTATION_REJECTED`; nessuna scrittura, `details.rollback: "not_needed"` |
| Risorsa inesistente o conflitto già previsto dall’API | Conservare 404/409; nessuna scrittura |
| Reload con errore sulle risorse coinvolte | Ripristinare file e ricaricare; se recupero riuscito, `400 MUTATION_REJECTED` e `details.rollback: "restored"` |
| Reload globalmente fallito o errore I/O durante la mutazione | Tentare recupero; `500 RUNTIME_APPLY_FAILED` o `500 MUTATION_FAILED`, con `rollback: "restored"` oppure `"not_needed"` se nulla era cambiato |
| Recupero dei file o del runtime fallito | `500 ROLLBACK_FAILED`, `rollback: "failed"`, cause dell’errore iniziale e del recupero in `details`; esporre nella diagnostica l’esito dell’ultimo reload e non dichiarare coerenza |
| Errore runtime su endpoint estraneo, effetto richiesto applicato | Successo ordinario; errore estraneo resta consultabile nella diagnostica |
| Commit riuscito ma costruzione del dettaglio fallita | Conservare il successo con `id` e `detailUnavailable`; non trasformarlo in errore di scrittura |

`rollback: restored` significa ritorno allo stato dei file e al comportamento servito prima dell’operazione, anche se prima esistevano errori. Non promette di riaprire stream già chiusi né di ricostruire memoria handler o step già consumati durante il tentativo. Il traffico non è isolato dalla mutazione. Un toggle di massa, una cancellazione multipla o una rinomina con riscrittura costituiscono un solo gruppo da recuperare; conservare i backup fino alla verifica finale. Per delete/disabilitazione controllare la scomparsa delle definizioni coinvolte dal registro installato, non soltanto l’assenza di errori o di una route con lo stesso method/path: un’altra definizione può subentrare legittimamente.

**Batch con risultati parziali:** import OpenAPI e creazione da traffico/dump mantengono gli elementi riusciti. Ogni elemento fallito durante la scrittura ripristina i propri file; non si annulla tutto il batch. Aggiungere `items` con identità dell’input, `id`/`responseFile` quando disponibili, `writeOutcome: created | added_variant | skipped | failed`, `runtimeOutcome: applied | not_applied | not_applicable` e `error` nullable. `not_applicable` indica un elemento saltato/fallito o una variante/endpoint preparato fuori dal serving; `applied` richiede verifica del runtime installato. I conteggi legacy conservano il significato di creazioni su disco, non certificano il serving.

Il reload finale riuscito restituisce lo status positivo esistente e `runtime.status: applied | degraded`; `degraded` segnala errori di caricamento, con `runtime.errors` e gli esiti per elemento. Un fallimento globale del reload finale restituisce `500 BATCH_RUNTIME_FAILED`, con il risultato parziale completo in `details.result`: i file riusciti restano su disco, `runtime.status: failed` e gli elementi che richiedevano applicazione sono `not_applied`. GUI e skill devono leggere questi esiti anche con HTTP 201. Il setup si ferma se una propria risorsa non è applicata. Una risposta persa non autorizza il retry cieco di una creazione.

### C2 — Identità, revisioni informative e diagnostica (S2)

**`GET /info`, 200:**

| Campo | Tipo e significato |
|---|---|
| `version` | Versione del pacchetto in esecuzione |
| `runtimeId`, `startedAt` | UUID nuovo a ogni avvio e timestamp UTC ISO 8601 |
| `workspace` | `{id, root, mocksDir, filesDir}`; percorsi assoluti canonici, `root: null` se non fornita dal workspace desktop; `filesDir: null` se non configurata |
| `listener` | `{host, port}` realmente in ascolto, incluso il caso di porta richiesta 0 |
| `watcher` | `{state, polling, lastError}`; stato `disabled \| starting \| ready \| error`, errore stringa o null |
| `revisions` | `{catalog, server, dump, diagnostics, config}`; interi monotoni nel runtime, inizializzati a 1 |

L’identità del workspace è SHA-256 della coppia canonica ordinata `[mocksDir, filesDir]`, serializzata JSON, con prefisso `workspace-v1:`. Non dipende da root desktop, porta o avvio. È un’identità della collocazione, non un UUID portabile insieme ai file. Due runtime possono avere lo stesso workspace e runtimeId diversi.

| Revisione | Incrementare quando cambia |
|---|---|
| `catalog` | Contenuto del catalogo: endpoint, collezioni/ordine, tutte le varianti anche inattive e relativi sorgenti/asset diretti; include comparsa/scomparsa/errori di lettura |
| `server` | `serverEnabled` o `proxyAll` |
| `dump` | Stato configurabile: abilitazione, intervallo, soglia e limiti; non ogni incremento dei contatori di traffico |
| `diagnostics` | Stato applied/degraded/failed, errori o disponibilità delle rotte in errore; non il solo timestamp/numero del tentativo |
| `config` | Configurazione effettiva o insieme degli override; da S8 |

Scansioni identiche e PATCH che non cambiano questi valori non incrementano revisioni. Le revisioni possono avanzare più di una volta durante un tentativo con rollback: invalidano la cache, non sono un conteggio delle azioni dell’utente. La revisione catalogo comprende i file del catalogo e le dipendenze dirette, non ogni file arbitrario leggibile da un handler. Le risorse Dati e i contatori live usano i loro endpoint e la rilettura al focus. Le revisioni informative non sono i token di scrittura C4.

**`GET /runtime/status`, 200 anche in stato degradato:** `{runtimeId, lastAttempt, lastAppliedAttemptId, errors, fatalError}`. `lastAttempt` contiene `{id, startedAt, completedAt, reason, status}`; `id` intero crescente, `reason: startup | admin | watcher`, `status: applied | degraded | failed`. Pubblicare un tentativo solo quando concluso; durante un reload rimane il precedente. `lastAppliedAttemptId` è null se nessun caricamento è stato installato. `errors` descrive gli errori dell’ultimo registro installato, con `{endpointId, filePath, message, serving}`; `endpointId` nullable se non ricostruibile e `serving: retained | missing` determinato dal registro effettivo. In caso di fallimento globale conservare quegli errori e aggiungere `fatalError: {message}` per il tentativo fallito; al successivo tentativo riuscito `fatalError` torna null. Un file corretto scompare dagli errori correnti. Non conservare uno storico dei tentativi.

**`GET /config`, 200:** `{runtimeId, startup, effective, overrides, persisted: false}`. `startup` ed `effective` contengono esclusivamente le nove chiavi di C8; assenza di backend rappresentata da null. In S2 sono uguali e `overrides` è `{}`. Flag `/server` e opzioni dump restano sulle rispettive API, senza duplicarli qui. Da S8 `overrides` contiene soltanto le chiavi impostate via PATCH. Nessuna esportazione di altre variabili d’ambiente.

**`GET /openapi.yaml`, 200:** YAML della fonte canonica confezionata con il runtime, `Content-Type: application/yaml`, medesime regole di abilitazione e accesso delle altre API admin. Nessuna generazione da un contratto diverso durante il packaging.

### C3 — Preparazione delle varianti e identità dello stream (S3)

`GET /mocks/:id/responses/:file` restituisce 200 con `{id, responseFile, selected, active, response, source, fileInfo}`. `response` è la definizione JSON della variante richiesta; `source` è il testo dello script diretto, altrimenti null; `fileInfo` è `{name, size}` per un asset binario, altrimenti null. Nessun body binario in JSON. `active` indica appartenenza alla selezione o ai suoi step, indipendentemente dai flag server; non significa “attualmente raggiungibile”. Da S4 aggiungere `revision`. Endpoint/variante assenti: 404; definizione o dipendenza illeggibile: errore esplicito 400, senza cambiare selezione.

`POST /mocks/:id/responses` accetta `select` booleano, default true per compatibilità. La risposta 201 conserva il dettaglio esistente e aggiunge `createdResponseFile`, così il client identifica la variante creata anche quando non selezionata. `select: false` non cambia selezione, cursore sequence o memoria handler; condivide la validazione delle scritture normali. Un aggiornamento di variante restituisce anche `updatedResponseFile` e, da S4, `updatedResponseRevision`, indipendenti dalla variante selezionata presente nel dettaglio legacy. La validazione copre schema, asset/sorgente diretto, compilazione e riferimenti/compatibilità degli step; non esegue l’handler per provarne tutti i possibili percorsi.

La chiave delle connessioni resta method/path. La firma confrontata deriva dalla **definizione normalizzata realmente installata**: tipo; per SSE `retryMs`, `script`, `onEnd`; per WS `script`, `rules`, `onEnd`, `closeCode`, `closeReason`. Include tutti i dati dei messaggi e i ritardi, conserva l’ordine di script/regole, considera equivalenti i default omessi ed espliciti. Non include filename, titolo, descrizione, preset della console. Il confronto riguarda il comportamento dichiarativo dello stream; non tenta di confrontare semanticamente codice handler/middleware arbitrario.

| Cambiamento rispetto al registro installato | Connessioni già aperte |
|---|---|
| Stessa firma e stessa chiave, anche selezionando un filename diverso | Conservare, senza riavviare copione o timer |
| Solo metadati, variante inattiva, endpoint estraneo, eco identica del watcher | Conservare |
| Firma diversa, tipo diverso, endpoint eliminato/disabilitato o chiave cambiata | Chiudere solo quelle della vecchia chiave interessata |
| Caricamento invalido ma vecchia rotta mantenuta identica | Conservare; diagnostica segnala `retained` |
| Shutdown | Chiudere tutte |

La chiusura mirata riusa la normale chiusura delle connessioni esistente, senza introdurre un nuovo protocollo di close. I flag globali `/server` mantengono la loro semantica corrente; questo passo riguarda la riconciliazione dei reload. Una mutazione respinta prima dell’installazione non chiude stream. Una già installata e poi recuperata segue C1: non può promettere di resuscitare connessioni chiuse.

### C4 — Token, precondizioni e conflitto della bozza (S4)

Token opaco `rev-v1:<sha256-esadecimale>` della serializzazione deterministica di: versione del formato, workspaceId, endpointId, tipo di risorsa, filename per la variante e contenuto coperto. Ordinare ricorsivamente le chiavi degli oggetti JSON; conservare ordine degli array e valori. Non usare runtimeId, timestamp, mtime o dimensione come prova di uguaglianza.

- **Descrizione:** solo valore persistito di `description`, con assenza normalizzata a stringa vuota. Un toggle o un cambio di selezione non genera conflitto.
- **Variante:** intera definizione JSON persistita, hash dei byte di sorgente diretto e asset diretto referenziati, nomi dei riferimenti compresi. Non includere selezione, endpoint.enabled, descrizione o contenuto delle varianti referenziate da una sequence. La scrittura della sequence ricontrolla comunque la validità dei riferimenti correnti; non riscrive gli step referenziati come effetto implicito. Asset condiviso cambiato significa revisione cambiata per tutte le varianti che lo referenziano.
- Script e asset si confrontano sui byte; JSON sulla rappresentazione deterministica. Differenze di sola indentazione JSON non generano conflitto. Questa è una precondizione di contenuto, non uno storico: A → B → A può restituire il token originale.

Il GET dettaglio endpoint aggiunge `descriptionRevision` e `responseRevision` per la selezionata; il GET per filename restituisce `revision`. Tutti si costruiscono da un unico snapshot rispetto al gate API. Il controllo al salvataggio rilegge il contenuto effettivo dentro il gate, senza fidarsi della cache mtime/size.

| Scrittura | Precondizione |
|---|---|
| `PUT /mocks/:id/endpoint` con description | `expectedRevision` sulla descrizione; la GUI manda soltanto description e token |
| PUT variante per filename | `expectedRevision` sulla variante indicata |
| PUT legacy endpoint che modifica il body selezionato | Stesso token variante; il token incorpora il filename e non può autorizzare la scrittura su una selezione diversa |
| Upload raw dell’asset della variante | Header `X-Mockxy-Expected-Revision`, stesso token variante |
| Selezione, toggle, reorder e reset | Nessuna nuova precondizione dedicata |

La precondizione omessa conserva il comportamento legacy. Sulle forme legacy che possono cambiare sia descrizione sia selezione/body, expectedRevision autorizza soltanto il contenuto della risorsa indicata dalla specifica operazione; rifiutare con 400 un payload protetto che mescola ambiti di revisione. Malformata: 400; non corrispondente: `409 REVISION_CONFLICT`, con `details.resource`, `expectedRevision`, `currentRevision`, nessuna scrittura/reload. Risorsa eliminata: 404, senza ricreazione automatica. Le modifiche alle risorse Dati restano fuori dalla protezione delle bozze C4; se cambiano un file che è anche dipendenza diretta, il suo nuovo contenuto influisce comunque sui token pertinenti. Le mutazioni interne non possono conservare un vecchio token dopo aver cambiato il suo contenuto.

**GUI:** ogni form mantiene `{endpointId, responseFile, baseRevision, draft}` propri. Per la descrizione non serve responseFile. Un refresh aggiorna il contesto circostante, ma non sostituisce una bozza modificata né il suo bersaglio. Al 409 mostra conflitto e conserva il testo; “Confronta” carica la versione corrente accanto alla bozza senza sostituirla; “Ricarica” sostituisce la bozza soltanto dopo conferma dell’utente se modificata. Dopo il confronto, un’azione esplicita “Salva la mia versione” usa il token della versione appena mostrata. Un’altra modifica concorrente genera un nuovo 409. Non esiste retry automatico senza precondizione. Se la risorsa è eliminata, conservare il testo copiabile e disabilitare il salvataggio sul bersaglio assente.

Il polling si attiva dopo questa gestione per descrizione, variante e dialog sequence. Una risposta relativa a un vecchio endpoint/runtime o a una richiesta superata non aggiorna il form attuale. Al restart dello stesso workspace si rileggono i valori mantenendo la bozza; su workspace diverso il salvataggio resta disabilitato finché l’utente non apre una risorsa della nuova istanza. Non trasferire silenziosamente la bozza a ID omonimi.

### C5 — Monitor: compatibilità, pagine e perdita (S5)

`GET /monitoring/requests` senza query resta `{items}`, completo e più-recente-prima. Lo stream `/monitoring/requests/stream` conserva il protocollo. La nuova modalità richiede `view=page`; nuovi parametri senza questa modalità o query sconosciute restituiscono 400.

| Parametro della modalità page | Contratto |
|---|---|
| `limit` | Intero 1–250, default 50 |
| `fields` | `summary` (default) oppure `full` |
| `method`, `path`, `status`, `source` | Filtri in AND; uguaglianza esatta. Method normalizzato maiuscolo; path è il path senza query, deve iniziare con `/`; status intero 100–599; source stringa non vuota. Assenti: nessun filtro |
| `since` | ID decimale non negativo esclusivo, oppure `latest` per iniziare dal momento corrente; assente per leggere il buffer disponibile |
| `runtimeId`, `generation` | Obbligatori con since numerico, vietati con since assente/latest; generation intero positivo |

Risposta 200: `{items, cursor, hasMore, gap, gapReason, available}`. `cursor` è `{runtimeId, generation, since}` con since stringa decimale da inviare alla richiesta successiva; `available` è `{oldestId, newestId, highWatermark}`, primi due nullable a buffer vuoto, highWatermark ultimo ID assegnato o `"0"`. `gapReason` è null oppure `runtime_changed | cleared | evicted`. Il client riusa gli stessi filtri durante una lettura incrementale; cambiarli richiede una nuova osservazione con since assente/latest, perché il cursore può aver superato voci escluse dal vecchio filtro. `limit` e `fields` possono cambiare senza ricominciare.

Gli ID sono stringhe decimali confrontate numericamente, crescenti nel runtime. `generation` parte da 1 e aumenta **a ogni clear**, anche a buffer vuoto; clear non riutilizza ID. Ogni pagina usa uno snapshot del buffer con highWatermark H. Ordine crescente; restituire fino a limit corrispondenze successive al cursore. Se restano altre corrispondenze nello snapshot, `hasMore: true` e nuovo since uguale all’ultimo ID restituito. Altrimenti `hasMore: false` e since = H, anche senza corrispondenze. Traffico successivo a H appartiene alla pagina successiva, non è perduto.

Alla prima lettura senza since, partire dal più vecchio disponibile con gap false: non si dichiara coperto il passato già espulso. `since=latest` restituisce items vuoto, gap false e cursore H. Con un cursore numerico rilevare nell’ordine runtime diverso, generation diversa, espulsione (`since < oldestId - 1`). Nei tre casi rispondere 200 con gap true, motivo esplicito e riprendere dal primo elemento ancora disponibile. Il gap va esposto anche se il buffer è vuoto; runtime e generation sono sufficienti per riconoscere restart/clear. Nel medesimo runtime/generation, since maggiore di H è `400 CURSOR_AHEAD`. Non dedurre “nessun traffico” da items vuoto se gap true.

`summary` contiene solo `id`, `timestamp`, `method`, `path`, `originalUrl`, `status`, `latencyMs`, `source`, `matchedRoutePath` e `sequenceStep`; gli ultimi due nullable. Esclude body e header. `full` usa la voce esistente, inclusi indicatori di troncamento. `GET /monitoring/requests/:id?runtimeId=...` richiede runtimeId: 409 `RUNTIME_CHANGED` se diverso, 404 `REQUEST_NOT_AVAILABLE` se espulso/cancellato/assente, altrimenti 200 `{runtimeId, item}` con voce completa. Dichiarare `/stream` e `/create-mocks` prima delle rotte parametriche applicabili.

**Esempio da testare:** buffer ID 11–15, filtro corrispondente a 12/14/15, since 10 e limit 2 → items 12/14, cursore 14, hasMore true. Seconda pagina → 15, cursore H, hasMore false. Nessuna corrispondenza → items vuoto, cursore H. Se prima della seconda pagina 15 viene espulso, la risposta deve segnalare gap, non completamento regolare. Il gap è conservativo sull’intervallo perduto anche quando non si sa se contenesse corrispondenze del filtro.

### C6 — Collaudo ripetibile del primo caso (S6)

Aggiungere un esempio Playwright con workspace di fixture isolato e ID/filename noti, risolti dal catalogo. Nessun affidamento ai titoli o alla selezione lasciata dalla prova precedente. Il fixture contiene un endpoint statico e uno sequence; l’helper configura i contenuti via API e prepara prima di attivare. Non introdurre un’API generale di scenari.

| Fixture | Preparazione ed esito atteso |
|---|---|
| `GET /agent-test/orders` | Due varianti preesistenti, target con status 200 e body `{"orders":[{"id":"o-1"}]}`, alternativa con 503. Impostare target via PUT protetto, selezionarlo, abilitare endpoint e modalità mock |
| `GET /agent-test/progress` | Step statici 202 `{"state":"pending"}` e 200 `{"state":"done"}`; sequence in quest’ordine con primo step `times: 1`, ultimo senza criterio, `onEnd: "stay"` e resetAfterMs assente. Preparare gli step, selezionare sequence, reset esplicito anche se già selezionata |

Una pagina di fixture mostra l’ordine `o-1` dopo fetch di orders e permette due fetch di progress: visualizza prima pending, poi done. L’HTML può essere fornito dall’harness Playwright; le chiamate ai due endpoint devono attraversare realmente Mockxy, senza intercettare le risposte API con Playwright. Nessuna modifica all’applicazione cliente dell’utente.

Eseguire lo stesso helper e le stesse asserzioni: (A) con variante alternativa selezionata e sequence già consumata; (B) con endpoint disabilitati e Proxy All attivo; (C) ripetendo il setup senza ripristino tra i casi. Per preparare A il test può consumare la sequence prima del setup, mai tra reset e prova. Dopo preparazione/attivazione/reset acquisire `since=latest` per il Monitor, eseguire il browser e verificare le tre richieste con status 200, 202, 200, path corretti e gap false. Il controllo amministrativo non consuma step. Le mutazioni riuscite sono la barriera di applicazione: nessuno sleep per il watcher.

L’helper fallisce con un messaggio diagnostico su workspace errato, precondizione fallita, configurazione richiesta non disponibile, risorsa non applicata o gap del Monitor. Non riprova alla cieca né risolve conflitti sovrascrivendo. Un eventuale polling del traffico ha scadenza esplicita e cerca gli eventi del cursore corrente; non attende per sperare che un errore di setup si risolva. Dichiarare all’avvio del fixture backend/fallback/ritardi necessari, perché la loro modifica via API arriva solo in S8. I test di stato condiviso restano separati e usano i reset esistenti; non sono necessari al fixture statico/sequence sopra.

### C7 — Creazione dal Monitor e dallo Storico (S7)

`POST /monitoring/requests/create-mocks` riceve `{runtimeId, ids, onConflict, selectAddedVariants, newEndpointEnabled}`. runtimeId richiesto e uguale al corrente, altrimenti 409 prima di scrivere; ids array di 1–250 ID distinti, ordinati dal client; onConflict richiesto `skip | add-variant`; selectAddedVariants booleano default false; newEndpointEnabled booleano **richiesto**, applicato solo ai nuovi endpoint. Nessun default implicito di attivazione. Gli elementi del Monitor sono copiati in memoria all’inizio del turno nel gate; un’evizione successiva non invalida una cattura già acquisita.

Processare nell’ordine richiesto. Il conflitto è sull’identità method/path del mock di destinazione: se un elemento precedente lo ha appena creato, quello successivo applica onConflict al risultato precedente. Un conflitto ambiguo con più destinazioni equivalenti restituisce un errore per elemento, non sceglie arbitrariamente. Per endpoint esistente add-variant conserva abilitazione e applica selectAddedVariants; per endpoint nuovo la prima variante è selezionata e newEndpointEnabled decide l’attivazione.

Risposta 201 con gli esiti per elemento di C1, più `captureOutcome: complete | incomplete | unavailable` e `warnings` array. Una cattura assente/espulsa produce `writeOutcome: skipped`, captureOutcome unavailable; altre catture proseguono. Corpo troncato o non ricostruibile produce una bozza incompleta, contrassegnata nella descrizione, non una risposta spacciata per fedele. L’abilitazione e la selezione seguono i flag richiesti anche per una bozza incompleta; includere warning `INCOMPLETE_CAPTURE`. Il flusso GUI/skill di preparazione richiede esplicitamente endpoint disabilitato o variante non selezionata e mostra l’incompletezza prima di una successiva attivazione.

Estrarre una sola trasformazione condivisa server, a partire da quella del dump: regole correnti di normalizzazione path, esclusione degli header e ricostruzione dei body. Fissare queste regole: usare matchedRoutePath se presente e diverso da `n/d`, altrimenti path; metodo maiuscolo; mantenere status e delayMs 0; body vuoto → oggetto vuoto, JSON valido → valore parsato, altro testo → stringa. Body troncato o placeholder `[binary payload:`/`[compressed payload:` → oggetto vuoto e descrizione `[da completare]`. Escludere `content-length`, `content-encoding`, `transfer-encoding`, `connection`, `keep-alive`, `date` e valori vuoti o `***`; unire valori array degli altri header con virgola e spazio. Prima della sostituzione GUI fissare fixture input/output per testo, JSON, binario, troncamento e header mascherati; non ripristinare valori mascherati né inoltrare header di trasporto incompatibili con il body ricostruito. Non aggiungere euristiche di inferenza di route parametriche. La reference API deve elencare le regole risultanti, non rimandare soltanto al codice.

La rotta Storico conserva input e conteggi legacy e adotta gli stessi campi per elemento, trasformazione ed errori di applicazione. Accetta accanto a file/keys gli stessi onConflict, selectAddedVariants e newEndpointEnabled, opzionali con default rispettivamente `skip`, false e true per preservare il comportamento legacy. Il flusso di preparazione li invia esplicitamente. I conteggi aggiungono `addedVariants` senza cambiare i precedenti. Non cancellare catture o dump dopo la conversione. Un batch non è idempotente: dopo risposta persa il client ispeziona il catalogo e si ferma se non può identificare con certezza gli elementi creati.

### C8 — Configurazione effimera (S8)

`PATCH /config` riceve `{set: {...}, unset: [...]}`; campi esterni omessi equivalgono a contenitori vuoti, ma almeno una chiave deve essere presente nei due contenitori. Niente chiavi duplicate in unset o presenti sia in set sia in unset. Una chiave in unset torna al valore di avvio; unset di un override assente è un no-op riuscito. `set.backendUrl: null` disabilita il backend, mentre unset ripristina il backend di avvio: non confondere le due operazioni. Risposta 200 identica al GET C2.

| Chiave ammessa | Validazione |
|---|---|
| `backendUrl` | null oppure URL assoluto HTTP/HTTPS, con il validatore già usato all’avvio |
| `proxyFallbackEnabled`, `corsEnabled`, `delayAllRequests`, `caseInsensitiveFilters`, `adaptProxyCookies`, `rewriteProxyRedirects` | Booleani, senza coercizione da stringhe |
| `globalDelayMs` | Intero 0–2147483647 |
| `requestTimeoutMs` | Intero 1–2147483647 |

Validare l’intero candidato prima di pubblicare un nuovo oggetto di configurazione: errore 400 senza cambiare valori, override o revisione. Gli override rimangono espliciti anche se uguali al valore di avvio, finché unset o restart li elimina. Lo snapshot per richiesta si acquisisce all’ingresso del serving, prima di delay/proxy/matching, e vale per tutto il ciclo: una richiesta iniziata con backend A usa A anche se durante il delay viene configurato B. La successiva usa B. Le connessioni già aperte continuano con il proprio stato; nessuna migrazione o chiusura aggiuntiva dovuta al PATCH. Host, porta, percorsi, adminEnabled e watcher non sono mutabili qui.

L’API dump esistente estende il PATCH piatto con `maxFileBytes` intero positivo e `maxTotalBytes` intero non negativo, entrambi safe integer; 0 per maxTotalBytes disattiva la potatura come nel comportamento esistente. Conservare i valori validi legacy di intervalMs e threshold; rifiutare un candidato invalido prima di applicare qualunque campo. I limiti cambiano dalla successiva scrittura/rotazione/potatura ordinaria, non cancellano file sincronicamente nel PATCH; una singola voce maggiore del limite file può superarlo, come oggi. Esporre entrambi i limiti nel GET. Non duplicare questi override sotto `/config`; sono effimeri e il restart ripristina i valori di avvio del dump.

La GUI mostra per ogni chiave configurabile valore effettivo e presenza dell’override, con azione per tornare al valore di avvio; segnala che i cambiamenti non sono persistiti. Desktop e browser leggono la medesima API, senza riscrivere automaticamente `.env` o preferenze di avvio.
