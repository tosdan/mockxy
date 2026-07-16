# Design — Mock di Server-Sent Events

Stato: **MVP implementato** (luglio 2026) — copione, modalità di fine, heartbeat, connessioni
runtime, push admin e console con regia manuale.

## Il problema

Le app moderne non ricevono dati solo a domanda: notifiche, avanzamenti di lavori, feed live
arrivano su un canale push. Chi sviluppa il frontend contro Mockxy oggi deve rinunciare a
mockare quella parte (le SSE proxate passano al backend reale, le WebSocket sono passthrough
puro). Serve poter dire: «quando il client si connette a questo endpoint, ricevi *questi*
eventi, con *questi* tempi» — e poter improvvisare a mano durante una sessione di prova.

**Si parte dalle SSE, non dalle WebSocket**: una SSE è una normale GET con body
`text/event-stream` che non finisce mai — sta nella pipeline HTTP esistente e si testa con
curl. Le WebSocket sono bidirezionali (upgrade, subprotocolli, messaggi in ingresso da
interpretare): un design molto più grosso, che però riuserà quasi tutto ciò che viene
costruito qui (vedi «Potenziamenti», fase W).

## Il principio

Due modi complementari di alimentare lo stream, con lo stesso formato di messaggio:

- **il copione** — una scaletta dichiarativa nel file della variante: «dopo 500ms invia X,
  dopo 3s invia Y, poi resta aperto». Sta in git, è riproducibile, non richiede presenza. È il
  gemello "dentro la connessione" della sequenza di varianti: stessi concetti (step, criteri a
  tempo, loop, reset), applicati al tempo *interno* di uno stream invece che tra richieste;
- **la console (regia manuale)** — una vista stile chat nella scheda dell'endpoint: connessioni
  attive, textarea per il prossimo evento, storico dei messaggi inviati. Il copione va in onda
  da solo; la console permette di intrometterviersi o di fare tutto a mano.

Tutto ciò che fa la console deve essere fattibile anche via admin API (curl): la regia
dev'essere scriptabile.

## MVP

### Il formato: una nuova natura di variante

Accanto a `mock`, `handler` e `middleware`, il file di risposta può essere di tipo **`sse`**:

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
  "onEnd": "keep-open"
}
```

- **`script`** — la scaletta, anche vuota (= endpoint muto, si alimenta solo dalla console).
  Ogni voce: **`afterMs`** (ritardo dal messaggio precedente — non dall'inizio: inserire una
  voce non ricalcola le successive), **`data`** (JSON o stringa; il JSON viene serializzato),
  **`event`** e **`id`** facoltativi (i campi del protocollo SSE).
- **`onEnd`** — esaurito il copione: **`keep-open`** (default: la connessione resta aperta,
  arrivano solo heartbeat ed eventuali push manuali), **`close`** (il server chiude — il caso
  «il lavoro è finito»), **`loop`** (si ricomincia dalla prima voce: feed infiniti).
- **`retryMs`** — facoltativo: il campo `retry:` SSE inviato in testa alla connessione.
- Come ogni variante: si seleziona (o si mette in una [sequenza](../it/ENDPOINT.md)? no — v. sotto),
  convive con varianti mock/handler dello stesso endpoint (es. GET che risponde JSON o stream
  a seconda della variante scelta... in pratica: la variante selezionata decide la natura).

Il copione parte **a ogni connessione, indipendentemente per ciascuna**: due client connessi in
momenti diversi vedono ciascuno il proprio film dall'inizio. È la semantica giusta per il caso
d'uso (ogni sessione di prova ricomincia) e non richiede reset: chiudere e riaprire la
connessione È il reset.

### Il serving

- La variante `sse` risponde `200` con `content-type: text/event-stream`, no-cache,
  `x-mock-source: sse`; il body resta aperto e gli eventi escono secondo il copione.
- **Heartbeat**: un commento `: ping` ogni 15s quando non c'è traffico, così proxy e client non
  chiudono per inattività. Non è un evento: i client non lo vedono.
- **CORS**: vale l'opzione già esistente del motore (l'hook su writeHead copre anche questo ramo).
- Le connessioni si chiudono in modo pulito allo shutdown del motore e alla ricarica a caldo
  (il client SSE ri-connette da solo: è il comportamento naturale del protocollo, e il copione
  riparte — coerente con «riconnessione = reset»). *Deviazione presa in implementazione:* si
  chiudono a **ogni** reload, non solo quando cambia l'endpoint interessato — il reload non
  distingue in modo affidabile cosa è cambiato, e una riconnessione in più è innocua.
- Fuori scope MVP: ritardi/paginazione/filtri automatici (non hanno senso su uno stream),
  variante `sse` dentro una sequenza di varianti (la sequenza sceglie tra risposte "chiuse";
  mescolare i due tempi — tra richieste e dentro la connessione — confonde più di quanto serva).

### La console (regia manuale)

Nella scheda dell'endpoint con variante `sse` selezionata, al posto della preview del body:

```
┌ Connessioni: 2 attive (ultima da 00:41) ────────────────┐
│  10:32:01  ▶ progress {"percent":10}      (copione 1/3) │
│  10:32:02  ▶ progress {"percent":60}      (copione 2/3) │
│  10:32:12  ▶ notifica {"tipo":"promo"}    (manuale)     │
│ ────────────────────────────────────────────────────────│
│  event: [notifica   ]  data: [ {"tipo": ... }        ]  │
│  [Invia a tutti]                 macro: [promo] [errore]│
└──────────────────────────────────────────────────────────┘
```

- **connessioni attive** con conteggio; l'invio manuale è **broadcast a tutte** (il
  per-connessione è un potenziamento);
- **storico** dei messaggi usciti (copione e manuali, distinti), ogni voce **ricliccabile**
  (re-invio con un clic);
- **macro**: messaggi pronti salvati nella variante (`"presets": [...]`), un clic e partono;
- la console si aggiorna live (il canale è lo stesso meccanismo SSE già usato dal monitor
  della UI).

### Admin API

| Metodo e percorso | Cosa fa |
|---|---|
| `POST /mocks/:id/sse/push` | invia un messaggio (`{ event?, data, id? }`) a tutte le connessioni aperte dell'endpoint — la curl-ability della console |
| `GET /mocks/:id/sse/connections` | connessioni attive (conteggio, da quanto, a che punto del copione) |
| dettaglio `GET /mocks/:id` | la variante `sse` espone copione e presets come ogni altra variante |

### Monitor

Le voci del monitor nascono **a risposta completata**: per uno stream questo significa alla
**chiusura della connessione** — la voce riporta durata, numero di eventi inviati e (nel limite
di cattura esistente) il transcript. Il live invece si guarda nella console dell'endpoint, non
nel monitor: due strumenti, due tempi. Limite dichiarato nell'MVP, migliorabile (fase 3).

## Potenziamenti progressivi

1. **Cattura e replay** — il proxy inoltra già gli stream del backend: registrare gli eventi
   *con i loro tempi* e offrire «crea mock da questa cattura» trasforma un feed vero di staging
   in un copione riproducibile (con timing originali o accelerati ×N). È la filosofia
   proxy+cattura del progetto applicata al push.
2. **Handler generatore** — la via del codice per i casi dinamici: lo script riceve la
   connessione (`onStream({ send, close, params, query, state, data })`) e decide lui cosa
   mandare e quando. Gradino sopra il copione, come handler sopra mock.
3. **Monitor live per gli stream** — voce del monitor aperta con aggiornamento incrementale
   (eventi che compaiono man mano), invece della sola voce a chiusura.
4. **Console avanzata** — invio a una connessione specifica; condizioni nel copione
   (`onlyIf: { query: {...} }`); templating nei `data` (vedi DESIGN-TEMPLATING.md) per
   riflettere `params`/`query` della connessione.
5. **Fase W: WebSocket** — riuso di copione, console, push admin e cattura; il capitolo nuovo
   sono i **messaggi in ingresso**: regole dichiarative di risposta (match sul contenuto →
   reply/broadcast), eco per default, e handler bidirezionale per il resto. L'upgrade oggi è
   passthrough puro: il mock WS richiede di intercettare l'upgrade per gli endpoint mockati e
   proxare gli altri.

## Non-obiettivi (MVP)

- WebSocket (fase W);
- variante `sse` come step di una sequenza di varianti;
- per-connessione nella console e condizioni nel copione (fase 4);
- fedeltà al protocollo oltre l'essenziale (multi-line data, BOM, ecc. si aggiungono quando
  servono; `event`/`data`/`id`/`retry` coprono i client reali).

## Questioni aperte

1. `afterMs` relativo al messaggio precedente (proposto) o assoluto dall'inizio della
   connessione? Il relativo è più editabile, l'assoluto più leggibile come timeline.
2. La console vive nella scheda endpoint (proposto) o in una vista dedicata stile monitor?
3. I `presets` (macro) stanno nel file della variante (condivisi in git, proposto) o sono
   preferenze locali?
4. `POST /sse/push` su endpoint senza connessioni: 200 con `delivered: 0` (proposto) o 409?
5. Heartbeat: intervallo fisso 15s (proposto) o configurabile per workspace?
