# Piano definitivo — Stato runtime condiviso tra handler

Stato: **specifica definitiva dopo adversarial review, pronta per l'implementazione**

Data: 16 agosto 2026

Ambito: runtime degli handler, concorrenza, reset, Admin API, UI, filtri/paginazione,
hot reload, limiti, sicurezza, test e documentazione.

Questo documento è la fonte di verità della feature. Le sezioni sulle alternative non sono una
cronologia delle proposte: conservano soltanto le ragioni che serviranno a non riaprire in futuro
decisioni già analizzate.

## 1. Esito dell'analisi

La funzione è coerente con Mockxy e risolve un vuoto reale tra mock statici e backend vero:
più endpoint devono poter osservare e modificare la stessa risorsa effimera. Il caso guida è:

```text
GET  /api/items       -> [A, B]
POST /api/items  C    -> 201 C
GET  /api/items       -> [A, B, C]
```

Il motore possiede già quasi tutti i mattoni necessari:

- gli handler ricevono il body della richiesta in forma JSON;
- `data(nome)` fornisce un seed condivisibile dal workspace;
- `HandlerStateStore` conserva memoria tra le richieste e sopravvive al reload a caldo;
- l'Admin API possiede già azioni runtime non persistenti, come reset sequence e console
  SSE/WS;
- il serving dei mock contiene già l'algoritmo comune per filtri e paginazione delle liste.

Il limite attuale è di identità: `HandlerStateStore` usa la chiave `METHOD path`, quindi
`GET /api/items` e `POST /api/items` hanno memorie diverse. `data()` non colma il vuoto perché
rilegge il file e restituisce una copia nuova a ogni chiamata. Una sequence, infine, avanza
solo quando viene richiesto il proprio endpoint e non può catturare il body arbitrario di una
POST diversa.

La soluzione scelta è un nuovo **`SharedStateStore` nominato, JSON-only, in-memory e separato
dallo stato locale degli handler**. Gli script accedono allo store mediante handle legati alla
singola esecuzione dell'handler. Letture e mutazioni non espongono mai il valore vivo dello
store: lavorano su snapshot e draft isolati.

Questa separazione è essenziale. Non si cambia il significato di `state`, `callCount` o
`firstRequestAt`; non si lega la vita di una risorsa condivisa a una singola sequence; non si
introduce un nuovo tipo di response o un nuovo file nel formato del workspace.

Non restano questioni bloccanti per l'MVP. Le limitazioni intenzionali sono raccolte nella
sezione 23.

## 2. Obiettivi

L'MVP deve consentire di:

1. condividere una risorsa fra handler di metodi e path diversi attraverso un nome esplicito;
2. inizializzarla una sola volta, anche quando le prime richieste arrivano in concorrenza;
3. leggerla senza poterla modificare accidentalmente fuori da una mutazione;
4. applicare mutazioni atomiche nel singolo processo, senza lost update fra POST concorrenti;
5. mantenere lo stato attraverso hot reload e selezioni di response non pertinenti;
6. azzerare una risorsa o tutte le risorse senza riavviare il motore;
7. impedire che callback tardive, partite da un handler già terminato, scaduto o rimasto senza
   client, modifichino lo **shared state** attraverso l'API ufficiale;
8. limitare crescita, numero di risorse e forme dati patologiche;
9. conservare, su richiesta esplicita, filtri e paginazione automatici sulle liste restituite
   dagli handler;
10. non cambiare formato o comportamento documentato dei workspace/handler esistenti.

## 3. Non-obiettivi dell'MVP

- persistenza su disco o sopravvivenza al riavvio;
- sincronizzazione tra più processi, repliche o workspace;
- isolamento per browser, utente, cookie o sessione;
- generazione automatica di ID, validazione di schema o semantica CRUD implicita;
- transazioni atomiche fra più risorse;
- rollback automatico di una mutazione già commessa se lo script fallisce in seguito;
- cancellazione della promise JavaScript dell'handler, rollback del vecchio `state` locale o
  compensazione di side effect esterni dopo timeout/disconnect;
- utilizzo da middleware, mock templati, SSE o WebSocket;
- scrittura di ritorno nei file della pagina Dati;
- reset automatico quando cambia un file dati, un handler o la selezione di una response;
- scoperta statica affidabile delle risorse usate da uno script;
- un nuovo tipo di response `resource`/`crud` o un database dichiarativo.

Questi confini non impediscono un'evoluzione dichiarativa futura: evitano di dover decidere
adesso ID, PUT/PATCH/DELETE, relazioni, schema e persistenza per risolvere il caso concreto.

## 4. Decisioni definitive

| Tema | Decisione |
|---|---|
| Nome pubblico | `sharedState` nel contesto di `resolveResponse`. |
| Implementazione | Nuovo `SharedStateStore`, distinto da `HandlerStateStore`. |
| Ownership | Una istanza creata e posseduta da `createServerRuntime`, iniettata in app e Admin API, chiusa dallo shutdown; nessun default nascosto in `createApp`. |
| Identità | Nome esplicito scelto dallo script, globale nel singolo motore/workspace. |
| Valori | Solo dati JSON rigorosamente validati: `null`, booleani, stringhe, numeri finiti, array e plain object; `-0` viene canonicalizzato esplicitamente a `0`. |
| Rappresentazione interna | Stringa JSON serializzata; nessun oggetto mutabile vivo viene conservato o esposto. |
| Inizializzazione | `open()` valida/avvia e può lanciare sincronicamente, poi restituisce sempre una Promise osservata internamente ma ancora rigettabile per chi la attende; una sola factory **corrente** per nome/generazione, mentre factory stale non cancellabili possono finire senza commit. |
| Compatibilità del seed | `seedKey` obbligatorio; due dichiarazioni diverse sullo stesso nome producono errore esplicito. |
| Lettura | `read()` restituisce un nuovo snapshot a ogni chiamata. |
| Modifica | `mutate(fn)` usa un draft privato e accetta solo callback sincrone. |
| Sostituzione | `replace(value)` sostituisce atomicamente l'intero JSON. |
| Commit | Immediato al termine valido di `mutate`/`replace`, non al termine dell'handler. |
| Callback store | Dentro initializer o mutator, incluse continuazioni asincrone avviate lì, non è ammessa alcuna operazione shared-state; marker asincrono per entrambe e guard sincrono store-wide nel mutator. |
| Concorrenza | Operazioni lineari e sincrone dopo l'eventuale inizializzazione; due mutazioni non si interlacciano. |
| Errori | Factory fallita ritentabile e registrata una volta dallo store; mutazione fallita non altera il valore precedente; errori non intercettati hanno una risposta pubblica allowlisted e dettagli soltanto in log/monitor admin. |
| Fine esecuzione | Return, errore, timeout e disconnect chiudono il facade; operazioni shared-state successive vengono rifiutate. |
| Hot reload | Stato conservato; cambiare schema/seed richiede nuovo `seedKey` e reset esplicito. |
| Riavvio | Stato perso e ricreato dal seed alla prima richiesta. |
| Shutdown | Lo store viene chiuso permanentemente, entry/init/handle invalidati. |
| Cambio workspace desktop | Equivale a shutdown + nuovo runtime: lo shared state viene perso. |
| Sequence | Il reset sequence non azzera shared state; il cursore sequence si consuma alla decisione di routing, mentre `callCount` conta soltanto gli avvii effettivi dell'handler. |
| Server off/proxy all | Stato conservato ma non usato finché gli handler sono bypassati. |
| Disabilitazione/cancellazione endpoint | Nessun reset o garbage collection implicita. |
| Reset | Admin API per nome e globale; idempotente, immediato, senza reload. |
| POST admin senza parametri | Le quattro mutazioni richiedono `application/json` e un body `{}` effettivamente presente; un marker del parser distingue un buffer decodificato di zero byte dall'oggetto parsato. |
| Visibilità admin | Metadati e diagnostica degli errori, mai il valore. |
| Liste | Nuovo opt-in `applyListQuery: true` nel risultato degli handler. |
| Limiti v1 | 256 risorse, 5 MiB per risorsa, 25 MiB totali, profondità JSON massima 100. |
| Persistenza workspace | Nessun nuovo campo/file; zero migrazioni. |

## 5. Il contratto esposto agli handler

`resolveResponse` riceve un nuovo campo `sharedState`. Il pattern supportato è sempre
`await sharedState.open(...)` dentro l'eventuale `try/catch` dell'handler:

```js
const items = await sharedState.open("items", {
  seedKey: "items@v1",
  initialize: () => [],
});
```

`open(name, options)` richiede:

- `name`: nome della risorsa, canonicalizzato secondo 5.1;
- `seedKey`: identità stabile della forma/strategia di inizializzazione;
- `initialize`: funzione sincrona o asincrona che restituisce il JSON iniziale.

`name` e `seedKey` devono essere stringhe: non si applica `String(...)`, così oggetti con
`toString()` non eseguono codice durante la validazione. `options` deve essere un oggetto non
nullo e `initialize` viene validata anche quando l'entry è già pronta, per non accettare un
opener che fallirebbe soltanto dopo il prossimo reset. Campi option sconosciuti vengono ignorati
nell'MVP per compatibilità evolutiva, ma non cambiano identità o comportamento. La factory non
riceve argomenti; usa soltanto le closure esplicite dello script.

`open()` **non** è dichiarata `async`: prima di restituire una Promise valida e lancia
sincronicamente tutto ciò che è già decidibile, inclusi argomenti, initializer, contesto/store
chiusi, accesso vietato da una callback in corso, conflitto con un seed già noto e limite di
entry. Se deve inizializzare, riserva il token e **invoca la factory nello stesso stack** prima
di ritornare; ne adotta poi l'eventuale Promise. Dopo questi passaggi `open()` restituisce sempre
una Promise, risolta con l'handle anche quando l'entry è già pronta. Attesa condivisa, reset
durante init e fallimenti del seed viaggiano invece sulla Promise.

Questa separazione è intenzionale. Dentro un mutator sincrono una chiamata vietata come
`sharedState.open()` non può essere attesa: deve lanciare subito, altrimenti una Promise
rigettata e ignorata diventerebbe un'unhandled rejection. Per chi usa il contratto documentato,
`await` dentro `try/catch` intercetta allo stesso modo throw sincroni e rejection asincrone.
Una factory sincrona che lancia viene catturata internamente e convertita nel normale esito
asincrono `SHARED_STATE_INIT_FAILED`.

Ogni Promise per-chiamante prodotta da un `open()` valido riceve immediatamente anche un
rejection handler interno no-op, ma lo store restituisce la **Promise originale**, non quella
risolta generata da `.catch()`. In questo modo `await sharedState.open(...)` continua a ricevere
la rejection e a seguire il normale `try/catch`, mentre la Promise originale lasciata
completamente inutilizzata non può terminare l'intero motore con un `unhandledRejection`
secondo i default di Node 24. L'osservatore interno è contenimento del danno, non trasforma il
fallimento in successo e non sostituisce la diagnostica store-level descritta in 7.1 e 16.2.
Non può controllare nuove Promise che lo script crei con `.then()`/`.finally()` e poi ignori:
il contratto supportato resta `await` oppure una catena con rejection handler esplicito.

La prenotazione sincrona impedisce a due chiamanti di osservare l'entry come assente; l'avvio
nello stesso stack garantisce inoltre che la factory del vincitore inizi prima che il chiamante
riprenda il controllo. Non trasforma gli errori della factory in throw sincroni: l'invocazione
è racchiusa in `try/catch` e il valore o l'errore vengono convertiti nel solo esito asincrono
della Promise condivisa.

Restituisce un handle request-scoped con tre operazioni:

```js
const snapshot = items.read();

const result = items.mutate((draft) => {
  // draft è privato: se la callback fallisce non viene commesso.
  return "risultato facoltativo della mutazione";
});

items.replace(nextJsonValue); // restituisce undefined
```

L'handle non espone `close()`: la chiusura appartiene al facade dell'invocazione ed è sempre
eseguita dal serving. `open()` descrive quindi l'acquisizione di un handle generazionale, non
l'obbligo per lo script di rilasciare una risorsa manualmente.

Le tre operazioni dopo `open()` sono intenzionalmente sincrone. Il solo punto asincrono
controllato è l'inizializzazione. Questo rende l'ordine delle mutazioni osservabile e impedisce
che un `await` dentro una callback lasci una risorsa a metà modifica. Dentro `initialize` e
dentro la callback di `mutate` non si può chiamare nessuna operazione shared-state, neppure su
un'altra risorsa: la callback deve essere pura rispetto allo store.

### 5.1 Regole dei nomi

Il nome:

- è convertito con `trim().toLowerCase()`;
- deve avere da 1 a 128 caratteri;
- ammette solo `a-z`, `0-9`, `.`, `_` e `-`, come i nomi dei file dati;
- non può essere esattamente `.` o `..`, che non sono segmenti URL amministrativi stabili;
- non deve essere costruito da input non fidato senza una whitelist.

`items`, `catalogo-prodotti` e `ordini.v2` sono validi. `.`, `..`, `../../x`, una stringa vuota o
un nome con spazi interni non lo sono.

`seedKey` è una stringa non vuota lunga al massimo 256 caratteri, senza caratteri di controllo
né spazi iniziali/finali. Non viene normalizzata ed è case-sensitive: `items@v1` e `Items@v1`
sono firme diverse. Non è un segreto, perché compare nei metadati admin. Conviene darle una
forma leggibile e versionata:

```text
items@v1
orders@v3
catalogo-prodotti@v2
```

La firma identifica la **forma logica**, non il percorso fisico del seed: rinominare
`items.json` non cambia `items@v1`, mentre cambiare lo schema degli item richiede `items@v2`.

### 5.2 Perché `seedKey` è obbligatorio

Senza una firma, due endpoint potrebbero dichiarare per errore lo stesso nome con seed diversi:
il contenuto iniziale dipenderebbe da quale richiesta arriva per prima. `seedKey` rende il
conflitto fail-fast.

```js
// GET /items
await sharedState.open("items", { seedKey: "items@v1", initialize: ... });

// POST /items — errore esplicito, non "first request wins"
await sharedState.open("items", { seedKey: "altro-schema@v1", initialize: ... });
```

La firma dichiara compatibilità, non prova che due callback siano identiche. Gli esempi e i
template devono quindi ripetere un blocco `open()` piccolo e canonico, con stesso nome,
`seedKey` e `data()` letterale. Un handler è codice fidato e potrebbe mentire deliberatamente
sul `seedKey`; questa API offre correttezza, non un sandbox fra script.

La garanzia deterministica richiede che `initialize` dipenda soltanto da input stabili per quel
`seedKey`, come un file `data()` o una costante. I pattern ufficiali non derivano il seed da body,
query, parametri, header, orologio o casualità della singola richiesta: due factory dichiarate
compatibili ma alimentate da input diversi reintrodurrebbero un «first request wins» che il
runtime non può rilevare. Uno script avanzato può scegliere intenzionalmente un seed casuale a
ogni reset, ma esce da quella garanzia e accetta esplicitamente che la prima inizializzazione
della generazione stabilisca il valore per tutti i chiamanti. `initializedBy` rende
diagnosticabile chi ha vinto, senza trasformare `seedKey` in una falsa verifica del codice.

Un helper CommonJS condiviso resta possibile per workspace gestiti a mano, ma non è il pattern
ufficiale dell'MVP: oggi l'indice della pagina Dati e la copia endpoint ragionano sui sorgenti
handler diretti, non sulla chiusura transitiva delle loro dipendenze. La duplicazione di quattro
righe è preferibile a introdurre un esempio che aggira funzioni di sicurezza del workspace.

### 5.3 Esempio completo: seed dalla pagina Dati

Struttura indicativa:

```text
mocks/api/items/
├── GET.endpoint.json
├── GET.responses/
│   ├── 001.response.json
│   └── 001.handler.js
├── POST.endpoint.json
└── POST.responses/
    ├── 001.response.json
    └── 001.handler.js

files/items.json
```

Ogni `001.response.json` è il descrittore necessario che collega la variante al sorgente:

```json
{
  "type": "handler",
  "title": "",
  "sourceFile": "001.handler.js"
}
```

Ogni handler contiene lo stesso opener canonico:

```js
function openItemsState({ sharedState, data }) {
  return sharedState.open("items", {
    seedKey: "items@v1",
    initialize: () => data("items"),
  });
}
```

Le due copie della funzione non contengono il valore vivo: entrambe raggiungono il
`SharedStateStore` del motore tramite nome e firma. Si elimina così il problema dei singleton
CommonJS che, dopo il reload incrementale di un solo handler, possono conservare istanze
diverse.

### 5.4 GET della collezione

```js
function openItemsState({ sharedState, data }) {
  return sharedState.open("items", {
    seedKey: "items@v1",
    initialize: () => data("items"),
  });
}

module.exports = {
  async resolveResponse(context) {
    const itemsState = await openItemsState(context);

    return {
      status: 200,
      jsonBody: itemsState.read(),
      applyListQuery: true,
    };
  },
};
```

`read()` restituisce un oggetto appena parsato. Modificarlo dopo la lettura non cambia lo
store:

```js
const snapshot = itemsState.read();
snapshot.push({ id: "solo-locale" });

// Una seconda read non contiene "solo-locale".
```

### 5.5 POST della collezione

```js
const crypto = require("node:crypto");

function openItemsState({ sharedState, data }) {
  return sharedState.open("items", {
    seedKey: "items@v1",
    initialize: () => data("items"),
  });
}

module.exports = {
  async resolveResponse(context) {
    const { jsonBody } = context;
    if (jsonBody == null || typeof jsonBody !== "object" || Array.isArray(jsonBody)) {
      return {
        status: 400,
        jsonBody: { error: "item_must_be_an_object" },
      };
    }

    const itemsState = await openItemsState(context);
    let created;
    try {
      created = itemsState.mutate((items) => {
        if (!Array.isArray(items)) {
          throw new Error("The 'items' shared state must contain an array.");
        }

        const item = {
          ...jsonBody,
          id: jsonBody.id ?? crypto.randomUUID(),
        };
        if (items.some((current) => String(current.id) === String(item.id))) {
          const error = new Error(`Duplicate item id: ${item.id}`);
          error.code = "DUPLICATE_ITEM";
          throw error;
        }

        items.push(item);
        return item;
      });
    } catch (error) {
      if (error.code === "DUPLICATE_ITEM") {
        return { status: 409, jsonBody: { error: "duplicate_item" } };
      }
      throw error;
    }

    return {
      status: 201,
      headers: { location: `/api/items/${encodeURIComponent(created.id)}` },
      jsonBody: created,
    };
  },
};
```

Se la callback lancia sull'ID duplicato, il draft viene scartato per intero e l'handler traduce
l'errore di dominio in `409`. Lo store non impone questa regola: ID, duplicati, campi
obbligatori e status HTTP appartengono al dominio e restano responsabilità dell'handler.

### 5.6 PATCH/DELETE sono normali mutazioni

Non servono primitive speciali:

```js
const updated = itemsState.mutate((items) => {
  const index = items.findIndex((item) => String(item.id) === params.id);
  if (index < 0) return null;
  items[index] = { ...items[index], ...jsonBody, id: items[index].id };
  return items[index];
});
```

Per eliminare:

```js
const deleted = itemsState.mutate((items) => {
  const index = items.findIndex((item) => String(item.id) === params.id);
  if (index < 0) return null;
  return items.splice(index, 1)[0];
});
```

### 5.7 Sostituire la radice

`mutate()` è ideale per array e oggetti. Per una radice scalare o una sostituzione completa:

```js
counterState.replace(0);
settingsState.replace({ mode: "maintenance" });
```

`replace()` applica le stesse validazioni, quote e garanzie atomiche di `mutate()`.
Il valore restituito dalla callback di `mutate()` è soltanto il risultato consegnato allo
script e **non** sostituisce la radice; questa separazione evita che un oggetto di dominio
ritornato per costruire la response diventi accidentalmente il nuovo store.

### 5.8 Intercettare un errore intenzionalmente

Lo script può tradurre un errore shared-state in una risposta di dominio. Se non riconosce il
codice deve rilanciarlo, così resta attiva la diagnostica sicura del runtime:

```js
try {
  itemsState.replace(nextItems);
} catch (error) {
  if (error.code === "SHARED_STATE_ENTRY_TOO_LARGE") {
    return {
      status: 422,
      jsonBody: { error: "scenario_capacity_exceeded" },
    };
  }
  throw error;
}
```

Il catch non deve implementare un retry generico di `open()`/`mutate()`: l'handler può avere
già prodotto effetti e soltanto il suo autore conosce l'idempotenza dello scenario.

Intercettare un errore evita il fallback HTTP, il log request-level e i metadati Monitor. Fa
eccezione il solo warning store-level di un'inizializzazione fallita: descrive una generazione,
viene emesso una volta indipendentemente dai waiter e resta disponibile anche se lo script ha
gestito l'errore. Errori intercettati di `read`, `mutate` o `replace` non generano invece un log
automatico dello store.

## 6. Modello interno del `SharedStateStore`

Ogni entry pronta contiene almeno:

```text
{
  name,
  seedKey,
  serializedValue,
  sizeBytes,
  version,
  initializedAt,
  updatedAt,
  lastAccessAt,
  initializedBy,
  lastAccessedBy,
  token
}
```

Durante l'inizializzazione contiene inoltre una promise condivisa e l'insieme dei contesti che
la stanno attendendo.

`version` vale 1 al commit del seed e cresce a ogni `mutate`/`replace` valido, anche se il JSON
finale è identico. `initializedAt` e `updatedAt` coincidono alla creazione; soltanto una scrittura
successiva cambia `updatedAt`. Ogni `open()` risolta, `read()` riuscita e scrittura commessa
aggiorna `lastAccessAt`/`lastAccessedBy`; un'operazione fallita non cambia alcun metadata
dell'entry. Tutti i timestamp sono millisecondi Unix prodotti da `Date.now()`. Gli origin
contengono method, route path e response file ricavati da
`decision.handler`; non contengono request body o valore. La lista admin è ordinata per nome
canonico, `totalBytes` somma soltanto entry pronte e il limite delle 256 entry conta anche le
prenotazioni in inizializzazione.

### 6.1 Perché conservare JSON serializzato

La stringa JSON, invece di un oggetto vivo, offre proprietà utili per costruzione:

- `read()` fa `JSON.parse` e non può restituire un riferimento interno;
- `mutate()` parte da un parse privato e commette soltanto una nuova stringa completa;
- un errore a metà callback non richiede rollback dell'oggetto originale;
- la dimensione UTF-8 del valore è misurabile con precisione;
- cicli, classi, `BigInt`, funzioni e altri valori non JSON vengono respinti prima del commit;
- reset e sostituzione sono semplici cambi atomici di entry nel singolo event loop.

Il costo è una parse per lettura e parse+validazione+serializzazione per mutazione. È coerente
con un mock server e con `data()`, che già legge e parsa il file a ogni chiamata; non è una
struttura pensata per dataset enormi o carichi da database.

### 6.2 Valori JSON ammessi

La validazione iterativa, con rilevamento dei cicli, accetta soltanto:

- `null`;
- booleani;
- stringhe;
- numeri finiti, incluso `-0`; la serializzazione canonicalizza deliberatamente `-0` a `0`,
  anche quando compare dentro array o oggetti, mentre `NaN` e infinito restano errori;
- array densi, senza buchi, proprietà extra o chiavi `Symbol`;
- plain object con prototipo `Object.prototype` o `null`, composto soltanto da proprietà proprie
  string-keyed, enumerabili e di tipo data (niente getter/setter).

Rifiuta `undefined`, `BigInt`, `Symbol`, funzioni, `Date`, `Buffer`, `Map`, `Set`, istanze di
classe, `Proxy`, array sparsi, accessor, proprietà non enumerabili/extra, riferimenti ciclici e
profondità oltre 100. Fatta salva la canonicalizzazione dichiarata di `-0`, a differenza di
`JSON.stringify` puro non elimina o trasforma valori in silenzio. `-0` è distinguibile da `0`
con operazioni JavaScript come `Object.is`, ma tale distinzione non fa parte del contratto JSON
portabile dello store; rifiutarlo renderebbe fragili risultati aritmetici comuni senza offrire
un vantaggio utile allo scenario. Prima di ispezionare prototipo o descriptor, il validatore
usa `util.types.isProxy()`: un proxy potrebbe altrimenti eseguire trap proprio durante una
validazione che promette di non invocare codice utente. Sugli altri oggetti il traversal usa i
descriptor invece di leggere getter potenzialmente fallibili o con side effect.

Per evitare off-by-one, una radice scalare ha profondità 0 e ogni ingresso in un array/plain
object incrementa di 1: sono validi al massimo 100 container annidati, il centounesimo fallisce.

## 7. Algoritmi e invarianti

### 7.1 `open()` e inizializzazione concorrente

```text
open(name, { seedKey, initialize }, requestContext)
  fase sincrona
  ├─ valida nome, seedKey, initialize e contesto/store attivi
  ├─ verifica che non sia in corso una callback initializer/mutator vietata
  ├─ entry con seedKey diverso -> throw SHARED_STATE_SEED_CONFLICT
  ├─ entry assente -> verifica limite, riserva entry + token e invoca initialize()
  └─ restituisce una Promise
       ├─ entry pronta -> handle sul token corrente
       ├─ inizializzazione in corso -> attesa della stessa factory, sul token corrente
       └─ nuova entry
            ├─ adotta l'esito dell'unica initialize(), avviata sotto marker asincrono
            ├─ valida JSON, profondità e quote
            ├─ se token corrente e almeno un waiter attivo: commit versione 1
            └─ altrimenti scarta il risultato
```

Una factory che fallisce rimuove la prenotazione, purché sia ancora quella corrente. Tutti i
waiter ricevono lo stesso errore e la richiesta successiva può ritentare. Non si memorizza un
fallimento permanente. Un throw/reject generico viene avvolto in `SHARED_STATE_INIT_FAILED` con
`cause`; un valore restituito ma non valido mantiene invece il codice specifico
`SHARED_STATE_INVALID_VALUE`, `SHARED_STATE_ENTRY_TOO_LARGE` o
`SHARED_STATE_TOTAL_TOO_LARGE`.

Lo store riceve dal runtime un logger strutturato esplicito e registra a livello `warn` ogni
tentativo di inizializzazione che termina con un fallimento effettivo della factory, della
validazione, della quota o del guard di reentrancy. Il log nasce nel punto unico di settlement
dell'inizializzazione condivisa, quindi una sola volta per nome/generazione e non una volta per
waiter o nel rejection handler no-op delle Promise per-chiamante. Include codice, nome,
`seedKey`, origin e causa/stack, ma mai valore, draft o request body; il messaggio canonico è
`Shared state initialization failed.`. Reset, chiusura del singolo contesto e chiusura dello
store sono eventi di lifecycle, non fallimenti della factory, e non producono questo warning.
Un errore del logger viene isolato e non può cambiare cleanup, rejection o ritentabilità
dell'inizializzazione.

La factory viene eseguita sotto un marker `AsyncLocalStorage` con identità dello store e fase
`initializer`, appartenente alla sua catena di esecuzione e non all'entry globale. Qualunque
operazione shared-state eseguita da quella catena — `open`, `read`, `mutate` o `replace`, anche
tramite un handle catturato e anche su una risorsa diversa — fallisce con
`SHARED_STATE_REENTRANT_INITIALIZATION`. Il marker sopravvive agli `await` e ai task asincroni
distaccati dalla factory, ma non blocca altre richieste che usano legittimamente lo store mentre
l'initializer attende. `AsyncLocalStorage.run()` ripristina automaticamente il contesto del
chiamante; prenotazione e waiter vengono invece ripuliti in `finally`. I discendenti asincroni
già creati conservano comunque il marker e restano riconoscibili come lavoro dell'initializer.
La prima violazione marca anche il tentativo di init: se la factory intercetta l'errore e prova
comunque a restituire un seed, il commit viene rifiutato con lo stesso codice e la prenotazione
rimossa. Catturare l'eccezione non trasforma quindi una factory impura in una valida.

Ogni `SharedStateStore` possiede il proprio `AsyncLocalStorage`; `close()` lo disabilita dopo
aver invalidato entry e contesti. In questo modo runtime successivi non condividono marker e
l'oggetto può essere raccolto senza trattenere catene asincrone oltre il proprio lifecycle.

Vietare soltanto `open()` sulla stessa entry non basta: una factory potrebbe creare un ciclo
attraverso una seconda risorsa, leggere uno stato il cui ordine dipende dalla prima richiesta
oppure commettere su un'altra entry e poi fallire, lasciando un'inizializzazione parziale non
annullabile. Il divieto uniforme rende l'initializer una factory del solo valore iniziale.
Può leggere `data()` o costanti e fare lavoro asincrono read-only, ma non deve scrivere file,
chiamare servizi con side effect o accedere allo shared state.

"Pure" qui significa niente side effect da annullare: il motore può invalidare il commit nello
store, ma non può cancellare una promise JavaScript né compensare effetti esterni già avvenuti.
Il seed raccomandato legge soltanto `data()` e costruisce un valore JSON.

Se un reset rimuove l'entry mentre la factory è in volo, il token non è più corrente: il
risultato tardivo viene scartato e non può far ricomparire la risorsa. Gli `open()` in attesa
non aspettano la factory: una promise di invalidazione associata all'entry li fa rigettare
subito con `SHARED_STATE_RESET_DURING_INITIALIZATION`.

Non viene eseguito alcun retry automatico sulla nuova generazione. Un `open()` registrato sulla
generazione G deve risolversi con un handle di G oppure fallire; non può migrare implicitamente
a G+1 dopo un reset. Questa **affinità generazionale** rende il reset un confine osservabile e
impedisce che una richiesta iniziata prima del reset inizializzi inaspettatamente lo stato
nuovo. Chi vuole proseguire invoca esplicitamente un nuovo `open()` dopo aver gestito l'errore.
Il runtime e i template non fanno retry automatici dell'intero handler: soltanto l'autore dello
script può sapere se ripetere la richiesta è sicuro rispetto agli effetti già prodotti.

Quando un contesto si chiude viene rimosso dai waiter. Se non ne resta nessuno, l'entry in
inizializzazione viene rimossa **subito**, senza attendere la factory: una promise che non
termina mai non deve avvelenare per sempre il nome né occupare una quota. La factory JavaScript
non è cancellabile e può continuare in background, ma l'invalidation promise libera gli
`open()` e il token ormai stale le impedisce ogni commit. Se almeno un altro handler attivo sta
ancora aspettando lo stesso seed, l'entry resta e il risultato può essere commesso per quel
chiamante.

La Promise restituita a ciascun chiamante corre fra esito della factory, chiusura del proprio
contesto, reset e chiusura store: vince il primo evento linearizzato. `CONTEXT_CLOSED`,
`RESET_DURING_INITIALIZATION` e `STORE_CLOSED` liberano subito quel waiter. L'esito tardivo della
factory resta sempre osservato internamente, anche dopo la rimozione dell'entry, per non creare
rejection non gestite. Anche ogni Promise per-chiamante viene marcata come gestita tramite un
`.catch(() => {})` interno e viene poi restituita nella sua forma originale: chi la attende vede
ancora l'errore, chi la ignora non può abbattere il processo. Il warning unico precedente rende
diagnosticabile un'inizializzazione fallita anche quando nessun chiamante ne osserva la
rejection; le rejection di puro lifecycle restano invece silenziose se lo script sceglie di
ignorare la Promise.

### 7.2 `read()`

1. verifica che il contesto dell'handler sia ancora attivo;
2. verifica che l'entry associata all'handle sia ancora quella corrente;
3. aggiorna `lastAccessAt`/`lastAccessedBy`;
4. restituisce `JSON.parse(serializedValue)`.

Un reset rende stale tutti gli handle esistenti. Una loro `read`, `mutate` o `replace` successiva
fallisce con `SHARED_STATE_STALE_HANDLE`, invece di operare su un oggetto orfano o ricreare
silenziosamente lo stato.

### 7.3 `mutate()`

1. verifica contesto e token;
2. parsa il valore corrente in un draft privato;
3. invoca la callback **sincronamente**;
4. se la callback lancia o restituisce un thenable/promise, scarta il draft;
5. valida il draft come JSON e ne calcola la stringa/size;
6. verifica quota per-entry e totale sostituendo idealmente la vecchia size con la nuova;
7. commette stringa, size, timestamp e `version + 1` in un'unica sezione sincrona;
8. restituisce il valore prodotto dalla callback.

Poiché fra i passi 2 e 7 non esiste alcun `await`, due mutazioni nello stesso processo non si
interlacciano. La seconda parte sempre dal valore già commesso dalla prima.

La callback viene invocata sotto il marker `AsyncLocalStorage` con fase `mutator` e, durante la
sua esecuzione sincrona, lo store porta anche un unico guard **store-wide**. Qualunque operazione
shared-state tentata dalla callback — `open`, `read`, `mutate` o `replace`, sulla stessa entry o
su un'altra — fallisce con `SHARED_STATE_REENTRANT_ACCESS`; `open()` lancia sincronicamente come
definito in sezione 5. Il guard viene sempre rilasciato in un `finally`, anche se callback,
validazione o quota falliscono.

Il frame della mutazione conserva la prima violazione. Se il mutator cattura internamente
l'errore di un accesso vietato e continua, il passo 5 non viene eseguito: l'intera mutazione
fallisce e il draft viene scartato. Questo rende «dentro la callback non si usa lo store» un
invariante, non un errore aggirabile con `try/catch` accidentale.

Il marker non rende asincrona la sezione critica: serve a riconoscere le continuazioni che una
callback errata può aver già schedulato. Per esempio, una funzione `async` comincia a eseguire,
restituisce una Promise che `mutate()` rifiuta, ma il codice dopo il suo primo `await` continua
comunque; senza marker potrebbe mutare un'altra entry mentre l'handler è ancora attivo. Quella
continuazione riceve `SHARED_STATE_REENTRANT_ACCESS`. Il codice dell'handler eseguito normalmente
dopo il ritorno di `mutate()` è fuori dallo scope e può usare lo store.

Un guard limitato alla stessa entry eviterebbe soltanto la sovrascrittura del draft esterno.
L'accesso ad altre risorse lascerebbe invece due semantiche fragili: letture dipendenti
dall'ordine di commit e scritture multi-risorsa parziali se il mutator esterno fallisce. Il
divieto uniforme è più semplice da spiegare e verificare. Il flag store-wide non produce falsi
positivi fra richieste: la callback è sincrona e nessun altro task JavaScript può interlevarsi.
Il marker estende il divieto soltanto ai discendenti asincroni della callback; non blocca altre
richieste. L'initializer, essendo legittimamente asincrono, usa soltanto il marker per catena
descritto in 7.1: un flag globale mantenuto attraverso i suoi `await` bloccherebbe richieste
concorrenti del tutto lecite.

Quando viene rilevato un thenable, il motore aggancia anche un rejection handler no-op prima di
segnalare `SHARED_STATE_ASYNC_MUTATOR`: una callback `async` che rigetta in seguito non deve
produrre un'unhandled rejection. Il suo draft resta comunque privato, non viene commesso e le
sue continuazioni restano marcate come lavoro vietato del mutator.

La garanzia di rollback riguarda soltanto il JSON dello store. Un mutator che scrive un file,
modifica un singleton di modulo o produce altri side effect e poi lancia non può vederli
annullati. I mutator documentati devono limitarsi a validare/modificare il draft e calcolare il
risultato.

Il risultato della callback può riferire oggetti del draft senza esporre lo stato vivo: lo
store conserva soltanto la nuova stringa serializzata. Modificare il risultato in seguito non
cambia la risorsa.

### 7.4 `replace()`

Valida e serializza il nuovo valore prima di sostituire l'entry. Un errore o superamento quota
lascia intatta la versione precedente. La versione avanza di uno anche se il JSON nuovo è
identico: `replace()` rappresenta una scrittura esplicita.

### 7.5 Chiusura del contesto request-scoped

`respondWithHandler()` installa all'ingresso un listener `res.once("close")`, prima della lettura
del body. Il listener imposta `clientDisconnected` quando `res.writableEnded` è falso e chiude
il facade se è già stato creato. Il facade è inizialmente `null`: viene creato soltanto dopo che
il body è stato letto con successo e una seconda verifica di `clientDisconnected`,
`req.destroyed` e `res.destroyed` conferma che il client è ancora presente. Solo allora si chiama
`handlerStates.enter()` e si avvia `resolveResponse`.

Non si aggiunge un secondo listener `req.on("aborted")`: `readStreamToBuffer()` conserva il
rilevamento già esistente durante la body read e produce `CLIENT_ABORTED`. Il nuovo listener su
`res.close` copre la finestra successiva e usa `writableEnded` per non confondere una response
completata con una disconnessione.

Quell'ordine definisce un cambiamento intenzionale del contratto esistente:

- abort durante il body, oppure nel breve intervallo fra body completo e avvio, non esegue
  l'handler e non incrementa `callCount`/`firstRequestAt`;
- dopo `handlerStates.enter()` l'**invocazione dell'handler** è considerata iniziata: il
  conteggio resta anche se il client si disconnette e non viene eseguito alcun rollback;
- un `CLIENT_ABORTED` della lettura body non diventa `Handler Execution Failed`, non produce un
  tentativo di risposta `500` e non viene loggato come errore dello script.

Questa soglia riguarda soltanto il lifecycle e i contatori dell'handler. Il registry esegue
`matchRequest()` e la sequence esegue `resolveStep()` prima di entrare in
`respondWithHandler()`: una richiesta che ha già ottenuto una decisione di routing consuma
quindi lo step anche se il client abortisce durante il body e l'handler non parte. È
un'asimmetria intenzionale con `callCount`: la sequence conta decisioni di routing, `callCount`
conta invocazioni effettive. Ritardare o annullare lo step dopo un abort richiederebbe un
rollback ambiguo quando richieste concorrenti hanno già ricevuto gli step successivi; il piano
mantiene il comportamento preesistente e lo rende parte del contratto.

Il facade viene chiuso in un `finally` quando `resolveResponse` termina, lancia o perde la corsa
col timeout. Il listener di disconnect lo chiude inoltre appena la response si interrompe prima
del completamento. Chiusura e cleanup sono idempotenti; il listener `once` viene rimosso
nell'uscita normale, compresi i percorsi nei quali il facade non è mai stato creato.
Prima di inviare sia un risultato valido sia un errore, il serving ricontrolla il flag e lo stato
di `res`: dopo un disconnect non tenta di scrivere header o body sul socket chiuso.

La fine si linearizza quando il serving osserva il settlement della Promise handler: il facade
viene chiuso nella stessa continuazione, prima di validare/costruire/inviare la response. Una
microtask che lo script ha accodato prima di risolvere la propria Promise può essere eseguita da
Node prima di quella continuazione ed è quindi ancora parte dell'esecuzione osservabile; timer o
continuazioni successive alla chiusura vengono rifiutati. Non si promette una preemption fra
microtask già ordinate nello stesso turno dell'event loop.

Handle e facade controllano il flag a ogni operazione. Perciò questo codice non modifica lo
stato dopo la risposta:

```js
resolveResponse({ sharedState }) {
  setTimeout(async () => {
    try {
      const state = await sharedState.open(/* ... */);
      state.mutate(/* ... */);
    } catch (error) {
      // SHARED_STATE_CONTEXT_CLOSED: nessun commit tardivo.
    }
  }, 1000);

  return { status: 202 };
}
```

`runWithTimeout()` non cancella la promise dello script perdente; la chiusura del facade è
quindi una protezione necessaria, non un raffinamento opzionale. La garanzia copre soltanto
l'API ufficiale di shared state: la promise dell'handler continua, il vecchio `state` locale
può ancora essere modificato tramite riferimenti già ottenuti e side effect su filesystem,
rete o singleton non vengono annullati. Estendere la protezione a questi effetti richiederebbe
un diverso modello di esecuzione ed è fuori dall'MVP.

La chiusura su disconnect non annulla commit già conclusi: impedisce soltanto le operazioni
successive. Un client che sparisce dopo il commit ma prima della risposta resta nello stesso
caso ambiguo di un backend reale che ha applicato la POST e ha perso la connessione.

## 8. Semantica del commit e dei fallimenti dell'handler

Le mutazioni sono **immediate**, non transazioni legate alla risposta HTTP.

```js
itemsState.mutate((items) => items.push(created)); // commit
throw new Error("failure after commit");           // response 500, item presente
```

Questo comportamento è deliberato:

- trattenere lock per tutta una funzione `async` bloccherebbe GET/POST sulla risorsa e aprirebbe
  deadlock con più risorse;
- un modello ottimistico non può rieseguire in sicurezza handler con side effect esterni;
- anche un backend reale può commettere e poi perdere la risposta, lasciando il client incerto;
- lo `state` locale attuale ha già side effect immediati.

Gli esempi devono validare prima e chiamare `mutate()` come ultima operazione fallibile prima
di costruire il risultato. Se serve una vera transazione multi-step, è il segnale che il caso
ha superato il perimetro di un mock in-memory.

Una mutazione eseguita prima del timeout resta commessa. Una mutazione tentata **dopo** che il
timeout ha chiuso il contesto viene rifiutata. Entrambi i casi devono avere test espliciti per
evitare ambiguità future.

Il timeout non è una preemption CPU: parse, validazione, stringify e callback sincrona bloccano
l'event loop, quindi il timer non può scattare nel mezzo e un lavoro sincrono può superare la
durata nominale prima che Node torni a processare timer/microtask. Quote, callback brevi e il
benchmark sono la mitigazione; non si promette un limite wall-clock rigido sul codice sincrono.

## 9. Concorrenza e ordine osservabile

Nel singolo processo Node, `read`, `mutate` e `replace` sono linearizzabili:

| Interleaving | Esito garantito |
|---|---|
| Due prime GET concorrenti | Una sola factory; entrambe ricevono snapshot dello stesso seed. |
| Prima GET e prima POST concorrenti | Una sola factory; GET vede lo stato prima o dopo il commit POST, mai un draft parziale. |
| Due POST concorrenti | Entrambi gli item restano; l'ordine è l'ordine effettivo delle due `mutate()`. |
| GET durante `mutate()` | Poiché `mutate()` è sincrona, la GET avviene interamente prima o dopo. |
| Mutator che lancia | Nessun cambiamento e nessun incremento versione. |
| Mutator `async` | Errore `SHARED_STATE_ASYNC_MUTATOR`, nessun commit. |
| Initializer usa qualunque risorsa condivisa | Errore di reentrancy nel solo contesto della factory; le altre richieste non sono bloccate. |
| Mutator usa la stessa o un'altra risorsa | Errore di reentrancy store-wide, nessun commit del draft esterno. |
| Reset durante init | Factory tardiva scartata; la risorsa resta assente. |
| `open()` in attesa su G mentre avviene reset | Fallisce; non viene ritentato implicitamente sulla generazione G+1. |
| Reset dopo `open`, prima di `mutate` | Handle stale; nessuna resurrezione. |
| Reset concorrente a GET già letta | La GET può rispondere col vecchio snapshot; le richieste successive ripartono dal seed. |
| Abort durante il body di uno step handler | Lo step resta consumato perché la decisione sequence è già linearizzata; l'handler non parte e `callCount` non avanza. |

Non esiste una garanzia di ordine fra due richieste HTTP arrivate "nello stesso momento" oltre
all'ordine in cui raggiungono le operazioni dello store. I test non devono assumere quale dei
due item concorrenti venga prima, ma devono verificare che entrambi siano presenti.

Non c'è coordinamento fra processi. Due istanze Mockxy sullo stesso workspace hanno due store
diversi; mettere il motore dietro un bilanciatore con più repliche rende questo tipo di scenario
non deterministico ed è fuori contratto.

## 10. Ciclo di vita

| Evento | Shared state |
|---|---|
| Prima `open()` | Inizializzato dal seed una volta. |
| Richiesta successiva | Riusa la versione corrente. |
| Hot reload estraneo | Conservato. |
| Modifica dello stesso handler | Conservato. |
| Handler già in volo durante hot reload | Continua col vecchio codice e può commettere finché il suo contesto/token resta valido. |
| Modifica del codice di apertura | Conservato se `seedKey` resta uguale. |
| Cambio `seedKey` con entry viva | Errore esplicito fino a reset/riavvio. |
| Modifica del file dati usato come seed | Nessun effetto finché non si resetta. |
| Eliminazione del file dati dopo init | Stato corrente ancora utilizzabile; il prossimo reset rende l'init fallibile. |
| Selezione di un'altra variante | Conservato. |
| Disable/delete dell'endpoint | Conservato. |
| Reset della sequence | Conservato. |
| Auto-reset della sequence | Conservato. |
| Server off | Conservato, handler bypassati. |
| Proxy all | Conservato, handler/middleware bypassati. |
| Reset per nome | Entry rimossa e handle correnti invalidati. |
| Reset globale | Tutte le entry rimosse e handle invalidati. |
| Cambio workspace nell'app desktop | Shutdown del vecchio runtime, nuovo store vuoto; stato perso. |
| Riavvio/crash | Perso. |
| Shutdown ordinato | `close()` invalida tutto e impedisce nuove `open()`. |

`close()` è idempotente e permanente: svuota le entry, fa rigettare subito gli `open()` in
attesa con `SHARED_STATE_STORE_CLOSED` e rende stale tutti gli handle. Le factory sottostanti
non sono cancellabili, ma i loro token non possono più commettere quando terminano.
Nello shutdown è il primo passo semantico di cleanup, prima di chiudere connessioni e attendere
il server: così il lavoro handler ancora in volo non può commettere mentre il runtime viene
smontato. Su uno store chiuso `STORE_CLOSED` ha precedenza rispetto al token stale.

Un reset non promette che la risorsa resti vuota mentre continua ad arrivare traffico. Chi era
legato alla generazione rimossa fallisce; una nuova chiamata esplicita a `open()` può creare
subito la generazione successiva. Per un reset deterministico di una suite occorre fermare il
flusso che usa la risorsa, eseguire il reset e soltanto dopo avviare il caso di test.

Anche l'hot reload non è una barriera per richieste già avviate: il registry nuovo governa le
richieste successive, mentre una promise handler in volo conserva il vecchio codice. Se una
modifica è incompatibile si ferma il traffico, si aggiorna `seedKey`, si esegue reset e poi si
riprende; non si promette rollback del lavoro iniziato prima del reload.

Non si potano automaticamente risorse non più referenziate: i nomi possono essere dinamici e
uno stesso store può appartenere a endpoint diversi. Il limite sul numero di entry, la vista
admin e il reset esplicito rendono visibili e recuperabili gli eventuali nomi orfani.

## 11. Seed, file dati e schema evolution

`data("items")` resta una lettura fresca del file; usarla come factory di `sharedState` la
trasforma in un **seed una tantum** per quella generazione.

```text
file items.json v1 --prima open--> shared state v1 --POST--> shared state v2
       |
       +-- modifica file: nessun overwrite dello stato runtime
```

Questa scelta evita che salvare un file dati cancelli item creati durante la sessione. Per
applicare il nuovo seed si usa reset per nome o reset globale.

Quando cambia la forma del dato, si incrementa la firma:

```js
seedKey: "items@v2"
```

Se esiste ancora un'entry `@v1`, il conflitto impedisce di servire silenziosamente codice v2
su dati v1. Il flusso previsto durante lo sviluppo è:

1. modificare seed/codice di apertura e incrementare `seedKey`;
2. resettare `items` dalla UI/Admin API;
3. ripetere la richiesta, che inizializza v2.

Non si auto-resetta sul conflitto: un altro handler ancora su v1 potrebbe usare la stessa
risorsa, e cancellarla automaticamente maschererebbe una configurazione incoerente.

### 11.1 Authoring, pagina Dati e copia endpoint

Il blocco ufficiale mantiene `data("items")` direttamente in ciascun `*.handler.js`. In questo
modo l'indice attuale della pagina Dati vede entrambe le route e la rinomina sicura riscrive i
riferimenti senza dover interpretare un grafo CommonJS. `seedKey` non viene riscritto perché è
un'identità logica (`items@v1`), non il nome fisico del file.

La copia di un endpoint duplica il sorgente handler e quindi conserva anche il nome
`sharedState.open("items", ...)`. Il nuovo endpoint continuerà deliberatamente a condividere
`items`: è la semantica di una copia esatta del codice, ma può sorprendere chi voleva uno
scenario indipendente.

La dialog usa la stessa rotta di copia, relativa al prefisso Admin API esistente, in modalità
anteprima:

```http
POST /mocks/:id/copy?dryRun=true
Content-Type: application/json

{ "method": "POST", "path": "/api/items-copy", "copyResponses": false }
```

Risposta `200`:

```json
{
  "dryRun": true,
  "target": { "method": "POST", "path": "/api/items-copy" },
  "copyResponses": false,
  "responseFiles": ["001.response.json"],
  "assetFiles": ["001.handler.js"],
  "sharedStateRefs": ["items"],
  "warnings": [
    {
      "code": "SHARED_STATE_REFERENCES_PRESERVED",
      "names": ["items"]
    }
  ]
}
```

Il dry run esegue tutte le validazioni e calcola con lo stesso algoritmo dell'operazione reale
la chiusura da copiare: sola response selezionata, step raggiunti dalla sequence selezionata o
tutte le response quando `copyResponses` è `true`, con i relativi asset. Legge poi, senza
eseguirli, i sorgenti handler inclusi e ricava best-effort i nomi letterali nella forma
`sharedState.open("nome", ...)` (apici singoli/doppi o template literal statico; espressioni e
alias sono ignorati). `responseFiles` conserva l'ordine dell'endpoint sorgente;
`assetFiles` è deduplicato per primo incontro; nomi e `names` sono canonici, unici e ordinati.
Senza riferimenti, `sharedStateRefs` e `warnings` sono array vuoti. Il dry run non crea directory,
non scrive file e non invoca il reload. La copia effettiva ricalcola il piano anziché fidarsi
dell'anteprima, perché i file potrebbero essere cambiati nel frattempo.

Non si aggiunge `sharedStateRefs` al dettaglio di ogni response: obbligherebbe le normali
letture dell'Admin API a rileggere sorgenti nel percorso caldo per una diagnosi usata soltanto
dalla copia. L'analisi on demand mantiene costo e semantica nello stesso punto dell'azione.

Se l'anteprima trova riferimenti mostra prima del commit:

```text
La copia continuerà a condividere lo stato: items.
Per renderla indipendente, modifica nome e seedKey nel sorgente copiato.
```

Non si riscrive automaticamente nome o `seedKey`: condividere può essere proprio l'obiettivo,
una riscrittura parziale creerebbe firme incoerenti e i nomi dinamici non sono interpretabili
in sicurezza. L'anteprima è diagnostica additiva, non una fonte di verità: la scansione
lessicale può non vedere un helper/nome dinamico e può produrre un warning prudenziale da
commenti o stringhe. Sono accettabili perché il risultato non abilita né blocca il commit. Un
helper esterno può ancora essere usato da utenti avanzati, ma usage dei file dati e copia delle
dipendenze conservano i limiti già esistenti; per questo non compare nei template ufficiali.

## 12. Admin API

Nuove rotte, indicate qui relativamente al prefisso esistente `/_admin/api`:

| Metodo e percorso | Semantica |
|---|---|
| `GET /runtime/shared-state` | Elenco metadati, uso e limiti; mai i valori. |
| `POST /runtime/shared-state/:name/reset` | Reset idempotente della risorsa canonica. |
| `POST /runtime/shared-state/reset` | Reset globale con conteggio delle entry rimosse. |

Esempio lista:

```json
{
  "items": [
    {
      "name": "items",
      "seedKey": "items@v1",
      "status": "ready",
      "version": 3,
      "sizeBytes": 1842,
      "initializedAt": 1786796700000,
      "updatedAt": 1786796765000,
      "lastAccessAt": 1786796770000,
      "initializedBy": {
        "method": "GET",
        "path": "/api/items",
        "responseFile": "001.response.json"
      },
      "lastAccessedBy": {
        "method": "POST",
        "path": "/api/items",
        "responseFile": "001.response.json"
      }
    }
  ],
  "totalBytes": 1842,
  "limits": {
    "maxEntries": 256,
    "maxEntryBytes": 5242880,
    "maxTotalBytes": 26214400,
    "maxDepth": 100
  }
}
```

Un'entry in inizializzazione può apparire con `status: "initializing"`, campi valore/versione
null e metadati del primo inizializzatore. Il payload non espone mai body, anteprime o chiavi
interne del valore.

Reset per nome:

```json
{ "name": "items", "reset": true }
```

Su nome valido ma assente risponde `200` con `reset: false`: il reset è idempotente e adatto a
`beforeEach` delle suite. Il reset globale risponde:

```json
{ "resetCount": 2 }
```

`resetCount` include entry pronte e inizializzazioni invalidate presenti nel punto di
linearizzazione; un'entry già assente non contribuisce.

Il reset linearizza la rimozione ma non mette in pausa il traffico. Una richiesta che esegue
un nuovo `open()` dopo il reset può inizializzare subito un'altra generazione, anche se era
arrivata al server poco prima; soltanto gli handle ottenuti prima del reset sono stale. Per un
setup di test deterministico si ferma il client/polling, si resetta e poi si avvia il flusso da
provare. La UI non deve promettere che la riga resti assente mentre gli endpoint sono attivi.

Un middleware comune `requireEmptyJsonObject` viene applicato uniformemente alle quattro POST
amministrative che rappresentano mutazioni logiche senza parametri:

1. `POST /runtime/shared-state/:name/reset`;
2. `POST /runtime/shared-state/reset`;
3. `POST /mocks/:id/sequence/reset`, già esistente;
4. `POST /monitoring/dump/flush`, già esistente.

Richiedono `Content-Type: application/json` (è ammesso il parametro `charset`) e un body che,
dopo il parsing, sia esattamente un plain object senza proprietà: `{}`. Header assente o media
type diverso produce `415`; body vuoto, `null`, array, scalare o oggetto non vuoto produce
`400`.

`req.body` da solo non distingue tutti i casi: con body-parser 2.x una request senza indicazione
di body lascia `req.body === undefined`, mentre `Content-Length: 0` con media type JSON viene
parsato come `{}`. Il router configura quindi `express.json({ limit, verify })` affinché
`verify` salvi in un marker privato al modulo la lunghezza del buffer decodificato. Il middleware
accetta la richiesta soltanto se quel marker esiste, la lunghezza è maggiore di zero e il
valore parsato è il plain object vuoto. Body assente, `Content-Length: 0` e trasferimento
chunked vuoto producono così tutti `400`; `{}` e sue varianti con whitespace restano valide.
Il marker contiene soltanto una lunghezza, non conserva una copia del body.

La difesa dalle simple request cross-origin deriva dal requisito
`Content-Type: application/json`, che forza il preflight del browser; `{}` non aggiunge
protezione CSRF, ma rende uniforme e non ambiguo il contratto delle quattro mutazioni senza
parametri. Accettare anche il body vuoto manterrebbe la proprietà CORS, ma è scartato per non
creare due forme equivalenti e un'eccezione rispetto ai client/OpenAPI che inviano già `{}`.

Per le due rotte esistenti è un piccolo cambiamento incompatibile di un'API pubblica
documentata, non hardening invisibile: si aggiornano esempi curl italiani/inglesi, OpenAPI,
test di contratto e note di rilascio. Il client UI invia già `{}` su sequence reset e dump
flush, quindi non richiede una migrazione comportamentale. Le rotte restano sotto le protezioni
esistenti dell'Admin API e non sono disponibili quando questa è disabilitata.

Esempi:

```bash
curl -s http://localhost:3000/_admin/api/runtime/shared-state

curl -s -X POST \
  http://localhost:3000/_admin/api/runtime/shared-state/items/reset \
  -H 'content-type: application/json' \
  -d '{}'

curl -s -X POST \
  http://localhost:3000/_admin/api/runtime/shared-state/reset \
  -H 'content-type: application/json' \
  -d '{}'
```

Il reset non scrive file e non invoca `reloadRuntime()`.
Reset per nome/globale agiscono soltanto su `SharedStateStore`: non modificano cursori sequence,
`state`, `callCount` o `firstRequestAt`. Simmetricamente, il reset sequence continua a toccare
soltanto cursore e memoria handler locale. L'indipendenza evita che una risorsa usata da più
endpoint venga cancellata da un'azione su uno solo di essi.

La modalità `POST /mocks/:id/copy?dryRun=true` descritta in 11.1 risponde `200`; la copia reale
continua a rispondere `201`. Entrambe accettano lo stesso body e condividono il planner
read-only che risolve response, asset e riferimenti dal filesystem corrente. Solo il ramo reale
esegue scritture e reload.
`dryRun` assente o esattamente `false` indica commit, esattamente `true` indica anteprima;
valori diversi o ripetuti ricevono `400`, così un typo non può trasformare un'anteprima attesa
in una copia reale.

## 13. Interfaccia

L'endpoint detail non è il posto giusto per il reset: una risorsa può essere usata da molti
endpoint e non è possibile dedurre in modo affidabile i nomi da JavaScript dinamico.

La collocazione definitiva è la pagina **Dati**, divisa in due tab: **File dati** e
**Stato runtime**. Il primo conserva le funzioni attuali; il secondo gestisce dati effimeri
derivati o meno da un file. Questa posizione evita di affollare permanentemente la barra
runtime, mette vicini seed e stato materializzato e offre una destinazione navigabile anche
quando l'errore nasce da `curl` o da una suite.

La tab runtime presenta una vista simile a:

```text
┌ Dati / Stato runtime ────────────────────────────────────────┐
│ 2 risorse · 18,4 KB                                         │
│                                                             │
│ items       v3   1,8 KB   ultimo uso POST /api/items        │
│ items@v1                                   [Azzera]          │
│                                                             │
│ cart        v7  16,6 KB   ultimo uso PATCH /api/cart        │
│ inline:cart@v1                             [Azzera]          │
│                                                             │
│ [Aggiorna]                              [Azzera tutto…]     │
└─────────────────────────────────────────────────────────────┘
```

Regole UI:

- carica i metadati quando si apre la tab e su «Aggiorna», senza polling permanente;
- mostra stato `initializing`, versione, dimensione, firma e ultimo endpoint;
- reset singolo immediato con conferma leggera solo se la risorsa esiste;
- reset globale con dialog di conferma che indica il numero di risorse;
- nessun editor/preview del valore nell'MVP;
- focus gestito nelle conferme, stato busy per riga e annunci accessibili degli esiti;
- URL navigabile `/dati?tab=runtime&name=${encodeURIComponent(nome)}` che seleziona/evidenzia
  la risorsa senza incorporarne il valore;
- una voce del Monitor con `sharedStateError` mostra l'azione «Apri stato condiviso», che porta
  a quell'URL; se la voce non è più presente restano il log server e la vista non filtrata;
- la dialog di copia richiede un dry run riuscito per i valori correnti prima di abilitare la
  conferma; ogni modifica a method/path/`copyResponses` invalida l'anteprima, avvia un nuovo
  dry run dopo la validazione/debounce e ignora response appartenenti a input ormai obsoleti;
- dopo reset sequence la UI precisa che stato locale/cursore sono stati azzerati ma lo shared
  state è rimasto invariato;
- traduzioni italiano/inglese e test dei flussi errore/successo.

Il completamento CodeMirror e il template iniziale degli handler includono `sharedState` e un
esempio breve. Il template generale non deve però creare automaticamente una risorsa: lo
store resta opt-in.

## 14. Filtri e paginazione sulle liste degli handler

Oggi `buildMockPayload()` applica filtri e paginazione solo ai mock JSON statici. Una GET
stateful diventerebbe un handler e perderebbe un comportamento utile. L'MVP aggiunge al
risultato dell'handler:

```js
return {
  status: 200,
  jsonBody: itemsState.read(),
  applyListQuery: true,
};
```

Contratto:

- `applyListQuery` è booleano e facoltativo, default `false`;
- un valore presente ma non booleano, oppure `true` senza `jsonBody`, rende invalido il risultato
  dell'handler e segue il normale errore `Handler Execution Failed`;
- riusa esattamente le regole dei mock statici: array oppure oggetto con un solo array di primo
  livello, filtri prima della pagina, `page`/`size`, case sensitivity configurata e
  `X-Total-Count`;
- se il body non ha forma lista, non lo modifica;
- se non esistono filtri né paginazione, l'algoritmo restituisce `totalCount: undefined` e un
  eventuale `X-Total-Count` dichiarato dallo script viene conservato;
- quando filtri o paginazione calcolano davvero un totale, il server imposta
  `X-Total-Count` **dopo** gli header dello script e quindi il conteggio calcolato vince;
- non si attiva implicitamente per tutti gli handler, quindi non cambia risposte esistenti.

`buildMockPayload()` è già puro, esportato e implementa esattamente questa distinzione; non va
rinominato né duplicato. Il serving handler lo richiama sullo snapshot prima di costruire la
response. I test esistenti dei mock devono restare invariati; una nuova suite applica gli
stessi casi agli handler opt-in, inclusi entrambi i comportamenti dell'header.

## 15. Limiti e controllo della memoria

Lo shared state è raggiungibile indirettamente da endpoint pubblici: una serie di POST da 2 MiB
potrebbe altrimenti far crescere il processo senza limite. L'MVP impone costanti difensive:

| Limite | Valore v1 | Motivazione |
|---|---:|---|
| Numero entry pronte/in init | 256 | Ferma nomi dinamici senza impedire workspace realistici. |
| Dimensione serializzata per entry | 5 MiB (5.242.880 byte) | Tiene contenuto il blocco sincrono di parse/validate/stringify e i duplicati temporanei. |
| Dimensione serializzata totale | 25 MiB (26.214.400 byte) | Consente più scenari realistici senza promettere un database in RAM. |
| Profondità JSON | 100 | Evita strutture patologiche e overflow dei traversal. |

Le quote misurano i byte UTF-8 **commessi**, non il picco temporaneo di memoria durante
parse/draft/stringify. `mutate()` verifica il totale come:

```text
totalBytes - oldEntryBytes + nextEntryBytes
```

`replace()` usa la stessa formula; il primo commit usa `totalBytes + nextEntryBytes`. Le entry in
inizializzazione consumano la quota di conteggio ma zero byte finché non hanno un valore valido.

Un superamento non modifica valore, versione o contatori di size. L'errore ha codice stabile e,
se non intercettato dallo script, segue la mappatura pubblica sicura della sezione 16. Lo script
può intercettarlo e produrre un altro status se lo scenario lo richiede.

Le costanti non diventano impostazioni UI/env nell'MVP. Il limite da 5 MiB è deliberatamente
più basso del massimo dei file dati: durante una mutazione convivono stringa precedente, draft,
nuova stringa e strutture del validatore, quindi equiparare file su disco e stato mutabile
sottostimerebbe sia memoria sia blocco dell'event loop.

Prima del merge un benchmark riproducibile usa un array di plain object realistici da 1 e
5 MiB, cinque warm-up e trenta campioni su una macchina di riferimento registrata insieme ai
risultati. Il generatore deterministico, il seed e lo script restano nel repository; il run usa
Node 24 in modalità normale e `--expose-gc` soltanto per stabilizzare le misure di memoria. A
5 MiB il gate è p95 <= 50 ms per `read()`, p95 <= 100 ms per una `mutate()` no-op
completa di parse/validazione/serializzazione, p95 <= 100 ms per `read()` + filtro/pagina
rappresentativi con `buildMockPayload()`, e picco addizionale sia heap sia RSS <= 128 MiB con GC
controllato. Il benchmark non entra nella CI multipiattaforma come test temporale flaky; il
report è un artefatto di review. Se una soglia fallisce si abbassa il limite documentato prima
del rilascio, non si allenta automaticamente il gate. Un risultato migliore non autorizza da
solo ad alzare la quota. Se casi reali richiederanno dataset maggiori, si valuterà una
configurazione esplicita invece di rimuovere i limiti.

Le quote limitano soltanto ciò che viene commesso tramite questa API. Una factory o callback è
pur sempre JavaScript e può allocare memoria arbitraria prima della validazione o fuori dal
draft; come il resto degli handler, non è sandboxata. Il runtime garantisce rollback/accounting
dello store, non un limite generale alla memoria del processo.

## 16. Errori stabili

L'MVP espone esattamente questi diciassette codici; nuove cause riusano la categoria coerente
finché non richiedono una diversa azione del chiamante:

| Codice | Causa | Commit |
|---|---|---|
| `SHARED_STATE_CONTEXT_CLOSED` | Operazione dopo fine, timeout o disconnect dell'handler. | Nessuno |
| `SHARED_STATE_STORE_CLOSED` | Operazione dopo lo shutdown del runtime. | Nessuno |
| `SHARED_STATE_INVALID_NAME` | Nome non canonico/valido. | Nessuno |
| `SHARED_STATE_INVALID_SEED_KEY` | Firma assente o non valida. | Nessuno |
| `SHARED_STATE_INVALID_INITIALIZER` | `initialize` assente o non funzione. | Nessuno |
| `SHARED_STATE_SEED_CONFLICT` | Stesso nome, firma diversa. | Nessuno |
| `SHARED_STATE_INIT_FAILED` | Factory fallita. La causa originale resta disponibile. | Nessuno; ritentabile |
| `SHARED_STATE_REENTRANT_INITIALIZATION` | La catena di una factory usa qualunque operazione shared-state. | Nessuno |
| `SHARED_STATE_RESET_DURING_INITIALIZATION` | Reset mentre `open()` attende la factory. | Nessuno |
| `SHARED_STATE_STALE_HANDLE` | Reset dopo `open()`. | Nessuno |
| `SHARED_STATE_INVALID_MUTATOR` | Callback di `mutate()` assente o non funzione. | Nessuno |
| `SHARED_STATE_ASYNC_MUTATOR` | Callback restituisce thenable/promise. | Nessuno |
| `SHARED_STATE_REENTRANT_ACCESS` | Un mutator o una sua continuazione usa qualunque operazione shared-state, anche su un'altra entry. | Nessuno |
| `SHARED_STATE_INVALID_VALUE` | Valore non JSON, ciclico o troppo profondo. | Nessuno |
| `SHARED_STATE_ENTRY_LIMIT` | Troppe risorse. | Nessuno |
| `SHARED_STATE_ENTRY_TOO_LARGE` | Entry oltre 5 MiB. | Nessuno |
| `SHARED_STATE_TOTAL_TOO_LARGE` | Totale oltre 25 MiB. | Nessuno |

Tutti sono istanze di `SharedStateError`; `respondWithHandler()` li riconosce con
`isSharedStateError(error)`, basato sull'identità della classe, e non tramite il solo prefisso
di `error.code`. Il modulo vive sotto `src/`, fuori da `mocksDir`, e non viene eliminato dal
purge della cache degli handler: nel runtime esiste una sola identità della classe. Questo
branding evita che un normale errore di dominio con un codice simile venga riclassificato per
sbaglio; non è presentato come confine di sicurezza verso JavaScript arbitrario nello stesso
processo.

### 16.1 Mappatura HTTP degli errori non intercettati

La mappatura seguente si applica **solo** a un vero `SharedStateError` che sfugge allo script.
Se l'handler lo cattura e restituisce una propria response, vince la response dello script,
come nell'esempio 5.8; il `409` di dominio in 5.5 segue lo stesso principio generale.

| Codice/famiglia | Status | `error` e messaggio allowlisted |
|---|---:|---|
| `SHARED_STATE_SEED_CONFLICT` | `409` | `Shared State Conflict`; fermare il traffico, azzerare la risorsa indicata nel Monitor/log e riprovare. |
| `SHARED_STATE_RESET_DURING_INITIALIZATION` | `409` | `Shared State Conflict`; lo stato è stato azzerato durante l'init, riprovare la request solo se sicuro. |
| `SHARED_STATE_STALE_HANDLE` | `409` | `Shared State Conflict`; lo stato è stato azzerato durante la request, riprovare solo se sicuro. |
| `SHARED_STATE_STORE_CLOSED` | `503` | `Shared State Unavailable`; il runtime è in chiusura, riprovare più tardi se il socket è ancora scrivibile. |
| Tutti gli altri errori shared-state | `500` | `Handler Execution Failed`; consultare Monitor o log, senza dettagli interni. |

Esempio allowlisted:

```json
{
  "error": "Shared State Conflict",
  "code": "SHARED_STATE_SEED_CONFLICT",
  "message": "The shared runtime state has an incompatible seed. Stop traffic, find the resource in the Mockxy monitor or server log, reset it, then retry."
}
```

Le altre stringhe canoniche sono:

```text
RESET_DURING_INITIALIZATION:
  The shared runtime state was reset while this request was initializing.
  Retry the request only if it is safe. See the Mockxy monitor or server log.

STALE_HANDLE:
  The shared runtime state was reset while this request was running.
  Retry the request only if it is safe. See the Mockxy monitor or server log.

STORE_CLOSED:
  The shared runtime state is unavailable because Mockxy is shutting down. Retry later.

altri SHARED_STATE_*:
  Unable to use shared runtime state. See the Mockxy monitor or server log.
```

I due errori dovuti a un reset usano messaggi distinti che dicono «retry only if safe»: il
runtime non può sapere se l'handler abbia già prodotto effetti prima di `open()`/dell'uso
dell'handle e non suggerisce un retry automatico generalizzabile.

Le quote restano `500`, non `413`: il body della singola request può essere piccolo e il limite
può dipendere dall'accumulo precedente o dal seed. `507` suggerirebbe inoltre una capacità di
storage persistente che questo runtime non offre. Lo script può scegliere uno status di dominio
diverso intercettando l'errore.

Il body non contiene mai nome della risorsa, `seedKey` richiesto/corrente, dimensioni, valore,
messaggio originale o stack. `SHARED_STATE_CONTEXT_CLOSED` normalmente nasce dopo timeout,
return o disconnect: non sostituisce il `504` già deciso e non provoca un secondo tentativo di
scrittura quando response/socket non sono più utilizzabili. Prima di qualunque fallback il
serving controlla `res.headersSent`, `res.writableEnded`, `res.destroyed` e il flag di
disconnect.

### 16.2 Diagnostica nel monitor e nei log

Nel `catch` di `respondWithHandler()`, prima della mappatura, un errore shared-state non
intercettato imposta esplicitamente:

```js
req._sharedStateError = {
  code: error.code,
  name: error.meta?.name,
  requestedSeedKey: error.meta?.requestedSeedKey,
  currentSeedKey: error.meta?.currentSeedKey,
  actualBytes: error.meta?.actualBytes,
  limitBytes: error.meta?.limitBytes,
  actualEntries: error.meta?.actualEntries,
  limitEntries: error.meta?.limitEntries,
  actualDepth: error.meta?.actualDepth,
  limitDepth: error.meta?.limitDepth,
  responseFile: decision.handler.selectedResponseFile,
};
```

`createRequestMonitorEntry()` deve copiare questo campo come `sharedStateError`; aggiungere una
proprietà a `req` da solo non la rende parte della voce. I campi `undefined` vengono omessi e
non si includono mai valore, draft, body o preview. Il Monitor è superficie amministrativa e
può quindi mostrare nome e firma e offrire il deep link della sezione 13 senza esporli nella
response mock pubblica. Se il dump del monitor è attivo, questi metadati persistono nei relativi
file: la guida privacy/retention deve dichiararlo.

Il monitor è un canale diagnostico utile ma non una garanzia assoluta: la voce ordinaria nasce
su `finish`, è soggetta alla retention, richiede un `requestMonitor` reale e può non esistere
dopo disconnect, con Admin API disabilitata o nei test che costruiscono `createApp()` senza
monitor. Il log server resta quindi il fallback canonico e ha due eventi distinti:

1. `SharedStateStore` emette un solo `warn` strutturato nel settlement di ogni tentativo di
   inizializzazione fallito, indipendentemente dal numero o dalla sopravvivenza dei waiter;
2. `respondWithHandler()` conserva il normale log request-level soltanto quando l'errore sfugge
   allo script, una volta per richiesta coinvolta.

La presenza di entrambi non è una duplicazione accidentale: il primo descrive il fallimento
della generazione e copre anche uno script fire-and-forget; il secondo collega l'effetto alla
singola richiesta e ai suoi metadati. Il warning store-level riguarda factory, validazione,
quote e reentrancy dell'initializer, non le invalidazioni attese dovute a reset, chiusura del
contesto o shutdown. Il rejection handler no-op installato sulle Promise per-chiamante non
logga, così non moltiplica lo stesso evento per tutti i waiter.

Entrambi i log strutturati possono aggiungere codice, nome, seedKey richiesto/corrente, origin,
size/profondità/conteggio e relativi limiti senza serializzare automaticamente valore, draft o
request body; la normale causa/stack dell'errore resta disponibile secondo la policy di logging
esistente. Il logger store-level è una dipendenza esplicita del runtime e la sua eventuale
eccezione viene assorbita: la diagnostica non può modificare cleanup, errore restituito o
ritentabilità.

## 17. Sicurezza e confine di fiducia

Gli handler sono già JavaScript arbitrario eseguito nel processo del motore. `sharedState` non
pretende di isolare script malevoli: un handler può già usare `globalThis`, filesystem o
allocare memoria fuori dallo store.

Le protezioni qui servono a:

- evitare errori accidentali fra handler corretti;
- rendere deterministici reset e hot reload;
- limitare l'amplificazione di input pubblici attraverso l'API ufficiale;
- non esporre dati runtime nell'Admin API;
- impedire mutazioni tardive dopo timeout;
- produrre diagnosi senza loggare payload potenzialmente sensibili.

Con bind LAN, tutti i client del mock condividono la stessa risorsa. L'Admin API continua a
dover essere protetta/disabilitata secondo le regole esistenti. Il valore può contenere dati
ricevuti dai client e resta in RAM fino a reset/riavvio: la documentazione deve sconsigliare
segreti reali esattamente come per catture e body di mock.

Response mock e Admin API non hanno lo stesso confine di fiducia. I mock sono intenzionalmente
consumabili con qualunque `Host`; l'Admin API può essere disabilitata ed è protetta dal guard
anti-DNS-rebinding. Di conseguenza un dato ammesso nella lista stato o nel Monitor non diventa
automaticamente sicuro nel body pubblico. La feature mantiene tre livelli distinti:

1. l'handler riceve l'oggetto errore e può scegliere consapevolmente come tradurlo;
2. log e Monitor amministrativo ricevono metadati diagnostici;
3. la response mock fallback usa soltanto campi e messaggi allowlisted.

## 18. Adversarial review

La tabella seguente tratta ogni scenario come un tentativo di falsificare il design. Le
mitigazioni marcate come test sono requisiti, non suggerimenti.

| Attacco/caso limite | Rischio senza difesa | Decisione/mitigazione | Prova obbligatoria |
|---|---|---|---|
| GET e POST usano lo stesso nome ma seed diversi | Stato dipendente dalla prima richiesta | `seedKey` obbligatorio e conflitto esplicito | Due `open` concorrenti con firme diverse: uno solo può definire l'entry, l'altro fallisce |
| Factory con stesso `seedKey` ma dipendente da body/query | «First request wins» non rilevabile | Contratto di seed stabile, template solo con `data()`/costanti e `initializedBy` diagnostico | Esempi/template non catturano input request-scoped e il limite è documentato |
| Due richieste inizializzano insieme | Factory doppia, duplicati o seed diversi | Promise di init condivisa | Contatore factory uguale a 1 |
| La factory fallisce una volta | Entry avvelenata per sempre | Rimuovere prenotazione; richiesta successiva ritenta | Prima open fallisce, seconda riesce |
| `open()` valida non viene attesa e rigetta in seguito | `unhandledRejection` termina il motore oppure un catch sostitutivo nasconde l'errore a chi attende | No-op catch sulla Promise originale per-chiamante; warning unico al settlement dell'init fallita | `INIT_FAILED`, reset, context close e store close ignorati non producono `unhandledRejection`; un successivo `await` vede ancora la rejection |
| Reset mentre la factory è in volo | Risorsa resuscita o request resta appesa | Token + invalidation promise; waiter rigettati subito | Open fallisce subito e factory tardiva non ricrea l'entry |
| Tutti i waiter vanno in timeout | Init tardiva non richiesta resta viva | Commit solo con almeno un waiter attivo | Factory tardiva scartata |
| Factory non termina mai e tutti i waiter chiudono | Nome bloccato per sempre in `initializing` | Rimuovere subito l'entry all'ultimo waiter; token invalida la factory | Nuova richiesta può ritentare sullo stesso nome |
| Factory tardiva ha side effect esterni | Reset/timeout scarta lo store ma non filesystem/rete | Factory documentata come read-only/pura; nessuna falsa promessa di cancellazione | Test copre il mancato commit, non pretende rollback esterno |
| Un waiter scade, un altro resta | Scarto ingiustificato per il secondo | Waiter attivi per entry | Il secondo riceve il seed |
| Una factory usa la stessa o un'altra risorsa | Self-await, ordine nascosto o commit parziale cross-resource | Marker asincrono vieta ogni operazione shared-state nella catena della factory | Ogni metodo fallisce; un'altra richiesta concorrente non viene bloccata |
| Factory/mutator cattura l'errore rientrante | Callback vietata commette comunque | Il frame resta marcato dalla prima violazione | Init/draft fallisce anche se la callback prosegue |
| `open()` vietata dentro mutator non viene attesa | Promise rigettata ignorata può terminare il processo | Tutte le precondizioni decidibili e i guard lanciano sincronicamente | `expect(...).toThrow()` e nessun `unhandledRejection` |
| Script conserva handle in `setTimeout` | Mutazione fantasma dopo response | Facade request-scoped chiuso in `finally` | Callback tardiva riceve `CONTEXT_CLOSED`, stato invariato |
| `runWithTimeout` perde ma la promise continua | POST modifica dopo 504 | Chiusura context blocca operazioni successive | Mutazione tentata dopo timeout non commette |
| Mutator sincrono supera la durata del timeout | Timer non può preemptare l'event loop | Limiti, callback brevi e benchmark; timeout non dichiarato hard wall-clock | Lavoro già sincrono può finire, il processo resta coerente |
| Client abortisce durante il body | Handler/callCount avanzano per una richiesta mai eseguibile | Listener precoce; niente facade né `handlerStates.enter()` | Nessun handler, nessun incremento e nessun falso 500/log script |
| L'abort avviene dopo che una sequence ha scelto uno step handler | Rollback del cursore ambiguo o aspettativa errata che sequence e `callCount` coincidano | Step consumato alla decisione di routing; nessun rollback, `callCount` resta legato all'avvio handler | Step `times: 1` consumato dall'abort; la richiesta seguente usa lo step successivo senza incremento handler |
| Client chiude fra body completo e avvio | Race salta il listener della body utility | Listener response installato all'ingresso + recheck prima di `enter()` | Nessun handler/callCount in entrambe le finestre |
| Il client chiude dopo l'avvio handler | Script orfano modifica più tardi | Facade chiuso; handler e side effect non-store non cancellabili | CallCount resta; operazioni shared tardive non commettono |
| Listener di disconnect restano sulle keep-alive | Facade/request trattenuti in memoria | Listener `once` rimossi nel `finally` | Dopo molte richieste non crescono i listener sul request/response |
| Mutazione commette e poi handler lancia | Client vede 500 ma stato cambia | Semantica immediata documentata; mutate come ultima fase | Test codifica che il commit resta |
| Mutator `async` fa `await` | Interleaving/lost update | Callback sync-only; thenable rifiutato prima del commit | Nessuna versione/valore modificati |
| Continuazione del mutator `async` usa lo store | Commit tardivo nonostante `ASYNC_MUTATOR` | Marker asincrono fase mutator sopravvive al guard sincrono | Operazione dopo `await` rifiutata; altre request restano operative |
| Mutator usa la stessa o un'altra risorsa | Draft sovrascritto o commit cross-resource parziale | Un guard sincrono store-wide vieta ogni operazione shared-state | Tutti i metodi falliscono e il guard si libera anche dopo errore |
| Mutator modifica e poi lancia | Stato parziale | Draft da JSON separato | Snapshot successivo identico al precedente |
| Mutator produce side effect esterni e poi lancia | Rollback dello store scambiato per transazione generale | Contratto limita la garanzia al JSON; esempi puri | Documentazione esplicita, nessuna promessa di compensazione |
| Snapshot letto viene mutato | Scrittura fuori controllo | `read()` parsa una copia | Seconda read invariata |
| Risultato di `mutate` viene modificato | Alias con dato interno | Store conserva stringa, non draft | Stato invariato |
| Due POST in parallelo | Un item sovrascrive l'altro | Sezione mutate sincrona e lineare | Entrambi presenti, ordine non imposto |
| GET durante POST | Lista parziale | Commit intero sincrono | GET vede prima o dopo, mai draft |
| Reset fra open e mutate | Handle orfano modifica vecchio oggetto | Token stale | `STALE_HANDLE`, entry assente |
| `open()` su G subisce reset | Retry implicito fa migrare la richiesta a G+1 | Affinità generazionale fail-fast, nessun retry interno | La prima open fallisce; soltanto una nuova open crea G+1 |
| GET ha già letto quando arriva reset | Risposta pre-reset dopo conferma admin | Snapshot già linearizzato; limite dichiarato | Richieste successive usano seed nuovo |
| Traffico continuo subito dopo reset | La risorsa ricompare e sembra non azzerata | Reset non è una pausa; un nuovo `open` crea una generazione nuova | Stop/reset/start nel setup deterministico |
| Handler muta A, poi B fallisce | Stato multi-risorsa parziale | Transazioni cross-resource fuori scope, documentate | Nessuna promessa di rollback globale |
| Nome derivato da path/body | Creazione illimitata di entry | Pattern/length + massimo 256 + guida whitelist | La 257ª entry fallisce senza alterare totale |
| POST ripetute fanno crescere una lista | OOM | 5 MiB entry, 25 MiB totale, rollback quota | Superamento conserva size/versione precedente |
| Mutate su 5 MiB blocca l'event loop | Latenza globale; il timer non interrompe lavoro sincrono | Limite, callback sync breve e benchmark con gate espliciti | p95 e memoria rispettano le soglie della sezione 15 |
| JSON molto profondo/ciclico | Stack overflow/stringify failure | Validator iterativo, cicli e max depth 100 | Errori stabili, processo vivo |
| `NaN`, infinito, `BigInt`, `Date`, Buffer o `-0` aritmetico | Conversioni silenziose oppure 500 intermittenti su uno zero valido per lo scenario | JSON-only rigoroso; tipi/valori non JSON rifiutati, `-0` canonicalizzato esplicitamente | Invalidi rifiutati senza commit; `-0` radice o annidato viene riletto come `0` |
| Array sparso, object con getter/symbol o `Proxy` | Stringify ignora/trasforma o la validazione esegue codice | `isProxy`, descriptor validation e array densi | Errore stabile, getter/trap mai invocati |
| File seed cambia a caldo | Perdita silenziosa degli item runtime | Nessun auto-reset; reset esplicito | Stato resta, dopo reset legge il file nuovo |
| Template mette `data()` in un helper esterno | Pagina Dati/copia non seguono la dipendenza | Pattern ufficiale autocontenuto; limite avanzato dichiarato | Fixture ufficiale compare due volte in `usedBy` e sopravvive al rename |
| Si copia un handler/sequence che apre `items` | Nuovo endpoint condivide stato senza che l'utente lo noti | Dry run della copia analizza la chiusura reale e i riferimenti letterali; nessuna riscrittura | Anteprima elenca `items`, non scrive/reload; copia conserva i sorgenti |
| Schema del codice seed cambia ma seedKey no | Codice nuovo su dati vecchi | Convenzione di bump; metadata visibile | Documentazione/template mostrano `@v1` |
| Schema del codice seed cambia e seedKey cambia | Auto-reset distruttivo o 500 opaco | Conflitto fail-fast, reset manuale | Conflitto fino al reset, poi init nuova |
| Reload ricompila solo POST | Singleton JS diviso in due | Valore nel runtime store, non nel modulo | GET/POST condividono ancora dopo edit+reload di uno solo |
| Handler vecchio resta in volo durante reload | Commit del vecchio codice scambiato per rollback del reload | Reload non è una barriera; reset invalida il token quando serve | Slow handler può finire; stop/reset/start impedisce commit incompatibile |
| Endpoint viene eliminato | Entry orfana in memoria | Nessun GC incerto; lista admin + quote/reset | Stato resta visibile e resettabile |
| Reset sequence | Cancellazione inattesa di risorsa usata altrove | Lifecycle separato | Cursore/local state azzerati, shared invariato |
| Proxy all/off | Reset sorprendente al toggle | Conservazione esplicita | Toggle round-trip mantiene valore |
| Factory/handler resta vivo durante shutdown | Vecchio runtime ricrea o trattiene stato | `SharedStateStore.close()` permanente nel cleanup | Init tardiva scartata e nuove open rifiutate |
| L'app desktop cambia workspace | Stato del workspace precedente trapela nel nuovo | Store posseduto dal runtime e chiuso nello shutdown | Nuovo runtime vuoto, vecchi handle invalidi |
| Due processi servono lo stesso workspace | Client vede liste divergenti | Fuori contratto; documentare singolo processo | Nessuna falsa garanzia distribuita |
| Due browser/test usano lo stesso motore | Contaminazione fra sessioni | Stato globale dichiarato; reset in `beforeEach` o workspace distinti | E2E resetta esplicitamente |
| Admin GET espone valore | Leak di body/segreti e payload enorme | Solo metadati | Schema/API non contengono `value`/preview |
| Mutazione admin body-less senza preflight | CSRF distruttivo e regole incoerenti | Media type JSON uniforme sulle quattro POST; `{}` come unica forma contrattuale | Test media type/body per reset shared, sequence reset e dump flush |
| Body-parser confonde `Content-Length: 0` con `{}` in `req.body` | Body vuoto accettato contro specifica | Marker di byte da `express.json({ verify })` oltre al controllo del valore parsato | Body assente, CL 0 e chunked vuoto sono `400`; `{}` è accettato |
| Log di errore include il body | Leak di dati | Log solo metadata e codici | Logger mock non riceve snapshot |
| Factory fire-and-forget fallisce dopo il return | Il no-op catch salva il processo ma rende il difetto invisibile | Warning store-level una volta per tentativo, separato dal log request-level | Log presente anche senza waiter/Monitor, senza valore/body e senza duplicazione per waiter |
| Errore shared non intercettato espone nome/seed | Leak dalla superficie mock, meno protetta dell'admin | Mapping status/body allowlisted; dettagli soltanto in Monitor/log | 409/503/500 non contengono metadata interni |
| Handler lancia un errore comune con codice simile | Riclassificazione accidentale come shared-state | Branding tramite `SharedStateError`, non solo stringa `code` | Il falso errore resta un normale 500 handler |
| Il Monitor viene assunto sempre disponibile | Diagnostica persa su disconnect, retention o admin off | Monitor best-effort e log server fallback canonico | Test con monitor, senza monitor e con socket chiuso |
| `applyListQuery` viene attivato globalmente | Handler esistenti cambiano risposta | Flag opt-in e validazione | Vecchio handler array resta invariato |
| Filtro/paginazione modifica lo store | GET cambia la lista condivisa | Opera sullo snapshot di `read()` | GET paginata seguita da GET piena restituisce tutto |

### 18.1 Invarianti difensive da preservare

Una futura semplificazione è accettabile soltanto se conserva queste proprietà verificabili:

1. nessun riferimento mutabile allo stato vivo esce dallo store;
2. ogni `open()` appartiene a una sola generazione e non attraversa un reset;
3. initializer e mutator, incluse le continuazioni che avviano, non possono osservare o
   modificare altre risorse;
4. un handler terminato non può commettere nuovo shared state con handle catturati;
5. quote e validazione avvengono prima del commit e un fallimento lascia metadata/versione
   invariati;
6. una response pubblica non eredita automaticamente i privilegi diagnostici dell'Admin API;
7. la copia non riscrive euristicamente codice, ma rende visibile la condivisione rilevabile;
8. seed, lifecycle e limiti restano espliciti: nessuna euristica dipendente dalla prima
   richiesta o dal reload;
9. nessuna Promise per-chiamante ignorata può produrre un `unhandledRejection`, senza cambiare
   la rejection osservata da chi usa `await`;
10. un tentativo di inizializzazione fallito lascia almeno un warning store-level, una sola
    volta e senza valori, anche quando nessun waiter osserva l'errore;
11. il body `{}` delle mutazioni admin viene distinto dal body realmente vuoto usando i byte
    osservati dal parser, non inferendolo da `req.body`;
12. cursore sequence e `callCount` conservano punti di linearizzazione distinti e dichiarati.

## 19. Alternative considerate e scartate

### 19.1 Riutilizzare `HandlerStateStore` con chiave senza metodo

Condividere automaticamente `GET /items` e `POST /items` sarebbe economico, ma:

- cambia retroattivamente la semantica di `state`;
- fonde anche `callCount` e `firstRequestAt` fra metodi;
- non copre path diversi (`POST /items/import` -> `GET /items`);
- lega il reset sequence di un endpoint a dati usati da altri.

Scartato.

### 19.2 Campo `stateScope` nel file response/endpoint

Renderebbe esplicito il legame, ma modifica formato, loader, Admin CRUD, copia e UI soltanto per
passare un nome allo script. Inoltre un handler potrebbe aver bisogno di più risorse. La
primitiva nel contesto è più generale e non richiede migrazioni.

Scartato per l'MVP.

### 19.3 Helper CommonJS singleton

Funziona per uno spike, ma la cache degli script è incrementale: modificare un solo handler può
lasciare l'altro con una vecchia closure e creare due singleton. Reset, quote e introspezione
restano artigianali.

Utile solo come prototipo temporaneo, non come contratto prodotto.

### 19.4 `globalThis`/`Symbol.for`

Sopravvive al reload ma introduce collisioni invisibili, nessun lifecycle per workspace,
nessuna quota o reset e dipendenza da un dettaglio globale del processo.

Scartato.

### 19.5 Scrivere nei file dati

Offrirebbe persistenza, ma:

- sporca la parte condivisa/git del workspace durante i test;
- richiede lock e scritture atomiche sotto POST concorrenti;
- confligge con mount standalone read-only;
- rende reset e riproducibilità più difficili;
- trasforma dati di seed in database.

Scartato come default. Un futuro export/snapshot manuale è una funzione diversa.

### 19.6 Sequence cross-endpoint

Una macchina a stati può cambiare una GET dopo una POST, ma per includere il body arbitrario
della POST deve introdurre variabili, catture e trasformazioni: diventa un workflow engine. È
adatta a scenari predefiniti, non a una collezione mutabile generica.

Scartato.

### 19.7 Risorsa CRUD dichiarativa

È la UX finale più semplice, ma richiede decisioni su ID, schema, duplicate, envelope,
PUT/PATCH/DELETE, query, referential integrity, reset e UI dedicata. Può essere costruita in
futuro sopra `SharedStateStore`; non deve precederlo.

Rinviata.

### 19.8 Transazione legata all'intera `resolveResponse`

Fare commit solo quando l'handler ritorna eliminerebbe il caso "500 dopo commit", ma richiede:

- lock mantenuti attraverso `await`, con blocchi lunghi;
- ordine globale dei lock per più risorse, altrimenti deadlock;
- oppure versioning ottimistico e retry dell'intero handler, non sicuro con side effect;
- coordinamento con timeout e client disconnect.

Il costo e la semantica sono sproporzionati per un mock locale. Commit immediato e callback
sincrona offrono un confine più leggibile.

### 19.9 Oggetti vivi, `deepFreeze` o `structuredClone`

Conservare plain object e clonare/congelare ai bordi sembra evitare parse e stringify, ma non
elimina il lavoro O(n): servono comunque clone del draft, validazione JSON, rilevamento cicli,
accounting UTF-8 e isolamento del risultato. `structuredClone()` ammette inoltre `Date`, `Map`,
`Set`, `BigInt`, cicli e altri valori che il contratto JSON esclude; usarlo richiederebbe lo
stesso validatore e una serializzazione aggiuntiva per la quota.

La stringa JSON rende isolamento e rollback proprietà della rappresentazione, non una
combinazione fragile di clone e freeze. Scartati oggetti vivi e `structuredClone` come storage.

### 19.10 SQLite o key-value store embedded

Offrirebbero persistenza, query e transazioni più ricche, ma aggiungono dipendenze native o
formati su disco, schema, cleanup, recovery e semantica fra processi. Nessuno di questi vantaggi
serve al caso single-process, volatile e JSON-only; introdurli farebbe evolvere la feature in un
database prima di averne un requisito.

Scartati per l'MVP. Restano opzioni per una futura modalità persistente separata.

### 19.11 Firma automatica da `initialize.toString()`

Un hash della factory eliminerebbe il `seedKey` manuale, ma cambia per commenti/formattazione,
non vede valori catturati dalla closure o contenuti di `data()`, dipende dalla trasformazione
del codice e renderebbe l'hot reload fonte di conflitti o reset inattesi. Dà un'impressione di
verifica più forte di quella reale.

Scartato a favore di una firma logica esplicita, leggibile e versionata.

### 19.12 Retry automatico di `open()` dopo reset

Potrebbe nascondere `RESET_DURING_INITIALIZATION`, ma farebbe passare silenziosamente una
richiesta dalla generazione G a G+1. Il reset non sarebbe più un confine affidabile e una
factory avviata prima dell'azione admin potrebbe diventare l'inizializzatore del nuovo stato.

Scartato: fail-fast e nuova `open()` esplicita preservano l'affinità generazionale.
Non è una promessa che il reset resti vuoto sotto traffico: quel determinismo deriva soltanto
dal flusso stop/reset/start della sezione 10, indipendentemente dalla politica dei waiter.

### 19.13 Nomi API alternativi

- `getOrCreate()` suggerisce un valore sincrono e spesso mutabile, mentre qui l'esito è un
  handle generazionale dopo inizializzazione potenzialmente asincrona;
- `getSharedState()` confonde apertura e lettura del valore;
- `resource()` anticipa una futura astrazione CRUD che l'MVP non offre;
- una API esclusivamente callback (`withSharedState`) allungherebbe ogni handler e non
  eliminerebbe la necessità di distinguere lettura e commit.

`open()` è scelto perché comunica acquisizione asincrona di un handle con lifecycle, senza
promettere persistenza o CRUD.

### 19.14 Accesso ad altre risorse dentro le callback

Permetterlo nel mutator con un guard per-entry eviterebbe la sola mutazione ricorsiva, ma
renderebbe possibili commit parziali fra risorse e letture dipendenti dall'ordine. Permetterlo
nell'initializer aggiungerebbe cicli di promise e seed dipendenti dallo stato corrente. Una
transazione multi-risorsa vera richiederebbe ordine dei lock/versioning e un contratto diverso.

Scartato a favore del divieto uniforme. I due tipi di callback condividono il marker per catena;
il mutator aggiunge il guard store-wide durante la sezione sincrona, mentre l'initializer non
può mantenerlo attraverso `await` senza bloccare richieste lecite.

### 19.15 Riconoscere gli errori dal codice o da un `Symbol`

Controllare soltanto `error.code.startsWith("SHARED_STATE_")` può riclassificare errori comuni
dello script. `Symbol.for()` è recuperabile globalmente; un `Symbol` locale può essere copiato
per reflection da un errore autentico e, in caso di vero doppio caricamento, crea due identità
invece di risolverle. In ogni caso gli handler sono codice arbitrario nello stesso processo,
quindi il branding non costituisce un sandbox.

Si usa `instanceof SharedStateError` tramite un type guard centrale: è sufficiente contro la
classificazione accidentale e coerente col fatto che `src/` non viene hot-reloadato.

### 19.16 Dialog nella barra runtime o tab nella pagina Dati

Una dialog globale sarebbe rapida da aprire, ma aggiunge un trigger permanente a una barra già
trasversale, non offre un URL stabile per il Monitor e separa seed e stato materializzato. La
pagina Dati ha già il lessico e la responsabilità più vicini alla funzione.

Scelta la tab **Stato runtime** nella pagina Dati, raggiungibile anche tramite query string.

### 19.17 Riferimenti shared state in ogni dettaglio response

Calcolarli sempre renderebbe facile il warning di copia, ma imporrebbe letture e scansioni dei
sorgenti a ogni caricamento del dettaglio per un'informazione best-effort usata in un solo
flusso. Potrebbe inoltre far sembrare il dato una fonte di verità completa.

Scartato a favore del dry run della copia, che analizza soltanto la chiusura effettivamente
coinvolta e condivide il resolver con il commit.

### 19.18 Store creato implicitamente da `createApp()`

Un default faciliterebbe qualche test, ma nasconderebbe ownership e cleanup, e rischierebbe di
fornire istanze diverse al serving e all'Admin API. Lo store ha una vita pari al server, non
all'oggetto Express.

Scartato: `createServerRuntime()` crea, inietta, espone e chiude l'unica istanza. I test che
costruiscono direttamente l'app dichiarano la dipendenza e ne eseguono il cleanup.

### 19.19 API generica `get()`/`set()` o compare-and-swap

Un key-value store sarebbe più piccolo, ma il naturale read-modify-write attraverserebbe due
chiamate: due POST potrebbero leggere la stessa versione e l'ultimo `set()` perderebbe
l'aggiornamento dell'altra. Esporre versioni/compare-and-swap sposterebbe retry e conflitti in
ogni handler, che non può essere rieseguito automaticamente quando ha side effect.

Scartato: `mutate()` concentra il read-modify-commit in una sezione sincrona e lascia `replace()`
soltanto ai casi che sostituiscono consapevolmente l'intera radice.

### 19.20 Mutator asincrono con mutex/coda

Tenere il lock attraverso un `await` permetterebbe callback più comode, ma un I/O lento
bloccherebbe tutte le richieste sulla risorsa; più risorse richiederebbero un ordine globale dei
lock per evitare deadlock. Timeout e disconnect non cancellano la Promise, quindi potrebbero
lasciare il lock occupato o consentire un commit quando il chiamante non esiste più.

Scartato: callback sincrona breve, draft privato e I/O eseguito/validato prima di `mutate()`.

### 19.21 Eviction automatica LRU/TTL

Libererebbe nomi orfani senza intervento, ma trasformerebbe inattività e pressione di memoria in
reset impliciti: un test lento o un endpoint usato di rado potrebbe perdere stato senza alcuna
azione osservabile, mentre handle ancora vivi diventerebbero stale. Non esiste inoltre un TTL
corretto per tutti gli scenari.

Scartata: limite fail-fast, metadata visibili e reset esplicito rendono il lifecycle
deterministico. Un'eventuale eviction futura deve essere opt-in e avere eventi diagnostici.

### 19.22 Rifiutare `-0` per preservare l'identità JavaScript

`Object.is(-0, 0)` è falso e operazioni come `1 / value` distinguono i due valori. Rifiutare
`-0` eviterebbe quindi l'unica canonicalizzazione che cambia un'osservazione possibile in
JavaScript dopo il round-trip. Tuttavia lo store dichiara un contratto JSON, non l'identità
`SameValue` di ogni numero JavaScript, e `JSON.stringify` produce comunque `0`. Inoltre `-0`
nasce facilmente da calcoli ordinari come arrotondamenti, prodotti e resti: il rifiuto
trasformerebbe uno zero valido per lo scenario in un `500` dipendente dai dati.

Scartato il rifiuto: `-0` è accettato e canonicalizzato esplicitamente a `0`, alla radice e nei
container. La canonicalizzazione è documentata e testata; `NaN`, infinito e gli altri valori
non JSON restano errori senza commit.

### 19.23 Accettare anche un body vuoto nelle POST admin senza parametri

Dal punto di vista CSRF sarebbe sufficiente richiedere `Content-Type: application/json`: il
body `{}` non è ciò che forza il preflight. Accettare sia body vuoto sia `{}` ridurrebbe inoltre
il lavoro di integrazione per alcuni client. Creerebbe però due forme equivalenti per la stessa
mutazione, indebolirebbe l'uniformità fra le quattro rotte e contraddirebbe OpenAPI e client UI,
che possono già inviare l'oggetto vuoto.

Scartato: il contratto ammette soltanto `{}`. Poiché body-parser rappresenta anche
`Content-Length: 0` come `{}`, la distinzione usa il buffer osservato tramite `verify`, non il
solo `req.body` né il solo header `Content-Length`, che non coprirebbe il trasferimento chunked.

### 19.24 Annullare lo step sequence quando il client abortisce prima dell'handler

Fare rollback sembrerebbe allineare il cursore a `callCount`, ma `matchRequest()` ha già
linearizzato e restituito lo step prima della lettura del body. Nel frattempo altre richieste
possono aver consumato gli step successivi: decrementare il cursore riordinerebbe decisioni già
osservate o richiederebbe prenotazioni, commit e rollback transazionali dell'intera sequence.

Scartato: la sequence conta le decisioni di routing, mentre `callCount` conta gli avvii reali
dell'handler. L'abort impedisce lo script ma non restituisce lo step alla sequence.

### 19.25 Affidarsi al default Node o a un handler globale per le Promise ignorate

Lasciare una Promise per-chiamante senza osservatore permette a un semplice `open()` senza
`await` di terminare il processo. Installare `process.on("unhandledRejection")` cambierebbe
invece la policy di tutto Mockxy e potrebbe nascondere bug non collegati allo shared state.
Restituire la Promise prodotta da `.catch(() => {})` sarebbe ancora peggio: convertirebbe il
fallimento in una risoluzione con `undefined` anche per chi usa correttamente `await`.

Scartate tutte e tre le varianti: lo store aggancia il no-op alla Promise originale e restituisce
quella stessa Promise. Il log non nasce dal catch per-chiamante, che si moltiplicherebbe per i
waiter, ma una volta sola dal settlement dell'inizializzazione condivisa. Le rejection attese
di solo lifecycle restano non loggate se lo script ignora deliberatamente il contratto Promise;
Promise derivate create e abbandonate dallo script restano responsabilità dello script stesso.

## 20. Compatibilità

Per workspace e handler che usano il contratto documentato la feature è additiva:

- `sharedState` è un nuovo campo del contesto; gli handler che destrutturano altri campi non
  cambiano;
- `state`, `callCount` e `firstRequestAt` mantengono significato e reset correnti nelle richieste
  che arrivano all'esecuzione;
- nessun file endpoint/response/workspace cambia schema;
- nessuna response viene selezionata o riscritta;
- `applyListQuery` è opt-in e assente equivale al comportamento attuale;
- dry run della copia e rotte shared-state sono additive;
- non servono migratori o adapter legacy.

Esistono però cambiamenti intenzionali da trattare come contratto e inserire nelle note di
rilascio:

1. `POST /mocks/:id/sequence/reset` e `POST /monitoring/dump/flush` richiedono ora header JSON
   e body `{}`, come i due nuovi reset shared-state;
2. una richiesta il cui client scompare prima dell'avvio effettivo dell'handler non esegue più
   lo script e non incrementa `callCount`; dopo `handlerStates.enter()` i contatori restano
   invece invariati anche in caso di disconnect. Se la response era uno step di sequence, la
   decisione di routing già presa resta consumata: è il comportamento sequence preesistente,
   ora distinto esplicitamente dal lifecycle dell'handler;
3. `applyListQuery` diventa una chiave riservata e, se presente con valore non booleano, rende
   invalido il risultato; uno script che oggi usa casualmente quel nome come campo ignorato va
   corretto.

Come per qualunque estensione di un context object, uno script non portabile che confronta
`Object.keys(context)` con una lista esatta osserverà il nuovo campo `sharedState`. Non si
introduce una modalità per nasconderlo: il contratto supportato consente proprietà additive e
gli handler dovrebbero destrutturare soltanto quelle che usano.

`createApp()` e `respondWithHandler()` sono punti di wiring interni/esportati per i test: il
primo richiede ora l'iniezione esplicita dello store e il secondo passa a un dependency object.
Le suite e gli eventuali consumer interni vanno aggiornati nello stesso commit; non si aggiunge
un default che nasconda una risorsa da chiudere.

`sharedState` viene esposto soltanto agli handler nell'MVP. Aggiungerlo ai middleware non è un
semplice riuso: il middleware è fail-open dopo una risposta backend già ricevuta e richiede una
decisione separata sugli effetti commessi prima di un errore di trasformazione.

## 21. Piano di implementazione

### Fase 1 — Store isolato e invarianti

File nuovo indicativo: `src/mocks/shared-state.js`.

1. `SharedStateError`, type guard, codici e normalizzazione nome/seedKey;
2. validatore JSON iterativo con `isProxy`, canonicalizzazione dichiarata di `-0`,
   serializzazione, profondità e size UTF-8;
3. `open()` con validazioni/guard sincroni, init deduplicata, token generazionali, invalidation
   promise, waiter attivi e osservatore no-op su ogni Promise per-chiamante originale;
4. marker `AsyncLocalStorage` per initializer/mutator e guard sincrono store-wide durante il
   mutator;
5. facade/handle request-scoped, `read`, `mutate`, `replace` e chiusura idempotente;
6. logger strutturato iniettato, warning unico per tentativo di init fallito e isolamento degli
   errori del logger;
7. reset singolo/globale, `close()`, metadata e quote 256/5 MiB/25 MiB;
8. unit test completi, inclusi init/reset/closure simulati e assenza di unhandled rejection.

**Gate:** tutte le invarianti delle sezioni 6–9 dimostrate senza Express.

### Fase 2 — Serving degli handler

File principali: `src/server.js`, `src/app.js`, `src/monitoring/request-monitor.js`.

1. creare una sola istanza in `createServerRuntime()` con il logger esplicito, passarla a
   `createApp()` e Admin API, restituirla nel runtime e chiuderla come primo passo del cleanup
   ordinato;
2. rendere l'iniezione obbligatoria anche nei test che costruiscono `createApp()` direttamente;
3. sostituire i sette argomenti posizionali di `respondWithHandler()` con
   `respondWithHandler(req, res, decision, dependencies)`, dove il dependency object contiene
   `logger`, `requestTimeoutMs`, `dataFileReader`, `handlerStates`, `sharedStates` e
   `caseInsensitiveFilters`; origin method/path/response viene da `decision.handler`, senza un
   altro parametro;
4. installare il listener disconnect prima della body read, gestire `CLIENT_ABORTED`, eseguire
   il recheck e chiamare `handlerStates.enter()` soltanto prima dell'avvio reale;
5. creare/esporre il facade, chiuderlo in return/throw/timeout/disconnect e non tentare response
   su socket non scrivibile;
6. riconoscere soltanto `SharedStateError`, applicare 409/503/500 allowlisted, popolare
   `req._sharedStateError` e copiarlo esplicitamente nella voce Monitor;
7. integration test dello scenario guida, concorrenza, lifecycle client, distinzione fra step
   sequence consumato e `callCount`, error surface, hot reload, cambio runtime e shutdown.

**Gate:** scenario guida funzionante, nessun commit shared tardivo, semantica `callCount`
dimostrata nelle tre finestre di disconnect, semantica sequence sull'abort verificata e nessun
metadata interno nel body pubblico.

### Fase 3 — Liste dinamiche

File principale: `src/app.js`.

1. validare `applyListQuery` nel risultato handler;
2. riusare direttamente `buildMockPayload()` sullo snapshot JSON, senza rinominarlo o
   duplicarlo;
3. preservare l'header dello script con `totalCount: undefined` e sovrascriverlo dopo gli
   header script solo quando il totale è calcolato;
4. mantenere invariati mock statici e handler senza opt-in.

**Gate:** matrice dei test `LISTE.md` equivalente per mock statico e handler opt-in.

### Fase 4 — Admin API e contratto OpenAPI

File principali: `src/admin/admin-api.js`, `src/admin/endpoint-operations.js`, un helper
indicativo `src/mocks/shared-state-usage.js` e `docs/admin-api.openapi.yaml`.

1. esporre lista metadata, reset nome e reset globale sull'istanza iniettata;
2. configurare il parser JSON con un marker privato di byte tramite `verify`, introdurre
   `requireEmptyJsonObject` e applicarlo ai due reset shared, sequence reset e dump flush;
3. estrarre dal copy endpoint un planner read-only comune a dry run e commit, includendo response,
   asset, riferimenti letterali e warning;
4. garantire che il dry run non scriva, non crei directory e non chiami `reloadRuntime()`;
5. testare idempotenza, init in volo, nomi, payload senza valori, tutti i media type/body e il
   piano di copia completo di sequence;
6. aggiornare OpenAPI (shared metadata/reset, copy preview, `sharedStateError` del Monitor e
   request body `{}`), curl it/en e note di rilascio anche per le due POST esistenti.

**Gate:** una suite può resettare deterministicamente lo scenario senza restart.

### Fase 5 — UI e authoring

File/aree principali:

- tipi e service Admin API Angular;
- pagina Dati con tab File dati/Stato runtime e deep link per nome;
- Monitor con metadata errore e azione verso la tab runtime;
- completamenti CodeMirror e template script;
- anteprima obbligatoria nella dialog di copia e warning best-effort;
- feedback del reset sequence che dichiara shared state invariato;
- traduzioni `it.json`/`en.json`;
- test unitari accessibilità/flussi.

**Gate:** lista/reset singolo/globale usabili da tastiera, deep link Monitor funzionante e copia
mai confermata prima che la relativa anteprima sia stata risolta.

### Fase 6 — Documentazione, E2E e hardening

Aggiornare almeno:

- `docs/it/HANDLER.md` e `docs/en/HANDLER.md`;
- `docs/it/LISTE.md` e `docs/en/LISTE.md`;
- `docs/it/ADMIN-API.md` e `docs/en/ADMIN-API.md`;
- `docs/it/DATI.md` e `docs/en/DATI.md` per chiarire seed vs lettura fresca;
- `docs/it/MONITOR.md` e `docs/en/MONITOR.md` per metadata, deep link e persistenza nei dump;
- `docs/it/DESKTOP.md`, `docs/en/DESKTOP.md`, `docs/it/WORKSPACE.md` e
  `docs/en/WORKSPACE.md` per perdita dello stato al cambio workspace/riavvio;
- `docs/it/RESPONSE.md` e `docs/en/RESPONSE.md` per l'indipendenza dal reset sequence;
- `docs/it/SCENARI.md` e `docs/en/SCENARI.md` per il caso GET/POST/reset completo;
- indici README/documentazione e troubleshooting;
- template/example workspace, se utile.

Eseguire backend, frontend, E2E mirati e benchmark 1/5 MiB con i gate della sezione 15.

**Gate:** contratto italiano/inglese, OpenAPI, release notes, UI e runtime descrivono la stessa
semantica e il report prestazionale giustifica il limite pubblicato.

## 22. Piano di test completo

### 22.1 Store unitario

- normalizzazione e rifiuto nomi/seedKey;
- validazioni decidibili di `open()` (argomenti, store/context chiusi, guard, conflitto noto,
  entry limit) verificate con throw sincrono; ogni open valida restituisce comunque una Promise;
- factory sincrona che lancia convertita in rejection `INIT_FAILED`, non throw da `open()`;
- Promise per-chiamante originale ancora rigettata e intercettabile dopo l'installazione del
  no-op catch interno;
- `open()` valida ignorata non produce `unhandledRejection` nei quattro esiti asincroni
  `INIT_FAILED`, reset durante init, chiusura del contesto e chiusura dello store;
- rifiuto di initializer e mutator assenti o non funzione;
- JSON valido per ogni tipo, `-0` canonicalizzato a `0` alla radice/in array/in oggetto, e
  rifiuto di altri non-JSON, cicli, profondità, accessor, array sparsi e Proxy senza invocare
  getter/trap;
- factory sync/async eseguita una volta e due open della stessa request ricevono handle sullo
  stesso token senza duplicare waiter o side effect;
- due factory diverse con stesso `seedKey` usano soltanto la prima e registrano il relativo
  `initializedBy`, rendendo visibile il limite dichiarativo della firma;
- waiter concorrenti e conflitto seed;
- init fallita conserva `cause`, rimuove la prenotazione ed è ritentabile;
- ogni tentativo di init fallito emette un solo warning strutturato anche con più waiter, errore
  intercettato dallo script o factory tardiva senza waiter; le sole rejection di reset/context
  close/store close non emettono quel warning, mentre un successivo fallimento reale della
  factory stale lo emette una volta;
- il warning di init contiene codice/nome/seedKey/origin e causa ammessa, mai valore/draft/body;
  un logger che lancia non modifica rejection, cleanup o retry;
- ogni operazione shared-state da initializer, inclusi handle catturati e altre risorse, viene
  rifiutata prima e dopo un `await`; un'altra richiesta concorrente resta operativa;
- initializer che cattura una violazione non può comunque commettere il seed ed è ritentabile;
- il marker initializer si libera dopo successo/errore, mentre un discendente asincrono
  distaccato resta marcato;
- reset durante init e nessuna resurrezione;
- reset durante init rigetta subito gli `open()` senza attendere la factory;
- l'open legata a G non viene ritentata su G+1; una nuova open esplicita inizializza G+1;
- tutti i waiter chiusi vs almeno uno attivo;
- factory pendente rimossa quando si chiude l'ultimo waiter;
- factory che rigetta dopo reset/ultimo waiter/close non produce `unhandledRejection`;
- snapshot indipendenti;
- oggetto restituito dalla factory o passato a `replace()` può essere modificato dopo il commit
  senza alterare lo store;
- mutazione e replace incrementano versione/size;
- throw/thenable/invalid JSON/quota fanno rollback di valore, size, versione e metadata;
- `open`/`read`/`mutate`/`replace` dentro mutator vengono rifiutati anche su altre entry;
- mutator che cattura internamente la violazione fallisce comunque e non commette il draft;
- `open()` ignorata dentro mutator lancia sincronicamente e non genera `unhandledRejection`;
- continuazione dopo `await` di un mutator async resta marcata e non può usare lo store, mentre
  altre request possono farlo;
- guard store-wide liberato dopo successo, throw, thenable, JSON invalido ed errore quota;
- due mutate conservano entrambi gli aggiornamenti;
- risultato di mutate e snapshot modificati a posteriori non alterano lo store;
- stale handle dopo reset singolo e globale;
- nuova generazione dopo reset riparte da versione 1 con timestamp/origin nuovi;
- `close()` permanente invalida entry/init/handle ed è idempotente;
- boundary esatti: profondità 100/101, entry 5 MiB/+1 byte, totale 25 MiB/+1 byte ed entry
  numero 256/257;
- accounting totale quando un valore cresce, diminuisce, fallisce o viene resettato;
- metadata ordinati e senza valori.

### 22.2 Serving

- GET iniziale restituisce seed;
- POST poi GET contiene l'item arbitrario ricevuto;
- POST genera/rispetta ID secondo lo script;
- due POST in `Promise.all` restano entrambe;
- GET/POST su path diversi condividono lo stesso nome;
- handler selezionato direttamente e handler usato come step di sequence ricevono lo stesso
  contratto `sharedState`;
- due nomi diversi restano isolati;
- errore handler prima della mutate non cambia stato;
- errore dopo mutate conserva il commit;
- timeout prima della mutate impedisce commit tardivo;
- abort durante body e disconnect fra body/avvio non invocano handler né incrementano
  `callCount`, non loggano un failure script e non tentano un `500`;
- abort durante il body di uno step handler `times: 1` non avvia l'handler né incrementa
  `callCount`, ma consuma lo step e la richiesta successiva riceve quello seguente;
- disconnect dopo `handlerStates.enter()` conserva callCount/firstRequestAt ma impedisce commit
  shared tardivi;
- mutate prima del timeout resta commessa;
- microtask accodata dallo script prima del settlement può linearizzare prima della chiusura;
  il facade è già chiuso quando inizia la validazione/invio della response;
- timer dopo return non può usare il facade;
- listener response non si accumulano sulle keep-alive e vengono rimossi anche senza facade;
- body oltre 2 MiB resta `413` e non inizializza;
- hot reload di un solo handler conserva e condivide lo store;
- bump di `seedKey` a entry viva produce conflitto fino al reset e poi inizializza la nuova
  versione;
- handler avviato prima del reload può terminare col vecchio codice; un reset intermedio rende
  stale il suo handle e ne impedisce il commit successivo;
- reload invalido con graft conserva lo store;
- modifica del file seed non cambia lo stato vivo; dopo reset usa il file nuovo;
- eliminazione del file seed non rompe l'entry viva ma produce `INIT_FAILED` alla nuova init;
- nuovo runtime sugli stessi file riparte dal seed;
- cambio workspace chiude il vecchio store e il nuovo non eredita entry;
- shutdown invalida init/handle e non consente nuove open;
- server off/proxy all conserva il valore;
- reset sequence non tocca shared state;
- reset shared singolo/globale non tocca sequence né memoria handler locale;
- test che costruiscono `createApp()` iniettano e chiudono lo store; dipendenza assente fallisce
  subito con errore di configurazione chiaro.

### 22.3 Liste

- flag assente: array handler invariato anche con query;
- flag non booleano o `true` senza `jsonBody`: risultato handler invalido;
- flag true: filtri AND/OR, case sensitivity e parametri estranei;
- pagina valida/invalida e pagina oltre fine;
- oggetto con singolo array preserva le altre proprietà;
- due array non vengono modificati;
- senza filtri/paginazione `totalCount` resta undefined e l'`X-Total-Count` dello script è
  conservato;
- con filtri o paginazione l'`X-Total-Count` calcolato viene impostato per ultimo e vince;
- GET paginata non modifica lo stato condiviso.

### 22.4 Admin e copia

- elenco vuoto/pronto/in init;
- metadati e limiti corretti, contenuto mai presente;
- reset esistente/assente idempotente;
- reset globale conta correttamente;
- reset invalida handle e init in corso;
- nome non valido `400`;
- matrice comune sulle quattro POST body-less: header assente/text/plain `415`, `{}` JSON
  (anche con charset e whitespace) accettato, media type vendor JSON rifiutato, body
  assente/`Content-Length: 0`/chunked vuoto/malformato/null/array/scalare/non vuoto `400`;
- il marker `verify` registra soltanto il numero di byte, distingue zero byte da `{}` e non
  conserva il buffer dopo il parsing;
- Admin API disabilitata `404` come le altre rotte;
- OpenAPI validata dallo script esistente;
- fixture ufficiale con `data()` diretto compare in `usedBy` per GET e POST;
- rename del file seed riscrive entrambi gli handler e il reset successivo usa il nome nuovo;
- dry run con copia singola, sequence closure e copia totale restituisce gli stessi response e
  asset del commit;
- dry run estrae nomi letterali, deduplica e ignora forme dinamiche senza eseguire sorgenti;
- dry run non crea file/directory, non cambia selezione e non chiama reload; errori di sorgente,
  destinazione o asset coincidono col ramo reale;
- `dryRun=true/false` è accettato, valori ignoti o ripetuti sono `400` e non scrivono;
- una modifica fra preview e conferma viene ricalcolata dal commit, non usa un piano client
  obsoleto.

### 22.5 Errori e diagnostica

- i veri shared error seguono esattamente la matrice 409/503/500;
- body pubblici non contengono nome, seedKey, size, cause, stack o valore;
- uno script che cattura l'errore può restituire il proprio status/body;
- un normale `Error` con lo stesso `code` non supera `isSharedStateError`;
- `CONTEXT_CLOSED` dopo 504/disconnect non tenta una seconda response;
- `req._sharedStateError` viene copiato esplicitamente nella voce Monitor con soli metadati
  admin;
- init fallita senza `await` emette esattamente un warning store-level anche se non nasce alcun
  500 o record Monitor; più waiter non duplicano quel warning;
- quando la stessa init fallita sfugge a uno o più handler, il warning di generazione e i log
  request-level restano distinguibili per messaggio/campi;
- con monitor assente/disabilitato, retention esaurita o disconnect, il log strutturato conserva
  la diagnosi senza snapshot/body;
- dump monitor attivo persiste i metadata shared e la documentazione lo dichiara.

### 22.6 UI/E2E

- tab Stato runtime vuota e con più entry;
- stati loading/error/initializing;
- refresh manuale e nessun polling dopo apertura;
- reset riga e reset globale con conferma;
- deep link da Monitor apre/evidenzia la risorsa e degrada alla lista se non è più presente;
- reset sequence comunica esplicitamente che shared state non è stato azzerato;
- copia endpoint attende il dry run, aggrega i nomi delle response realmente copiate (sequence
  inclusa), ignora anteprime asincrone stale e non riscrive i sorgenti;
- focus management, annunci e tastiera;
- flusso browser reale: GET seed -> POST -> GET arricchita -> reset -> GET seed;
- due test isolati tramite reset nel setup.

## 23. Limitazioni residue dichiarate

Anche dopo tutte le mitigazioni restano limiti intenzionali:

1. **globale, non per client**: due browser condividono dati e reset;
2. **single-process**: nessuna coerenza fra repliche;
3. **volatile**: crash e restart perdono tutto;
4. **commit immediato**: un 500/timeout successivo al commit non lo annulla;
5. **nessuna atomicità multi-risorsa**;
6. **costo O(n)** di parse/serialize sulle risorse lette/modificate;
7. **nessun garbage collector semantico** per nomi non più usati;
8. **nessun auto-reset sul seed**: modifiche ai file richiedono un gesto esplicito;
9. **nessuna semantica CRUD incorporata**: validazione, ID e conflitti stanno nello script;
10. **nessun sandbox**: handler malevoli possono aggirare l'API ufficiale;
11. **nessuna compensazione di effetti esterni** prodotti da initializer o mutator;
12. **nessuna preemption del lavoro sincrono**: parse, validazione e mutator molto costosi
    bloccano l'event loop fino al termine, come altro codice sincrono degli handler;
13. **`seedKey` non verifica il codice della factory**: initializer diversi che dichiarano la
    stessa firma sono indistinguibili; il pattern ufficiale evita input request-scoped e i
    metadati rendono visibile il primo inizializzatore;
14. **callback isolate dallo store**: initializer e mutator non possono leggere o modificare
    alcuna risorsa condivisa; operazioni multi-risorsa vanno sequenziate dall'handler e non sono
    atomiche;
15. **disconnect non cancella JavaScript**: blocca soltanto future operazioni sull'API shared;
    vecchio `state`, filesystem, rete e singleton possono ancora ricevere side effect;
16. **reset non sospende il traffico**: una nuova `open()` può ricreare subito la risorsa;
17. **analisi copia best-effort**: riconosce riferimenti letterali, non nomi costruiti
    dinamicamente o nascosti in helper;
18. **Monitor non garantito**: retention, Admin API disabilitata, app costruita senza monitor o
    socket interrotto possono lasciare soltanto il log server;
19. **hot reload non interrompe request in volo**: il vecchio codice può terminare e commettere
    finché un reset/timeout/disconnect non ne invalida handle o contesto;
20. **il confine di return segue il settlement osservato**: microtask accodate prima che il
    serving osservi la Promise risolta possono ancora linearizzare operazioni nello stesso turno;
21. **sequence e handler hanno soglie diverse**: una richiesta abortita dopo `matchRequest()`
    può consumare lo step senza eseguire l'handler o incrementare `callCount`;
22. **una Promise ignorata perde il proprio esito**: l'osservatore interno protegge il processo,
    ma soltanto `await`/`catch` consegna allo script gli errori per-chiamante; il warning
    store-level garantisce la traccia dei fallimenti d'inizializzazione, non delle normali
    invalidazioni di lifecycle. La protezione copre la Promise originale di `open()`, non nuove
    Promise create dallo script con `.then()`/`.finally()` e poi abbandonate;
23. **`-0` non conserva l'identità JavaScript**: dopo il round-trip JSON viene letto come `0`.

Queste limitazioni devono comparire nella guida utente, non restare soltanto in questo piano.

## 24. Criteri di accettazione

L'implementazione è completa quando sono vere tutte queste condizioni:

1. GET e POST arbitrari condividono una risorsa per nome senza singleton di modulo;
2. nessun workspace esistente cambia formato e il comportamento documentato resta compatibile,
   salvo le eccezioni esplicite della sezione 20;
3. init concorrente viene eseguita una sola volta ed è ritentabile dopo errore;
4. `open()` lancia sincronicamente le precondizioni decidibili e usa la Promise soltanto per
   l'esito della factory/attesa; ogni Promise per-chiamante ignorata è osservata internamente
   senza alterare la rejection ricevuta da chi la attende;
5. letture e risultati non possono mutare indirettamente lo store;
6. initializer e mutator non possono rientrare nello store, neppure su un'altra risorsa, senza
   bloccare richieste concorrenti legittime;
7. mutazioni concorrenti non perdono aggiornamenti nel singolo processo;
8. throw, mutator async, JSON invalido e quote non producono commit parziali; `-0` è l'unica
   canonicalizzazione dichiarata e viene riletto come `0`;
9. reset invalida init e handle in volo senza resurrezioni o retry implicito su una nuova
   generazione;
10. uno script tardivo dopo timeout, disconnect o return non può modificare shared state;
11. abort prima dell'avvio non incrementa `callCount`, disconnect dopo l'avvio non lo annulla e
    uno step sequence già scelto resta consumato;
12. hot reload di uno solo fra GET/POST conserva un'unica risorsa coerente;
13. restart e cambio workspace ripartono dal seed; file dati modificati entrano solo dopo reset;
14. sequence, server toggle e selezione response rispettano la matrice lifecycle;
15. Admin API non espone valori e le quattro mutazioni body-less richiedono JSON `{}`, distinto
    da zero byte tramite il marker del parser;
16. errori non intercettati rispettano branding e mapping sicuro, con Monitor best-effort e log
   fallback; ogni inizializzazione fallita produce inoltre un solo warning store-level sicuro;
17. UI nella pagina Dati rende visibili dimensione/firma/uso, permette reset e riceve deep link
   diagnostici dal Monitor;
18. `applyListQuery` conserva filtri/paginazione e semantica di `X-Total-Count` senza modificare
   lo store;
19. quote e benchmark rispettano i gate e nessun campo strutturato logga snapshot/body;
20. il seed ufficiale resta visibile a `usedBy` e alla rinomina sicura della pagina Dati;
21. il dry run della copia copre response/sequence/asset reali, avvisa sui riferimenti letterali,
   non scrive e il commit non riscrive i sorgenti;
22. unit, integration, frontend, E2E, OpenAPI, release notes e documentazione it/en sono
   allineati.

## 25. Evoluzioni possibili dopo validazione dell'MVP

In ordine prudente:

1. **preset/wizard «Collezione stateful»**: genera opener autocontenuti + GET/POST senza
   nascondere il codice;
2. **export snapshot manuale** verso un nuovo file dati, mai write-through automatico;
3. **lettura diagnostica opt-in e troncata** solo se si risolve il problema dei dati sensibili;
4. **partizioni esplicite per test run** con quote separate, se emergono suite concorrenti;
5. **API dichiarativa `resource`** costruita sopra lo store, dopo aver osservato ID/envelope reali;
6. **persistenza locale sotto `.mockxy/`** come opzione distinta e non condivisa in git;
7. **middleware/shared state** dopo aver definito la semantica fail-open;
8. **transazioni multi-risorsa** soltanto davanti a casi concreti che giustifichino lock/versioning.

## 26. Valutazione finale

La proposta è solida se rimane una primitiva runtime per handler, non un database mascherato.
La parte più importante non è la `Map` dei valori, ma il contratto intorno ad essa: JSON
isolato, inizializzazione deduplicata, mutazioni sincrone atomiche, context closure, reset con
token e quote. Sono precisamente i punti che impediscono ai casi semplici di diventare race e
stato fantasma durante hot reload o timeout.

L'impatto è **medio-alto ma ben confinato**: nuovo store posseduto dal runtime, serving handler e
monitor, tre nuove rotte admin, guard uniforme su due rotte esistenti, dry run della copia, tab
Stato runtime nella pagina Dati, diagnostica Monitor, opt-in liste e test/documentazione.
Loader, registry e formato del workspace non cambiano; non servono migrazioni. I punti di
hardening — callback isolate, lifecycle disconnect, osservazione/logging delle Promise,
distinzione esatta del body admin, soglia sequence/handler, error surface, quote e test di
concorrenza — sono parte del contratto minimo, non rifiniture rimandabili dopo il rilascio.
