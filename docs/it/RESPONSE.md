# Il file di risposta

Ogni variante di risposta di un endpoint è un **file di risposta**: un JSON dentro la cartella
`<METODO>.responses/` accanto al [file endpoint](ENDPOINT.md), che descrive *come* rispondere
quando quella variante è selezionata. Le varianti permettono di tenere pronti più comportamenti
per lo stesso endpoint — il caso pieno, la lista vuota, l'errore — e di passare dall'uno
all'altro cambiando solo la variante selezionata, senza toccare i contenuti.

Il campo `type` distingue quattro nature di risposta:

- **`mock`** — risposta statica descritta nel file stesso (status, header, body o payload da file);
- **`handler`** — risposta calcolata da uno script JavaScript locale;
- **`middleware`** — trasformazione applicata alla risposta del backend reale proxato;
- **`sse`** — stream Server-Sent Events: la connessione resta aperta e gli eventi escono
  secondo un copione (o dalla regia manuale della console).
- **`ws`** — canale WebSocket mockato: l'handshake di upgrade viene accettato localmente e i
  messaggi escono secondo un copione, rispondono a regole dichiarative o partono dalla console.

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
- **`templated`** — facoltativo, default `false`: attiva il [templating](#il-templating) dei
  placeholder `{{...}}` nel body e negli header. Non ammesso sulle risposte con payload `file`.
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

## Il templating

Con **`templated: true`** i placeholder `{{...}}` nel body (JSON o testo) e negli header
vengono sostituiti con valori della richiesta: il caso «l'id che mi chiedi te lo rimetto nella
risposta» senza scomodare un handler.

```json
{
  "type": "mock",
  "status": 200,
  "templated": true,
  "headers": { "location": "/api/utenti/{{params.id}}" },
  "body": {
    "id": "{{params.id | number}}",
    "nome": "Utente {{params.id}}",
    "ruolo": "{{query.ruolo}}",
    "richiestoAlle": "{{now}}"
  }
}
```

- **Sorgenti**: `params.<nome>` (parametri di percorso), `query.<nome>` (primo valore se
  ripetuto), `headers.<nome>` (nomi in minuscolo), `body.<percorso.a.punti>` (il body JSON
  della richiesta, letto solo se referenziato).
- **Helper generati**: `now` (ISO 8601), `nowMs` (epoch ms), `uuid`, `randomInt min max`.
- **Filtro dei tipi**: quando l'intero valore stringa è un solo placeholder,
  `"{{params.id | number}}"` produce il numero senza virgolette (non numerico → `null`);
  esistono anche `| boolean` e `| json` (il sotto-albero del body così com'è).
- **Placeholder non risolto**: la risposta esce comunque (stringa vuota; `null` con filtro) e
  il motore logga un warning col placeholder — un typo non rompe il giro di prova. Escape:
  `\{{` produce `{{` letterale.
- Il template si applica **prima** di [paginazione e filtri automatici](LISTE.md): un body
  array templato vi partecipa come uno statico.
- Niente condizioni, cicli o espressioni: quando serve logica, il gradino giusto è l'handler.

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

## Risposta `sse`

```json
{
  "type": "sse",
  "title": "Avanzamento lavoro",
  "retryMs": 3000,
  "script": [
    { "afterMs": 0,    "event": "progress", "data": { "percent": 10 } },
    { "afterMs": 1500, "event": "progress", "data": { "percent": 60 } },
    { "afterMs": 3000, "event": "done",     "data": { "percent": 100 } }
  ],
  "onEnd": "keep-open",
  "presets": [
    { "label": "Errore", "event": "error", "data": { "message": "boom" } }
  ]
}
```

Quando la variante selezionata è di tipo `sse`, l'endpoint risponde con uno stream
`text/event-stream` che resta aperto: il **copione** (`script`) va in onda **a ogni
connessione, indipendentemente per ciascuna** — riconnettersi significa ripartire dall'inizio.

- **`script`** — la scaletta degli eventi, anche vuota (endpoint muto, alimentato solo dalla
  console). Ogni voce: **`afterMs`** (ritardo dal messaggio precedente, intero ≥ 0), **`data`**
  (JSON — serializzato — o stringa, anche multi-linea), **`event`** e **`id`** facoltativi
  (i campi del protocollo SSE).
- **`onEnd`** — esaurito il copione: **`keep-open`** (default: la connessione resta aperta per
  heartbeat e push manuali), **`close`** (il server chiude), **`loop`** (si ricomincia; serve
  almeno un `afterMs` positivo).
- **`retryMs`** — facoltativo: il campo `retry:` SSE inviato in testa alla connessione.
- **`presets`** — facoltativi: i messaggi pronti (macro) della console dell'endpoint.

Nei silenzi il motore invia un commento di **heartbeat** ogni 15 secondi (invisibile ai client).
Le connessioni vengono chiuse alla ricarica a caldo e allo shutdown: il client SSE riconnette da
solo e il copione riparte. La **console** nella scheda dell'endpoint mostra connessioni aperte e
storico, e permette la regia manuale (broadcast a tutte le connessioni) — via API:
`POST /mocks/:id/sse/push` e `GET /mocks/:id/sse/connections`. La voce del [monitor](MONITOR.md)
nasce alla chiusura della connessione. Una variante `sse` non può essere lo step di una
[sequenza](ENDPOINT.md).

## Risposta `ws`

```json
{
  "type": "ws",
  "title": "Canale notifiche",
  "script": [
    { "afterMs": 0,    "data": { "tipo": "benvenuto" } },
    { "afterMs": 2000, "data": { "tipo": "promo", "sconto": 20 } }
  ],
  "onEnd": "keep-open",
  "rules": [
    { "match": { "equals": "ping" }, "reply": [{ "afterMs": 0, "data": "pong" }] },
    { "match": { "json": { "azione": "subscribe" } },
      "reply": [{ "afterMs": 100, "data": { "esito": "sottoscritto" } }] }
  ],
  "presets": [{ "label": "Errore", "data": { "tipo": "errore" } }]
}
```

Quando la variante selezionata è di tipo `ws`, la richiesta di **upgrade** WebSocket
sull'endpoint viene gestita localmente (101, handshake accettato) invece di essere inoltrata
al backend; gli upgrade che non matchano un endpoint `ws` seguono il passthrough di sempre
(vedi [WEBSOCKET.md](WEBSOCKET.md)). Una richiesta HTTP normale sull'endpoint risponde
**`426 Upgrade Required`**.

- **`script`** — il copione dei messaggi in uscita, anche vuoto (endpoint muto: solo regole e
  console). Ogni voce: **`afterMs`** (ritardo dal messaggio precedente, intero ≥ 0) e
  **`data`** (JSON — serializzato sul filo — o stringa). Va in onda **a ogni connessione,
  indipendentemente per ciascuna**: riconnettersi significa ripartire dall'inizio.
- **`onEnd`** — esaurito il copione: **`keep-open`** (default), **`close`** (il server chiude,
  con **`closeCode`**/**`closeReason`** facoltativi accanto — codice `1000` o `3000-4999`),
  **`loop`** (si ricomincia; serve almeno un `afterMs` positivo).
- **`rules`** — regole dichiarative sui messaggi in ingresso, valutate in ordine (**la prima
  che matcha vince**): `match` con **uno solo** tra `equals` (testo esatto), `contains`
  (sottostringa) e `json` (il messaggio è JSON e contiene le coppie indicate — subset di primo
  livello); `reply` è una scaletta come lo script, inviata **solo alla connessione che ha
  parlato**. Un messaggio senza regola viene solo registrato nel transcript: niente eco di
  default, niente logica — quando serve di più, il gradino giusto è l'handler.
- **`presets`** — facoltativi: i messaggi pronti (macro) della console.

Nei silenzi il motore invia un **ping** di protocollo ogni 30 secondi (permissivo: un pong
mancato non chiude). Le connessioni vengono chiuse alla ricarica a caldo e allo shutdown: il
client riconnette e il copione riparte. La **console** nella scheda dell'endpoint mostra le
connessioni e il **transcript bidirezionale** (▶ usciti dal copione/regole/regia, ◀ ricevuti
dai client), con re-invio a un clic — via API: `POST /mocks/:id/ws/push` e
`GET /mocks/:id/ws/connections`. Una variante `ws` non può essere lo step di una
[sequenza](ENDPOINT.md).

## Validazione ed errori

Il file della variante **selezionata** viene validato al caricamento dell'endpoint: `type`
riconosciuto, status valido per i mock, `body`/`file` mutuamente esclusivi e uno dei due
presente, script esistente e con la funzione attesa per handler e middleware, payload `file`
esistente su disco. Un errore in questi controlli non abbatte il server: vale la degradazione
per-endpoint descritta nella [pagina sul file endpoint](ENDPOINT.md) — l'endpoint viene saltato
con un warning, e alla ricarica a caldo resta in vigore l'ultima versione valida.

Le varianti **non selezionate** non vengono validate finché non diventano quella attiva: un file
di variante incompleto può convivere nel workspace senza effetti, finché nessuno lo seleziona.
