# Note di rilascio

## Prossima versione

Versione prevista: **1.6.0**. Contiene una modifica incompatibile per i soli workspace che
avevano adottato l'import dalla radice della 1.5.0: è un'eccezione dichiarata alla politica di
versionamento (vedi [PROCEDURA-RILASCIO.md](PROCEDURA-RILASCIO.md), §1). Il disegno completo è
in [PIANO-SCRIPT-CONDIVISI.md](PIANO-SCRIPT-CONDIVISI.md).

### Script condivisi e ricarica

#### Helper condivisi con l'alias `#shared/`

- **Prima (1.5.0):** gli script potevano importare dalla radice dei mock con
  `require("_shared/helper")`. Funzionava solo per lo script caricato direttamente dal motore:
  un handler riusato da un'altra variante o da un helper non risolveva più l'import, e l'esito
  dipendeva dall'ordine di caricamento. Una migrazione reale ha reso non caricabili 22 script su
  55.
- **Ora:** gli helper stanno in `mocks/_shared/` e si importano con `require("#shared/….js")`.
  È l'alias nativo di Node, definito da `mocks/package.json`: vale per ogni script e helper sotto
  la cartella dei mock, chiunque lo carichi e a qualsiasi profondità. Mockxy crea il file al
  primo script del workspace, se manca, e non riscrive mai un file già presente.
- **Ritirato:** l'import dalla radice `require("_shared/…")`. Lo script che lo usa non si carica,
  con un messaggio che indica la sostituzione.
- **Invariato:** i `require` relativi continuano a funzionare e non richiedono migrazione.
- **Per chi ha usato `require("_shared/…")`:** sostituirlo con `require("#shared/….js")`,
  con l'estensione, e versionare `mocks/package.json`. Se il file viene aggiunto o modificato
  mentre Mockxy è in esecuzione serve un riavvio (dell'app, nel desktop): Node lo legge una volta
  per processo.

#### Ricompilazione a ogni ricarica

- **Prima:** una cache conservava le definizioni degli script invariati, riconosciuti da data di
  modifica e dimensione del sorgente e delle dipendenze. Ne derivavano dati non aggiornati senza
  errori: una modifica che lasciava invariati data e dimensione, un helper importato dentro una
  funzione, una cartella dei mock raggiunta da un collegamento simbolico. Dopo la ricompilazione
  di un solo handler, due handler potevano inoltre vedere due istanze dello stesso helper.
- **Ora:** a ogni ricarica il motore ricompila tutti gli script selezionati, dopo aver svuotato
  i moduli locali del workspace (anche quando la cartella è raggiunta da un collegamento
  simbolico). I pacchetti in `node_modules` non vengono toccati. `state`, `sharedState`, i cursori
  delle sequenze e le connessioni SSE e WebSocket si conservano come prima.
- **Per gli autori:** il livello superiore di uno script viene rieseguito a ogni ricarica, anche
  se lo script non è cambiato. Il [contratto degli script](../it/HANDLER.md#il-contratto-degli-script)
  lo rende sicuro: dipendenze importate in cima al modulo, stato in `state` e `sharedState`,
  nessun effetto al caricamento.

#### Contratto degli script, avvisi e validazione

- **Ora:** le regole per handler, middleware e helper sono scritte nel contratto degli script.
  Chi non le rispetta non viene bloccato; le violazioni si vedono al salvataggio (avvisi nella
  risposta e nell'app), nello stato del runtime e nella validazione completa, dove sono errori.
- **Validazione completa:** `node index.js validate [cartella]` controlla tutti gli script del
  workspace senza avviare il server, compresi quelli degli endpoint disabilitati e delle varianti
  non selezionate, ed esce con codice 1 se trova errori.

### Cambiamenti dell'admin API

- **`GET /runtime/status`: campo `warnings`.** Elenco degli avvisi del registro installato
  (`code`, `endpointId`, `filePath`, `message`): un handler o middleware importato da un altro
  script, o un problema di `mocks/package.json`. Non cambia `lastAttempt.status`: un tentativo
  con soli avvisi resta `applied`. È un campo in più; chi confronta la risposta per uguaglianza
  esatta deve tenerne conto.
- **`POST /scripts/validate`: nuova rotta.** La validazione completa degli script, con lo stesso
  rapporto della riga di comando. Risponde `200` anche con errori e non installa nulla. Come le
  altre POST senza parametri vuole `Content-Type: application/json` e un body `{}`.
- **Scritture di script: campo `warnings`.** Le rotte che salvano il sorgente di un handler o di
  un middleware riportano `warnings` quando lo script viola il contratto. Lo script viene
  salvato; il campo manca quando non c'è nulla da segnalare. Gli errori di compilazione e di
  risoluzione continuano a rispondere `400`.

### Interfaccia

- **Avvisi del runtime nella barra di stato:** un indicatore separato dagli errori elenca gli
  avvisi, con il file e il messaggio.
- **Avvisi al salvataggio di uno script:** l'app conferma il salvataggio e mostra le violazioni
  del contratto con la riga.

## v1.5.0

Nuova funzionalità per riusare gli helper condivisi tra mock. I workspace esistenti restano
compatibili: nessuna migrazione obbligatoria e nessun cambiamento dell'admin API.

Le [note per la pubblicazione, in italiano e inglese](NOTE-RILASCIO-v1.5.0.md)
riassumono le novità rispetto alla 1.4.2.

### Handler e middleware

- **Helper condivisi importati dalla radice dei mock:** gli script handler e middleware possono
  importare un helper con `require("_shared/<helper>")`, la stessa stringa a qualsiasi profondità
  della cartella dell'endpoint. Prima funzionavano solo i path relativi, che dipendono dalla
  profondità: copiare un endpoint verso una rotta di profondità diversa faceva rifiutare la copia
  oppure, per un endpoint disabilitato o una variante non selezionata, lasciava il riferimento
  rotto fino all'attivazione; nel caso peggiore il path risolveva un altro file con lo stesso nome,
  senza errori. I `require` relativi esistenti continuano a funzionare. Limiti: vale per lo script
  di primo livello, mentre gli helper si importano tra loro con path relativi; i pacchetti in
  `node_modules` hanno la precedenza; spostare o rinominare un helper richiede ancora di
  aggiornarne i riferimenti. Nessuna migrazione richiesta
  ([PR #43](https://github.com/tosdan/mockxy/pull/43); skill in
  [mockxy-skills#16](https://github.com/tosdan/mockxy-skills/pull/16)).

## v1.4.2

Correzioni compatibili dell'admin API e della creazione di mock dalle catture.
I workspace esistenti restano compatibili: nessuna migrazione richiesta.

Le [note per la pubblicazione, in italiano e inglese](NOTE-RILASCIO-v1.4.2.md)
riassumono le correzioni rispetto alla 1.4.1.

### Admin API

- **Identificativi delle connessioni SSE/WS dichiarati interi:** lo spec OpenAPI dichiarava
  stringhe per `id` delle connessioni in `GET /mocks/:id/sse/connections` e
  `GET /mocks/:id/ws/connections`, e per `connectionId` nello storico SSE e nel transcript WS.
  Il motore ha sempre restituito interi, e la GUI li usa come tali: ora lo spec li dichiara
  `integer`. Le risposte non cambiano. L'`id` degli eventi SSE resta una stringa. La
  divergenza è emersa dai test di accettazione esterni (T2).
- **Mock dalle catture senza l'header tecnico:** creando mock dal Monitor o dallo Storico, la
  trasformazione esclude anche `x-mock-source`. Una risposta del backend catturata lo portava con
  valore `backend`, che finiva nella definizione del mock: il serving lo sostituiva comunque con
  `mock`, ma il file era fuorviante. Emerso dai test di accettazione esterni (T5).
- **Descrizioni dello spec OpenAPI:** quattro descrizioni scritte in mappe YAML su una riga erano
  spezzate da una virgola (`BatchRuntime.errors[].filePath`, `MonitorEntry.path`,
  `MonitorEntry.requestBodyBytes`, `DumpFile.mtime`) e producevano chiavi spurie. Ora sono
  integre, e `check:admin-openapi` rifiuta questo errore.

## v1.4.1

Include le novità della 1.4.0 riportate sotto, più la correzione GUI della
[PR #40](https://github.com/tosdan/mockxy/pull/40). La 1.4.0 rimane in bozza e non
viene pubblicata. I workspace e il contratto API non cambiano rispetto alla 1.4.0.

Le [note per la pubblicazione, in italiano e inglese](NOTE-RILASCIO-v1.4.1.md)
riassumono l’intero aggiornamento dalla versione pubblica 1.3.2.

### Interfaccia

- **Recupero del dettaglio dopo una creazione riuscita:** quando il server conferma la
  creazione o la copia con `id` e `detailUnavailable`, la GUI conserva l’identità
  dell’endpoint appena scritto. «Rileggi», ricarica del catalogo e sincronizzazione
  recuperano quell’endpoint; prima riaprivano quello precedente oppure, alla prima
  creazione, non inviavano nessuna lettura. La mutazione resta un successo e non si
  ripete. Nella creazione con body da file, l’upload usa sempre l’id appena
  restituito e la prima variante, anche se il dettaglio non è disponibile: prima
  poteva sovrascrivere la variante dell’endpoint precedente o non partire senza
  selezione. Anche il cambio di workspace conserva la separazione delle risorse.

## v1.4.0

Note dettagliate della release 1.4.0. I workspace esistenti restano compatibili:
nessuna migrazione richiesta. La politica di versionamento è descritta nel §1 di
[PROCEDURA-RILASCIO.md](PROCEDURA-RILASCIO.md).

Le [note per la pubblicazione, in italiano e inglese](NOTE-RILASCIO-v1.4.0.md)
riassumono le novità e rimandano a questo documento per i dettagli del contratto API.

### Cambiamenti dell'admin API

#### Admin API attiva per default in sviluppo

- **Prima:** senza `ADMIN_API_ENABLED` l'admin API restava spenta anche in sviluppo, per un
  difetto nella lettura del flag. La documentazione descriveva già il default corretto.
- **Ora:** senza flag l'admin API è attiva in sviluppo e spenta con `NODE_ENV=production`, come
  documentato. Un valore esplicito, da ambiente o da override, prevale sempre.
- **Esposizione:** chi avviava `node index.js` o `npm start` senza flag su un bind di rete, oppure
  l'immagine Docker di sviluppo senza compose (che imposta `HOST=0.0.0.0`), si ritrova ora
  l'admin API raggiungibile dalle porte pubblicate. Su un bind di rete la guardia sull'header
  `Host` interviene solo se `ADMIN_ALLOWED_HOSTS` è impostato. All'avvio il log mostra l'avviso
  già esistente sull'admin attiva su un'interfaccia non loopback.
- **Per mantenere il comportamento precedente:** impostare `ADMIN_API_ENABLED=false`. Per l'uso
  locale dell'immagine di sviluppo, pubblicare la porta solo su loopback
  (`-p 127.0.0.1:3000:3000`). Compose, app desktop e immagine standalone impostano già il flag
  in modo esplicito e non cambiano comportamento.

#### Namespace `/_admin/api` riservato

- **Prima:** una rotta o un metodo non previsti sotto `/_admin/api` proseguivano nel serving dei
  mock e, con il proxy fallback attivo, arrivavano al backend reale senza comparire nel Monitor.
  Un mock dichiarato sotto `/_admin/api` veniva servito per i percorsi non usati dall'admin.
- **Ora:** rispondono `404` con `details.code: "ADMIN_ROUTE_NOT_FOUND"`; non raggiungono né i
  mock né il backend. Vale anche per gli upgrade WebSocket: un mock ws dichiarato sotto
  `/_admin/api` non esegue l'handshake, e la guardia degli upgrade non distingue più maiuscole e
  minuscole nel percorso, come il routing HTTP dell'admin.
- **Per i client:** correggere metodo e percorso delle chiamate che ricevono questo errore. Un
  mock sotto `/_admin/api` va spostato su un altro percorso: il namespace non è più disponibile
  per i mock.

#### Esito delle mutazioni verificato sul runtime

- **Prima:** sette rotte che ricaricano il runtime (abilitazione in massa di endpoint e
  collezioni, eliminazione di endpoint e del contenuto di una collezione, import OpenAPI,
  creazione dallo storico, rinomina dei file dati con riscrittura) ignoravano l'esito del reload:
  potevano rispondere `2xx` anche quando il runtime non serviva la modifica. Un reload fallito o
  un errore di scrittura rispondevano `400`, e un errore di scrittura a metà operazione poteva
  lasciare file non ripristinati.
- **Ora:** ogni mutazione verifica che il runtime rifletta l'effetto richiesto sugli endpoint
  coinvolti e, se non ci riesce, ripristina i file. Gli errori portano `details.code` e
  `details.rollback`: `400 MUTATION_REJECTED` (input non valido o modifica non applicabile),
  `500 RUNTIME_APPLY_FAILED` (reload fallito nel suo insieme, prima `400`), `500 MUTATION_FAILED`
  (errore di scrittura, prima `400`), `500 ROLLBACK_FAILED` (fallito anche il ripristino, o un
  endpoint coinvolto non è servito com'era prima della mutazione). Import
  OpenAPI e creazione dallo storico aggiungono `items` e `runtime` alla risposta, conservando i
  conteggi; un reload finale fallito risponde `500 BATCH_RUNTIME_FAILED` senza annullare gli
  elementi scritti. Se non riesce il ripristino di un elemento fallito, il batch si ferma lì e
  risponde `500 ROLLBACK_FAILED` con il risultato parziale; un errore nell'assegnazione di una
  collection durante l'import resta nell'esito dell'elemento, invece di interrompere l'import
  prima del reload. Le mutazioni dello stesso workspace vengono eseguite una alla volta; letture,
  traffico e push delle console non le attendono.
- **Per i client:** leggere `details.code` invece del solo status, e per i batch
  `items[].runtimeOutcome` anche con `201`. Chi distingueva un reload fallito dal `400` deve
  gestire il `500 RUNTIME_APPLY_FAILED`.

#### Console SSE/WS sul runtime installato

- **Prima:** push e stato delle console SSE/WS leggevano la selezione su disco. Se una nuova
  selezione non si caricava e il runtime manteneva la vecchia rotta, le console rispondevano
  con un errore pur avendo connessioni aperte; un endpoint disabilitato su disco ma ancora
  servito, o viceversa, dava l'esito sbagliato.
- **Ora:** il bersaglio è la definizione servita dal runtime installato. Un endpoint che il
  runtime non serve risponde `404` (`The runtime does not serve this endpoint.`), uno servito con
  un altro tipo, middleware compresi, `400`, con il messaggio `The response served by this endpoint is not ...`.
- **Per i client:** dopo aver cambiato la selezione su disco senza reload, le console seguono
  ancora la variante servita.

#### Letture del dettaglio durante una modifica

- **Prima:** un file che spariva mentre si leggeva il dettaglio di un endpoint dava un `404`
  specifico o, nei casi di corsa, un `500`. Un asset o un sorgente cancellati a mano davano
  `404` con un messaggio esplicito.
- **Ora:** `GET /mocks/:id` ricompone il dettaglio una volta dalla definizione riletta. Un
  endpoint eliminato nel frattempo risponde `404`; un file ancora mancante risponde `409` con
  `details: { code: "READ_INCONSISTENT", retryable: true }`, senza dettaglio parziale, e il
  messaggio conserva quello specifico (per esempio `Response asset file not found on disk.`).
- **Per i client:** su `READ_INCONSISTENT` ripetere la lettura al massimo una volta in
  automatico; chi riconosceva il `404` di un asset o sorgente mancante deve gestire il `409`.

#### Contratto e configurazione letti dal runtime

- **Prima:** il contratto OpenAPI esisteva solo nel repository, in `docs/admin-api.openapi.yaml`,
  assente dall'app desktop e dall'immagine Docker; la configurazione effettiva non era leggibile
  via API.
- **Ora:** `GET /openapi.yaml` restituisce il contratto della versione in esecuzione, anche
  dall'app desktop e dall'immagine Docker di sviluppo, e `GET /config` la configurazione di
  avvio ed effettiva: le nove chiavi modificabili a runtime (vedi «Configurazione effimera del
  runtime»), con il `runtimeId` dell'avvio. Nessun'altra variabile d'ambiente viene esposta. Le
  due rotte seguono l'abilitazione dell'admin API e restano spente nell'immagine standalone.
- **Per i client:** la fonte del contratto si è spostata in `src/admin/admin-api.openapi.yaml`;
  chi la leggeva dal percorso precedente deve aggiornarlo o usare la rotta.

#### Esito dei caricamenti leggibile via API

- **Prima:** gli errori di caricamento degli endpoint comparivano solo nei log e, per i file
  illeggibili, in `loadErrors` del catalogo; un fallimento globale del reload o una rotta
  mantenuta nella versione precedente non erano visibili.
- **Ora:** `GET /runtime/status` riporta l'ultimo tentativo di caricamento (avvio, mutazione
  admin o modifica vista dal watcher) con il suo esito, gli errori per file del registro
  installato, indicando se la versione precedente resta servita, e l'eventuale fallimento
  globale. Nessuno storico dei tentativi.
- **Per i client:** dopo un `500 ROLLBACK_FAILED` o `RUNTIME_APPLY_FAILED` questa rotta dice in
  che stato è rimasto il runtime.

#### Identità del runtime e revisioni

- **Prima:** nessuna rotta diceva quale istanza stesse rispondendo, su quale workspace, dopo quale
  avvio: `GET /server` rispondeva allo stesso modo per qualunque workspace.
- **Ora:** `GET /info` riporta versione, `runtimeId` nuovo a ogni avvio, identità e percorsi
  canonici del workspace, indirizzo realmente in ascolto, stato del watcher e revisioni leggere
  di catalogo, stato del server, dump, diagnostica e configurazione. Le revisioni crescono quando
  la risorsa cambia e non richiedono di scansionare il workspace a ogni lettura; una modifica
  esterna che lascia identici dimensione e data di modifica di un file può restare invisibile
  finché il file non viene riletto.
- **Per i client:** confrontare `workspace.id` e `runtimeId` prima di agire su un'istanza, e le
  revisioni per decidere cosa rileggere.

#### Varianti inattive: lettura e preparazione

- **Prima:** una variante si leggeva solo selezionandola, e crearne una la selezionava sempre,
  cambiando la risposta servita e azzerando lo scenario della sequence.
- **Ora:** `GET /mocks/:id/responses/:file` legge una variante qualsiasi, con `active` che dice
  se appartiene alla selezione o ai suoi step. `POST /mocks/:id/responses` accetta
  `select: false` per prepararla senza attivarla (stessa validazione, nessun azzeramento dello
  scenario) e riporta `createdResponseFile`; gli aggiornamenti di variante riportano
  `updatedResponseFile`.
- **Per i client:** senza `select` il comportamento non cambia. Prima di modificare una variante
  per filename conviene leggerne `active`: modificare uno step della sequence in uso cambia lo
  scenario in corso.

#### Stream SSE/WS preservati alle ricariche

- **Prima:** ogni ricarica a caldo chiudeva tutte le connessioni SSE e WebSocket aperte, anche per
  una descrizione cambiata, una variante inattiva o un altro endpoint.
- **Ora:** si chiudono soltanto le connessioni degli endpoint il cui stream installato cambia
  (copione, regole, chiusura, tipo) o che vengono disabilitati o eliminati. Una nuova selezione con
  la stessa definizione e la vecchia rotta mantenuta su un errore di caricamento le conservano.
  Lo shutdown le chiude tutte.
- **Per i client:** una riconnessione non segue più ogni modifica del workspace; se serve
  ripartire dall'inizio del copione, basta riaprire la connessione.

#### Revisioni e precondizioni per i salvataggi da bozza

- **Prima:** un salvataggio poteva sovrascrivere in silenzio una modifica fatta nel frattempo da
  un altro client, dall'app o da un agente.
- **Ora:** il dettaglio e la lettura di una variante riportano token di revisione del contenuto
  (`descriptionRevision`, `responseRevision`, `revision`). Le scritture di descrizione e varianti,
  compreso l'upload (header `X-Mockxy-Expected-Revision`) e la forma legacy di `PUT /mocks/:id`,
  accettano `expectedRevision`: se il contenuto è cambiato rispondono `409 REVISION_CONFLICT`
  senza scrivere. Gli aggiornamenti di variante riportano `updatedResponseRevision`.
- **Per i client:** la precondizione è facoltativa, e senza di essa nulla cambia; chi la usa deve
  gestire il `409` rileggendo e confrontando, non ripetendo alla cieca.

#### Monitor interrogabile a pagine

- **Prima:** `GET /monitoring/requests` restituiva sempre tutte le voci in memoria, complete e
  dalla più recente, e ignorava in silenzio qualunque parametro in query. Non c'era modo di
  leggere solo il traffico successivo a un certo momento, né di sapere se nel frattempo il motore
  era ripartito, il Monitor era stato svuotato o le voci più vecchie erano state espulse.
- **Ora:** senza query la rotta risponde come prima (`{ items }`) e lo stream SSE non cambia. Con
  `view=page` restituisce una pagina in ordine crescente con filtri (`method`, `path`, `status`,
  `source`), `limit` (predefinito 50, massimo 250), `fields=summary` senza body né header oppure
  `full`, e un cursore `{ runtimeId, generation, since }` da rimandare per leggere solo il seguito;
  `since=latest` parte da adesso. Riavvio, svuotamento ed espulsione tornano come `gap: true` con
  il motivo in `gapReason`, invece di una lista vuota che sembrerebbe «nessuna richiesta».
  `GET /monitoring/requests/:id?runtimeId=…` legge una voce completa per ID.
- **Compatibilità:** un parametro in query senza `view=page`, o un parametro sconosciuto, prima
  ignorato, ora risponde `400` con `details.code: "INVALID_QUERY"` e il nome del parametro.
- **Per i client:** chi chiama la rotta senza query non deve cambiare nulla. Chi passava parametri
  che venivano ignorati deve toglierli o passare a `view=page`.

#### Mock dal traffico del Monitor e dello Storico

- **Prima:** dal Monitor la trasformazione di una cattura in mock la faceva l'interfaccia, con una
  copia delle regole del server; lo Storico aveva la sua rotta, che saltava un endpoint esistente
  solo se il file stava nella cartella derivata dalla rotta.
- **Ora:** `POST /monitoring/requests/create-mocks` crea mock da voci del Monitor, nell'ordine dato,
  con esiti per elemento. Chiede il `runtimeId` delle catture (`409 RUNTIME_CHANGED` se il motore è
  ripartito), la strategia per un endpoint esistente (`skip` o `add-variant`) e se i nuovi endpoint
  vanno serviti. Una cattura non più disponibile, un body troncato o binario (bozza incompleta con
  l'avviso `INCOMPLETE_CAPTURE`) o una destinazione ambigua non fermano gli altri elementi. Lo
  Storico usa la stessa trasformazione e gli stessi esiti, e accetta le stesse opzioni.
- **Compatibilità dello Storico:** senza opzioni si comporta come prima e i conteggi restano, con
  `addedVariants` in più. Cambiano tre casi limite: l'endpoint esistente si riconosce da metodo e
  rotta nel catalogo, quindi anche se sta in un'altra cartella; un file nella cartella derivata che
  dichiara un'altra rotta fa fallire l'elemento invece di saltarlo; una chiave non più leggibile
  compare fra gli elementi come non disponibile invece di sparire. Con `keys` gli elementi seguono
  l'ordine delle chiavi.
- **Body JSON `null`:** una risposta catturata `null`, un `body: null` in `POST /mocks` o un
  `example: null` di una specifica OpenAPI ora diventano un mock che serve `null`; prima
  diventavano `{}`. Un body assente resta `{}`.
- **Per i client:** leggere `writeOutcome` (ora anche `variant_added`), `captureOutcome` e
  `warnings` di ogni elemento. Un batch non è idempotente: dopo una risposta persa rileggere il
  catalogo invece di ripetere.

#### Configurazione effimera del runtime

- **Prima:** backend, proxy fallback, CORS, ritardi, timeout, filtri, adattamento dei cookie e
  riscrittura dei redirect si fissavano all'avvio; per cambiarli bisognava riavviare il motore.
  I limiti di dimensione del dump non si leggevano né si cambiavano via API.
- **Ora:** `PATCH /config` con `{ set?, unset? }` cambia quelle nove chiavi fino al prossimo
  riavvio, senza scrivere niente su disco. Il corpo si valida per intero prima di applicare
  qualunque cosa; `unset` riporta al valore di avvio, `set: { backendUrl: null }` disattiva il
  backend. Ogni richiesta usa la configurazione con cui è entrata, anche se cambia mentre attende
  il ritardo; le connessioni aperte non migrano. `GET /config` distingue valori di avvio,
  effettivi e override, e la revisione `config` di `GET /info` cresce quando cambiano. Il dump
  espone `maxFileBytes` e `maxTotalBytes` nel `GET` e li accetta nel `PATCH` esistente, dalla
  scrittura successiva e senza cancellare file nella chiamata.
- **Compatibilità:** `PATCH /monitoring/dump` prima ignorava `maxFileBytes` e `maxTotalBytes`;
  ora li valida (un valore non valido è un `400` e nessun campo si applica) e li usa.
- **Per i client:** un override vale solo per il runtime corrente: dopo un riavvio (nuovo
  `runtimeId`) va reimpostato. Controllare `effective` prima di un test invece di supporre i
  valori di avvio.

### Interfaccia

- **Descrizione e abilitazione:** salvare la descrizione invia solo la descrizione, e il toggle
  solo lo stato di abilitazione. Prima ciascuna azione reinviava anche l'altro campo letto in
  precedenza: salvare la descrizione poteva riabilitare un endpoint disabilitato nel frattempo, e
  un toggle poteva riportare indietro una descrizione appena modificata.
- **Dettaglio in lettura durante una modifica:** su `READ_INCONSISTENT` la lettura si ripete una
  sola volta in automatico; se non basta, compare un avviso di dettaglio non leggibile e il
  pannello resta com'era, bozze comprese.
- **Import OpenAPI e creazione dallo storico:** il riepilogo segnala gli endpoint creati ma non
  serviti dal runtime e quelli con avvisi (per esempio una collection non assegnata), e in quel
  caso diventa un avviso invece di una conferma. Se il batch fallisce dopo aver già scritto degli
  endpoint (`BATCH_RUNTIME_FAILED`, `ROLLBACK_FAILED`), l'errore dice anche cosa è rimasto su
  disco; l'import OpenAPI rilegge il catalogo e ricalcola l'anteprima, che non vale più.
- **Varianti preparate senza attivarle:** il form di una nuova risposta e il dialog di una nuova
  sequenza hanno l'opzione «Attiva subito», attiva di default; togliendola la variante viene
  creata senza cambiare la risposta servita né lo scenario in corso. Nel Monitor, aggiungendo una
  risposta catturata a un endpoint esistente, si può scegliere «Aggiungi senza attivare». Le
  varianti SSE e WS, che nascono senza form, restano attivate alla creazione.
- **Mock dal traffico del Monitor:** «Crea mock da questa» e la creazione dalla selezione
  passano dal server, con le stesse regole dello Storico. La casella «Attiva subito», attiva di
  default, decide se un endpoint nuovo nasce servito o disattivato. Il messaggio dice se la
  cattura era incompleta, non più disponibile, o scritta ma non servita dal runtime. Catture
  mostrate prima di un riavvio del motore non creano mock da richieste del nuovo runtime; se la
  risposta si perde, l'esito è dichiarato sconosciuto e la creazione non si ripete da sola. Il
  riepilogo dello Storico conta anche le varianti aggiunte e le voci non disponibili.
- **Configurazione runtime:** «Configurazione» nella barra di stato, nel browser e nel desktop,
  mostra per ogni chiave modificabile a runtime il valore in uso, se è un override temporaneo (per
  esempio di un agente) e il valore di avvio, e riporta una chiave o tutte al valore di avvio. Nel
  desktop le impostazioni del workspace si dichiarano impostazioni di avvio: accanto a un campo con
  un override indicano il valore in uso, e prima di un salvataggio che riavvia il motore avvisano
  che gli override si perdono tutti. Nessun override viene salvato né riapplicato dopo il riavvio.
- **Bozze protette dalle modifiche concorrenti:** la descrizione, il form di una variante e il
  dialog di una sequenza salvano sulla risorsa aperta, con la revisione letta all'apertura. Se
  intanto un agente o un altro client attiva un'altra variante, la bozza resta sulla sua. Se la
  risorsa è cambiata, il salvataggio non la sovrascrive: la bozza resta com'è e un pannello
  permette di confrontarla con la versione attuale, di ricaricarla al posto della bozza (con
  conferma se modificata) o di salvare la propria versione dopo averla vista. Se la risorsa non
  esiste più, il testo resta da copiare e il salvataggio è disabilitato. Le azioni immediate
  (status, delay e template in linea, attivazione, selezione) non cambiano.
- **Sincronizzazione col runtime:** l'interfaccia interroga `GET /info` ogni 2 secondi mentre la
  finestra è visibile, e rilegge tutto al ritorno sulla finestra. Catalogo, endpoint aperto, stato
  del server (Proxy All compreso, anche dopo un riavvio del motore), dump del Monitor e diagnostica
  si aggiornano senza ricaricare la pagina; il Monitor riapre il suo stream a ogni nuovo runtime e
  quando il collegamento torna. La status bar segnala «Non aggiornato» quando il motore non
  risponde, e mostra gli errori dell'ultimo caricamento con quello che il runtime serve al loro
  posto. Una bozza aperta non cambia: se la sua risorsa cambia sul server lo segnala; se sparisce,
  o se il motore ora serve un altro workspace, il salvataggio resta disabilitato. Una rilettura
  fallita di stato del server, dump, diagnostica o configurazione si ritenta da sola, con attese
  crescenti fino a 30 secondi, invece di lasciare la GUI indietro.

### Documentazione e collaudo

- **Preparare uno scenario via API:** la guida all'admin API descrive il setup esplicito di uno
  scenario da qualunque stato (verifica dell'istanza e del contratto, preparazione con revisione,
  attivazione, reset, controllo del traffico dal Monitor) e dichiara che il contratto evolve con
  l'app. Un esempio Playwright eseguito con la suite (`e2e/agent-setup.spec.js`) lo applica a un
  workspace di fixture e dà lo stesso risultato da stati di partenza diversi, senza ripristino.

---

## v1.3.2 (pubblicata)

### Evidenziazione degli handler

- La sorgente JavaScript di handler e middleware ora usa l'evidenziazione della sintassi anche
  nella vista di dettaglio del Catalogo.
- Il renderer rimane quello statico della vista: numeri di riga, dimensioni, scorrimento e azione
  di copia non cambiano.
- Colori e parser sono coerenti con l'editor già disponibile nelle finestre di creazione e
  modifica.

### Documentazione del rilascio

- Aggiunto un runbook operativo dedicato alla preparazione, creazione, verifica e pubblicazione
  delle release stabili.

Questa patch non introduce cambiamenti incompatibili alle API o al formato dei workspace.
