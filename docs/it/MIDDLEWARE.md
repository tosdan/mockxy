# I middleware proxy

I middleware sono il terzo modo di rispondere, a metà strada tra il mock e il backend vero: la
richiesta **arriva davvero al backend** attraverso il proxy, ma la risposta passa da uno script
locale che può modificarla prima che raggiunga il client. Servono quando il backend c'è e va
usato, ma la sua risposta va ritoccata: mascherare dati sensibili, forzare un campo per
provocare un caso specifico nel frontend, arricchire un payload che non è ancora completo.

Un middleware è collegato all'endpoint tramite un [file di risposta](RESPONSE.md) di tipo
`middleware`, che punta a uno script `*.middleware.js`. Vale tutto ciò che vale per gli script
degli handler: modulo CommonJS, `require` locali con ricompilazione al cambio, niente
`method`/`path`/`disabled` nello script.

## La forma dello script

```js
module.exports = {
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: { ...headers, "x-ambiente": "mockxy" },
      jsonBody: { ...jsonBody, saldoDisponibile: 0 },
    };
  },
};
```

Quando la variante middleware è selezionata, il motore inoltra la richiesta al backend
(chiedendo la risposta **non compressa**, così è ispezionabile), la bufferizza per intero e
chiama **`transformResponse`**.

## Il contesto ricevuto

- **`status`** — lo status della risposta del backend.
- **`headers`** — copia degli header della risposta del backend.
- **il body del backend, in tre forme** — `bodyBuffer` (grezzo, sempre presente), `bodyText`
  (per i content-type testuali) e `jsonBody` (parsato quando possibile), con la stessa
  semantica del [contesto degli handler](HANDLER.md). Se il backend ha comunque risposto
  compresso, il corpo viene decompresso per l'ispezione (gzip, deflate, brotli) con un tetto di
  sicurezza di 50 MB decompressi: oltre, o con una compressione non supportata, `bodyText` e
  `jsonBody` sono assenti e `bodyBuffer` resta in forma compressa.
- **`req`** — la richiesta Express in ingresso.
- **`targetUrl`** — l'URL completo a cui la richiesta è stata inoltrata.
- **`data(nome)`** — l'accessor ai file dati, identico a quello degli handler.

## Il risultato

- **`undefined`** (o nessun `return`) — la risposta del backend passa **intatta**: utile per
  middleware condizionali che trasformano solo certi casi.
- Un **oggetto** con:
  - **`status`** — facoltativo; default: lo status del backend.
  - **`headers`** — facoltativo; a differenza degli handler, questi header **si fondono sopra
    quelli del backend** (la risposta parte da ciò che il backend ha mandato): le chiavi
    dichiarate sovrascrivono, quelle con valore `undefined` vengono ignorate, il resto passa.
  - **`removeHeaders`** — elenco di nomi (case-insensitive) rimossi dal risultato fuso: è il
    modo per **togliere** un header messo dal backend.
  - **`jsonBody`** *oppure* **`body`** (stringa o `Buffer`) — stesse regole degli handler,
    inclusi il `content-type: application/json` forzato per `jsonBody` e lo scarto degli header
    dipendenti dal corpo (`Content-Length`, `Content-Encoding`, `Transfer-Encoding`, `ETag`).
  - **né `body` né `jsonBody`** — il corpo del backend resta quello originale; cambiano solo
    status e header. È il caso «ritocca gli header senza toccare il payload».

Le risposte trasformate escono con `x-mock-source: middleware`.

## Quando il middleware viene scavalcato

La trasformazione richiede di bufferizzare la risposta in RAM, quindi il motore la salta — con
un warning nel log e inoltro passthrough intatto — quando non è fattibile o non avrebbe senso:

- **stream dichiarati** (`text/event-stream`, tipico delle SSE): non terminano mai, bufferizzarli
  appenderebbe la richiesta;
- **risposte oltre 10 MB** — sia quando il backend lo dichiara in anticipo (`Content-Length`),
  sia quando il limite viene superato durante la lettura: in quel caso il prefisso già letto
  viene inoltrato e il resto prosegue in streaming.

In questi casi la risposta arriva al client **integra ma non trasformata**, marcata
`x-mock-source: backend`.

## Errori e timeout: fail-open

Un middleware che fallisce **non rompe la risposta**: se lo script lancia un'eccezione,
restituisce un risultato invalido o supera il timeout (`requestTimeoutMs`, lo stesso del
proxy), il motore inoltra la **risposta originale del backend** e registra l'errore nel log con
il riferimento allo script. La filosofia è che un ritocco rotto non deve negare al frontend una
risposta che il backend ha già prodotto.

Il `502` resta riservato ai problemi veri di comunicazione col backend (irraggiungibile, errore
durante la lettura della risposta).

I middleware lavorano su richieste proxate, quindi il [ritardo globale esteso al
proxy](RITARDI.md) si applica anche a loro.
