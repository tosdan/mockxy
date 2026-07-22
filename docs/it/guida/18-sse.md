# 18 — Mockare gli stream: Server-Sent Events

Non tutte le comunicazioni sono richiesta/risposta. Con i **Server-Sent Events** (SSE) il
client apre una richiesta HTTP che resta aperta, e il server vi spinge dentro eventi quando
vuole: è il protocollo tipico di notifiche, avanzamento di job, feed di aggiornamenti. Lato
frontend il consumo è l'API `EventSource`:

```js
const es = new EventSource("/api/jobs/42/events");
es.addEventListener("progress", (e) => aggiorna(JSON.parse(e.data)));
es.addEventListener("done", () => completato());
```

Mockare un endpoint del genere con una risposta statica non ha senso — serve una risposta che
*si svolge nel tempo*. La variante di tipo **SSE** fa esattamente questo: la connessione
resta aperta e gli eventi escono secondo un **copione** temporizzato, oppure in diretta dalla
**console** dell'endpoint.

## Il copione

Una variante SSE si crea dal menu delle nuove response ([capitolo 8](08-scheda-endpoint.md));
il suo contenuto è la scaletta degli eventi. L'esempio guida — la barra di avanzamento:

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

- ogni voce dello **`script`** ha `afterMs` (il ritardo **dal messaggio precedente**, non
  dall'inizio), `data` (JSON — serializzato sul filo — o stringa, anche multi-linea) e,
  facoltativi, `event` e `id` — i campi del protocollo SSE;
- il copione può anche essere **vuoto**: un endpoint muto, alimentato solo dalla console;
- **`onEnd`** decide cosa succede a copione esaurito: `keep-open` (default — la connessione
  resta aperta per heartbeat e push manuali), `close` (il server chiude), `loop` (si
  ricomincia; serve almeno un `afterMs` positivo, altrimenti sarebbe un ciclo istantaneo);
- **`retryMs`** è il campo `retry:` SSE inviato in testa: il suggerimento al client su quanto
  attendere prima di riconnettersi;
- **`presets`** sono i messaggi pronti della console (sotto).

La regola più importante: il copione va in onda **a ogni connessione, indipendentemente per
ciascuna** — riconnettersi significa ripartire dall'inizio. È coerente con come i client SSE
funzionano (`EventSource` riconnette da solo), e rende ogni giro di prova riproducibile.

Nei silenzi il motore invia un commento di **heartbeat** ogni 15 secondi, invisibile ai
client ma sufficiente a tenere viva la connessione attraverso proxy e timeout intermedi.

> 📷 **SCREENSHOT** — `18-editor-sse.png`
> Cosa mostrare: la variante SSE nella scheda endpoint con il copione dei tre eventi
> progress/done visibile.

## La console: la regia manuale

Quando la variante SSE è selezionata, la scheda dell'endpoint mostra la **console** al posto
dell'anteprima del body: le **connessioni aperte** (con la posizione di ciascuna nel
copione), lo **storico** dei messaggi inviati — con l'origine distinta: copione o manuale —
e il compositore per l'invio in diretta: campo `event` facoltativo, campo `data` (JSON o
testo, `Ctrl+Invio` per spedire), invio **broadcast a tutte le connessioni aperte**. Dallo
storico, ogni messaggio si re-invia con un click; i `presets` configurati nella variante
compaiono come macro pronte.

La console trasforma la prova del frontend in una sessione interattiva: l'app aperta di
fianco, e si dirigono gli eventi a mano — «e se adesso arriva un errore?» — guardando la UI
reagire in tempo reale. Senza client connessi, l'invio finisce solo nello storico (la console
lo segnala).

> 📷 **SCREENSHOT** — `18-console-sse.png`
> Cosa mostrare: la console SSE con una connessione attiva, qualche messaggio nello storico
> con origini diverse (copione e manuale) e il compositore in basso.

## I dettagli operativi

- le connessioni SSE vengono **chiuse alla ricarica a caldo e allo shutdown**: il client
  riconnette da solo e il copione riparte — nessuno stato appeso;
- la voce del **monitor** per una richiesta SSE nasce **alla chiusura della connessione** (è
  lì che status e durata sono definitivi);
- una variante SSE **non può essere lo step di una sequenza**;
- via admin API: `POST /mocks/:id/sse/push` (invio) e `GET /mocks/:id/sse/connections`
  (connessioni) — per pilotare la regia da script o test.

Gli SSE sono unidirezionali: server → client. Quando il canale deve parlare in entrambe le
direzioni, il protocollo è WebSocket — e il mock ha bisogno anche di *regole di risposta*:
[capitolo 19](19-websocket.md).
