# L'admin API — riferimento

Tutta l'interfaccia di Mockxy è costruita sull'**admin API** sotto `/_admin/api`: non esiste
un'operazione della UI che non passi da qui. La conseguenza utile è che **tutto ciò che fa
l'interfaccia è automatizzabile** — script di setup che popolano un workspace, suite e2e che
resettano lo stato tra i test, pipeline che importano una specifica aggiornata.

**Il contratto evolve con l'app.** L'admin API segue le versioni di Mockxy, e una minor può
cambiarne il contratto: le [note di rilascio](../progetto/NOTE-RILASCIO-next.md) dicono cosa
cambia per i client. Chi usa le capacità più recenti (revisioni, varianti inattive, Monitor a
pagine) legge prima la versione da `GET /info` e il contratto da `GET /openapi.yaml`. Se il
runtime non espone queste rotte, o non dichiara quelle che servono, il client si ferma prima di
qualunque modifica e indica l'aggiornamento necessario: una capacità non si scopre provando a
scrivere.

## Quando risponde e come si protegge

- Attiva con `ADMIN_API_ENABLED` (default: attiva in sviluppo, spenta in produzione). Da
  spenta, ogni rotta risponde `404` con un messaggio esplicito.
- Il namespace `/_admin/api` è **riservato**: un metodo o un percorso che non compare qui
  sotto risponde `404` con `details.code: "ADMIN_ROUTE_NOT_FOUND"`. Non prosegue mai nel
  serving dei mock né nel proxy verso il backend, e un mock dichiarato sotto `/_admin/api` non
  viene servito, nemmeno come WebSocket.
- **Niente autenticazione**: crea handler, cioè scrive file ed esegue codice. Le protezioni e
  le regole di esposizione sono nella pagina sull'[esposizione in rete](RETE.md) (guardia
  anti DNS rebinding sull'header `Host`, avviso su bind non-loopback).
- Le mutazioni accettano solo **JSON esplicito**: è anche la difesa anti-CSRF — una richiesta
  cross-origin con `content-type: application/json` scatena il preflight del browser e muore
  lì. L'unica eccezione strutturale è l'import OpenAPI, che accetta YAML ma **rifiuta
  `text/plain` con `415`** proprio per non aprire la falla delle richieste "semplici".
- Le POST senza parametri (`sequence/reset`, `monitoring/dump/flush` e i due reset dello stato
  condiviso) richiedono comunque `Content-Type: application/json` e un body esattamente `{}`.
  Body assente o vuoto, `null`, array, scalari e oggetti non vuoti rispondono `400`; un media
  type diverso risponde `415`. La forma unica rende il contratto esplicito e uniforme.

## Convenzioni

- **`:id`** degli endpoint è il percorso relativo del file endpoint codificato base64url: si
  ottiene dalle liste e si tratta come **opaco**.
- Gli **errori** sono JSON `{ error, message, details? }` con lo status appropriato
  (`400` input invalido, `403` header `Host` inatteso, `404` non trovato, `409` conflitto,
  `415` media type non supportato, `500` fallimento imprevisto). Gli errori più recenti
  aggiungono un codice stabile in `details.code`, così il client non deve interpretare il testo.
- Le mutazioni sul catalogo **attendono il giro di reload che contiene la scrittura e ne
  verificano l'esito**: la modifica è servita dalla richiesta successiva. Un `2xx` significa che
  i file sono scritti **e** che il runtime riflette l'effetto richiesto sugli endpoint coinvolti:
  serviti se abilitati, spariti se disabilitati o eliminati. Un errore di caricamento su quegli
  endpoint, un reload fallito o un errore di scrittura annullano la modifica; gli errori di
  endpoint estranei non fanno fallire una mutazione valida. Non c'è isolamento dal traffico
  durante la scrittura: la garanzia è uno stato coerente al termine.
- Gli **esiti negativi delle mutazioni** portano `details.code` e `details.rollback`
  (`not_needed`, `restored` o `failed`):
  - `400 MUTATION_REJECTED`: input non valido (niente da ripristinare) oppure modifica che il
    runtime non riesce ad applicare (file ripristinati);
  - `500 RUNTIME_APPLY_FAILED`: il reload del runtime è fallito nel suo insieme; file ripristinati;
  - `500 MUTATION_FAILED`: errore imprevisto durante la scrittura; file ripristinati;
  - `500 ROLLBACK_FAILED`: è fallito anche il ripristino (`rollback: "failed"`, con `cause` e
    `recoveryError`), anche solo perché dopo il ripristino un endpoint coinvolto non è servito
    com'era prima: non è più servito, oppure resta la versione della modifica rifiutata perché il
    ripristino non è riuscito a ricaricarlo. Lo stato del workspace non va considerato coerente:
    `GET /runtime/status` mostra l'esito dell'ultimo caricamento e gli errori per file.
- **Una mutazione alla volta** per workspace: le mutazioni vengono messe in coda, mentre letture,
  traffico e push delle console SSE/WS non le aspettano. Un client che si disconnette non
  interrompe una mutazione già partita.
- **Letture durante una modifica:** il dettaglio di un endpoint non è una fotografia atomica di
  più file. Se durante la lettura manca un file, il dettaglio viene ricomposto una volta dalla
  definizione riletta, seguendone la selezione; un endpoint eliminato nel frattempo risponde
  `404`. Se il file manca ancora, la risposta è `409` con
  `details: { code: "READ_INCONSISTENT", retryable: true }` e nessun dettaglio parziale: si
  ripete la lettura al massimo una volta in automatico. Il messaggio nomina il file mancante,
  che può anche essere stato cancellato a mano.
- **Bozze protette da revisione:** il dettaglio riporta `descriptionRevision` e `responseRevision`
  (la variante selezionata), la lettura di una variante `revision`. Sono token di contenuto
  (`rev-v1:…`) calcolati dagli stessi dati restituiti: la descrizione copre il solo valore, la
  variante la definizione persistita e i byte del sorgente e dell'asset diretti. Tornare allo
  stesso contenuto ridà lo stesso token, anche dopo un riavvio. Chi salva da una bozza manda
  `expectedRevision` (per l'upload l'header `X-Mockxy-Expected-Revision`): il controllo avviene
  nella coda, rileggendo il contenuto reale, e se è cambiato la risposta è
  `409 REVISION_CONFLICT` con `details.resource`, `expectedRevision` e `currentRevision`, senza
  scrivere né ricaricare. Non va ripetuto alla cieca: si rilegge, si confronta e si salva
  deliberatamente con la nuova revisione. Senza precondizione tutto funziona come prima.
- I file dati non ricaricano nulla ([`data()` rilegge a ogni chiamata](DATI.md)), con
  un'eccezione: la rinomina con riscrittura dei riferimenti ricarica, perché ha toccato i
  sorgenti degli handler, e verifica gli handler riscritti come ogni altra mutazione.

## Catalogo ed endpoint

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /mocks` | l'intero catalogo: endpoint, collezioni e ordinamenti; ogni endpoint espone anche `sequenceActive` per il badge SEQ. Un file endpoint illeggibile (JSON invalido, variante selezionata mancante) non fa fallire la richiesta: quell'endpoint viene saltato e segnalato in `loadErrors` (`[{ configFilePath, message }]`), come fa il runtime al caricamento |
| `GET /mocks/resolve?method&path` | l'endpoint che oggi coprirebbe una richiesta concreta (path con eventuale query), disabilitati inclusi; `{ mock: null }` se nessuno. Fatto derivato col matching del serving, usato dal monitor per "vai al mock" |
| `POST /mocks` | crea un endpoint (mock statico, o handler/middleware con sorgente); se per rotta+metodo esiste già risponde `409` con `details.existingMockId`, così il client può proporre l'aggiunta di una variante a quell'endpoint |
| `GET /mocks/:id` | dettaglio con varianti e configurazione normalizzata della response selezionata; con `type: sequence` espone `sequence` e `sequenceState`, mai `endpoint.sequence`. `409 READ_INCONSISTENT` se un file referenziato manca anche al secondo tentativo |
| `PUT /mocks/:id` | seleziona una response con `{ selectedResponseFile }`, oppure aggiorna la response ordinaria selezionata; il vecchio body `{ sequence }` è rifiutato. Nell'aggiornamento `expectedRevision` protegge la variante selezionata (il token include il filename); un payload protetto che cambierebbe `enabled`, o un cambio di selezione protetto, è `400` |
| `GET /mocks/:id/sequence/state` | stato live leggero della sequence selezionata: `{ sequenceFile, sequenceState }`; `400` su un altro tipo |
| `POST /mocks/:id/sequence/reset` | azzera cursore e memoria handler della sequence selezionata; body `{}`; risponde `{ sequenceFile, sequenceState }` |
| `POST /mocks/:id/sse/push` | push manuale della console [SSE](RESPONSE.md): body `{ data, event?, id? }`, broadcast a tutte le connessioni aperte — risponde `{ delivered, connections }`. Il bersaglio è la definizione servita dal runtime, anche la vecchia rotta mantenuta quando una nuova selezione non si carica, non la selezione su disco: `404` se il runtime non serve l'endpoint, `400` se la serve con un altro tipo, middleware compresi. Vale anche per le altre tre rotte delle console |
| `GET /mocks/:id/sse/connections` | stato della console SSE: connessioni aperte (con posizione nel copione) e storico dei messaggi usciti |
| `POST /mocks/:id/ws/push` | push manuale della console [WS](RESPONSE.md): body `{ data }`, broadcast a tutte le connessioni aperte — risponde `{ delivered, connections }` |
| `GET /mocks/:id/ws/connections` | stato della console WS: connessioni aperte (con posizione nel copione) e transcript bidirezionale (usciti e ricevuti) |
| `PUT /mocks/:id/endpoint` | aggiorna **solo** `description` ed `enabled` (qualunque altro campo è `400`): metodo e percorso sono fissati alla creazione — il percorso determina la cartella dei file — e si cambiano con `POST /mocks/:id/copy`. Con `expectedRevision` (la `descriptionRevision` letta) protegge la sola descrizione: va inviata con `description` e senza `enabled` |
| `POST /mocks/:id/copy` | duplica su nuovo metodo+percorso — body `{ method, path, copyResponses }`; con `?dryRun=true` restituisce il piano senza scrivere né ricaricare |
| `PATCH /mocks/enabled` | abilita o disabilita un elenco di endpoint — body `{ ids, enabled }`, con `ids` non vuoto (i duplicati vengono unificati); un id sconosciuto fa fallire la richiesta prima di scrivere; risponde col catalogo aggiornato `{ items, collections, childOrder }`. È la rotta dietro la selezione multipla del catalogo |
| `PUT /mocks/:id/collection` | assegna l'endpoint a una collezione |
| `DELETE /mocks/:id` | elimina endpoint e varianti |

## Varianti di risposta

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /mocks/:id/responses/:file` | una variante per filename, selezionata o no: `{ id, responseFile, selected, active, response, source, fileInfo }`, con il sorgente di handler e middleware e i metadati (`name`, `size`) dell'asset di un mock servito da file, mai il contenuto binario. `active` dice se è la selezionata o uno step della sequence selezionata: va controllato prima di considerare innocua una modifica; se la variante selezionata è illeggibile la risposta è `400`, non un `active` inventato. Leggerla non cambia selezione né scenario; una variante non più elencata è `404`, un file mancante segue la procedura `READ_INCONSISTENT` del dettaglio |
| `POST /mocks/:id/responses` | aggiunge e seleziona una variante `mock`, `handler`, `middleware`, `sse`, `ws` o `sequence`; il clone generico vale anche per sequence. Con `select: false` la prepara senza attivarla: selezione, cursore della sequence e memoria handler non cambiano, la validazione è la stessa. La risposta riporta `createdResponseFile` |
| `PUT /mocks/:id/responses/:file` | aggiorna una variante; per sequence modifica titolo/step/fine/reset e valida tutto il grafo. La risposta riporta `updatedResponseFile`, indipendente dalla variante selezionata del dettaglio |
| `PUT /mocks/:id/responses/:file/file` | carica i byte grezzi che rendono la variante [file-backed](RESPONSE.md) — body `application/octet-stream` (fino a 12 MB), MIME e nome in query (`?contentType=…&filename=…`). La precondizione va nell'header `X-Mockxy-Expected-Revision` |
| `DELETE /mocks/:id/responses/:file` | elimina una variante; risponde `409` con `details.referencedBy` se è usata da una sequence |

## Collezioni

| Metodo e percorso | Cosa fa |
|---|---|
| `POST /mocks/collections` | crea una collezione (anche annidata) |
| `PATCH /mocks/collections/order` | riordina le collezioni radice |
| `PATCH /mocks/collections/:id/parent` | sposta una collezione nell'albero |
| `PATCH /mocks/collections/:id/items/order` | riordina gli endpoint di una collezione |
| `PATCH /mocks/collections/:key/children/order` | riordina le sottocollezioni |
| `PATCH /mocks/collections/:id/enabled` | abilita/disabilita **in massa** il sottoalbero ([semantica](CATALOGO.md)) |
| `DELETE /mocks/collections/:id` | **dissolve** il sottoalbero; gli endpoint tornano in Unsorted |
| `DELETE /mocks/collections/:id/contents` | elimina definitivamente il sottoalbero e tutti gli endpoint contenuti; con `id=unsorted` elimina tutti e soli gli endpoint non assegnati — risposta `{ deleted }` |

## Import OpenAPI

| Metodo e percorso | Cosa fa |
|---|---|
| `POST /mocks/import/openapi` | importa la specifica (body grezzo JSON/YAML, fino a 12 MB) — [regole di generazione](OPENAPI.md). Procede per elemento: `items` riporta per ogni operazione `writeOutcome` e `runtimeOutcome`, `runtime.status` dice se il runtime è `applied` o `degraded`; se fallisce il reload finale risponde `500 BATCH_RUNTIME_FAILED` con il risultato completo in `details.result`. Se il ripristino di un elemento fallito non riesce, si ferma lì e risponde `500 ROLLBACK_FAILED`, con gli elementi elaborati fino a quel punto in `details.result`. Una collection non assegnata non annulla l'endpoint: finisce nell'`error` dell'elemento |
| `POST /mocks/import/openapi?dryRun=true` | solo il piano con i conteggi, senza scrivere nulla |
| `POST /mocks/import/openapi?prefix=/be` | antepone `/be` a tutti i percorsi importati (vale anche con `dryRun`); il piano riporta `prefix` applicato e `suggestedPrefix` ricavato dai `servers` |

## File dati

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /files` | elenco con metadati e endpoint che li usano (`usedBy`) |
| `GET /files/:name` | contenuto di un file dati |
| `PUT /files/:name` | crea (`201`) o sostituisce (`200`) — byte grezzi fino a 25 MB, JSON validato prima di scrivere |
| `PATCH /files/:name` | rinomina — body `{ name, rewriteReferences }` ([rinomina sicura](DATI.md)) |
| `DELETE /files/:name` | elimina il file |

## Stato runtime condiviso

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /runtime/shared-state` | elenca metadati, uso corrente e limiti dello store; non espone mai i valori |
| `POST /runtime/shared-state/:name/reset` | invalida in modo idempotente una risorsa; body `{}`; risponde `{ name, reset }` |
| `POST /runtime/shared-state/reset` | invalida tutte le risorse; body `{}`; risponde `{ resetCount }` |

La lista espone nome, `seedKey`, stato (`initializing` o `ready`), versione, byte occupati,
timestamp e origine dell'inizializzazione/ultimo accesso. Serve a diagnosticare gli handler che
usano una firma non più compatibile, ma resta una superficie amministrativa: non contiene il
JSON vivo. Un reset non scrive i file dati e non modifica sequence, `state`, `callCount` o
`firstRequestAt`.

Il reset linearizza l'invalidazione ma non ferma il traffico: una richiesta successiva può
inizializzare subito una nuova generazione. In una suite deterministica, interrompere prima
client e polling, eseguire il reset, poi avviare lo scenario.

## Monitor e storico

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /monitoring/requests` | senza query: tutte le voci in RAM, complete, dalla più recente (`{ items }`, come prima). Con `view=page`: una [pagina a cursore](#leggere-il-monitor-a-pagine), in ordine crescente, con filtri e perdita dichiarata |
| `GET /monitoring/requests/:id?runtimeId=…` | una voce completa per ID, nel runtime indicato: `{ runtimeId, item }`; `409 RUNTIME_CHANGED` se il motore è ripartito, `404 REQUEST_NOT_AVAILABLE` se la voce è stata espulsa, cancellata o non esiste |
| `POST /monitoring/requests/create-mocks` | crea mock da voci del Monitor, nell'ordine dato — body `{ runtimeId, ids, onConflict, selectAddedVariants?, newEndpointEnabled }`; [regole ed esiti](#creare-mock-dal-traffico) |
| `DELETE /monitoring/requests` | svuota la vista live (gli archivi non sono toccati) |
| `GET /monitoring/requests/stream` | flusso live degli eventi (SSE) |
| `GET /monitoring/dump` | stato della scrittura su disco |
| `PATCH /monitoring/dump` | accende/spegne e regola cadenza/soglia a runtime — body `{ enabled?, intervalMs?, threshold? }` |
| `POST /monitoring/dump/flush` | flush manuale; body `{}`; risponde con il numero di voci scritte |
| `GET /monitoring/dumps` | elenco dei file di dump |
| `GET /monitoring/dumps/read` | lettura paginata a cursore (`?fileIndex&lineIndex&limit`) |
| `POST /monitoring/dumps/create-mocks` | crea mock in blocco da un file o da una selezione di voci (`file` o `keys`), con le stesse [regole ed esiti](#creare-mock-dal-traffico) del Monitor; le opzioni sono facoltative, con i default storici `onConflict: "skip"`, `selectAddedVariants: false`, `newEndpointEnabled: true`. Conserva i conteggi (`created`, `createdEmpty`, `skippedExisting`, `failed`) e aggiunge `addedVariants`; `items` riporta la `key` della voce |
| `DELETE /monitoring/dumps/:file` | elimina un file di dump |

### Leggere il Monitor a pagine

Con `view=page` il Monitor si interroga come serve a un agente o a un test: «cosa è passato da
quando ho guardato l'ultima volta». Il Monitor resta un buffer in memoria delle ultime voci, non un
archivio: per la cattura durevole c'è il dump.

| Parametro | Significato |
|---|---|
| `limit` | voci per pagina, da 1 a 250; predefinito 50 |
| `fields` | `summary` (predefinito: identità, esito, `matchedRoutePath`, `sequenceStep`, `sharedStateError`; niente body né header) oppure `full` (la voce completa, con gli indicatori di troncamento) |
| `method`, `path`, `status`, `source` | filtri in AND, per uguaglianza esatta; il metodo non distingue maiuscole, `path` è il percorso senza query |
| `since` | l'ID esclusivo da cui ripartire (`cursor.since` della pagina precedente), oppure `latest` per partire da adesso; assente per leggere il buffer disponibile |
| `runtimeId`, `generation` | quelli del cursore: obbligatori con un `since` numerico, vietati altrimenti |

La risposta è `{ items, cursor, hasMore, gap, gapReason, available }`. Gli ID sono stringhe
decimali crescenti nel runtime; `generation` cresce a ogni svuotamento, anche di un buffer già
vuoto, e lo svuotamento non riutilizza gli ID. Ogni pagina restituisce fino a `limit`
corrispondenze dopo il cursore: se ne restano altre `hasMore` è `true` e `cursor.since` è l'ultimo
ID restituito, altrimenti `cursor.since` è l'ultimo ID assegnato (`available.highWatermark`),
anche senza corrispondenze. Il traffico arrivato nel frattempo finisce nella pagina successiva,
senza perdite né duplicati. Per leggere in modo incrementale si rimandano `since`, `runtimeId` e
`generation` del cursore con gli stessi filtri; cambiare filtri richiede una lettura nuova (senza
`since` o con `since=latest`), mentre `limit` e `fields` possono cambiare fra una pagina e l'altra.

Se il motore è ripartito (`runtime_changed`), il Monitor è stato svuotato (`cleared`) o le voci
dopo il cursore sono già state espulse (`evicted`), la risposta è comunque `200` con `gap: true`,
il motivo, e la pagina riparte dal primo elemento disponibile. **Con `gap: true` una lista vuota
non significa «nessuna richiesta»**: l'intervallo perso poteva contenerne. Un `since` oltre
l'ultimo ID assegnato nello stesso runtime è `400 CURSOR_AHEAD`.

Qualunque parametro richiede `view=page`, e un parametro sconosciuto è un `400` con
`details.code: "INVALID_QUERY"` e il nome in `details.parameter`: prima questi parametri venivano
ignorati, e un filtro scritto male sembrava un Monitor vuoto.

```bash
# da adesso in poi: il cursore da cui ripartire dopo l'azione
curl -s "http://localhost:3000/_admin/api/monitoring/requests?view=page&since=latest"
# le GET su /api/orders arrivate dopo quel cursore
curl -s "http://localhost:3000/_admin/api/monitoring/requests?view=page&method=GET&path=/api/orders&since=41&runtimeId=…&generation=1"
```

### Creare mock dal traffico

Monitor e Storico trasformano una risposta catturata in un mock con le stesse regole:

- **Rotta e metodo:** la rotta che l'ha servita (`matchedRoutePath`, se presente e diversa da
  `n/d`), altrimenti il path richiesto; metodo in maiuscolo. Nessuna rotta parametrica dedotta.
- **Status e ritardo:** lo status catturato; `delayMs` 0.
- **Body:** vuoto → `{}`; JSON valido → il valore; altro testo → la stringa. Un body troncato o un
  segnaposto `[binary payload: …]`/`[compressed payload: …]` diventa `{}` e la bozza è
  **incompleta**: un endpoint nuovo ha la descrizione `[da completare] …`, una variante aggiunta
  il titolo che inizia con `[da completare]`, e l'elemento l'avviso `INCOMPLETE_CAPTURE` con
  `reason` `truncated` o `binary`. Non è una riproduzione fedele e non viene presentata come tale.
- **Header:** quelli della risposta catturata, senza `content-length`, `content-encoding`,
  `transfer-encoding`, `connection`, `keep-alive`, `date`, valori vuoti e valori mascherati `***`
  (un valore mascherato non viene mai ripristinato); i valori multipli si uniscono con `, `.
- **Conflitto:** sull'identità della destinazione, metodo e rotta esatti, rispetto al catalogo e
  agli elementi già elaborati nello stesso batch. `onConflict: "skip"` la lascia com'è;
  `"add-variant"` aggiunge una variante (titolo con la provenienza e l'ora UTC della cattura, per
  esempio `monitor · 10:11:12`), conserva l'abilitazione dell'endpoint e la seleziona solo con
  `selectAddedVariants: true`. Più destinazioni equivalenti sono un errore dell'elemento, con
  `candidates`, mai una scelta arbitraria; anche un file endpoint nella cartella derivata dalla
  rotta che non dichiara quell'identità fa fallire l'elemento. Un endpoint nuovo nasce con la
  variante selezionata, abilitato solo con `newEndpointEnabled: true`.

Con il Monitor `runtimeId` è obbligatorio e deve essere quello corrente, perché gli ID ripartono a
ogni avvio: altrimenti `409 RUNTIME_CHANGED` prima di scrivere. Anche `onConflict` e
`newEndpointEnabled` sono obbligatori: una cattura non attiva mai niente in modo implicito. Le voci
si copiano all'inizio del turno nella coda delle mutazioni, quindi un'espulsione successiva non
invalida una cattura già presa; un ID non più disponibile è un elemento saltato con
`captureOutcome: "unavailable"`, e gli altri proseguono. Per preparare senza toccare ciò che è
servito si mandano `newEndpointEnabled: false` e `selectAddedVariants: false`, e si controllano gli
elementi incompleti prima di attivarli.

La risposta `201` riporta per ogni elemento `writeOutcome` (`created`, `variant_added`, `skipped`,
`failed`), `runtimeOutcome`, `captureOutcome` (`complete`, `incomplete`, `unavailable`) e
`warnings`, con `id` e `responseFile` scritti; dal Monitor anche `requestId` e `counts`. Un batch
**non è idempotente**: se la risposta si perde, rileggere il catalogo e fermarsi se non si possono
identificare con certezza gli elementi creati, senza ripetere alla cieca. La conversione non
cancella né le catture né i file di dump.

## Stato del server

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /server` | `{ serverEnabled, proxyAll }` — [le tre modalità](CONTROLLI.md) |
| `PATCH /server` | aggiornamento parziale dei due booleani |

## Runtime

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /info` | chi risponde e su cosa: `version`, `runtimeId` e `startedAt` (nuovi a ogni avvio), `workspace` (`id`, `root`, `mocksDir`, `filesDir` canonici; `root` solo dall'app desktop), `listener` realmente in ascolto, `watcher` (`state` fra `disabled`, `starting`, `ready`, `error`) e `revisions` (`catalog`, `server`, `dump`, `diagnostics`, `config`). Le revisioni partono da 1 e crescono quando la risorsa cambia: servono a sapere cosa rileggere, non sono precondizioni di scrittura. Non scansiona il workspace |
| `GET /config` | configurazione effettiva in sola lettura: `{ runtimeId, startup, effective, overrides, persisted }`, con le sole nove chiavi modificabili a runtime nelle prossime versioni (`backendUrl` è `null` senza backend). Nessun'altra variabile d'ambiente. Per ora `effective` coincide con `startup` e `overrides` è `{}`; `runtimeId` cambia a ogni avvio |
| `GET /runtime/status` | esito dell'ultimo caricamento del workspace, `200` anche se degradato o fallito: `lastAttempt` (`id`, istanti, `reasons` fra `startup`, `admin`, `watcher`, `status` `applied`, `degraded` o `failed`), `lastAppliedAttemptId`, `errors` per file (`endpointId`, `filePath`, `message`, `serving`: `retained` se resta servita la versione precedente, `missing` se nulla la serve) e `fatalError`. Solo l'ultimo tentativo, senza storico |
| `GET /openapi.yaml` | il [contratto](#la-descrizione-leggibile-dalle-macchine) della versione in esecuzione, come `application/yaml` |

## Esempi

```bash
# il catalogo completo
curl -s http://localhost:3000/_admin/api/mocks

# sospendi i mock: proxy totale verso il backend
curl -s -X PATCH http://localhost:3000/_admin/api/server \
  -H "content-type: application/json" -d '{"proxyAll": true}'

# anteprima di un import OpenAPI senza creare nulla
curl -s -X POST "http://localhost:3000/_admin/api/mocks/import/openapi?dryRun=true" \
  -H "content-type: application/yaml" --data-binary @openapi.yaml

# accendi la scrittura su disco dello storico e forza un flush
curl -s -X PATCH http://localhost:3000/_admin/api/monitoring/dump \
  -H "content-type: application/json" -d '{"enabled": true}'
curl -s -X POST http://localhost:3000/_admin/api/monitoring/dump/flush \
  -H "content-type: application/json" -d '{}'

# stato runtime (solo metadati) e reset idempotente di "items"
curl -s http://localhost:3000/_admin/api/runtime/shared-state
curl -s -X POST http://localhost:3000/_admin/api/runtime/shared-state/items/reset \
  -H "content-type: application/json" -d '{}'

# anteprima della copia: segnala anche riferimenti sharedState letterali conservati
curl -s -X POST "http://localhost:3000/_admin/api/mocks/ID/copy?dryRun=true" \
  -H "content-type: application/json" \
  -d '{"method":"GET","path":"/items-copy","copyResponses":true}'
```

L'anteprima e la copia reale condividono lo stesso planner. Il dry run risponde `200` con file
previsti, riferimenti `sharedState.open("nome", ...)` letterali e warning; la copia risponde
`201`. Il dry run non crea cartelle, non scrive file e non ricarica il runtime. I nomi dinamici
o nascosti in helper non sono rilevabili, mentre commenti/stringhe possono produrre un warning
prudenziale: l'anteprima informa, non abilita né blocca il commit. La copia non riscrive nome o
`seedKey`, perché condividere la risorsa può essere intenzionale.

## Preparare uno scenario via API

Un test o un agente che deve provare una funzione prepara lo scenario in modo **esplicito**,
qualunque stato abbia lasciato la sessione precedente: non esiste un «annulla», e non serve.

1. **Verificare l'istanza:** `GET /info` (il `workspace` giusto), `GET /openapi.yaml` (le rotte
   che si useranno) e `GET /config` (la configurazione di avvio da cui dipende il test, che per
   ora non si cambia via API: la prepara l'ambiente). Se qualcosa non torna, fermarsi.
2. **Preparare i contenuti:** risolvere endpoint e varianti dal catalogo per metodo, percorso e
   filename, mai per titolo né dalla selezione corrente. Leggere ogni variante
   (`GET /mocks/:id/responses/:file`) e salvarla con la `revision` letta come `expectedRevision`;
   creare con `select: false`. Controllare `active`: una variante non selezionata può essere uno
   step della sequence selezionata. Se l'esito di una creazione è incerto, rileggere prima di
   ritentare.
3. **Attivare:** dopo la preparazione riuscita, `PATCH /server` con `serverEnabled: true` e
   `proxyAll: false`, selezione delle varianti previste, abilitazione degli endpoint.
4. **Azzerare:** per una sequence, selezionarla e chiamare `POST /mocks/:id/sequence/reset`
   anche se era già selezionata; per lo stato condiviso, i reset delle sole risorse interessate.
5. **Nessuna attesa a tempo:** una mutazione riuscita è già servita. Le letture di controllo via
   admin API non consumano step della sequence.
6. **Verificare il traffico:** prendere un cursore `since=latest` del Monitor prima dell'azione,
   poi leggere le voci successive ([Monitor a pagine](#leggere-il-monitor-a-pagine)); con
   `gap: true` la verifica non può concludere.

Il repository ne contiene un esempio completo, eseguito con la suite Playwright:
[`e2e/agent-setup.spec.js`](../../e2e/agent-setup.spec.js), con l'helper
[`e2e/agent-setup/mockxy-admin.js`](../../e2e/agent-setup/mockxy-admin.js) e il workspace di
fixture `workspace-agent-test/`. Lo stesso setup riporta allo stesso risultato partendo da una
variante diversa selezionata e dalla sequence già consumata, da endpoint disabilitati con Proxy
All attivo, e ripetuto più volte senza ripristino. L'helper si ferma con un messaggio diagnostico
su workspace sbagliato, contratto non verificabile, configurazione diversa, precondizione fallita,
modifica non applicata o traffico perso nel Monitor.

Limiti da conoscere:

- **Modifiche fuori dall'API:** un editor, il watcher o un altro processo non passano dalla coda
  delle mutazioni. Una mutazione alla volta e le precondizioni valgono per le chiamate API; una
  scrittura esterna fatta dopo il controllo resta fuori.
- **Memoria del runtime:** cursori delle sequence, memoria degli handler, stato condiviso e
  Monitor vivono in memoria e ripartono a ogni avvio. Il reset di una sequence azzera anche la
  memoria handler di quell'endpoint, ma richiede la sequence selezionata: non è un reset di
  qualunque handler. Un handler con memoria locale che nessun reset azzera va provato su un
  runtime di test nuovo, oppure con un reset specifico documentato nel workspace.

## La descrizione leggibile dalle macchine

Per la struttura esatta di ogni body di richiesta e risposta esiste una descrizione OpenAPI 3.1
di questa API: [`src/admin/admin-api.openapi.yaml`](../../src/admin/admin-api.openapi.yaml). Documenta
rotta per rotta gli schemi, gli status e le varianti di payload, e si può caricare in un
generatore di client, in uno strumento per le richieste, o darla a un agente che deve pilotare
Mockxy da solo. Un runtime in esecuzione la serve così com'è da `GET /_admin/api/openapi.yaml`,
anche dall'app desktop e dall'immagine Docker di sviluppo: è il contratto della versione che
risponde, con le stesse regole di abilitazione delle altre rotte admin.

La seconda fonte affidabile resta l'interfaccia stessa: ogni sua azione è una chiamata a queste
rotte, osservabile dagli strumenti di sviluppo del browser.
