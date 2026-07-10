# Gli handler

Quando una risposta statica non basta — perché deve fare eco a un parametro, cambiare in base al
body ricevuto, o costruire il risultato da un dataset — la variante può essere un **handler**:
uno script JavaScript locale che riceve la richiesta e restituisce la risposta. È il gradino
sopra il mock statico, prima di dover scomodare un backend vero.

Un handler è collegato all'endpoint tramite un [file di risposta](RESPONSE.md) di tipo
`handler`, che punta a uno script `*.handler.js` nella stessa cartella delle varianti. Come ogni
variante, si attiva selezionandolo — lo stesso endpoint può avere una variante statica e una
dinamica e passare dall'una all'altra.

## La forma dello script

```js
module.exports = {
  async resolveResponse({ params, query, requestHeaders, jsonBody, data }) {
    const utenti = await data("utenti");
    const utente = utenti.find((u) => String(u.id) === params.id);
    if (!utente) {
      return { status: 404, jsonBody: { error: "not_found", id: params.id } };
    }
    return {
      status: 200,
      headers: { "x-fonte": "handler" },
      jsonBody: utente,
    };
  },
};
```

Lo script è un modulo CommonJS che esporta un oggetto con la funzione **`resolveResponse`**
(sincrona o `async`). Può richiedere altri file locali con `require` relativi: il motore ne
traccia le dipendenze e ricompila quando qualcosa cambia (vedi [il file di
risposta](RESPONSE.md)). Non può dichiarare `method`, `path` o `disabled`: il routing appartiene
al file endpoint. L'interfaccia propone un template di partenza già in questa forma.

## Il contesto ricevuto

`resolveResponse` riceve un oggetto con:

- **`params`** — i parametri di percorso della rotta (`/utenti/:id` → `params.id`), già
  percent-decodificati. Sempre stringhe.
- **`query`** — i parametri di query (oggetto Express: valori stringa, o array per i ripetuti).
- **`requestHeaders`** — copia degli header della richiesta, nomi in minuscolo.
- **il body, in tre forme** (la richiesta viene bufferizzata prima di chiamare lo script):
  - **`bodyBuffer`** — il body grezzo come `Buffer`, sempre presente (vuoto senza body);
  - **`bodyText`** — il body come stringa UTF-8, solo per i content-type testuali, altrimenti
    `undefined`;
  - **`jsonBody`** — il body già parsato, quando il content-type è JSON o il contenuto ha forma
    JSON strutturata; altrimenti `undefined`.
- **`data(nome)`** — l'accessor ai [file dati](WORKSPACE.md) della pagina Dati: `await
  data("utenti")` restituisce il contenuto di `utenti.json`. La lettura avviene a ogni
  chiamata (le modifiche al file sono visibili alla richiesta successiva) e ogni handler riceve
  una **copia propria**: mutarla non inquina le altre richieste. Un nome inesistente è un
  errore esplicito, che diventa il fallimento standard dell'handler.
- **`req`** — la richiesta Express grezza, per i casi avanzati. Attenzione: lo stream del body
  è già stato consumato dalla bufferizzazione — usare le tre forme qui sopra, non rileggerlo.

Il body della richiesta viene bufferizzato **fino a 2 MB**: oltre, il motore risponde `413`
senza nemmeno eseguire lo script.

## Il risultato

`resolveResponse` restituisce un oggetto:

- **`status`** — facoltativo, default `200`; intero tra 100 e 599.
- **`headers`** — facoltativo. `Content-Length` viene sempre ricalcolato dal motore, e quando
  la risposta ha un corpo vengono scartati anche eventuali `Content-Encoding`,
  `Transfer-Encoding` ed `ETag` dichiarati: il corpo è costruito localmente e quei metadati
  sarebbero stantii.
- **`removeHeaders`** — facoltativo: elenco di nomi (case-insensitive) da togliere dagli header
  dichiarati. Utile quando `headers` è costruito per spread da un'altra fonte e qualche voce va
  esclusa.
- **`jsonBody`** *oppure* **`body`** — al più uno dei due:
  - **`jsonBody`** — qualunque valore serializzabile: esce come JSON con
    `content-type: application/json` impostato dal motore;
  - **`body`** — una **stringa o un `Buffer`**, servito così com'è: il content-type lo
    dichiarano gli `headers`. È la strada per testo, XML, o payload binari generati;
  - **nessuno dei due** — risposta senza corpo (tipico per `204`).

Le risposte degli handler escono con header di no-cache e con `x-mock-source: handler`, e non
ricevono [ritardi simulati](RITARDI.md): uno script che vuole essere lento attende al proprio
interno.

## Errori, timeout e limiti

Il fallimento di un handler non abbatte mai il server e produce sempre una risposta JSON di
servizio, con il dettaglio completo (messaggio e stack) nel **log del server**:

- **eccezione nello script o risultato invalido** (non-oggetto, status fuori range, `body` e
  `jsonBody` insieme, `body` di tipo non supportato) → `500 Handler Execution Failed`;
- **timeout** — lo script ha a disposizione lo stesso timeout delle richieste verso il backend
  (`requestTimeoutMs`): superato, la risposta è `504 Handler Timeout`. Una promise che non
  risolve mai non lascia la richiesta appesa;
- **body della richiesta oltre 2 MB** → `413 Payload Too Large`.

La validazione dello script (esistenza del file, presenza di `resolveResponse`) avviene invece
già al caricamento dell'endpoint, con la degradazione per-endpoint descritta nella [pagina sul
file endpoint](ENDPOINT.md).
