# Design — Sequence come variante di response

Stato: **implementato** (agosto 2026).

Documento decisionale dettagliato: `ANALISI-SEQUENCE-COME-VARIANTE.md`.

## Principio

Una sequence è una normale response con `type: "sequence"`. Il file endpoint non contiene
configurazione sequence e `selectedResponseFile` è l'unico meccanismo di attivazione. Questo
elimina lo stato ambiguo «response selezionata + sequence separatamente abilitata» e permette
di possedere, clonare e alternare più scenari sullo stesso endpoint.

Il vecchio `endpoint.sequence` e il vecchio `PUT /mocks/:id { sequence: ... }` non sono
retrocompatibili: vengono rifiutati esplicitamente.

## Formato

`GET.endpoint.json`:

```json
{
  "method": "GET",
  "path": "/api/operazioni/:id",
  "description": "",
  "enabled": true,
  "responseFiles": [
    "001.response.json",
    "002.response.json",
    "003.response.json",
    "900.response.json"
  ],
  "selectedResponseFile": "900.response.json"
}
```

`GET.responses/900.response.json`:

```json
{
  "type": "sequence",
  "title": "Polling operazione",
  "steps": [
    { "response": "001.response.json", "times": 3 },
    { "response": "002.response.json", "forMs": 5000 },
    { "response": "003.response.json" }
  ],
  "onEnd": "stay",
  "resetAfterMs": 30000
}
```

- `steps`: almeno due; ogni target deve essere elencato nell'endpoint.
- target ammessi: soltanto `mock` e `handler`.
- `times` e `forMs` sono mutuamente esclusivi, interi positivi e scelti per singolo step.
- ogni step non terminale deve avere un criterio; con `onEnd: loop` anche l'ultimo.
- `onEnd`: `stay` oppure `loop`, default normalizzato `stay`.
- `resetAfterMs`: intero positivo facoltativo; assente significa mai.
- `enabled` non è ammesso. Per disattivare lo scenario si seleziona un'altra response.

## Validazione del grafo

Quando una mutazione admin crea, modifica, seleziona o copia una sequence, non basta validare
il JSON. Il server usa lo stesso resolver del runtime per caricare tutti gli step, inclusi file
payload, sorgenti handler e dipendenze. Sequence annidate, middleware, SSE e WS sono errori.

La mutazione attende un reload iniziato dopo la propria scrittura. Se il reload riporta il file
endpoint in `loadErrors`, i backup vengono ripristinati e si esegue un secondo reload. In questo
modo una risposta `2xx` garantisce che lo scenario sia realmente servibile.

La cancellazione di un target referenziato risponde `409` con:

```json
{ "details": { "referencedBy": ["900.response.json"] } }
```

La copia con `copyResponses: false`, se la selezionata è una sequence, copia la chiusura minima:
file sequence, response degli step e relativi asset. `copyResponses: true` copia tutto.

## Runtime e identità

Il cursore è globale per endpoint e in-memory:

```text
{ stepIndex, servedInStep, stepStartedAt, lastRequestAt }
```

La firma dello scenario comprende:

```text
sequenceFileName + steps normalizzati + onEnd + resetAfterMs
```

Perciò:

- un cambio di titolo o un reload estraneo conserva cursore e memoria handler;
- cambiare filename selezionato o definizione azzera entrambi;
- passare sequence → response ordinaria → stessa sequence riparte da zero;
- disable/enable dell'endpoint sequence riparte da zero;
- il reset manuale azzera cursore e `HandlerStateStore`;
- l'auto-reset per inattività azzera solo il cursore.

Il timer `forMs` parte dalla prima richiesta servita dallo step. Con `times`, lo stato esposto
dall'admin indica sempre lo step che risponderà alla prossima richiesta.

## Admin API

| Metodo | Semantica |
|---|---|
| `POST /mocks/:id/responses` | crea e seleziona una sequence; `steps` obbligatorio |
| `PUT /mocks/:id/responses/:file` | modifica la sequence indicata |
| `PUT /mocks/:id` | seleziona la response; una sequence viene validata integralmente |
| `GET /mocks/:id` | espone `sequence` e `sequenceState` soltanto se la selezionata è sequence |
| `GET /mocks/:id/sequence/state` | restituisce `{ sequenceFile, sequenceState }` |
| `POST /mocks/:id/sequence/reset` | resetta cursore e memoria handler |

`GET /mocks` definisce `sequenceActive` come `response.type === "sequence"`; il flag è
indipendente da `endpoint.enabled`, già rappresentato da `disabled`.

## Interfaccia

La sequence appare nel menu delle response e nel pulsante scorciatoia. La dialog ha modalità
create/edit, titolo, `onEnd`, reset per inattività e una scelta `times`/`forMs` indipendente su
ogni riga. I target sono filtrati con allow-list `mock|handler`.

In edit della sequence selezionata la UI mostra uno snapshot del cursore, lo aggiorna tramite
polling leggero su `/sequence/state`, cancella il polling alla chiusura e offre il reset. Il
dettaglio mostra un riepilogo degli step invece del form generico.

## Limite noto — mutazioni ravvicinate sullo stesso endpoint

L'azzeramento dello scenario è deciso dalla mutazione che lo causa (`invalidateScenario` in
`src/admin/endpoint-operations.js`), non dedotto dal reload. Il motivo è che il reload **aggrega**:
le chiamate arrivate mentre un giro è in corso vengono servite dal successivo (`createReloadHandler`
in `src/server.js`), quindi due cambi di selezione che si annullano a vicenda producono una sola
riconciliazione, che confronta due firme identiche e conclude — correttamente, per quel che vede —
che nulla è cambiato. Lo stato intermedio non è mai esistito su disco al momento della scansione.

Con quella correzione il caso ricorrente è risolto, ma **resta una finestra di concorrenza non
caratterizzata**. Sintomo: subito dopo una raffica di mutazioni sullo stesso endpoint,
`GET /mocks/:id/sequence/state` può riportare un `servedInStep` precedente invece di ripartire da
zero. Osservato solo dalla suite di accettazione, che spara più mutazioni in pochi millisecondi da
tre browser in parallelo; **non** riproducibile rigiocando la stessa sequenza di chiamate HTTP una
dopo l'altra.

Quando lo si può incontrare: solo da un client automatico che muta lo stesso endpoint a raffica.
Non usando l'interfaccia — Mockxy è uno strumento di sviluppo per un utente alla volta (al massimo
un paio sulla versione headless) e non è pensato per carichi concorrenti. Se capita, il rimedio è
il reset esplicito: `POST /mocks/:id/sequence/reset`, o "Riparti dall'inizio" nella dialog.

Non affrontato di proposito: il costo della diagnosi non è giustificato dall'uso previsto.

## Limiti intenzionali

- cursore globale per endpoint, non per client;
- nessuna persistenza del cursore tra riavvii;
- nessuna sequence annidata;
- nessun target middleware/SSE/WS;
- nessun adapter di compatibilità per il formato precedente;
- nessun migratore automatico incluso in questa implementazione.
