# Il file di risposta

Ogni variante di risposta di un endpoint è un **file di risposta**: un JSON dentro la cartella
`<METODO>.responses/` accanto al [file endpoint](ENDPOINT.md), che descrive *come* rispondere
quando quella variante è selezionata. Le varianti permettono di tenere pronti più comportamenti
per lo stesso endpoint — il caso pieno, la lista vuota, l'errore — e di passare dall'uno
all'altro cambiando solo la variante selezionata, senza toccare i contenuti.

Il campo `type` distingue tre nature di risposta:

- **`mock`** — risposta statica descritta nel file stesso (status, header, body o payload da file);
- **`handler`** — risposta calcolata da uno script JavaScript locale;
- **`middleware`** — trasformazione applicata alla risposta del backend reale proxato.

L'interfaccia crea i file con nomi progressivi (`001.response.json`, `002.response.json`, …),
ma qualunque nome che termini in `.response.json` è valido, purché sia un semplice nome di file
(niente percorsi) ed elencato in `responseFiles` del file endpoint.

## Risposta `mock`

```json
{
  "type": "mock",
  "title": "Utente trovato",
  "status": 200,
  "headers": { "x-esempio": "true" },
  "delayMs": 150,
  "body": { "id": 1, "nome": "Ada", "ruolo": "admin" }
}
```

- **`title`** — etichetta facoltativa della variante, mostrata dall'interfaccia.
- **`status`** — obbligatorio: un intero tra 100 e 599.
- **`headers`** — facoltativo: oggetto con valori primitivi (stringhe, numeri, booleani) o array
  di stringhe per gli header multipli.
- **`delayMs`** — facoltativo: ritardo in millisecondi prima della risposta, intero non
  negativo. Quando è maggiore di zero **vince sul ritardo globale** del server; a zero o
  assente, vale l'eventuale ritardo globale.
- **`body`** oppure **`file`** — esattamente uno dei due:
  - **`body` JSON** (oggetto, array, numero, booleano) — servito come JSON. Se è un array, o un
    oggetto con un solo array di primo livello, la risposta partecipa a paginazione e filtri
    automatici sulle query string;
  - **`body` stringa** — servito **così com'è, senza content-type implicito**: il content-type
    lo dichiara l'utente negli header (l'editor dell'interfaccia aggiunge `text/plain` quando
    si sceglie la modalità testo). È la strada per XML, CSV, HTML o qualunque payload testuale
    non-JSON;
  - **`file`** — percorso di un file dentro la cartella `<METODO>.responses/` (anche in una
    sottocartella, es. `assets/img.png`), servito **in streaming a ogni richiesta**: il
    contenuto non viene mai caricato in memoria, quindi anche payload da centinaia di MB
    (download, immagini, PDF) non pesano sul server. Senza un `content-type` dichiarato negli
    header, la risposta esce come `application/octet-stream`.

## Risposta `handler`

```json
{
  "type": "handler",
  "title": "Ordine calcolato",
  "sourceFile": "001.handler.js"
}
```

Il file di risposta è solo il collegamento: la logica sta nello script indicato da
**`sourceFile`** — un nome di file che termina in `.handler.js`, nella stessa cartella
`<METODO>.responses/`. Lo script esporta un oggetto con la funzione `resolveResponse`, che
riceve il contesto della richiesta e restituisce status, header e body. Il contratto completo è
documentato nella pagina sugli handler.

Lo script **non** può dichiarare `method`, `path` o `disabled`: quelle proprietà appartengono al
file endpoint, e la loro presenza nello script è un errore di validazione — la fonte di verità
sul routing resta una sola.

Gli script possono richiedere altri file locali (`require` relativi): il motore traccia queste
dipendenze e ricompila lo script quando il sorgente **o una delle dipendenze** cambia su disco;
finché nulla cambia, la definizione compilata viene riusata tra le ricariche.

## Risposta `middleware`

```json
{
  "type": "middleware",
  "title": "Maschera i dati sensibili",
  "sourceFile": "001.middleware.js"
}
```

Stessa struttura dell'handler, con suffisso **`.middleware.js`** e funzione esportata
`transformResponse`: il motore inoltra la richiesta al backend reale e passa la risposta allo
script, che può modificarla prima che raggiunga il client. Limiti e contratto sono documentati
nella pagina sui middleware proxy.

## Validazione ed errori

Il file della variante **selezionata** viene validato al caricamento dell'endpoint: `type`
riconosciuto, status valido per i mock, `body`/`file` mutuamente esclusivi e uno dei due
presente, script esistente e con la funzione attesa per handler e middleware, payload `file`
esistente su disco. Un errore in questi controlli non abbatte il server: vale la degradazione
per-endpoint descritta nella [pagina sul file endpoint](ENDPOINT.md) — l'endpoint viene saltato
con un warning, e alla ricarica a caldo resta in vigore l'ultima versione valida.

Le varianti **non selezionate** non vengono validate finché non diventano quella attiva: un file
di variante incompleto può convivere nel workspace senza effetti, finché nessuno lo seleziona.
