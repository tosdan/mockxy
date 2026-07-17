# 19 — Mockare le WebSocket

Le WebSocket sono il gemello bidirezionale del capitolo precedente — e un protocollo a sé: la
connessione nasce da una normale richiesta HTTP di **upgrade**, dopo la quale client e server
si scambiano **frame** in entrambe le direzioni, senza più la coppia richiesta/risposta. È il
canale tipico di notifiche push, chat, aggiornamenti live. Lato frontend:

```js
const ws = new WebSocket("ws://localhost:3000/api/notifiche");
ws.onmessage = (e) => mostra(JSON.parse(e.data));
ws.send(JSON.stringify({ azione: "subscribe", canale: "ordini" }));
```

Mockxy tratta le WebSocket in due modi complementari: il **mock locale** — un endpoint la cui
variante selezionata è di tipo `ws` gestisce l'handshake in casa e parla col client secondo
copione, regole e console — e il **passthrough**: tutti gli upgrade che *non* matchano un
endpoint `ws` vengono inoltrati al backend reale. Il passthrough è metà del valore: il caso
d'uso comune è l'app che mocka le API HTTP ma tiene viva la connessione notifiche **vera**
verso il backend — e non deve trovarsela rotta.

## La variante `ws`

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
  ]
}
```

Tre meccanismi combinabili:

- **il copione (`script`)** — i messaggi in uscita, con la stessa meccanica dell'SSE:
  `afterMs` dal messaggio precedente, `data` JSON o stringa, in onda **a ogni connessione
  indipendentemente**. Può essere vuoto (endpoint muto: solo regole e console). `onEnd`
  ammette `keep-open` (default), `loop`, e `close` — qui con `closeCode` e `closeReason`
  facoltativi (codice `1000` o `3000`–`4999`) per provare come il frontend gestisce le
  chiusure;
- **le regole (`rules`)** — le risposte dichiarative ai messaggi **in arrivo**. Ogni regola
  ha un `match` con **uno solo** tra `equals` (testo esatto), `contains` (sottostringa) e
  `json` (il messaggio è JSON e contiene le coppie indicate — confronto per subset di primo
  livello), e un `reply`: una scaletta come lo script, inviata **solo alla connessione che ha
  parlato**. Le regole si valutano in ordine e **la prima che matcha vince**. Un messaggio
  senza regola viene solo registrato nel transcript: niente eco di default. La filosofia è
  dichiarata — niente logica nelle regole: quando serve calcolo vero, il posto giusto è un
  handler su un endpoint HTTP;
- **la console** — la regia manuale (sotto).

Due esempi di regole in lettura: la prima è il classico ping/pong (il client manda il testo
`ping`, riceve `pong`); la seconda risponde a un messaggio JSON di sottoscrizione con la
conferma — sufficiente per il flusso «subscribe → conferma → eventi dal copione» di un canale
notifiche realistico.

> 📷 **SCREENSHOT** — `19-editor-ws.png`
> Cosa mostrare: la variante WS nella scheda endpoint con copione e almeno una regola
> compilata (l'esempio subscribe/conferma).

## La console e il transcript

Con la variante `ws` selezionata, la scheda mostra la console: le **connessioni** aperte
(con il conteggio dei messaggi e la posizione nel copione) e il **transcript bidirezionale**
— ▶ i messaggi usciti (con l'origine: copione, regola, o manuale) e ◀ quelli ricevuti dai
client. Il compositore invia in **broadcast** a tutte le connessioni (`Ctrl+Invio`), ogni
payload del transcript si re-invia con un click, e i `presets` della variante fanno da macro.

Il transcript è anche uno strumento diagnostico: si legge la conversazione completa — cosa ha
mandato davvero il frontend, cosa ha risposto quale regola — senza strumenti esterni.

> 📷 **SCREENSHOT** — `19-console-ws.png`
> Cosa mostrare: la console WS con una connessione attiva e un transcript popolato in
> entrambe le direzioni (frecce ▶/◀, origini diverse: copione, regola, manuale).

## Il routing degli upgrade

All'arrivo di una richiesta di upgrade, il motore consulta il registry dei mock (a server
attivo e fuori dal proxy totale): se l'endpoint matcha una variante `ws`, la connessione è
servita dal mock; altrimenti l'upgrade viene **inoltrato al backend reale** (serve
`BACKEND_URL` e il proxy fallback attivo). Le connessioni di upgrade non attraversano la
pipeline HTTP: non compaiono nel monitor, e in modalità server spento o proxy totale vengono
sempre inoltrate.

Una richiesta HTTP *normale* (senza upgrade) su un endpoint la cui variante selezionata è
`ws` riceve **`426 Upgrade Required`** — il segnale che si sta chiamando un canale WebSocket
come se fosse un endpoint REST.

## I dettagli operativi

- nei silenzi il motore invia un **ping** di protocollo ogni 30 secondi, in modalità
  permissiva: un pong mancato non chiude la connessione;
- alla ricarica a caldo e allo shutdown le connessioni vengono chiuse: il client riconnette e
  il copione riparte;
- una variante `ws` **non può essere lo step di una sequenza**;
- via admin API: `POST /mocks/:id/ws/push` e `GET /mocks/:id/ws/connections`.

Con SSE e WebSocket si chiude la parte III: ogni natura di risposta è coperta. La parte IV
cambia prospettiva — non più *costruire* risposte, ma *osservare e catturare* quelle vere:
si parte dal [monitor](20-monitor.md).
