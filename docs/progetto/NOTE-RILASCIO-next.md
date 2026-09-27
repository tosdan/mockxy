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
  mock né il backend.
- **Per i client:** correggere metodo e percorso delle chiamate che ricevono questo errore. Un
  mock sotto `/_admin/api` va spostato su un altro percorso: il namespace non è più disponibile
  per i mock.

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
