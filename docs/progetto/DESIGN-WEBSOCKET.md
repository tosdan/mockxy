# Design — Mock di WebSocket

Stato: **MVP implementato** (luglio 2026) — copione, regole, console e admin API come da
proposta; decisioni prese: regole nel MVP, nessun eco di default, dipendenza `ws`.

## Il problema

Oggi le WebSocket sono passthrough puro verso il backend reale (vedi `docs/it/WEBSOCKET.md`):
chi sviluppa un frontend che parla WS — notifiche, chat, aggiornamenti live — non può mockare
quel canale, e senza backend la connessione muore. Con le SSE il problema è stato risolto
(copione + console); questo è il capitolo successivo, già previsto come «fase W» in
[`DESIGN-SSE.md`](DESIGN-SSE.md): serve poter dire «quando il client si connette qui, ricevi
questi messaggi» e — soprattutto — poter fare la **regia manuale dalla GUI**: l'utente guarda
il proprio frontend reagire ai messaggi che invia dalla console di Mockxy.

Cosa cambia davvero rispetto alle SSE, in ordine di peso:

1. **i messaggi in ingresso**: una WS è bidirezionale — il client *parla*. Un mock credibile
   deve almeno mostrarli (console) e poter rispondere a tono (regole);
2. **il protocollo**: l'upgrade non attraversa la pipeline HTTP; i frame vanno
   codificati/decodificati (RFC 6455), con ping/pong e chiusura con codice;
3. **il matching**: oggi l'upgrade o va al backend o viene rifiutato; deve imparare a
   consultare il registry dei mock.

Tutto il resto — copione, console, push admin, presets, heartbeat, chiusura a reload — è riuso
diretto di ciò che le SSE hanno già costruito.

## Il principio

Stessi due modi complementari di alimentare il canale, come per le SSE:

- **il copione** — la scaletta dichiarativa dei messaggi in uscita nel file della variante:
  riproducibile, in git, non richiede presenza;
- **la console (regia manuale)** — la vista nella scheda dell'endpoint: connessioni attive,
  **transcript bidirezionale** (▶ inviati, ◀ ricevuti), textarea per il prossimo messaggio,
  macro. È il cuore del caso d'uso richiesto: il frontend si collega, l'utente gli manda
  messaggi a mano e lo vede reagire.

In mezzo, il pezzo nuovo: le **regole di risposta** dichiarative sui messaggi in ingresso
(«se arriva questo, rispondi quello»), per i giri richiesta/risposta che il copione non può
prevedere. Come sempre: tutto ciò che fa la console è fattibile via admin API (curl).

## MVP

### Il formato: una nuova natura di variante

Accanto a `mock`, `handler`, `middleware` e `sse`, il tipo **`ws`**:

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
    { "match": { "json": { "azione": "subscribe" } },
      "reply": [{ "afterMs": 100, "data": { "esito": "sottoscritto" } }] },
    { "match": { "equals": "ping" },
      "reply": [{ "afterMs": 0, "data": "pong" }] }
  ],
  "presets": [
    { "label": "Errore", "data": { "tipo": "errore", "messaggio": "boom" } }
  ]
}
```

- **`script`** — la scaletta in uscita, anche vuota (endpoint muto, solo regia manuale).
  Ogni voce: `afterMs` (relativo al messaggio precedente, come nelle SSE), `data` (JSON —
  serializzato — o stringa). Parte **a ogni connessione, indipendentemente per ciascuna**;
  riconnettersi = ripartire (stessa semantica SSE, stesso motivo: nessun reset da gestire).
- **`onEnd`** — esaurito il copione: `keep-open` (default), `close` (con `closeCode`/
  `closeReason` opzionali accanto, default `1000`), `loop` (richiede ritardi > 0, come SSE).
- **`rules`** — valutate su ogni messaggio in ingresso, **prima regola che matcha vince**,
  indipendenti dal copione (che nel frattempo continua). `match` minimale e senza logica,
  nello spirito del templating: **`equals`** (testo esatto), **`contains`** (sottostringa),
  **`json`** (il messaggio è JSON e *contiene* le coppie indicate — subset match, non
  uguaglianza profonda). `reply` è una scaletta con la stessa forma dello script, inviata
  solo alla connessione che ha parlato. Nessun match → il messaggio viene solo registrato
  (transcript/monitor); l'eco di default è una scelta aperta (questione 3).
- **`presets`** — le macro della console, come per le SSE.

### Il serving: intercettare l'upgrade

Oggi `server.on("upgrade")` inoltra tutto al backend (`upgrade-proxy.js`). Il nuovo flusso:

1. all'upgrade si consulta il registry: c'è un endpoint **abilitato** il cui path matcha e la
   cui **variante selezionata è di tipo `ws`**? Se no → passthrough com'è oggi (tunnel al
   backend, o rifiuto locale nei casi già documentati). Il confine mock/reale per-endpoint
   funziona quindi anche per le WS, come per tutto il resto;
2. se sì → **handshake gestito localmente** (101, `Sec-WebSocket-Accept`; se il client offre
   subprotocolli si accetta il primo — questione 4) e la connessione entra nello store delle
   connessioni WS: copione in onda, regole in ascolto, console collegata.

Un **GET normale** (senza upgrade) su un endpoint con variante `ws` selezionata risponde
**`426 Upgrade Required`** con un body esplicito: diagnosi immediata invece di un mock muto.

Dettagli di protocollo nel perimetro MVP: frame di testo, ping/pong come heartbeat (30s,
al posto del commento SSE), chiusura pulita con codice a reload/shutdown (il client riconnette
e il copione riparte), messaggi in ingresso oltre il limite di cattura troncati nel transcript
ma consegnati alle regole per intero.

### La dipendenza: `ws`, non framing a mano

Il motore non ha una libreria WebSocket (il tunnel attuale incolla socket senza guardare i
frame). Per il mock i frame vanno parlati davvero: unmasking obbligatorio dei frame client,
frammentazione, control frame, chiusura con status code. Farlo a mano è possibile ma è
esattamente il codice che si sbaglia in silenzio; **`ws`** è lo standard de-facto (zero
dipendenze transitive obbligatorie), si usa solo in `handleUpgrade` sul ramo mockato e non
tocca il tunnel proxy esistente. Il costo (una dipendenza in più) è dichiarato qui perché è
l'unica aggiunta al `package.json` di runtime che questa feature richiede.

### La console

Come quella SSE, con il transcript nei due versi:

```
┌ Connessioni: 1 attiva (da 02:13) ───────────────────────┐
│  10:32:01  ▶ {"tipo":"benvenuto"}          (copione 1/2)│
│  10:32:04  ◀ {"azione":"subscribe"}                     │
│  10:32:04  ▶ {"esito":"sottoscritto"}      (regola 1)   │
│  10:32:12  ▶ {"tipo":"promo","sconto":20}  (manuale)    │
│ ────────────────────────────────────────────────────────│
│  data: [ {"tipo": ...}                               ]  │
│  [Invia a tutti]                 macro: [promo] [errore]│
└──────────────────────────────────────────────────────────┘
```

Ogni messaggio del transcript è ricliccabile (re-invio); la provenienza è etichettata
(copione / regola / manuale / ricevuto). L'invio manuale è broadcast; il per-connessione è un
potenziamento, come per le SSE.

### Admin API

| Metodo e percorso | Cosa fa |
|---|---|
| `POST /mocks/:id/ws/push` | invia `{ data }` a tutte le connessioni aperte — `{ delivered, connections }` |
| `GET /mocks/:id/ws/connections` | connessioni attive (da quanto, punto del copione) + transcript bidirezionale |
| dettaglio `GET /mocks/:id` | la variante `ws` espone copione, regole e presets |

### Monitor

Come per le SSE: la voce nasce **alla chiusura della connessione**, con durata e conteggio
messaggi nei due versi (e il transcript nel limite di cattura). Il live si guarda nella
console. L'handshake mockato, a differenza di oggi, ha una voce sua (`x-mock-source: ws`).

## Potenziamenti progressivi

1. **Handler bidirezionale** — la via del codice: `onSocket({ send, close, onMessage, params,
   query, state, data })`. È il gradino sopra le regole, come handler sopra mock; le regole
   dichiarative coprono il caso comune senza scrivere JavaScript.
2. **Cattura e replay** — il tunnel proxy oggi non guarda i frame; farglieli osservare
   (tee sul tunnel) permetterebbe «crea mock da questa sessione» con i tempi originali, come
   per il resto del traffico. Progetto a sé: il tunnel resta agnostico nel MVP.
3. **Templating nei `data`** — i placeholder di DESIGN-TEMPLATING.md su params/query della
   connessione e (nuovo) sul messaggio che ha attivato la regola (`{{message.campo}}`).
4. **Console avanzata** — invio a una connessione specifica; `broadcast: true` sulle regole
   (es. chat: quello che dice uno lo ricevono tutti).
5. **Subprotocolli e binario** — negoziazione dichiarata nella variante; frame binari da
   file, se emerge il caso d'uso.

## Non-obiettivi (MVP)

- frame binari e subprotocolli oltre l'eco del primo offerto;
- compressione `permessage-deflate` (disattivata: il mock non ha bisogno di comprimere);
- cattura del traffico WS proxato (potenziamento 2 — il tunnel attuale non si tocca);
- handler bidirezionale (potenziamento 1);
- variante `ws` come step di una sequenza (stesso ragionamento delle SSE);
- regole con logica (condizioni composte, stato tra messaggi): quando serve, è l'handler.

## Questioni aperte

1. **`rules` nel MVP o subito dopo?** La regia manuale da console copre già il caso d'uso
   principale richiesto; le regole si possono spostare in un secondo giro per accorciare il
   primo. Proposta: tenerle nel MVP solo se il primo giro non si allunga — sono il pezzo che
   rende il mock utilizzabile *senza* presenza umana (CI, colleghi).
2. **Match dei messaggi**: bastano `equals`/`contains`/`json` subset (proposto)? O serve un
   percorso a punti con valore (`{"path": "azione", "equals": "subscribe"}`)?
3. **Eco di default**: messaggio in ingresso senza regola che matcha — ignorare (proposto:
   solo transcript) o rispondere con l'eco? L'eco è comodo per il primo giro di prova ma è un
   comportamento "magico" che poi va spento.
4. **Subprotocollo**: accettare il primo offerto (proposto) o rifiutare l'handshake se il
   client ne chiede uno e la variante non lo dichiara? Il primo è permissivo (funziona
   subito), il secondo più fedele.
5. **Heartbeat ping/pong**: 30s fisso (proposto) o allineato/configurabile col 15s delle SSE?
   E: chiudere la connessione se il pong non torna (fedele) o lasciarla vivere (permissivo)?
6. **`ws` in `dependencies`**: confermare la scelta della dipendenza rispetto al framing a
   mano (vedi sopra) — è l'unico punto in cui questa feature tocca la superficie del runtime.
