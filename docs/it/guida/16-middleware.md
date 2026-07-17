# 16 — I middleware: ritoccare le risposte del backend vero

Il terzo modo di rispondere sta a metà tra il mock e il backend: con una variante
**middleware**, la richiesta **arriva davvero al backend** attraverso il proxy, ma la
risposta passa da uno script locale che può modificarla prima che raggiunga l'applicazione.

Il posizionamento è preciso: il mock (statico o handler) batte il middleware quando il
backend non c'è o non serve; il middleware batte il mock quando **i dati veri servono** ma la
risposta va ritoccata. I casi che lo giustificano:

- **il contratto corre avanti**: il client rigenerato si aspetta campi che il backend non
  manda ancora — il middleware li aggiunge sopra la risposta reale, e si continua a lavorare
  con dati veri invece di congelarne una copia;
- **provocare un caso specifico senza rinunciare al resto**: forzare `stato: "SOSPESO"`
  sull'utente vero per vedere il banner del frontend, lasciando autentico tutto il resto del
  payload;
- **mascherare o ripulire**: oscurare dati sensibili in una demo, togliere un header di
  troppo.

## Creare un middleware e la forma dello script

Dalla scheda dell'endpoint: **Nuova response middleware**, o **Clona in nuova response
middleware** da una variante esistente. Lo script è un modulo CommonJS come l'handler —
stesso editor, `require` locali con ricompilazione automatica, niente metodo/percorso nello
script — ma esporta **`transformResponse`**, che riceve la **risposta del backend** e
restituisce le modifiche:

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
(chiedendo la risposta non compressa, così è ispezionabile), la bufferizza e chiama lo
script.

## Il contesto ricevuto

- **`status`** e **`headers`** — status e header della risposta del backend;
- **il body del backend in tre forme** — `bodyBuffer` (grezzo), `bodyText` (per i
  content-type testuali), `jsonBody` (parsato quando possibile), come nel contesto degli
  handler;
- **`req`** — la richiesta in ingresso, per trasformazioni condizionate da chi ha chiesto
  cosa;
- **`targetUrl`** — l'URL completo a cui la richiesta è stata inoltrata;
- **`data(nome)`** — l'accessor ai file dati, identico a quello degli handler: si può
  arricchire la risposta reale con dati propri.

## Il risultato

- **`undefined`** (o nessun `return`) — la risposta del backend passa **intatta**. È la base
  dei middleware condizionali: `if (jsonBody?.tipo !== "PREMIUM") return;` e si trasforma
  solo il caso che interessa.
- Un oggetto con **`status`**, **`headers`**, **`removeHeaders`**, e **`jsonBody`** *oppure*
  **`body`** — con una differenza importante rispetto agli handler: gli `headers` dichiarati
  **si fondono sopra quelli del backend** (le chiavi dichiarate sovrascrivono, il resto
  passa), perché la risposta parte da ciò che il backend ha mandato. `removeHeaders` è il
  modo per *togliere* un header messo dal backend. Senza `body` né `jsonBody`, il corpo del
  backend resta l'originale e cambiano solo status e header.

Le risposte trasformate escono con `x-mock-source: middleware`.

## Esempio: i campi del contratto nuovo

Il backend risponde ancora `{ "id": 7, "nome": "Rossi SRL" }`, il client rigenerato si
aspetta anche `rating` e `tags`:

```js
module.exports = {
  async transformResponse({ jsonBody }) {
    if (!jsonBody) return; // risposta non JSON: lasciala stare
    return {
      jsonBody: { ...jsonBody, rating: "A", tags: ["cliente-storico"] },
    };
  },
};
```

Il frontend nuovo funziona da subito, su anagrafiche vere; quando il backend si allinea, si
disattiva la variante (o l'endpoint) e non si butta via niente.

## Quando il middleware viene scavalcato

La trasformazione richiede di bufferizzare la risposta in memoria, quindi il motore la salta
— con un warning nel log e inoltro intatto — quando non è fattibile:

- **stream dichiarati** (`text/event-stream`): non terminano, bufferizzarli appenderebbe la
  richiesta;
- **risposte oltre 10 MB**, dichiarate in anticipo o scoperte durante la lettura.

In questi casi la risposta arriva al client integra ma non trasformata, marcata
`x-mock-source: backend` — il segnale da controllare quando «il middleware non funziona».

Vale anche il quadro generale del capitolo 5: in modalità **proxy totale** i middleware non
intervengono affatto (il backend si osserva al naturale), e a server spento nemmeno.

## Errori e timeout: fail-open

Un middleware che fallisce **non rompe la risposta**: eccezione, risultato invalido o timeout
(`requestTimeoutMs`) fanno passare la **risposta originale del backend**, con l'errore nel
log e il riferimento allo script. La filosofia: un ritocco rotto non deve negare al frontend
una risposta che il backend ha già prodotto. Il `502` resta riservato ai problemi veri di
comunicazione con il backend.

È un comportamento da conoscere perché silenzioso lato client: se la trasformazione sembra
non applicarsi, i due indizi sono `x-mock-source` (`backend` invece di `middleware`) e il
log.

> 📷 **SCREENSHOT** — `16-editor-middleware.png`
> Cosa mostrare: l'editor del middleware con lo script d'esempio dell'arricchimento campi,
> nel contesto della scheda endpoint.

> 📷 **SCREENSHOT** — `16-monitor-confronto.png`
> Cosa mostrare: il monitor con due richieste alla stessa rotta, una servita con provenienza
> «proxy/backend» (prima dell'attivazione del middleware) e una con provenienza
> «middleware», per rendere visibile la differenza di instradamento.

Handler e middleware condividono lo stesso alleato: i dataset tenuti fuori dal codice. La
pagina che li gestisce — e l'accessor `data()` già incontrato due volte — è il
[capitolo 17](17-pagina-dati.md).
