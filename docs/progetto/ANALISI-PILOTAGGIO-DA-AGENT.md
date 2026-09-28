# Analisi — Mockxy pilotabile da un agent AI: parità tra GUI e admin API

Stato: **diagnosi aggiornata dopo review e arbitraggio; implementazione non iniziata**

Analisi iniziale: 25 settembre 2026. Aggiornamento: 27 settembre 2026.

Base della diagnosi iniziale: `ace8860c9d5b2d019147e0a090bad9ab1c0d5713`.
Verifica incrementale dopo pull/rebase: `33fbfcc7de3e03611067b9eb04939708ef2d6dc6` (1.3.2), 27 settembre 2026.
I sei commit intermedi riguardano rilasci, documentazione e presentazione UI; motore e admin API
sono invariati. La diagnosi resta valida; il piano recepisce le cautele UI e di rilascio emerse.
La [review](REVIEW-ANALISI-PILOTAGGIO-DA-AGENT.md) conserva i riscontri e la storia del confronto
Codex–Opus; le decisioni di Dani D01–D04 prevalgono sulle proposte precedenti.
Il [piano di implementazione](PIANO-PILOTAGGIO-DA-AGENT.md) traduce questa diagnosi in passi e
criteri di accettazione. Il §13 del piano fissa contratti e casi limite di implementazione;
le alternative storiche della diagnosi vanno lette alla luce di quelle scelte.
Le API nuove descritte nei documenti non sono ancora disponibili.

Ambito: admin API, UI Angular, app desktop (Electron), documentazione, skill `mockxy-skills`.

Obiettivo: rendere le capacità del workspace e del runtime pilotabili da GUI, agent e test
tramite API. Il risultato prioritario è preparare uno scenario in modo esplicito e ripetibile,
indipendentemente dalle selezioni lasciate da una sessione precedente. La gestione del contenitore
desktop (finestre, aggiornamenti, apertura workspace) è fuori dal perimetro di parità.

Decisioni approvate:

- **D01:** collaborazione simultanea con protezione delle bozze tramite revisione attesa; nessuna
  fusione automatica. Si coordina il lavoro sulla stessa feature, senza tentare di gestire due
  attori che cambiano deliberatamente lo stesso scenario durante un test.
- **D02:** preparare varianti inattive e modificare metadati non deve interrompere stream SSE/WS
  il cui comportamento attivo resta invariato.
- **D03:** prima modificare mock esistenti, poi creare dal traffico, infine cambiare condizioni
  runtime come latenza e backend.
- **D04:** nessun undo o ripristino dedicato richiesto. Il client prepara lo scenario necessario;
  l'eventuale ripristino usa le normali API. Resta distinto il rollback di una mutazione fallita.

Nel perimetro dello scenario selezionato, una variante è **attiva** se è selezionata oppure se
è referenziata da uno step della sequence selezionata. Il loader carica e valida tutti questi
step; modificarne uno può cambiare le risposte anche senza selezionarlo direttamente. “Inattiva”
significa esclusa da entrambi i casi. Il serving effettivo dipende anche da abilitazione e modalità
del server; gli step attuali sono solo mock/handler, non SSE/WS.

## 1. Esito in breve

La documentazione afferma che «non esiste un'operazione della UI che non passi» dall'admin API.
Il censimento iniziale ha trovato 49 rotte del router, 49 operazioni OpenAPI e le corrispondenti
chiamate del service Angular. Il confronto router–OpenAPI è stato ripetuto indipendentemente
nella review. Questa parità riguarda metodi e percorsi: non dimostra equivalenza dei payload,
assenza di effetti collaterali o accessibilità della configurazione desktop tramite HTTP.

Questo però non basta a rendere Mockxy pilotabile da un agent. Problemi trovati, per priorità:

| # | Problema | Effetto per un agent | Priorità |
|---|---|---|---|
| 1 | **Bug**: senza `ADMIN_API_ENABLED` l'admin API è spenta anche in sviluppo | `npm start` o `node index.js` risponde `404 Admin API disabled` a ogni rotta | P0 |
| 2 | Le rotte admin inesistenti ricadono nel serving e, col proxy fallback, **arrivano al backend reale** | una rotta sbagliata colpisce il backend e non compare nel Monitor | P0 |
| 3 | Documentazione disallineata: lo skill copre 38 rotte su 49, le guide 48 su 49; il motore non serve l'OpenAPI | l'agent non vede metà del Monitor né il toggle di massa | P0 |
| 4 | Configurazione del motore (backend URL, CORS, ritardo globale, timeout, proxy fallback…) solo dalla GUI desktop o da `.env` con riavvio; nemmeno leggibile via API | l'agent non sa come è configurato il motore e non può simulare latenza né cambiare backend | P1 |
| 5 | «Crea mock da questa richiesta» del Monitor è logica nel browser | l'agent deve replicare regole già scritte due volte | P1 |
| 6 | Monitor senza filtri, paginazione né lettura per id | ogni lettura scarica fino a 250 voci con body fino a 156 KB | P1 |
| 7 | La GUI non vede le modifiche fatte via API (server, Proxy All, catalogo) | l'agent attiva Proxy All e la barra continua a mostrare «mock attivi» | P1 |
| 8 | Le mutazioni sugli endpoint non sono serializzate: la posizione «uso mono-utente» di `CONCORRENZA-ADMIN.md` non regge con un agent | agent e utente possono perdersi le modifiche a vicenda | P1 |
| 9 | Via API leggere una variante inattiva richiede di selezionarla; crearne una la seleziona | preparazione e attivazione non sono separate | P1 |
| 10 | Sette rotte che ricaricano il runtime ignorano l'esito finale del reload | successo API e catalogo aggiornato possono non corrispondere al comportamento servito | P0 |
| 11 | Ogni reload riuscito chiude tutti gli stream mockati; il watcher può aggiungere altri reload | anche una descrizione o una variante inattiva interrompe sessioni estranee | P1 |
| 12 | Gli errori runtime non sono conservati in una diagnostica interrogabile | catalogo e status bar possono risultare puliti mentre si serve una versione precedente o manca una rotta | P1 |

Le capacità già raggiungibili con `curl` includono catalogo, varianti, sequence, console SSE/WS,
collezioni, import OpenAPI, file dati, metadati/reset dello stato condiviso, storico e modalità
del server. La raggiungibilità va distinta dalle garanzie di applicazione e concorrenza.

## 2. Metodo

- Lettura del router (`src/admin/admin-api.js`), del montaggio in `src/app.js`, del service
  `mockxy-ui/src/app/mock-admin-api.service.ts`, di store, pagine e dialog della UI, del preload e
  dei canali IPC in `electron/`.
- Confronto automatico tra router, OpenAPI, service Angular, guide e reference dello skill (lo
  script è la base del test proposto nell'appendice A).
- Prova dal vivo su una copia del workspace demo (porta 39417) con il flusso tipico di un agent,
  più un backend finto (porta 39418) per vedere dove finiscono le rotte admin sconosciute. Esiti
  nell'appendice C. Processi terminati e repository intatto al termine.
- Review successiva Codex–Opus: verifiche indipendenti su workspace temporanei, di cui resta
  traccia nella review. Riprodotti sia i reload aggiuntivi del watcher sia il successo della
  PATCH di massa con handler non compilabile e comportamento runtime divergente dal catalogo.
  Questo aggiornamento documentale non dichiara nuove prove applicative eseguite.

## 3. I piani di controllo

Mockxy non ha uno solo, ma due piani di controllo:

| Piano | Chi lo usa | Raggiungibile da un agent |
|---|---|---|
| Admin API HTTP `/_admin/api`, 49 rotte | UI Angular, sia nel browser sia nel desktop | sì, via HTTP su loopback |
| IPC Electron `window.desktop`, 16 canali più un evento | solo la UI dentro l'app desktop | **no**: esiste solo nel processo Electron |

C'è poi lo stato di vista in `localStorage` (larghezze dei pannelli, endpoint selezionato,
cartelle espanse, lingua): non tocca il motore e a un agent non serve.

## 4. Matrice di parità GUI → API

Legenda: ✅ esiste una rotta equivalente · 🟡 fattibile, ma l'agent deve replicare logica del
client o fare N chiamate · ❌ non raggiungibile via API.

### 4.1 Barra runtime, palette comandi, status bar

| Funzione GUI | API | | Note |
|---|---|---|---|
| Server on/off | `PATCH /server {serverEnabled}` | ✅ | |
| Proxy All | `PATCH /server {proxyAll}` | ✅ | |
| Monitor live o in pausa | nessuna | ✅ | solo client: chiude lo stream SSE (`monitor-stream.store.ts:37`); il motore continua a catturare |
| Dump su disco on/off | `PATCH /monitoring/dump {enabled}` | ✅ | |
| Flush del dump | `POST /monitoring/dump/flush` con `{}` | ✅ | |
| Indirizzo del server | nessuna | ❌ | ricavato da `window.location` o dall'IPC; manca una rotta informativa |
| Conteggi ed errori di lettura del catalogo | `GET /mocks` (`items`, `collections`, `loadErrors`) | 🟡 | non include tutti gli errori del loader runtime, vedi 5.11 |

### 4.2 Catalogo

| Funzione GUI | API | | Note |
|---|---|---|---|
| Elenco e filtri (testo, tipo, stato) | `GET /mocks` | ✅ | filtri lato client: il catalogo è un sommario, va bene così |
| «Ricarica da disco» | `GET /mocks` | ✅ | rilegge soltanto; il motore ricarica da sé col watcher |
| Nuovo mock, handler, middleware | `POST /mocks` | ✅ | senza `source` il server scrive il template |
| Nuovo mock con body da file | `POST /mocks` poi `PUT /mocks/:id/responses/:file/file` | 🟡 | due passi non atomici, come nella UI |
| Import OpenAPI (anteprima, prefisso, import) | `POST /mocks/import/openapi[?dryRun&prefix]` | ✅ | |
| Abilita o disabilita un endpoint | `PUT /mocks/:id/endpoint {enabled}` oppure `PATCH /mocks/enabled` | ✅ | la PUT accetta anche il solo `enabled`: la lettura preventiva che fa la UI non serve |
| Selezione multipla: abilita o disabilita | `PATCH /mocks/enabled {ids, enabled}` | ✅ | backup/rollback senza isolamento; esito reload non validato, possibili reload del watcher (5.10–5.12) |
| Selezione multipla: sposta in collezione | N × `PUT /mocks/:id/collection` | 🟡 | nessuna rotta di massa (`mocks-next.store.ts:519`) |
| Selezione multipla: elimina | N × `DELETE /mocks/:id` | 🟡 | N reload, non atomico (`mocks-next.store.ts:543`) |
| Collezioni: crea, annida, riordina, sposta, abilita in massa, dissolvi, elimina col contenuto | `POST /mocks/collections`, `PATCH …/order`, `…/children/order`, `…/items/order`, `…/parent`, `…/enabled`, `DELETE …`, `DELETE …/contents` | ✅ | compreso il drag & drop, via `targetIndex` |
| Rinomina collezione | nessuna | — | non c'è né nella GUI né nell'API: non è un problema di parità |

### 4.3 Dettaglio endpoint e varianti

| Funzione GUI | API | | Note |
|---|---|---|---|
| Descrizione | `PUT /mocks/:id/endpoint {description}` | ✅ | |
| Copia endpoint, con anteprima | `POST /mocks/:id/copy[?dryRun=true]` | ✅ | |
| Elimina endpoint | `DELETE /mocks/:id` | ✅ | |
| Percorso del file | `definitionFilePath` nel dettaglio | ✅ | |
| Seleziona variante | `PUT /mocks/:id {selectedResponseFile}` | ✅ | |
| Contenuto di una variante | `GET /mocks/:id` | 🟡 | contiene per intero **solo la variante selezionata**; delle altre dà solo metadati (`fileName`, `type`, `title`, `status`, `templated`, `selected`). Verificato |
| Modifica variante (status, header, body, ritardo, templating, sorgente) | `PUT /mocks/:id/responses/:file` | ✅ | qui l'API fa più della UI: modifica anche varianti non selezionate |
| Carica file | `PUT /mocks/:id/responses/:file/file` | ✅ | |
| Nuova variante mock, handler, middleware, SSE, WS o sequence | `POST /mocks/:id/responses` | ✅ | la aggiunge **e la seleziona**: manca la preparazione senza attivazione tramite questa API |
| «Clona in handler/middleware» | `POST /mocks/:id/responses {type, source}` | 🟡 | il sorgente è generato nel browser a partire dalla variante mock (`mocks-next-detail.ts:844`) |
| Preset di risposta, gruppi di header, template degli script | nessuna | 🟡 | costanti del client: comodità, non capacità; l'agent scrive direttamente il payload |
| Elimina variante | `DELETE /mocks/:id/responses/:file` | ✅ | `409` se una sequence la usa |
| Sequence: crea, modifica, stato, riparti | `POST` e `PUT …/responses`, `GET …/sequence/state`, `POST …/sequence/reset` | ✅ | |
| Console SSE e WS: stato, invio, reinvio | `GET …/sse/connections`, `GET …/ws/connections`, `POST …/sse/push`, `POST …/ws/push` | ✅ | |

### 4.4 Monitor

| Funzione GUI | API | | Note |
|---|---|---|---|
| Elenco live | `GET /monitoring/requests`, `GET /monitoring/requests/stream` (SSE) | ✅ | |
| Filtri (testo, metodo, provenienza, classe di status) e statistiche | nessuna | 🟡 | tutto lato client (`monitor-next.page.ts:440`); `?method=POST` viene ignorato. Verificato |
| Dettaglio di una richiesta | nessuna | 🟡 | non esiste `GET /monitoring/requests/:id`: si scarica tutto e si cerca |
| Svuota | `DELETE /monitoring/requests` | ✅ | |
| Copia come cURL, esporta JSON | nessuna | 🟡 | lato client, facili da ricostruire |
| Vai al mock che copre la richiesta | `GET /mocks/resolve?method&path` | ✅ | |
| **Crea mock da questa richiesta** (singola e multipla) | `POST /mocks`, e su `409` `POST /mocks/:id/responses` | 🟡 | vedi 5.4 |

### 4.5 Storico, Dati, stato condiviso

Tutto coperto:

- **Storico**: elenco, lettura paginata, creazione di mock in blocco ed eliminazione dei dump
  (`/monitoring/dumps…`);
- **Dati**: elenco, lettura, caricamento, rinomina con riscrittura dei riferimenti ed
  eliminazione dei file dati (`/files…`);
- **Stato condiviso**: elenco dei metadati e reset (`/runtime/shared-state…`).

Resta fuori solo la copia negli appunti dello snippet `data('nome')`.

### 4.6 Solo app desktop (IPC)

| Funzione GUI | Dove vive | | Serve a un agent? |
|---|---|---|---|
| Impostazioni del workspace: backend URL, proxy fallback, CORS, cookie, redirect, ritardo globale e sui proxy, timeout, filtri case-insensitive, 4 parametri del dump | `workspace:update` → `.mockxy/settings.json` + riavvio del motore (`electron/app-main.js:396`) | ❌ | **sì**, vedi 5.3 |
| Titolo, porta, esposizione in rete (0.0.0.0) | idem | ❌ | da leggere sì, da modificare no (vedi 6) |
| Apri, cambia, chiudi workspace; recenti | `workspace:open`, `switch`, `close`, `recent`, `removeRecent` | ❌ | no |
| Preferenze dell'app (log errori), aggiornamenti, lingua | `prefs:*`, `updates:*`, `lang:*` | ❌ | no |

Modificare `.mockxy/settings.json` a mano non basta: il motore lo legge solo all'avvio del
workspace, quindi bisogna chiudere e riaprire la tab o riavviare l'app. Nel server headless
l'equivalente è `.env` o i flag CLI, più il riavvio del processo.

## 5. Dettaglio dei problemi

### 5.1 Bug: l'admin API è spenta di default

Le guide (`docs/it/ADMIN-API.md:10`, `docs/en/ADMIN-API.md:10`) e `.env.example` dicono «attiva in
sviluppo, spenta in produzione». Il codice fa altro:

```js
// src/config.js:313
parseBoolean(process.env.ADMIN_API_ENABLED, undefined)
// src/config.js:79
function parseBoolean(value, fallback = false) { … }
```

Passare `undefined` esplicitamente attiva il valore di default del parametro: `parseBoolean`
restituisce `false`, e `shouldEnableAdminApi` lo tratta come una scelta esplicita. Verificato: con
`NODE_ENV` e `ADMIN_API_ENABLED` non impostati, `loadConfig({})` restituisce
`adminApiEnabled: false` e il server risponde `404 Admin API disabled` a ogni rotta.

Il difetto c'è dal primo commit ma finora non si è visto, perché `scripts/dev-server.js`,
`docker-compose.yml`, `.env.example` e l'app desktop impostano tutti il flag esplicitamente. Il
test di `test/config-and-mock-scan.test.js:294` prova `shouldEnableAdminApi` da sola, non la
catena che parte da `loadConfig`. Il caso colpito è proprio quello di un agent che avvia
`npm start` o `node index.js` su un workspace.

Correzione: passare `null` come fallback alle righe 313 e 314, e aggiungere un test su
`loadConfig` senza variabili d'ambiente (API attiva in `development`, spenta in `production`).

Il fix cambia il comportamento effettivo di chi avviava senza flag: l'admin si accende in dev.
Il Dockerfile di sviluppo imposta `HOST=0.0.0.0`; senza compose/override, le porte pubblicate
possono quindi esporre l'admin dopo la correzione. Su bind non loopback la guardia Host non è
attiva in assenza di allowlist esplicita. L'avviso all'avvio esiste, ma non sostituisce una nota di
migrazione: esplicitare `ADMIN_API_ENABLED=false` per mantenere il vecchio risultato e il mapping
su loopback per l'uso locale. Standalone e compose che impostano il flag conservano la scelta
esplicita. Il piano include le verifiche e le note di rilascio nello stesso passo S0.

### 5.2 Le rotte admin sconosciute arrivano al backend

Il router admin non ha un 404 finale: una rotta che non combacia prosegue nella pipeline dei mock
e poi nel proxy. Verificato con un backend finto:

- `GET /_admin/api/info` restituisce la risposta **del backend** (`{"reachedBackend": true, …}`);
- `POST /_admin/api/typo` con body JSON restituisce `502 Bad Gateway`, perché il parser JSON del
  router ha già consumato il body;
- nessuna delle due richieste compare nel Monitor, che esclude `/_admin/api`
  (`src/monitoring/request-monitor.js:17`).

Un agent che esplora l'API per tentativi, o che usa una rotta aggiunta in una versione più
recente, riceve risposte fuorvianti e manda richieste al backend senza saperlo. Correzione: un
gestore 404 JSON in coda al router, prima di `return router` (`src/admin/admin-api.js:583`).

### 5.3 Configurazione del motore fuori dall'API

Un agent non può né leggere né modificare backend URL, CORS, ritardo globale, timeout, proxy
fallback, adattamento dei cookie, riscrittura dei redirect e filtri case-insensitive. Eppure sono
le leve tipiche di una sessione di sviluppo: «simula una rete lenta», «punta al backend di
staging», «rispondi 404 invece di andare al backend».

`src/app.js` e `src/proxy/proxy.js` consultano le principali leve durante le richieste:
`corsEnabled`, `backendUrl`, `globalDelayMs`, `delayAllRequests`, `requestTimeoutMs`,
`proxyFallbackEnabled`, `caseInsensitiveFilters`, `adaptProxyCookies`, `rewriteProxyRedirects`.
Questo rende plausibile l'applicazione a caldo, ma non basta mutare l'oggetto condiviso:
una richiesta può attendere un ritardo e rileggere il backend dopo che è cambiato.

Il primo incremento espone la configurazione effettiva in lettura. La scrittura, nel terzo caso
d'uso, richiede validazione dell'intero PATCH, snapshot coerente per richiesta, override effimeri
visibili nella GUI e regole esplicite per riavvio e connessioni già aperte. La provenienza dei
valori si espone soltanto se conservata dal caricamento, senza dedurla arbitrariamente.

### 5.4 «Crea mock da questa richiesta» vive nel browser

Il Monitor costruisce nel client il body di `POST /mocks` (`monitor-next.page.ts:588`):

- percorso preso da `matchedRoutePath`;
- esclusione degli header calcolati dal server e di quelli mascherati con `***`;
- skeleton con descrizione «[da completare]» per body binari o troncati;
- su `409`, proposta di aggiungere la risposta catturata come variante.

Il server contiene già la stessa trasformazione per lo Storico (`src/admin/dump-to-mock.js:57`),
ma le due copie sono tenute allineate a mano: `SKELETON_DESCRIPTION` e l'elenco degli header da
escludere esistono due volte. Anche il comportamento diverge: lo Storico salta gli endpoint
esistenti, il Monitor propone la variante. Un agent deve replicare tutte queste regole per
ottenere quello che fa la GUI.

### 5.5 Monitor poco interrogabile

`GET /monitoring/requests` restituisce l'intero buffer: fino a 250 voci (`DEFAULT_MONITOR_LIMIT`),
ciascuna con body di richiesta e risposta fino a 156 KB. Nel caso peggiore sono decine di MB,
che l'agent deve scaricare per rispondere a una domanda come «il frontend ha chiamato
`POST /orders` con questo body?». Mancano filtri, `limit`, un cursore `since`, la lettura per id e
un modo per escludere i body.

Filtrare non basta: il buffer espelle voci, può essere svuotato e gli ID ripartono da 1 dopo un
riavvio. Occorrono identità del runtime, cursori con ordine definito e segnalazione degli
intervalli non più osservabili. Una risposta vuota non deve mascherare traffico perduto.

### 5.6 La GUI non vede le modifiche dell'agent

Sono aggiornati dal vivo solo il Monitor (SSE), le console SSE e WS e lo stato delle sequence
(polling). Lo stato del server e di Proxy All (`server-status.store.ts:27`) e quello del dump
(`monitor-dump.store.ts:29`) si leggono una volta sola, all'avvio. Catalogo, Dati e stato
condiviso si rileggono solo quando l'utente fa un'azione.

Nello scenario «l'agent pilota mentre sviluppo» è il rischio più concreto: l'agent attiva Proxy All
via API, la barra continua a mostrare i mock attivi, e l'utente cerca il problema nel posto
sbagliato.

La soluzione iniziale scelta è rilettura al ritorno in primo piano più polling leggero di stato
e revisioni; un nuovo SSE generale non è necessario. Prima di aggiornare automaticamente il
dettaglio bisogna legare la bozza a endpoint, variante e revisione letti all'apertura, altrimenti
il salvataggio potrebbe usare la variante selezionata successivamente. Una bozza aperta non va
rimpiazzata dal polling. Catalogo, comportamento attivo e diagnostica sono grandezze distinte.

### 5.7 Scrivere file o usare l'API

Lo skill `mockxy-workspace` indica la scrittura dei file come strada predefinita. Col watcher
funziona (attesa di stabilità di 100 ms, `src/server.js:161`), ma manca un punto di
sincronizzazione: l'agent non sa quando la modifica viene servita. Se poi il file è rotto, il
motore conserva la versione precedente quando disponibile, altrimenti la rotta manca. Gli errori
del catalogo e quelli del loader runtime non coincidono: un handler non compilabile può
risultare soltanto nel log e nell'esito del reload, senza comparire in `GET /mocks` (5.11).

Le mutazioni API principali attendono il reload e ne validano l'esito per il file toccato;
altre sette rotte ignorano l'esito finale (5.10). Il vantaggio dell'API va completato uniformando
questa garanzia. Una successiva lettura del catalogo da disco non certifica l'applicazione runtime.

Con un'istanza in esecuzione il percorso preferito resta l'API. Per scritture dirette ai file è
utile una barriera di reload esplicita con esito e diagnostica (raccomandazione 14), che non rende
quelle scritture transazionali né le include nella coda HTTP.

### 5.8 Mutazioni concorrenti

`docs/sviluppo/CONCORRENZA-ADMIN.md` ha fissato il 9 luglio la posizione «uso mono-utente»: le
mutazioni sui file degli endpoint non passano da nessuna coda, e in caso di mutazioni parallele
l'ultima scrittura vince. Lo stesso documento chiede di rivedere questa scelta se compaiono
«automazioni interne dell'app che mutano il workspace in background mentre l'utente lavora
(sincronizzazioni, import automatici, agenti)».

L'uso simultaneo approvato richiede un gate per workspace che serializzi le mutazioni API
senza riusare in modo rientrante la coda interna delle collezioni. La coda va mantenuta fino
alla conclusione dell'operazione, compreso reload o rollback; GET e serving restano concorrenti.
Questo impedisce intrecci fra mutazioni API, non l'osservazione di stati intermedi da watcher o
altri processi e non protegge una bozza stantia.

Per descrizioni e varianti, il salvataggio deve confrontare una revisione attesa nella stessa
sezione serializzata della scrittura. La GUI conserva la bozza su conflitto e consente una
riconciliazione esplicita. Caso già concreto: `saveDescription` reinvia anche `enabled` dalla
vecchia lettura, e può riabilitare un endpoint disabilitato dall'agent. Deve inviare solo il campo
modificato. Aggiornamento visivo o eventi da soli non impediscono questa perdita.

Il perimetro approvato non è collaborazione multiutente generale: azioni immediate possono
mantenere l'ultima azione prevalente, e chi lavora sulla stessa feature si coordina. Le revisioni
sono una protezione dagli incidenti; i writer esterni al processo restano fuori dalla garanzia.

Per il token il piano adotta un hash deterministico del contenuto pertinente, non un contatore
legato all'esecuzione. Una risorsa invariata nello stesso workspace non diventa stantia solo per
un riavvio. `runtimeId` resta necessario per stato effimero, Monitor e risincronizzazione. La
firma `mtime + dimensione` usata nella cache degli script non è abbastanza forte come unica
precondizione: può essere uguale per contenuti diversi. Il token deve corrispondere ai dati letti
e il controllo al salvataggio deve confrontarne il contenuto nella sezione serializzata.

### 5.9 Selezionare equivale a pubblicare

`POST /mocks/:id/responses` aggiunge la variante e la seleziona; `GET /mocks/:id` mostra il
contenuto della sola variante selezionata. Verificato: dopo l'aggiunta di una variante 500, la
chiamata successiva all'endpoint riceve 500. Un agent che prepara o ispeziona varianti mentre il
frontend è in uso cambia quello che il frontend riceve. In locale l'agent può leggere i file da
disco e preparare una variante senza cambiare `selectedResponseFile`, come già documentato nello
skill. È l'API attuale a non offrire questa separazione.

Lettura per nome e creazione con `select: false` entrano nel primo caso d'uso. Modificare per nome
uno step della sequence selezionata è però una modifica attiva: per preparare senza effetti serve
una variante separata non usata dallo scenario corrente. Questo caso entra nei test S3/S6.

La validazione della variante scritta via API va distinta dal caricamento passivo del workspace:
la prima deve controllare anche le varianti preparate inattive; il secondo non deve iniziare a
rifiutare tutte le bozze su disco fuori dal perimetro attivo. Le guide devono dichiarare entrambi
i comportamenti senza assimilare una scrittura API a una semplice scansione dei file.

Per gli stream,
conservare la selezione non basta: ogni reload oggi chiude tutte le connessioni (5.12).

### 5.10 Successo della mutazione e applicazione runtime divergono

`createReloadHandler` restituisce `applied: false` e `fatalError` in caso di fallimento globale,
oppure `applied: true` con `loadErrors` per i singoli endpoint. `commitWithRollback` non considera
questi valori un errore senza un `validateReloadResult` fornito dal chiamante.

Nell'inventario della review, sette delle quindici rotte che ricaricano il motore ignorano
l'esito finale:

- toggle di massa degli endpoint e di una collezione;
- eliminazione di endpoint e del contenuto di una collezione;
- import OpenAPI e creazione dallo storico;
- rinomina dei file dati con riscrittura dei riferimenti.

Prova riprodotta da entrambi i revisori: abilitare in massa un handler non compilabile restituisce
200; il catalogo lo mostra abilitato e senza errori, ma la richiesta applicativa restituisce 404.
La modifica singola equivalente rifiuta invece l'operazione e ripristina il file.

Il contratto richiesto è **esito esplicito e stato coerente al termine**, senza promettere
isolamento verso il traffico durante le scritture. Gli import già parziali devono riportare esiti
per elemento e stato dell'applicazione runtime; non diventano implicitamente tutto-o-niente.
Per eliminazioni e rinomine va verificato l'effetto atteso: cercare errori solo su un percorso
ormai eliminato non è una verifica sufficiente.

### 5.11 Diagnostica runtime non interrogabile

`GET /mocks` legge il filesystem e costruisce i propri errori. Il loader compila anche gli script,
rileva conflitti e può reintegrare una vecchia rotta. I suoi errori non sono conservati in uno
stato interrogabile, né alimentano correttamente la status bar. Una mutazione che valida il
reload può già riportarli al suo chiamante: non sono assenti da qualsiasi risposta API.

Serve conservare l'esito del caricamento iniziale e dell'ultimo reload, distinguendo applicazione
completa, applicazione degradata e fallimento globale. Per gli endpoint in errore va indicato se
la versione precedente è stata mantenuta o non è disponibile. Dopo un rollback riuscito la
diagnostica corrente descrive lo stato ripristinato; l'errore della mutazione resta nella risposta.

### 5.12 Reload aggiuntivi e interruzione degli stream

Con watcher attivo una scrittura API può provocare ulteriori reload quando viene osservata su
disco. Nelle prove una PUT della descrizione e una PATCH di massa hanno prodotto due reload;
con watcher disattivato la PUT ne ha prodotto uno. Non è una proprietà di ogni mutazione né
una garanzia sul numero esatto: dipende da file scritti, eventi e aggregazione delle scansioni.

Ogni reload riuscito invoca attualmente `closeAll()` sugli store SSE/WS. Una modifica a un
endpoint estraneo può quindi interrompere stream aperti altrove; l'eco può richiudere anche
connessioni aperte subito dopo la risposta API.

La correzione approvata confronta disponibilità e definizione attiva degli stream: chiude solo
le connessioni coinvolte da un cambiamento pertinente. SSE e WS hanno configurazioni dichiarative,
quindi questo intervento non dipende da un confronto generale degli handler compilati. Descrizioni,
titoli, preset della console e varianti inattive non cambiano il comportamento dello stream.

Una scansione ridondante può restare; non deve produrre nuove interruzioni. Catalogo e diagnostica
si aggiornano anche quando il comportamento servito resta invariato. Ignorare a tempo gli eventi
del watcher potrebbe invece perdere modifiche esterne e non è la soluzione proposta.

## 6. Raccomandazioni dopo l'arbitraggio

La tabella conserva gli ID 1–16 dell'analisi iniziale e aggiunge le garanzie emerse nella review.
Le priorità esprimono l'ordine dei casi d'uso; i passi eseguibili sono nel piano separato.

| ID | Raccomandazione aggiornata | Collocazione |
|---|---|---|
| 1 | Correggere il default admin in `loadConfig`, con test dev/prod e override | Fondamenta |
| 2 | 404 JSON conclusivo nel namespace admin, senza fallthrough al proxy | Fondamenta |
| 3 | Allineare guide IT/EN e reference; aggiornare il flusso offline/live nello skill principale | Ogni passo, completamento nel primo caso |
| 4 | Guardia router–OpenAPI e convenzione sui trasporti della UI (`HttpClient`, `fetch`, `EventSource`, `WebSocket`, `XMLHttpRequest`), con eccezioni intenzionali | Fondamenta; non prova equivalenza comportamentale |
| 5 | `/info`: identità del workspace, percorsi reali, versione, identità dell'esecuzione e stato del watcher | Primo caso |
| 6 | Spec OpenAPI canonico sotto `src/admin/`, servito dal motore e distribuito in Electron e Docker | Primo caso; spostamento ancora da eseguire |
| 7 | GET della configurazione effettiva nel primo caso; PATCH effimero e visibile nella GUI nel terzo caso | Separare lettura e scrittura |
| 8 | Monitor limitato, filtri, sommario, lettura per ID e cursori con perdita osservabile | Primo caso; long polling rinviabile |
| 9 | Conversione traffico → mock lato server riusata dalla UI, con esiti per elemento e selezione esplicita delle varianti aggiunte | Secondo caso |
| 10 | Sincronizzazione GUI con ritorno in primo piano e polling di stato/revisioni; preservare bozze e diagnostica | Primo caso; nessun SSE generale nuovo richiesto |
| 11 | Gate per workspace più revisione attesa per descrizioni e varianti; bersaglio della bozza stabile | Primo caso, prima del polling |
| 12 | GET della variante per nome e creazione con `select: false` | Anticipata nel primo caso |
| 13 | Batch sposta/elimina, con atomicità delimitata e verificata per operazione | Rinviabile; non promettere un solo reload totale |
| 14 | Reload esplicito con esito e diagnostica per sincronizzare scritture su file | Eventuale evoluzione fuori da S0–S8; non richiesto dal setup via API e non incluso nel piano corrente |
| 15 | Clonazione lato server fra tipi di variante | Rinviabile |
| 16 | Scenari attivabili in blocco | Evoluzione eventuale; non prerequisito del setup con API esistenti |
| 17 | Validazione uniforme dell'esito delle mutazioni, distinguendo rollback e batch parziali | Fondamenta, vedi 5.10 |
| 18 | Diagnostica runtime persistente in memoria e interrogabile da API/GUI | Primo caso, vedi 5.11 |
| 19 | Preservare gli stream invariati durante preparazione e reload aggiuntivi | Primo caso, vedi 5.12 |

### Confini delle garanzie

- Il setup del test imposta esplicitamente selezioni, abilitazioni, modalità e stato pertinente;
  non dipende da come era rimasta la sessione precedente. Le risposte delle mutazioni devono
  consentire di sapere se l'effetto necessario è applicato.
- Nessun undo server, snapshot di sessione o comando di ripristino è richiesto. Non si aggiunge
  una precondizione sulla selezione al solo scopo del ripristino. L'eventuale ritorno a vecchi
  valori resta al client; la gestione dei retry ambigui resta invece necessaria.
- I test che modificano le stesse risorse non sono isolati dalla sola protezione delle bozze:
  devono essere coordinati o usare istanze/workspace distinti.
- La persistenza della configurazione resta a file e desktop. I futuri override API sono
  effimeri, visibili e rimovibili; si applicano con snapshot coerente alle nuove richieste.
  Host e porta restano fuori dal PATCH iniziale.
- Apertura/chiusura workspace, lingua, preferenze della finestra e aggiornamenti desktop sono
  esclusi. Un secondo processo headless sullo stesso workspace richiede coordinamento e non
  equivale a controllare l'istanza già usata dal frontend.

### Distribuzione, guide e note di rilascio

Fino a S2 il contratto era in `docs/admin-api.openapi.yaml` (percorso storico): `.dockerignore`
esclude `docs/` e il pacchetto Electron copia il motore da `src/`. S2 ha spostato la fonte
canonica in `src/admin/admin-api.openapi.yaml`, aggiornando validatore, test e link correnti. La rotta dello
spec resta sotto la stessa abilitazione admin; la standalone non deve esporla quando l'admin è
spenta. Serve una sola fonte modificabile e una prova sia del layout Electron sia di Docker.

L'allineamento documentale comprende tutti e quattro gli skill: workspace per il flusso e
`select: false`; static-mock per dipendenze sequence e validazione; realtime-mock per la nuova
chiusura degli stream; dynamic-mock per i contratti interessati di handler/step e reset. Le
reference SSE/WS e `docs/{it,en}/RESPONSE.md` oggi dichiarano la chiusura a ogni reload: vanno
cambiate insieme al codice. La distinzione fra validazione API e loader va mantenuta nelle guide.

[NOTE-RILASCIO-next.md](NOTE-RILASCIO-next.md) va aggiornato nei passi implementativi pertinenti:
nuovo default admin, namespace admin riservato, stream preservati ed eventuali cambi di forma o
ordine nel Monitor. Qui si descrivono cambiamenti previsti; le note rivolte agli utenti non devono
annunciarli come già realizzati. Sulla base aggiornata il file contiene le note di v1.3.2: i futuri
incrementi del piano vanno in una sezione distinta per la prossima versione, seguendo
[PROCEDURA-RILASCIO.md](PROCEDURA-RILASCIO.md), compresa l’integrazione manuale delle note curate
nella bozza GitHub. Il piano contiene una matrice dei file e dei passi coinvolti.

### Un server MCP?

Non è necessario al perimetro iniziale: HTTP, contratto distribuito e skill aggiornato offrono
il percorso scelto. Un eventuale adattatore MCP va motivato da esigenze successive; la riuscita
del primo incremento si misura sui flussi e sulle garanzie, non sul numero delle rotte aggiunte.

## 7. Come un agent pilota Mockxy oggi

Finché le correzioni non arrivano:

1. **Trovare l'istanza**: nel server headless la porta è `PORT` (default 3000); nel desktop è
   quella in `<workspace>/.mockxy/settings.json`, che l'app aggiorna anche quando ripiega su una
   porta libera.
2. **Verificare**: `curl -s http://127.0.0.1:<porta>/_admin/api/info` riporta `workspace`
   (percorsi canonici e `id`) e `runtimeId` (da S2): confermano di parlare con l'istanza del
   workspace giusto, e un `runtimeId` diverso rivela un riavvio.
   Se risponde `404 Admin API disabled`, riavviare con
   `ADMIN_API_ENABLED=true` (5.1).
3. **Contratto**: `src/admin/admin-api.openapi.yaml` nel repository, oppure `GET /_admin/api/openapi.yaml`
   dal runtime in esecuzione (da S2).
4. **Accortezze**:
   - controllare metodo e percorso: una rotta sbagliata non dà 404 ma può arrivare al backend
     (5.2);
   - dopo una modifica via API, dire all'utente di ricaricare la GUI o di premere «Ricarica» nel
     catalogo (5.6);
   - aggiungere o selezionare una variante cambia subito quello che riceve il frontend (5.9);
   - preparare ogni test impostando le condizioni che usa; una lettura del catalogo non basta
     a certificare il runtime finché 5.10–5.11 non sono corretti. Per sequence, preferire stato
     amministrativo e reset esplicito a richieste di prova che ne consumerebbero uno step;
   - coordinare il lavoro sulle risorse della stessa feature. Non è richiesto lasciare il
     workspace nella configurazione iniziale dopo la prova;
   - per creare mock dal traffico senza replicare le regole del client: attivare il dump
     (`PATCH /monitoring/dump {"enabled": true}`) **prima** del traffico, poi fare il flush,
     leggere le voci con `GET /monitoring/dumps/read` (ognuna ha un `dumpKey`) e passare le chiavi
     a `POST /monitoring/dumps/create-mocks`. Le regole le applica il server; gli endpoint già
     esistenti vengono saltati.

## Appendice A — test di parità router ↔ OpenAPI

Bozza del test proposto nella raccomandazione 4: confronta metodi e percorsi, non payload o
comportamenti. I test di flusso del piano completano questa guardia.

Il router si costruisce senza dipendenze reali;
i nomi dei parametri vengono normalizzati, perché router e spec li chiamano in modo diverso
(`:parentKey` e `{parentKey}`, ma anche `:responseFileName`).

```js
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { createAdminApiRouter } = require("../src/admin/admin-api");

const METHODS = ["get", "post", "put", "patch", "delete"];
const normalize = (route) => route.replace(/[:{][A-Za-z]+\}?/g, "{}");

test("ogni rotta del router admin è documentata nell'OpenAPI e viceversa", () => {
  const router = createAdminApiRouter({ config: {}, sharedStates: {} });
  const routes = router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods)
      .map((method) => normalize(`${method.toUpperCase()} ${layer.route.path}`)));

  const specPath = path.join(__dirname, "..", "src", "admin", "admin-api.openapi.yaml");
  const spec = yaml.safeLoad(fs.readFileSync(specPath, "utf8"));
  const operations = Object.entries(spec.paths).flatMap(([route, item]) =>
    METHODS.filter((method) => item[method])
      .map((method) => normalize(`${method.toUpperCase()} ${route}`)));

  expect(new Set(routes)).toEqual(new Set(operations));
});
```

Esito oggi: 49 rotte contro 49 operazioni, nessuna differenza.

## Appendice B — rotte assenti dalla reference dello skill

`mockxy-skills/skills/mockxy-workspace/references/admin-api.md` documenta 38 rotte su 49. Mancano:

- `PATCH /mocks/enabled`
- `PATCH /mocks/collections/order`
- `PATCH /mocks/collections/:id/items/order`
- `PATCH /mocks/collections/:parentKey/children/order`
- `DELETE /monitoring/requests`
- `GET /monitoring/requests/stream`
- `GET /monitoring/dump`
- `PATCH /monitoring/dump`
- `GET /monitoring/dumps`
- `GET /monitoring/dumps/read`
- `DELETE /monitoring/dumps/:file`

`docs/it/ADMIN-API.md` e `docs/en/ADMIN-API.md` ne documentano 48 su 49: manca soltanto
`PATCH /mocks/enabled`, che è invece nell'OpenAPI.

## Appendice C — prova dal vivo dell’analisi iniziale (25 settembre 2026)

Motore avviato da `index.js` su una copia del workspace demo, porta 39417.

| Passo | Esito |
|---|---|
| Avvio senza `ADMIN_API_ENABLED` | `404 Admin API disabled` su ogni rotta (5.1) |
| `POST /mocks` per `GET /agent/hello`, poi chiamata all'endpoint | `201`; l'endpoint risponde `200 {"msg":"hi"}` con `x-mock-source: mock` |
| `POST /mocks/:id/responses` con una variante 500 | la variante viene creata **e selezionata**: la chiamata successiva riceve `500` |
| `GET /mocks/:id` | body della sola variante selezionata; delle altre solo metadati |
| `PUT /mocks/:id/endpoint {"enabled": false}` | `200`; l'endpoint risponde `404` (mock-only) |
| `GET /monitoring/requests?method=POST` | filtro ignorato: restituisce tutte le voci `GET` |
| `GET` su `/monitoring/requests/1`, `/info`, `/config`, `/version`, `/health`, `/openapi.json`, `/runtime/reload` | tutte `404` dalla pipeline dei mock, non dall'admin API |
| Stesse rotte con proxy fallback e backend finto | `GET /_admin/api/info` arriva al backend; `POST /_admin/api/typo` dà `502`; nessuna voce nel Monitor |


## Appendice D — riscontri aggiunti dalla review (26 settembre 2026)

| Caso | Riscontro |
|---|---|
| PUT descrizione con watcher attivo | un reload alla risposta, due dopo l'eco osservata; watcher chiuso: uno |
| Handler non compilabile su endpoint precedentemente disabilitato, poi abilitazione di massa | API 200, catalogo abilitato e senza errori, runtime 404 |
| Script invalido dopo un mock valido | reload `applied: true` con errore; catalogo senza errore; ancora servito il vecchio body |
| Modifica della descrizione di un endpoint estraneo a uno stream SSE aperto | stream chiuso dal reload nella prova di Opus; causa `closeAll()` confermata nel codice |
| Bozza descrizione caricata prima di una disabilitazione esterna | il payload GUI include l'`enabled` precedente: possibile riabilitazione involontaria, confermata per lettura del codice |

La review distingue prove dal vivo, controlli isolati e deduzioni. Questo documento descrive i
problemi del codice alla base indicata; il piano non implica che le correzioni siano già presenti.
