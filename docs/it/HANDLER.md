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
- **`sharedState`** — lo store JSON effimero condiviso da **handler diversi**. È la primitiva
  per scenari stateful come «POST aggiunge un item, la GET successiva lo restituisce». Si apre
  una risorsa con `await sharedState.open(nome, { seedKey, initialize })` e si usa l'handle
  risultante con `read()`, `mutate()` o `replace()`. Il contratto completo è nella sezione
  [Stato runtime condiviso](#stato-runtime-condiviso).
- **`state`** — oggetto mutabile **persistente tra le chiamate** dello stesso endpoint (e
  condiviso tra le sue varianti): la memoria per contatori, macchine a stati per-risorsa
  (`state[params.id] = ...`), esiti che dipendono dalla storia. È **effimero e locale al
  motore** — non un database: si azzera al riavvio e col reset della [sequenza](ENDPOINT.md)
  dell'endpoint; sopravvive invece alla ricarica a caldo, così iterare sullo script non
  ricomincia il test da capo.
- **`callCount`** — numero progressivo di invocazioni dell'handler per questo endpoint (1 alla
  prima), stessa vita di `state`.
- **`firstRequestAt`** — timestamp (ms epoch) della prima invocazione: `Date.now() -
  firstRequestAt` è il tempo trascorso dall'inizio del giro, senza guardare l'orologio
  assoluto. Con queste tre primitive un polling che cambia esito si scrive senza accrocchi:

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

  (per il caso semplice, senza scrivere codice, c'è la [sequenza di varianti](ENDPOINT.md)).
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
- **`applyListQuery`** — booleano facoltativo, default `false`. Con `true`, il motore applica a
  `jsonBody` le stesse regole di [filtro e paginazione delle liste](LISTE.md) dei mock statici,
  incluso `X-Total-Count`. Richiede `jsonBody`; un valore non booleano rende invalido il
  risultato.

Le risposte degli handler escono con header di no-cache e con `x-mock-source: handler`, e non
ricevono [ritardi simulati](RITARDI.md): uno script che vuole essere lento attende al proprio
interno.

## Stato runtime condiviso

`state` appartiene a un endpoint. `sharedState`, invece, permette a più handler di raggiungere
la stessa risorsa per nome. Un file dati può inizializzarla, ma dopo l'apertura il valore vivo
resta soltanto in memoria e non riscrive il file.

Questo è un esempio completo per una GET e una POST che condividono `items`:

```js
// Lo stesso helper, ripetuto nei due file *.handler.js.
function openItems({ sharedState, data }) {
  return sharedState.open("items", {
    seedKey: "items@v1",
    initialize: () => data("items"),
  });
}

// GET /items
module.exports = {
  async resolveResponse(context) {
    const items = await openItems(context);
    return {
      status: 200,
      jsonBody: items.read(),
      applyListQuery: true,
    };
  },
};
```

```js
// POST /items — nello script dell'altro endpoint, con lo stesso openItems().
module.exports = {
  async resolveResponse(context) {
    const items = await openItems(context);
    let created;
    try {
      created = items.mutate((draft) => {
        if (!Array.isArray(draft)) throw new Error("items must be an array");
        if (draft.some((item) => String(item.id) === String(context.jsonBody.id))) {
          const error = new Error("duplicate item");
          error.code = "DUPLICATE_ITEM";
          throw error;
        }
        const item = { ...context.jsonBody };
        draft.push(item);
        return item;
      });
    } catch (error) {
      if (error.code === "DUPLICATE_ITEM") {
        return { status: 409, jsonBody: { error: "duplicate_item" } };
      }
      throw error;
    }
    return { status: 201, jsonBody: created };
  },
};
```

Le operazioni dell'handle sono:

- `read()` restituisce una copia JSON: modificarla non cambia lo store;
- `mutate(callback)` passa alla callback un draft privato e commette tutto insieme solo se la
  callback termina correttamente. La callback deve essere sincrona; il suo valore di ritorno
  viene restituito allo script, ma non sostituisce la radice;
- `replace(value)` sostituisce l'intero valore e restituisce `undefined`.

Initializer e mutator non possono usare, direttamente o nelle loro continuazioni asincrone,
nessun'altra operazione shared-state. Questa regola evita dipendenze circolari, ordine nascosto
fra risorse e commit parziali. L'inizializzazione può invece essere asincrona: se più richieste
aprono insieme una risorsa assente, una sola factory viene usata e le altre attendono lo stesso
esito.

### Il ruolo di `seedKey`

Il nome identifica la risorsa; `seedKey` dichiara quale **forma logica** gli handler si
aspettano. Tutti gli handler che aprono `items` devono usare la stessa firma. Se uno è rimasto a
`items@v1` e un altro passa a `items@v2`, il secondo riceve un conflitto esplicito invece di
lavorare silenziosamente su dati dalla forma sbagliata. Il Monitor e la pagina **Dati → Stato
runtime** mostrano nome, firma e handler coinvolto per trovare il riferimento non aggiornato.

`seedKey` non confronta il codice delle factory e non valida lo schema del JSON: è una
dichiarazione intenzionale dell'autore. Va incrementata quando cambia la forma o la strategia
di inizializzazione, poi la risorsa va azzerata. Non va derivata da body, query, orario o altri
input della singola richiesta; altrimenti il contenuto dipenderebbe nuovamente dalla prima
richiesta arrivata.

Nomi e firme seguono queste regole:

- il nome viene normalizzato con trim e minuscole, è lungo 1–128 caratteri e ammette solo
  `a-z`, `0-9`, `.`, `_`, `-` (ma non `.` o `..`);
- `seedKey` è case-sensitive, non viene normalizzata, è lunga 1–256 caratteri e non ammette
  spazi ai bordi o caratteri di controllo. Non è un segreto: compare nei metadati admin.

### Vita, reset e concorrenza

Lo stato sopravvive al reload a caldo degli handler, ma si perde al riavvio del motore. Si può
azzerare una risorsa o tutto lo store dalla pagina **Dati → Stato runtime** e dall'[Admin
API](ADMIN-API.md). Il reset non modifica file dati, `state`, `callCount` o cursori delle
sequence; il reset di una sequence, simmetricamente, non tocca lo stato condiviso.

Un reset invalida gli handle già aperti e le inizializzazioni in corso. Non sospende il
traffico: una nuova richiesta può inizializzare subito la nuova generazione. Per un test
deterministico, ferma prima polling/client, esegui il reset e avvia poi lo scenario.

Return, errore, timeout e disconnessione del client chiudono il facade dell'invocazione:
continuazioni tardive non possono modificare lo store. Se il client è già sparito dopo la
lettura del body, l'handler non viene avviato e quella richiesta non incrementa `callCount`;
l'eventuale step sequence era però già stato scelto dal routing e non viene riavvolto.

### Valori, quote ed errori

Lo store accetta JSON rigoroso e ne conserva una copia serializzata. Sono rifiutati cicli,
`undefined`, funzioni, simboli, `BigInt`, numeri non finiti, oggetti di classe, accessor,
proprietà non enumerabili e profondità oltre 100; `-0` viene conservato come lo `0` equivalente
in JSON. I limiti predefiniti sono 256 risorse, 3 MiB per risorsa e 25 MiB complessivi.

Gli errori shared-state non intercettati producono una risposta pubblica senza nome, firma,
valori o stack: conflitti generazionali `409`, runtime in chiusura `503`, altri errori `500`.
Il dettaglio completo resta nel log e, per gli errori di una richiesta, nella relativa voce del
Monitor. Uno script può intercettare un codice noto e restituire una risposta di dominio; se
non lo riconosce deve rilanciare l'errore. Non applicare retry generici: solo l'autore dello
scenario sa se gli effetti già prodotti siano idempotenti.

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
