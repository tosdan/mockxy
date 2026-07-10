# Risoluzione dei problemi

La cassetta degli attrezzi è sempre la stessa, in quest'ordine: l'header **`x-mock-source`**
sulla risposta (chi ha risposto davvero — [la tassonomia](PROXY.md)), il **[monitor](MONITOR.md)**
(cosa è arrivato e cosa è stato deciso), e il **log del server** (gli errori con il file
incriminato). Qui sotto, i sintomi ricorrenti per area.

## Il mock non risponde

- **La richiesta arriva al backend (o al 404) invece che al mock.** Il body del 404 solo-mock
  dice già molto: `path_not_mocked` = nessuna rotta combacia (occhio ai prefissi come `/api` e
  al match dell'intero percorso); `method_not_mocked` = la rotta c'è ma non definisce quel
  metodo — e **non** si ripiega su rotte meno specifiche ([la convenzione dei path](PATH.md)).
- **L'endpoint ha una query dichiarata nel path.** La query dichiarata richiede l'uguaglianza
  **esatta dell'intera query**: un parametro in più — `page`, `size`, un filtro — la esclude e
  la richiesta scivola sulla gemella senza query o al fallback ([dettagli](PATH.md)).
- **Risponde, ma con la variante sbagliata.** Conta solo la variante **selezionata**
  ([file endpoint](ENDPOINT.md)); le altre convivono inerti, anche se invalide.
- **L'endpoint è sparito dopo una modifica a mano.** Un file invalido non ferma il server:
  l'endpoint viene saltato con un warning nel log (o mantiene l'ultima versione valida al
  reload). Anche un **duplicato** metodo+percorso in un'altra cartella viene scartato e
  segnalato ([degradazione per-endpoint](ENDPOINT.md)).
- **Era una collezione.** L'interruttore di collezione scrive `enabled` **in massa** sul
  sottoalbero: riaccenderla riaccende anche ciò che era spento singolarmente
  ([catalogo](CATALOGO.md)).

## Filtri e paginazione

- **Il filtro non filtra.** Il *nome* del parametro deve coincidere con la chiave di primo
  livello in modo esatto (maiuscole comprese: è il *valore* a essere case-insensitive), e la
  chiave deve avere valori scalari ([liste](LISTE.md)).
- **La paginazione non si attiva.** Servono **entrambi** `page` e `size`, validi; e il body
  dev'essere un array o un oggetto con *un solo* array di primo livello.
- **`X-Total-Count` non è quello dichiarato nel mock.** Con filtro o paginazione attivi vince
  sempre il valore calcolato.

## Errori dal proxy

- **`501 Backend Not Configured`** — la richiesta doveva raggiungere il backend ma
  `BACKEND_URL` non è impostato (o serve la modalità solo-mock: `PROXY_FALLBACK_ENABLED=false`).
- **`502 Bad Gateway`** — backend irraggiungibile **oppure** timeout: il timeout copre solo
  fino ai primi header di risposta ([semantica completa](PROXY.md)). Un backend morto a metà
  stream si manifesta come errore di rete lato client (troncamento esplicito), non come 502.

## Handler e middleware

- **`500 Handler Execution Failed`** — eccezione o risultato invalido nello script: il
  dettaglio, con lo stack, è nel log ([il contratto](HANDLER.md)).
- **`504 Handler Timeout`** — quasi sempre una promise che non risolve (una fetch senza
  timeout); il file è indicato nel log.
- **`413 Payload Too Large`** — il body della richiesta supera i 2 MB: l'handler non viene
  nemmeno eseguito.
- **Il middleware non trasforma.** Risposte oltre 10 MB e stream (`text/event-stream`) passano
  integre con `x-mock-source: backend` e un avviso nel log; un middleware che *fallisce* è
  fail-open: passa la risposta originale ([i middleware](MIDDLEWARE.md)).

## CORS, cookie e redirect

- **Errore CORS in console** (`Access-Control-Allow-Origin` mancante) — il frontend chiama
  Mockxy da un'altra origin e l'opzione è spenta: [il CORS automatico](CORS.md), o il proxy
  del dev server ([le due strade](FRONTEND.md)).
- **Ho spento il CORS ma il browser "funziona" ancora** — i preflight restano in cache fino a
  10 minuti.
- **Il login non tiene** — il login deve passare da Mockxy, il frontend deve inviare le
  credenziali (`withCredentials`), e l'[adattamento dei cookie](COOKIE.md) dev'essere attivo;
  cross-site su http i cookie non viaggiano comunque (si usa il token).
- **Dopo un redirect l'app parla col backend diretto** — la [riscrittura dei
  redirect](REDIRECT.md) è stata disattivata, o il `Location` punta a un host terzo (che passa
  intatto di proposito).

## Monitor e storico

- **Il monitor è vuoto** — il server è spento ([controlli globali](CONTROLLI.md): il proxy
  totale registra, il server spento no), oppure si sta guardando traffico che il monitor
  esclude di proposito: admin/UI, preflight, WebSocket ([cosa registra](MONITOR.md)).
- **Lo storico non scrive** — la scrittura su disco è **opt-in a runtime**: va accesa dalla
  pagina Storico ([come funziona](STORICO.md)).

## Ricarica e ambienti

- **Le modifiche ai file non vengono ricaricate** — dove gli eventi nativi del filesystem non
  arrivano (Docker con volumi montati, cartelle di rete) serve il polling:
  `CHOKIDAR_USEPOLLING=true`.
- **`data()` fallisce** — il messaggio d'errore elenca i file disponibili; occhio al nome
  canonico minuscolo e, fuori dal desktop, a `FILES_DIR` configurato ([file dati](DATI.md)).
- **App desktop: porta rifiutata** — il cambio esplicito verso una porta occupata non viene
  applicato; all'avvio invece il motore ripiega da solo su una porta libera
  ([l'app desktop](DESKTOP.md)).
