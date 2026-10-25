# 15 — Gli handler: risposte calcolate in JavaScript

Templating, liste automatiche e sequenze coprono molto — ma prima o poi serve un `if`: «se
manca il campo X rispondi 400», «rispondi con la risorsa che il client ha appena creato»,
«filtra il dataset con una logica vera». Per questi casi la variante può essere un
**handler**: uno script JavaScript locale che riceve la richiesta e costruisce la risposta.
È il gradino sopra il mock statico, prima di dover scomodare un backend vero — e non tocca
mai il backend: tutto avviene in locale.

Come ogni variante, l'handler convive con le altre nella lista delle response: lo stesso
endpoint può avere la variante statica e quella dinamica, e si passa dall'una all'altra con
la selezione.

## Creare un handler

Due strade dalla scheda dell'endpoint ([capitolo 8](08-scheda-endpoint.md)):

- **Nuova response handler** — parte da un template funzionante, da adattare;
- **Clona in nuova response handler** — da una response mock esistente: il template arriva
  **con il body statico già dentro** come punto di partenza. È la strada consigliata quando
  il mock statico c'è già: si aggiunge la logica attorno a dati già giusti.

L'editor è lo stesso editor di codice del capitolo 9 (evidenziazione, ricerca,
autocompletamento JavaScript); il pulsante «Rigenera template» ripristina il template di
partenza se serve ricominciare.

## La forma dello script

Lo script è un modulo CommonJS che esporta la funzione **`resolveResponse`** (sincrona o
`async`):

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

Tre righe di lettura guidata: il contesto ricevuto come argomento porta tutto ciò che serve
della richiesta (`params.id` è il `:id` della rotta); il `return` descrive la risposta —
status, header facoltativi e `jsonBody`; e `data("utenti")` legge un dataset dalla pagina
Dati ([capitolo 17](17-pagina-dati.md)), tenendo i dati fuori dal codice.

Lo script **non dichiara** metodo, percorso o stato di abilitazione: il routing appartiene al
file endpoint, e la fonte di verità resta una sola. Può invece richiedere altri file locali
con `require` relativi — utilità condivise tra più handler — e il motore ne traccia le
dipendenze: alla modifica dello script *o di una dipendenza*, la ricompilazione è automatica.

## Il contesto ricevuto

| Campo | Contenuto |
|---|---|
| `params` | i parametri di percorso, già decodificati; sempre stringhe |
| `query` | i parametri di query (valori stringa, o array per i ripetuti) |
| `requestHeaders` | gli header della richiesta, nomi in minuscolo |
| `bodyBuffer` / `bodyText` / `jsonBody` | il body della richiesta in tre forme: grezzo (sempre presente), testo (per i content-type testuali), già parsato (quando è JSON) |
| `data(nome)` | l'accessor ai file dati della pagina Dati |
| `state` | memoria mutabile persistente tra le chiamate dell'endpoint |
| `callCount` | numero progressivo di invocazioni (1 alla prima) |
| `firstRequestAt` | timestamp della prima invocazione |
| `req` | la richiesta Express grezza, per i casi avanzati (il body va letto dalle tre forme sopra: lo stream è già stato consumato) |

Il body della richiesta viene bufferizzato fino a **2 MB**: oltre, il motore risponde `413`
senza nemmeno eseguire lo script.

### Lo stato: mock che ricordano

`state`, `callCount` e `firstRequestAt` sono la parte più potente del contratto. `state` è un
oggetto mutabile che **sopravvive tra le richieste** dello stesso endpoint (condiviso tra le
sue varianti): la memoria per contatori, macchine a stati per-risorsa
(`state[params.id] = ...`), esiti che dipendono dalla storia. È effimero e locale al motore —
non un database: si azzera al riavvio e con il reset della sequenza dell'endpoint; sopravvive
invece alla ricarica a caldo, così iterare sullo script non ricomincia il giro di prova da
capo.

Un esempio con `firstRequestAt` — il polling che cambia esito dopo 15 secondi:

```js
module.exports = {
  resolveResponse({ firstRequestAt }) {
    if (Date.now() - firstRequestAt < 15000) {
      return { status: 202, jsonBody: { status: "processing" } };
    }
    return { status: 200, jsonBody: { status: "completed" } };
  },
};
```

(per questo caso specifico, senza scrivere codice, basta una
[sequenza](12-sequenze.md) — l'handler serve quando attorno c'è altra logica).

## Il risultato

`resolveResponse` restituisce un oggetto con:

- **`status`** — facoltativo, default `200`;
- **`headers`** — facoltativi; `Content-Length` viene sempre ricalcolato dal motore;
- **`removeHeaders`** — elenco di nomi da togliere dagli header dichiarati, utile quando
  `headers` nasce per spread da un'altra fonte;
- **`jsonBody`** *oppure* **`body`** — al più uno dei due: `jsonBody` è qualunque valore
  serializzabile ed esce come JSON (content-type impostato dal motore); `body` è una stringa
  o un `Buffer` servito così com'è (content-type negli header). Nessuno dei due = risposta
  senza corpo, il tipico `204`.

Le risposte degli handler escono con `x-mock-source: handler` e non ricevono ritardi
simulati: uno script che vuole essere lento attende al proprio interno.

## Errori e timeout

Un handler rotto non abbatte mai il server, e non lascia mai richieste appese:

- eccezione nello script o risultato invalido → **`500 Handler Execution Failed`**;
- script che non risponde entro il timeout (`requestTimeoutMs`, lo stesso del proxy —
  default 15 s) → **`504 Handler Timeout`**: la classica promise che non risolve, la fetch
  senza timeout;
- body della richiesta oltre 2 MB → **`413 Payload Too Large`**.

In tutti i casi il client riceve una risposta JSON di servizio e **il dettaglio completo —
messaggio, stack, file incriminato — finisce nel log del server**: terminale in headless,
file `logs/` nell'app desktop ([capitolo 28](28-desktop-workspace.md)).

## Scenario completo: un CRUD in memoria

Il pezzo forte degli handler: far lavorare il frontend come se il backend esistesse. Tre
endpoint sullo stesso `state` (che è condiviso *per endpoint*, quindi qui si usa il pattern
più semplice: tutta la logica su un solo endpoint con la lista, più il dettaglio):

```js
// POST /api/note — GET.responses/001.handler.js dell'endpoint POST
module.exports = {
  resolveResponse({ jsonBody, state }) {
    state.note ??= [];
    if (!jsonBody?.testo) {
      return { status: 400, jsonBody: { error: "testo obbligatorio" } };
    }
    const nota = { id: state.note.length + 1, testo: jsonBody.testo, creataAlle: new Date().toISOString() };
    state.note.push(nota);
    return { status: 201, jsonBody: nota };
  },
};
```

```js
// GET /api/note — l'elenco riflette ciò che è stato creato
module.exports = {
  resolveResponse({ state }) {
    return { jsonBody: state.note ?? [] };
  },
};
```

Attenzione al dettaglio già citato: `state` è per-endpoint, e `GET /api/note` e
`POST /api/note` sono endpoint diversi (stesso percorso, metodi diversi). Perché condividano
la memoria, la coppia va modellata come due *varianti dello stesso endpoint*... che non è
possibile tra metodi diversi — quindi la strada pratica è tenere il dataset in un file dati e
usare `state` per le sole mutazioni, oppure gestire il caso interamente lato `GET` con dati
da `data()`. Il capitolo 17 mostra il pattern completo file-dati + handler.

> 📷 **SCREENSHOT** — `15-editor-handler.png`
> Cosa mostrare: l'editor dell'handler con uno script completo e leggibile (l'esempio del
> 404/200 con `data()` va bene), nel contesto della scheda endpoint.

> 📷 **SCREENSHOT** — `15-monitor-stateful.png`
> Cosa mostrare: il monitor con più richieste successive allo stesso endpoint handler le cui
> risposte differiscono per effetto dello stato (es. un contatore che cresce nel body, o il
> 201 di un POST seguito da un GET che elenca l'elemento creato).

L'handler calcola tutto in locale. Quando invece il backend c'è, funziona, e va solo
*ritoccato*, il tipo giusto è il prossimo: i [middleware proxy](16-middleware.md).
