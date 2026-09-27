# Note di rilascio

## Prossima versione

Documento provvisorio: il numero di versione verrà assegnato durante il rilascio, secondo la
politica di versionamento del §1 di [PROCEDURA-RILASCIO.md](PROCEDURA-RILASCIO.md). I workspace
esistenti restano compatibili: nessuna migrazione richiesta.

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
  endpoint coinvolto servito prima non lo è più dopo il ripristino). Import
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
