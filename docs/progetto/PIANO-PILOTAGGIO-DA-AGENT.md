# Piano — Mockxy pilotabile da agent e test tramite API

Data: 26 settembre 2026. Stato: **piano redatto; implementazione non iniziata**.

Base esaminata: `ace8860c9d5b2d019147e0a090bad9ab1c0d5713`.
Fonti: [analisi aggiornata](ANALISI-PILOTAGGIO-DA-AGENT.md) e [review con arbitraggio D01–D04](REVIEW-ANALISI-PILOTAGGIO-DA-AGENT.md).

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

**Gate.** Una mutazione API alla volta per workspace. Usare una coda esterna distinta da quella non rientrante delle collezioni. Il turno comprende letture, controlli, scritture, reload, validazione e rollback eventuale. Un errore non deve bloccare le richieste successive. La disconnessione del client non deve liberare la coda mentre l'operazione sta ancora scrivendo: la durata segue l'operazione, non soltanto gli eventi del socket HTTP. Le letture e il serving ordinario rimangono concorrenti.

**Reload.** Esaminare tutte le quindici rotte censite. Le sette lacune note sono: toggle endpoint/collezione, delete endpoint/contenuto collezione, import OpenAPI, creazione dallo storico, rinomina dati con riscrittura. Non basta controllare una promise rigettata: il reload risolve anche con esito negativo.

| Tipo di operazione | Garanzia da implementare |
|---|---|
| Mutazione singola con backup | Fallimento globale o errore sulle risorse coinvolte → errore e rollback; verificare anche l'esito del rollback |
| Toggle di massa | Validare tutte le risorse coinvolte e ripristinare il gruppo sul fallimento previsto dal contratto |
| Eliminazione/rinomina | Verificare l'effetto finale sulle risorse/rotte coinvolte; non cercare soltanto errori su un percorso ormai eliminato |
| Import/creazione dallo storico | Conservare gli esiti parziali intenzionali, distinguendo elementi scritti da elementi applicati e rendendo esplicito un fallimento del reload finale |

Un errore su un endpoint estraneo non deve far fallire indiscriminatamente una mutazione valida. Il contratto garantisce coerenza al termine, non una transazione isolata per tutto il traffico durante il batch. Se anche il recupero fallisce, l'API segnala lo stato incerto/degradato; non dichiara un rollback riuscito.

Correggere subito `saveDescription` perché invii solo `description`, eliminando la riabilitazione involontaria tramite il vecchio `enabled`.

**Punti del codice:** [admin-fs.js](../../src/admin/admin-fs.js), [endpoint-operations.js](../../src/admin/endpoint-operations.js), [collection-operations.js](../../src/admin/collection-operations.js), [openapi-admin-import.js](../../src/admin/openapi-admin-import.js), [dump-to-mock.js](../../src/admin/dump-to-mock.js), [server.js](../../src/server.js), [store GUI](../../mockxy-ui/src/app/pages/mocks-next/mocks-next.store.ts).

**Accettazione:** riprodurre il caso dell'handler non compilabile e del toggle; verificare interleaving di due mutazioni, recupero da errore e disconnessione del client; un GET resta possibile mentre è in corso una mutazione. I test non devono confondere un errore estraneo con un errore sulla risorsa modificata. Verificare separatamente delete, rinomina e batch parziali.

## 5. S2 — Identità, contratto distribuito e diagnostica

**Proposta di superficie API:**

| Rotta | Contenuto e funzione |
|---|---|
| `GET /_admin/api/info` | Versione, `runtimeId`, avvio, workspace/percorsi canonici, indirizzo effettivo, watcher e revisioni leggere delle risorse osservabili |
| `GET /_admin/api/config` | Configurazione effettiva ammessa, in sola lettura; nessuna esportazione indiscriminata dell'ambiente |
| `GET /_admin/api/runtime/status` | Esito del caricamento iniziale/ultimo reload, applicazione completa/degradata/fallita ed errori per endpoint |
| `GET /_admin/api/openapi.yaml` | Contratto della versione in esecuzione, disponibile anche dal pacchetto desktop |

Separare la diagnostica dettagliata dal riepilogo piccolo evita di scaricare tutti gli errori a ogni polling. I nomi dei campi e gli schemi vengono definiti nell'OpenAPI del passo; questi percorsi sono proposte del piano, non rotte già disponibili.

Il `runtimeId` cambia a ogni avvio; l'identità del workspace resta distinta. Per headless senza marker usare i percorsi reali delle directory configurate, senza inventare una radice desktop. Riportare l'indirizzo realmente in ascolto anche quando la porta assegnata differisce da quella richiesta.

Conservare tentativo di caricamento, ultima applicazione e diagnostica per file. Indicare per le definizioni in errore se è stata mantenuta la vecchia rotta oppure non è disponibile. Aggiornare questo stato anche se il comportamento servito è invariato; dopo una correzione riuscita rimuovere l'errore corrente. Non introdurre uno storico illimitato dei tentativi.

Distinguere revisioni per catalogo, modalità server, dump e diagnostica. Il token del catalogo deve cambiare anche per metadati/varianti inattive; non può essere derivato solo dal comportamento attivo. Calcolare le informazioni durante le operazioni/scansioni pertinenti, senza rileggere l'intero workspace a ogni ping. Per risorse non coperte da eventi affidabili, usare una rilettura mirata all'apertura/focus finché non esiste una revisione attendibile.

La provenienza dei valori di configurazione è facoltativa nel primo GET: esporla solo se tracciata lungo il caricamento.

**Distribuzione dello spec:** spostare la fonte canonica da `docs/admin-api.openapi.yaml` a `src/admin/admin-api.openapi.yaml` durante S2. È un percorso pianificato, non ancora esistente. [.dockerignore](../../.dockerignore) esclude `docs/`, mentre Docker include `src/` ed Electron copia `../src`: la collocazione proposta copre entrambi i pacchetti. Risolvere il file rispetto al modulo server, senza dipendere dalla cwd o dal checkout. Mantenere una sola fonte modificabile; aggiornare insieme lo script [validate-admin-openapi.js](../../scripts/validate-admin-openapi.js), i test di parità, i link delle guide IT/EN, le reference degli skill e gli esempi correnti dell'analisi. I documenti storici possono conservare il vecchio percorso qualificato come storico; un'eventuale copia in `docs/` deve essere generata e verificata, non mantenuta a mano.

**Accettazione:** handler invalido all'avvio e dopo reload visibile via API; caso con rotta mantenuta e caso senza rotta; errore risolto; nuovo `runtimeId` dopo restart; identità corretta anche con più runtime; spec leggibile sia nel layout Electron sia nell'immagine Docker di sviluppo senza checkout o `docs/`, uguale alla fonte validata. Nella standalone il file può essere presente, ma la rotta deve restare disabilitata con l'admin. La GUI userà questa diagnostica in S4.

## 6. S3 — Varianti inattive e stream preservati

Aggiungere `GET /mocks/:id/responses/:file` con il contenuto della variante richiesta e gli stessi criteri di sicurezza dei percorsi esistenti. Per asset binari esporre i metadati appropriati, senza convertirli implicitamente in grandi payload JSON. Aggiungere `select: false` alla creazione di varianti; per compatibilità il valore omesso conserva l'attuale selezione automatica. GUI e skill devono scegliere esplicitamente la preparazione senza attivazione quando è l'intento.

La variante preparata va validata anche quando non è attiva: la sola riuscita del reload della variante selezionata non dimostra che un nuovo script o una sequence inattiva sia valida. Questo è un contratto della scrittura via API, non un cambiamento implicito del caricamento passivo da disco: una variante esclusa dal perimetro attivo può restare incompleta sul filesystem finché non viene attivata. Uno step della sequence selezionata fa invece parte del perimetro attivo e viene già caricato/validato.

Non azzerare cursori o memoria soltanto perché è stata creata una variante realmente inattiva. Per preparare senza effetti una modifica a uno step attivo, creare una variante separata non referenziata; se necessario preparare anche una sequence alternativa, senza riscrivere gli step della sequence in uso. Verificare le dipendenze attive prima di chiamare “non invasivo” un aggiornamento per filename.

Riconciliare gli stream per endpoint confrontando disponibilità e scenario attivo. Gli store aggiungono la chiusura per chiave; lo shutdown continua a chiudere tutto. SSE/WS hanno definizioni dichiarative: confrontare i campi che governano copione/regole/chiusura, escludendo descrizione, titolo e preset della console. Considerare esplicitamente cambio di variante attiva, disabilitazione, eliminazione e vecchia rotta mantenuta su errore.

Non serve impedire ogni scansione duplicata del watcher. Serve che una scansione senza cambiamenti pertinenti non provochi chiusure né revisioni fittizie del comportamento. Gli aggiornamenti di catalogo e diagnostica restano indipendenti.

**Punti del codice:** [mock-catalog.js](../../src/admin/mock-catalog.js), [endpoint-operations.js](../../src/admin/endpoint-operations.js), [server.js](../../src/server.js), [sse-connections.js](../../src/mocks/sse-connections.js), [ws-connections.js](../../src/mocks/ws-connections.js).

**Accettazione:** leggere una variante inattiva non cambia selezione; creazione `select: false` non cambia risposta o scenario corrente; input invalido rifiutato dalla scrittura API anche se inattivo, senza introdurre la validazione globale delle varianti non caricate dal filesystem. Aggiungere un caso in cui si modifica una variante non selezionata usata da uno step attivo: il cambiamento deve essere riconosciuto come modifica dello scenario; preparare la variante separata lascia lo scenario invariato. Stream SSE e WS aperti sopravvivono a descrizione, variante inattiva sullo stesso endpoint, endpoint estraneo ed eco del watcher. Cambiamenti allo scenario attivo chiudono soltanto le connessioni interessate; gli store e lo shutdown non lasciano connessioni residue.

Il reload esplicito per chi scrive file può essere aggiunto dopo questo passo: `POST /runtime/reload` attende una scansione iniziata dopo la richiesta e restituisce esito/diagnostica. È una barriera opzionale, non un reset di sessione e non un prerequisito dei test che mutano via API.

## 7. S4 — Protezione delle bozze e sincronizzazione GUI

**Contratto di scrittura.** Restituire token opachi per revisione della descrizione e della singola variante. La revisione della variante copre il contenuto realmente riscritto, inclusi sorgenti o asset pertinenti; non basta l'hash del solo endpoint. Token e contenuto letti devono appartenere allo stesso snapshot logico rispetto alle mutazioni API.

**Strategia del token:** usare un hash del contenuto (per esempio SHA-256) con serializzazione deterministica dei dati pertinenti, identità della risorsa e versione del formato del token. Per la descrizione coprire il solo campo; per la variante includere sorgenti/asset effettivamente modificati dall'operazione. Legare il token ai contenuti letti e ricontrollarlo nello stesso turno del gate che scrive; una lettura composta non deve restituire contenuto e token di due versioni API diverse.

Per asset grandi calcolare l'hash sui byte anche in streaming. `mtime + dimensione` non è una precondizione affidabile: contenuti diversi possono conservare entrambi i metadati. Può aiutare un'ottimizzazione solo se non sostituisce il confronto del contenuto al salvataggio; l'euristica della cache degli script non è automaticamente un contratto adatto a evitare sovrascritture.

I token descrivono il contenuto corrente, non la cronologia: tornare allo stesso contenuto può produrre lo stesso token. Lo stesso workspace/risorsa con contenuto e formato invariati conserva il token dopo un riavvio. Una modifica esterna persistente al momento del confronto può così essere rilevata, ma un writer esterno che scrive dopo il controllo resta fuori dal gate e dalla garanzia D01.

Per i payload JSON usare `expectedRevision`, verificata dentro il gate prima della scrittura; conflitto `409` distinguibile dagli altri conflitti esistenti. Il controllo rimane facoltativo per i client precedenti e obbligatorio nei salvataggi da bozza della GUI e nel flusso di editing dello skill. Se un aggiornamento raw necessita della stessa precondizione, usare un header documentato (per esempio `If-Match`, con semantica HTTP e status `412` coerenti), non inserire dati di controllo nel file caricato.

Tutti i percorsi che modificano la risorsa devono aggiornare/influenzare la sua revisione, compresi upload e forma legacy di `PUT /mocks/:id` che modifica la risposta ordinaria selezionata. Anche il percorso legacy deve onorare la precondizione quando inviata. La selezione come azione immediata non acquisisce una precondizione dedicata al ripristino.

**Bozza.** All'apertura conservare endpoint, variante, contenuto e revisione iniziali. Un aggiornamento remoto non cambia questi riferimenti. Al conflitto preservare il testo locale, permettere di consultare la versione corrente e scegliere fra ricarica o riconciliazione/sovrascrittura deliberata contro la nuova revisione. Nessun merge automatico. Aggiornare descrizione, form della variante e dialog sequence; una modifica al body di A non deve finire in B dopo un cambio remoto di selezione.

**Sincronizzazione.** Introdurla soltanto con queste protezioni già collegate. Rilettura immediata al focus/ritorno visibile; polling del riepilogo ogni circa 2 secondi mentre la finestra è visibile, senza richieste sovrapposte. Rileggere i dettagli quando cambia la revisione pertinente. Obiettivo iniziale di verifica: cambiamenti visibili entro 5 secondi in una sessione locale con richieste riuscite; errori di collegamento mostrati come stato non aggiornato. Intervallo e margine sono parametri tecnici del piano, non una garanzia in presenza di rete indisponibile.

Al nuovo `runtimeId` risincronizzare le risorse, lo stato runtime e i cursori del Monitor; verificare che l'istanza corrisponda ancora al workspace richiesto. Conservare le bozze e i token basati sul contenuto: il solo riavvio non li invalida, mentre contenuto/identità/formato diversi richiedono il confronto o la riconciliazione appropriati. La status bar mostra gli errori del runtime oltre a quelli del catalogo. Riletture in ritardo non devono sovrascrivere risposte più recenti; chiudere polling/subscription allo smontaggio dello store interessato.

**Punti UI:** [mocks-next.store.ts](../../mockxy-ui/src/app/pages/mocks-next/mocks-next.store.ts), [response-draft.ts](../../mockxy-ui/src/app/pages/mocks-next/detail/response-draft.ts), [dialog sequence](../../mockxy-ui/src/app/pages/mocks-next/sequence/mocks-next-sequence-dialog.ts), [server-status.store.ts](../../mockxy-ui/src/app/shared/server-status.store.ts), [monitor-dump.store.ts](../../mockxy-ui/src/app/shared/monitor-dump.store.ts), [workspace-summary.store.ts](../../mockxy-ui/src/app/shared/workspace-summary.store.ts).

**Accettazione:** due salvataggi dalla stessa versione producono un successo e un conflitto; varianti diverse non confliggono; descrizione non riabilita l'endpoint; bozza A resta A mentre l'agent attiva B; riconnessione mostra Proxy All corretto senza refresh manuale; diagnostica cambia anche con vecchia rotta ancora servita. Verificare anche keyboard/focus e stringhe IT/EN della gestione conflitti, secondo le istruzioni UI. Aggiungere prove di token stabile dopo restart a contenuto invariato, contenuto diverso della stessa lunghezza con mtime conservato, descrizione invariata con toggle esterno e lettura/salvataggio concorrenti: nessun falso successo ottenuto da token calcolati su dati diversi da quelli letti.

## 8. S5 — Monitor interrogabile

Estendere la lista con filtri espliciti, `limit` con massimo documentato, proiezione sommario senza body, cursore e lettura per ID. Validare i parametri supportati invece di ignorarli silenziosamente. I percorsi statici come `/stream` devono restare distinti dalla rotta parametrica del dettaglio.

Definire `since` come ID strettamente maggiore nel runtime indicato. Per le pagine incrementali restituire in ordine crescente e avanzare il cursore senza saltare le voci non ancora restituite. Conservare la vista corrente più-recente-prima per i client esistenti oppure migrare esplicitamente GUI e contratto nello stesso passo. Il cursore deve avere una semantica precisa anche quando un filtro non trova corrispondenze.

La busta deve permettere di distinguere runtime, intervallo disponibile, pagina successiva e perdita (`gap`). Gestire espulsione, `clear` anche a buffer vuoto e riavvio. Il dettaglio di un ID non disponibile restituisce un errore esplicito; i body troncati restano riconoscibili. Non si trasforma il Monitor in un archivio durevole: per quello esiste il dump.

**Punti del codice:** [request-monitor.js](../../src/monitoring/request-monitor.js), [admin-api.js](../../src/admin/admin-api.js), service/types Angular e pagina Monitor.

**Accettazione:** filtri realmente applicati; nessun body nel sommario; due o più pagine senza buchi/duplicati introdotti dalla paginazione; nuovo traffico durante la lettura; cursore espulso, clear e restart riconoscibili. “Nessun elemento” non deve essere usato per concludere “nessuna richiesta” quando c'è un gap. Long polling rinviato.

## 9. S6 — Primo caso completo: setup ripetibile via API

Realizzare un helper di test/esempio come composizione di chiamate HTTP esistenti ed estese; non è una nuova API server di scenari. Identificare il runtime/workspace e selezionare risorse per ID/filename risolti, senza dipendere dalla selezione corrente o da titoli non univoci. Prima di modificare una variante per prepararla, verificare anche se è uno step della sequence selezionata: “non selezionata” non significa necessariamente “inattiva”.

Un setup esemplificativo per una feature deve:

1. Verificare identità dell'istanza e configurazione richiesta dal test. Parametri di avvio non ancora mutabili vanno predisposti dall'ambiente di test, con errore esplicito se non corrispondono.
2. Impostare `serverEnabled: true` e `proxyAll: false` se il caso richiede i mock; abilitare gli endpoint necessari e selezionare esplicitamente le varianti previste. Impostare anche le altre condizioni da cui dipende il test.
3. Preparare/aggiornare solo le varianti mancanti o da cambiare. Se l'esito di una creazione è incerto, rileggere prima di ritentare; non duplicare varianti alla cieca.
4. Per una sequence, selezionarla e chiamare il reset esplicito anche se era già selezionata. Per stato condiviso, resettare solo le risorse pertinenti e inizializzarle attraverso il comportamento previsto dagli handler.
5. Attendere e controllare gli esiti delle mutazioni; non usare un ritardo fisso per sperare che il watcher abbia finito. Eventuali letture amministrative di verifica non devono consumare uno step della sequence prima del test.
6. Ottenere un riferimento al Monitor prima dell'azione del browser, eseguire l'azione e verificare risposta e traffico attesi senza includere richieste di una prova precedente.

**Limite già individuato:** il reset sequence azzera anche la memoria handler di quell'endpoint, ma oggi richiede una sequence selezionata; non è un reset generale di qualsiasi handler ordinario. Non promettere ripetibilità universale di stato locale arbitrario. Il primo esempio usa mock statici, sequence e reset condivisi disponibili; per un handler con memoria locale non azzerabile usare un runtime di test isolato/fresco oppure documentare il reset specifico del workspace. Una nuova rotta di reset va motivata da un caso concreto, non introdotta come undo implicito.

**Prova centrale:** partire una volta con altre varianti attive e una volta con endpoint disabilitati/Proxy All attivo; eseguire lo stesso setup e ottenere lo stesso risultato browser. Ripetere senza ripristinare lo stato iniziale nel mezzo. Affiancare un caso sequence già consumata che riparta correttamente dopo il setup.

Usare un workspace di prova, non il workspace di sviluppo dell'utente. La suite attuale [Playwright](../../playwright.config.js) esegue con un worker e usa helper di reset: aggiungere il caso senza trasformare quei reset di fixture in una funzionalità pubblica di undo. Non migrare tutta la suite. Le esecuzioni parallele che mutano gli stessi mock devono usare risorse/istanze distinte o essere serializzate.

**Skill e documentazione.** Aggiornare il flusso di `mockxy-workspace/SKILL.md` e verificare i contratti degli altri tre skill (`mockxy-static-mock`, `mockxy-realtime-mock`, `mockxy-dynamic-mock`) secondo la matrice del §12: bivio offline/live, identità dell'istanza, lettura/preparazione/attivazione e dipendenze sequence, revisioni sulle bozze, conferma dell'applicazione e retry. Gli aggiornamenti delle singole semantiche accompagnano S2–S4, non aspettano tutti S6. Includere un esempio Playwright di setup esplicito senza obbligo di ripristino. Le guide utente e gli errori visibili cambiano in IT/EN; il piano interno rimane in italiano.

**Uscita del primo caso:** tutte le verifiche S0–S6 superate, API documentate e disponibili nel desktop, esempio ripetibile eseguibile, nessun requisito di undo. I dati da disco fuori dalla coda HTTP e i limiti della memoria runtime sono dichiarati.

## 10. S7 — Secondo caso: creare dal traffico

Centralizzare la trasformazione usata da Monitor e Storico: percorso, header da escludere, body incompleto/binario e descrizione della bozza. Introdurre una rotta per gli ID del Monitor con strategia `skip`/`add-variant` esplicita e opzione di selezione delle varianti aggiunte; nel flusso di preparazione usare variante inattiva. Per nuovi endpoint dichiarare esplicitamente l'abilitazione desiderata, evitando di nascondere l'attivazione dietro una semplice cattura.

Ogni elemento restituisce esito e identificatori: creato, variante aggiunta, saltato, cattura non disponibile, incompleto o fallito. Un body non ricostruibile non viene presentato come riproduzione fedele. Applicare lo stesso vocabolario degli esiti allo Storico preservando i campi compatibili; la GUI usa il server e rimuove la trasformazione duplicata.

**Accettazione:** cattura valida, endpoint esistente per entrambe le strategie, più catture sullo stesso endpoint, cattura espulsa, body troncato/binario, headers mascherati, risultati parziali e variante aggiunta senza cambio di selezione. Nessun retry cieco quando manca la risposta al batch.

## 11. S8 — Terzo caso: condizioni runtime

Aggiungere PATCH della configurazione per le leve effettivamente supportate: backend, fallback, CORS, ritardo globale/estensione al proxy, timeout, filtri, adattamento cookie e redirect. Validazione completa prima dell'applicazione; nessun effetto parziale di un PATCH invalido. I limiti del dump si estendono sulla sua API esistente, con validazione coerente.

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

Le note di rilascio vanno scritte al completamento del relativo cambiamento, senza presentare ora le proposte come già implementate. Evidenziare soprattutto il nuovo comportamento del default admin su bind di rete; per il Monitor dichiarare l'eventuale nuova forma/ordinamento e la migrazione necessaria, anche se il piano preferisce conservare la vista dei vecchi client.


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

Non c'è un ulteriore arbitraggio di prodotto pendente. Le scelte di dettaglio del contratto e gli eventuali gap scoperti durante l'implementazione vanno risolti nel perimetro D01–D04, documentando limiti reali senza introdurre funzionalità di ripristino o collaborazione più ampie per precauzione.
