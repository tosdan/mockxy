# Piano definitivo — Sequence come variante di response

Stato: **specifica pronta per l'implementazione**

Data: 11 agosto 2026

Ambito: formato workspace, runtime, admin API, UI, reload a caldo, migrazione e test.

## 1. Esito dell'analisi

La trasformazione è fattibile nell'architettura attuale e migliora il modello del prodotto:
`selectedResponseFile` diventa davvero l'unica fonte di verità sul comportamento di un
endpoint. Non richiede di riscrivere l'algoritmo `times`/`forMs`, ma richiede un refactor
coordinato di loader, stato runtime, operazioni admin e UI.

Non ci sono impedimenti strutturali. I rischi reali, verificati sul codice, sono questi:

1. il reload a caldo conserva la route precedente quando una nuova configurazione non carica e
   non propaga quel fallimento alla mutazione admin; inoltre una chiamata arrivata mentre un
   reload è in corso accoda un giro ma ritorna subito. Una sequence deve quindi validare tutto
   il proprio grafo e attendere l'esito del reload che contiene la propria scrittura prima che
   l'API dichiari successo;
2. il cursore attuale è identificato solo da `METHOD path`; senza includere la variante
   sequence e senza riconciliare lo stato ai reload, passare tra più sequence può riutilizzare
   uno stato non pertinente;
3. cancellazione e copia parziale devono conoscere le dipendenze introdotte dagli step;
4. il dialog attuale usa una modalità globale `times`/`forMs`, ma il formato e il motore
   accettano step misti: l'editor deve rappresentarli senza riscriverli in modo distruttivo;
5. aggiungere `sequence` al tipo TypeScript generale farebbe entrare accidentalmente il nuovo
   tipo nei flussi che creano un endpoint da zero o usano il form body/source generico.

Le sezioni seguenti chiudono queste decisioni. Non restano questioni di prodotto bloccanti.

## 2. Decisioni definitive

| Tema | Decisione |
|---|---|
| Forma su disco | `type: "sequence"` con campi diretti `steps`, `onEnd`, `resetAfterMs`. |
| Attivazione | La sequence è attiva quando il suo file è `selectedResponseFile`. |
| Toggle | `sequence.enabled` viene eliminato; non esiste un secondo stato di attivazione. |
| Step ammessi | Solo response `mock` e `handler`, anche miste. |
| Annidamento | Una sequence non può essere step di un'altra sequence. |
| SSE/WS/middleware | Non ammessi negli step; i loro percorsi runtime non sono request/response locali compatibili col cursore. |
| Cursore | Uno per endpoint attualmente attivo; l'identità include il file sequence selezionato. |
| Cambio selezione | Entrare in una sequence, uscirne o passare a un'altra azzera lo scenario runtime dell'endpoint. |
| Riselezione identica | È un no-op idempotente e conserva lo stato; per ripartire si usa il reset esplicito. |
| Modifica sequence | Cambiare `steps`, `onEnd` o `resetAfterMs` azzera lo scenario; cambiare solo `title` no. |
| Modifica di uno step | Cambiare il contenuto di una response referenziata non azzera il cursore. |
| Handler state | Si azzera agli stessi confini dello scenario e col reset manuale; resta invariato sui reload estranei. |
| Auto-reset | Assente per default nel formato/API; la UI propone `30000` ms solo come valore iniziale modificabile. |
| Cancellazione target | Rifiutata con `409 Conflict` se almeno una sequence lo referenzia. |
| Copia parziale | Se la selezionata è una sequence, copia sequence, step distinti e relativi asset. |
| Stato UI | Snapshot nel dettaglio più polling leggero mentre il dialog della sequence selezionata è aperto. |
| Header diagnostico | Nessun nuovo header HTTP; il monitor resta il canale diagnostico. |
| Compatibilità legacy | Nessun adapter runtime/admin. `endpoint.sequence` viene rifiutato esplicitamente, non ignorato. |

La non retrocompatibilità è deliberata: riduce i rami doppi nel loader e impedisce che il
modello vecchio continui a influenzare API e UI. È possibile offrire un migratore una tantum,
ma il codice applicativo finale legge e scrive solo il nuovo formato.

## 3. Modello persistito

Il file endpoint contiene soltanto l'elenco e la selezione delle response:

```json
{
  "method": "GET",
  "path": "/api/operazioni/:id",
  "description": "",
  "enabled": true,
  "responseFiles": [
    "001.response.json",
    "002.response.json",
    "003.response.json"
  ],
  "selectedResponseFile": "003.response.json"
}
```

La configurazione della sequence vive nel normale file response:

```json
{
  "type": "sequence",
  "title": "Polling operazione",
  "steps": [
    { "response": "001.response.json", "times": 2 },
    { "response": "002.response.json" }
  ],
  "onEnd": "stay",
  "resetAfterMs": 30000
}
```

La forma annidata `{ "type": "sequence", "sequence": { ... } }` è scartata: SSE e WS
mettono già il proprio copione direttamente nella response e un livello ulteriore non offre
un vantaggio operativo.

### 3.1 Forma canonica

- `type`: obbligatorio e uguale a `"sequence"`;
- `title`: stringa facoltativa, normalizzata a `""` nell'API;
- `steps`: array di almeno due step;
- `onEnd`: `"stay"` o `"loop"`, default `"stay"` in lettura;
- `resetAfterMs`: intero positivo facoltativo; assente significa mai;
- `enabled`: non ammesso in una response sequence;
- il writer admin scrive sempre `type`, `title`, `steps` e `onEnd`, e omette
  `resetAfterMs` quando il valore normalizzato è `null`.

L'API può esporre `resetAfterMs: null` nella forma normalizzata anche se il campo è omesso su
disco.

### 3.2 Invarianti degli step

Per ogni step:

- `response` deve essere un filename locale elencato in `endpoint.responseFiles`;
- la response deve esistere su disco e deve essere valida secondo il proprio tipo;
- il tipo risolto deve essere `mock` o `handler`;
- `times` e `forMs` sono mutuamente esclusivi e, quando presenti, interi maggiori o uguali a 1;
- ogni step non terminale deve avere un criterio;
- con `onEnd: "stay"`, l'ultimo step può non avere criterio e diventa terminale;
- con `onEnd: "loop"`, anche l'ultimo step deve avere un criterio;
- lo stesso file può comparire in più step, ma non è possibile riferire il file sequence stesso
  perché il suo tipo non è ammesso come target.

L'editor UI richiede almeno due response eleggibili distinte prima di creare una sequence. Il
formato non vieta di riusare una delle due in più posizioni. Questo è un vincolo UX della sola
creazione: una sequence valida già presente che ripete un unico target deve comunque restare
visualizzabile e modificabile senza perdita.

### 3.3 Semantica della selezione

| Tipo selezionato | Comportamento |
|---|---|
| `mock` | Serve stabilmente la response mock. |
| `handler` | Esegue stabilmente l'handler. |
| `middleware` | Usa il percorso proxy con middleware. |
| `sse` | Apre lo stream SSE. |
| `ws` | Gestisce l'upgrade WebSocket. |
| `sequence` | Il cursore sceglie a ogni richiesta uno step `mock` o `handler`. |

La response `sequence` non ha status, header o body servibili direttamente. Nel catalogo ha
`status: null` e `payloadType: "none"`.

## 4. Flusso runtime

```text
endpoint abilitato
  └─ carica selectedResponseFile
       ├─ type !== sequence → route group esistente del tipo selezionato
       └─ type === sequence
            ├─ normalizza la definizione
            ├─ risolve e valida tutti gli step
            ├─ registra route group runtime sequence
            └─ a request-time:
                 SequenceStateStore.resolveStep()
                   └─ step mock/handler → pipeline già esistente
```

Il route group interno `sequenceRouteGroups` può restare: descrive il comportamento runtime
della response selezionata e non implica più che la configurazione appartenga all'endpoint.

### 4.1 `src/mocks/sequence-config.js`

Sostituire l'attuale normalizzatore con una funzione esplicita, per esempio:

```js
normalizeSequenceResponse(response, responseFiles)
```

La funzione:

- richiede un oggetto sequence, invece di trattare `null` come “nessuna sequence”;
- elimina `enabled` dalla forma e dalla firma;
- conserva le regole attuali di `steps`, `times`, `forMs`, `onEnd` e `resetAfterMs`;
- restituisce `{ errors, sequence }` per essere condivisa da runtime e admin;
- produce una forma normalizzata priva di campi estranei.

Non mantenere `normalizeSequenceConfig()` come adapter legacy: tutti i chiamanti e i test
vengono aggiornati nello stesso rilascio.

### 4.2 `src/mocks/endpoint-loader.js`

Modifiche necessarie:

1. `validateEndpointConfig()` rifiuta esplicitamente la presenza di `endpoint.sequence` con un
   errore che rimanda alla migrazione;
2. `loadResponseByName()` riconosce `sequence`, ne normalizza la definizione contro
   `endpoint.responseFiles` e restituisce anche `responseFileName`;
3. `loadSequenceSteps(endpoint, endpointFilePath, sequence)` riceve la definizione della
   response selezionata, non legge più `endpoint.sequence`;
4. gli step vengono caricati con la stessa `loadResponseByName()` usata per una response
   normale, così mock file-backed, handler e dipendenze script sono realmente validati;
5. se uno step risolve a `sequence`, `middleware`, `sse` o `ws`, il caricamento fallisce;
6. la route runtime sequence conserva `sequenceFileName`, configurazione normalizzata e step
   risolti.

La funzione che risolve gli step deve essere esportata o estratta in un modulo condiviso. Le
mutazioni admin devono poterla chiamare: una validazione che controlla soltanto il campo
`type` non basta, perché non rileva un payload file mancante o un handler che non esporta
`resolveResponse`.

### 4.3 Serving

`src/mocks/mock-registry.js` può mantenere il ramo attuale:

1. riconosce l'entry runtime `type: "sequence"`;
2. chiede allo store l'indice dello step;
3. sostituisce l'entry con lo step risolto;
4. continua nel ramo `mock` o `handler` già esistente;
5. allega `sequenceStep` al monitor.

`src/app.js`, ritardi, templating, paginazione, filtri e timeout degli handler non richiedono
una nuova pipeline. La sequence sceglie quale response usare; la response scelta decide come
rispondere.

## 5. Identità e ciclo di vita dello stato

La sola firma della definizione non distingue due file sequence identici. La nuova firma deve
includere:

```text
sequenceFileName + steps normalizzati + onEnd + resetAfterMs
```

La chiave della mappa resta `METHOD path`, perché può esserci una sola response attiva per
endpoint. Non serve una mappa di cursori persistenti per ogni variante inattiva.

### 5.1 Riconciliazione ai reload

`SequenceStateStore` deve mantenere anche la mappa delle sequence attive e offrire un metodo
simile a:

```js
reconcile(activeSequencesByEndpoint)
```

Il metodo confronta l'insieme appena caricato con quello del registry precedente:

- stessa chiave e stessa firma: conserva il cursore;
- nuova sequence, file diverso o definizione diversa: elimina il cursore;
- endpoint non più sequence, disabilitato o cancellato: elimina il cursore;
- restituisce le chiavi il cui scenario è cambiato, così `HandlerStateStore` può essere
  azzerato sugli stessi confini.

La riconciliazione avviene **dopo** `graftPreviousRoutes()`, sull'insieme di route che verrà
effettivamente installato. Se un file modificato è invalido e il reload conserva la route
precedente, deve conservare anche il suo stato precedente.

`MockRegistry.setRouteGroups()` può occuparsi della sincronizzazione del cursore e restituire
le transizioni; `createReloadHandler()` azzera quindi `HandlerStateStore` per quelle chiavi.
I test che costruiscono un reload custom devono replicare questo passaggio tramite un helper
condiviso, non con logica duplicata.

### 5.2 Matrice delle transizioni

| Evento | Cursore | Handler state |
|---|---|---|
| primo avvio | vergine | vergine |
| mock/handler → sequence A | reset A | reset endpoint |
| sequence A → sequence B | reset B | reset endpoint |
| sequence → tipo non-sequence | rimosso | reset endpoint |
| disabilita/riabilita endpoint sequence | reset alla riattivazione | reset endpoint |
| riscrive la stessa selezione A | conserva | conserva |
| cambia solo `title` di A | conserva | conserva |
| cambia step/onEnd/reset di A | reset | reset endpoint |
| modifica body/sorgente di uno step | conserva | conserva |
| reset manuale | reset | reset endpoint |
| inattività `resetAfterMs` | reset pigro alla richiesta | conserva |
| riavvio processo | reset | reset |

L'auto-reset non azzera la memoria handler: è un comportamento già legato al solo cursore e
farlo pigramente alla richiesta cambierebbe in modo poco visibile lo stato degli script. Il
reset manuale e i cambi di scenario restano le azioni che azzerano entrambi.

La riselezione dello stesso file è intenzionalmente idempotente. Non è possibile distinguere
in modo affidabile un salvataggio su disco dello stesso valore da un reload estraneo; il
pulsante/API di reset esiste proprio per esprimere l'intenzione di ripartire.

## 6. Validazione e atomicità admin

Questo è il principale vincolo di correttezza emerso dal codice corrente.

`createReloadHandler()` raccoglie i `loadErrors`, innesta la route precedente e risolve senza
lanciare. Se un reload è già in corso, imposta inoltre `reloadQueued` e ritorna senza aspettare
il giro accodato. Di conseguenza `commitWithRollback()` non può, da solo, garantire che una
sequence nuova sia diventata la route effettiva quando risponde al client.

### 6.1 Contratto del reload

Prima di spostare il modello va rafforzato il contratto interno di reload:

- ogni chiamante riceve una Promise che si risolve dopo un giro che include le modifiche su
  disco visibili al momento della chiamata;
- più chiamate possono ancora essere aggregate, ma i waiter del giro accodato non vengono
  risolti alla fine del giro precedente;
- l'esito espone almeno `loadErrors` e un eventuale errore globale;
- il watcher continua a usare la politica resiliente: log e route precedente;
- una mutazione admin può dichiarare quali endpoint devono essere caricati senza errori e
  rifiutare l'esito anche se il runtime ha correttamente innestato la versione precedente.

`runReload()` deve restituire l'esito invece di scartarlo. `commitWithRollback()` può ricevere
un predicato `validateReloadResult`, oppure `reloadRuntime` può accettare un'opzione strict con
i path interessati. In entrambi i casi, un errore sul file mutato causa rollback, secondo
reload sui backup e risposta non-`2xx`.

Questo ack va implementato una volta nel protocollo admin/reload, non ricostruito dentro le
singole operazioni sequence.

### 6.2 Validazione del grafo

Ogni operazione admin che crea, modifica, seleziona o copia una sequence deve quindi eseguire
prima del successo:

1. normalizzazione strutturale della response sequence;
2. verifica dei riferimenti contro `responseFiles`;
3. caricamento completo di ogni step con il resolver condiviso del runtime;
4. rifiuto dei tipi non ammessi;
5. scrittura atomica dei file;
6. reload con ack del giro che contiene la scrittura;
7. verifica che il file endpoint interessato non compaia nei `loadErrors`;
8. rollback secondo il protocollo esistente se la verifica post-scrittura fallisce.

In particolare vanno coperti i casi oggi non rilevati dalla sola lettura JSON:

- asset di un mock file-backed assente;
- sorgente handler assente o invalida;
- handler senza `resolveResponse`;
- response elencata ma mancante;
- sequence annidata o tipo persistente non ammesso.

Le modifiche manuali ai file restano gestite dalla politica esistente: warning e ultima route
valida al reload. Le mutazioni attraverso l'admin API, invece, non devono mai rispondere `2xx`
se il nuovo grafo non è servibile.

## 7. Admin API definitiva

### 7.1 Letture

`GET /mocks/:id` restituisce:

- `endpoint` senza campo `sequence`;
- `type: "sequence"`, `status: null`, `payloadType: "none"` quando è selezionata una sequence;
- `response` con la forma normalizzata completa del file selezionato;
- `sequence` come vista tipizzata della definizione selezionata, coerente con le viste
  top-level `sse` e `ws` già esistenti;
- `sequenceState` soltanto quando la response selezionata è una sequence, anche se l'endpoint
  è disabilitato; in tal caso lo stato può essere vergine.

`GET /mocks` mantiene `sequenceActive`, definito in modo non ambiguo come:

```js
response.type === "sequence"
```

Il flag non incorpora `endpoint.enabled`; il catalogo espone già `disabled` separatamente.

Per l'indicatore live si aggiunge:

```text
GET /mocks/:id/sequence/state
→ { sequenceFile, sequenceState }
```

La rotta è leggera, opera soltanto sulla response sequence selezionata e risponde `400` se la
selezione non è una sequence.

### 7.2 Creazione e modifica

```text
POST /mocks/:id/responses
```

accetta:

```json
{
  "type": "sequence",
  "title": "Polling operazione",
  "steps": [
    { "response": "001.response.json", "times": 2 },
    { "response": "002.response.json" }
  ],
  "onEnd": "stay",
  "resetAfterMs": 30000
}
```

Per `type: "sequence"`, `steps` è obbligatorio: il server non inventa riferimenti. La response
viene creata col prossimo filename e selezionata, come le altre response nuove.

Il clone della sequence selezionata resta disponibile tramite il comportamento generico
esistente di creazione senza `type`; conserva i riferimenti agli stessi step e ottiene un nuovo
filename, quindi un'identità di cursore nuova.

```text
PUT /mocks/:id/responses/:file
```

modifica `title`, `steps`, `onEnd` e `resetAfterMs` della sequence indicata, con merge sulla
definizione esistente e validazione del risultato completo. Il tipo non può cambiare.

Il ramo generico `PUT /mocks/:id` che modifica body/config della response selezionata deve
rifiutare `sequence`, come già fa per SSE/WS, e indirizzare alla rotta della singola response.
Il vecchio body `{ sequence: ... }` non è più accettato.

### 7.3 Selezione e reset

```text
PUT /mocks/:id
{ "selectedResponseFile": "003.response.json" }
```

resta l'unica operazione di attivazione. Se il target è una sequence, l'API valida l'intero
grafo prima di scrivere la selezione.

```text
POST /mocks/:id/sequence/reset
→ { sequenceFile, sequenceState }
```

resetta la sequence selezionata e `HandlerStateStore`. Risponde `400` quando la response
selezionata non è una sequence. La rotta resta endpoint-scoped perché non esiste stato per le
sequence non selezionate.

### 7.4 OpenAPI e tipi TypeScript

Aggiornare `docs/admin-api.openapi.yaml` con:

- `sequence` in `ResponseType`;
- rimozione di `sequence` da `EndpointConfig` e `UpdateMockRequest`;
- `SequenceVariantConfig`, senza `enabled`;
- ramo sequence in `CreateResponseRequest` e `UpdateResponseRequest`;
- vista `sequence` e `sequenceState` in `MockDetail`;
- nuova risposta dello state endpoint;
- nuova semantica di `sequenceActive`;
- errore `409` della cancellazione referenziata.

In `mock-admin-api.types.ts`:

- aggiungere `'sequence'` a `MockType`;
- introdurre `SequenceVariantConfig` e `ResponseSequenceUpdateRequest`;
- rimuovere `EndpointConfig.sequence`;
- aggiungere `MockDetail.sequence`;
- mantenere `SequenceState` invariato;
- introdurre alias espliciti per i tipi creabili come endpoint e per quelli editabili nel form
  generico, invece di usare `Exclude<MockType, 'sse' | 'ws'>`.

Quest'ultimo punto evita che `sequence`, dopo l'estensione di `MockType`, venga trattato come
handler/middleware dai dialog di creazione o da `ResponseDraft`.

## 8. CRUD, dipendenze e copia

### 8.1 Indice delle dipendenze

Introdurre un helper che, dato un endpoint, legge tutte le response sequence e produce:

```text
targetResponseFile → [sequenceResponseFile, ...]
```

Va usato dalle operazioni di cancellazione e dai test. Il calcolo è locale all'endpoint e il
numero di response è ridotto: non serve persistere un indice globale.

Se un file sequence non è leggibile durante un'operazione distruttiva, la cancellazione viene
interrotta: non si elimina un target quando non è possibile dimostrare che sia privo di
riferimenti.

### 8.2 Cancellazione

- cancellare una response usata da almeno una sequence restituisce `409 Conflict` con dettagli
  strutturati, per esempio `{ referencedBy: ["003.response.json"] }`;
- cancellare una response sequence è consentito se essa non è a sua volta referenziata; per
  definizione valida non può esserlo;
- se la sequence cancellata era selezionata, si applica la regola esistente della response
  precedente;
- la response di fallback può essere normale oppure un'altra sequence; in entrambi i casi la
  riconciliazione runtime applica il comportamento corretto e parte da stato vergine.

Non si modificano automaticamente gli step: produrrebbe una sequence diversa senza una scelta
esplicita dell'utente.

### 8.3 Clone di response

Clonare una response sequence nello stesso endpoint copia soltanto il file sequence; gli step
continuano a riferire le stesse response locali. Il clone viene selezionato e, avendo filename
diverso, parte dal primo step.

### 8.4 Copia di endpoint

Con `copyResponses: true` si copiano tutte le response e gli asset, come oggi.

Con `copyResponses: false`:

- selezionata non-sequence: si copia soltanto quella response e il suo asset;
- selezionata sequence: si calcola la chiusura minima composta dal file sequence e da tutti i
  file distinti referenziati dagli step;
- si preserva l'ordine relativo originale di `responseFiles` filtrando l'elenco sorgente;
- si copiano gli asset file/handler degli step, deduplicando gli asset condivisi;
- `selectedResponseFile` del duplicato resta il file sequence.

Poiché le sequence annidate sono vietate, la chiusura è di un solo livello e non richiede un
algoritmo ricorsivo.

## 9. UI definitiva

### 9.1 Modello di interazione

La sequence entra nel normale selettore delle response. Non esiste più il toggle attiva/spenta:

- selezionare una response sequence la attiva;
- selezionare una response diversa la disattiva;
- il badge `SEQ` significa che la response selezionata ha tipo `sequence`;
- il pulsante “Sequenza” modifica la sequence corrente quando è selezionata, altrimenti apre
  la creazione di una nuova sequence;
- il menu “Aggiungi response” contiene anche “Sequence” e apre sempre la modalità creazione.

La creazione usa una bozza locale: `Annulla` non scrive file; `Salva` chiama il `POST`, crea la
variante e la seleziona.

### 9.2 Dialog

Il dialog riceve dati espliciti:

```ts
{ detail, mode: 'create' | 'edit', responseFileName?: string }
```

In modalità edit inizializza la bozza da `detail.sequence`, non da
`detail.endpoint.sequence`, e salva il filename indicato con `PUT /responses/:file`.

Le opzioni degli step sono **soltanto** summary con:

```ts
response.type === 'mock' || response.type === 'handler'
```

Non usare più il filtro negativo `type !== 'middleware'`, che include accidentalmente SSE e
WS.

Il controllo “servono almeno due varianti” si applica alla modalità create; non deve
disabilitare la modalità edit di una configurazione valida già esistente che riusa lo stesso
target.

Ogni riga non terminale deve avere il proprio selettore di criterio (`times` o `forMs`) e il
proprio valore. Il toggle globale viene rimosso: una sequence mista caricata da file deve poter
essere visualizzata e salvata senza trasformare silenziosamente tutti gli step nello stesso
criterio.

Il dialog contiene inoltre:

- titolo della response;
- `onEnd` stay/loop;
- `resetAfterMs`, vuoto = mai e `30000` proposto soltanto in creazione;
- riordino, aggiunta e cancellazione step;
- validazione inline coerente con il backend;
- snapshot dello stato e reset soltanto in edit della sequence attualmente selezionata;
- polling ogni secondo dello state endpoint, senza richieste sovrapposte e interrotto alla
  distruzione del dialog;
- messaggio chiaro se durante l'apertura cambia la response selezionata.

Il polling aggiorna solo lo stato runtime, mai la bozza. Dopo una modifica non salvata non si
evidenzia una riga come corrente, perché il cursore appartiene ancora alla definizione salvata.

### 9.3 Dettaglio e catalogo

In `mocks-next-detail.ts`:

- `responseEditable()` restituisce false per `sequence`;
- il form body/source generico non viene mai inizializzato per una sequence;
- quando `d.type === 'sequence'`, l'area body mostra un riepilogo degli step e un pulsante
  “Modifica sequence”, non il JSON grezzo;
- aggiungere la voce Sequence al menu response;
- la cancellazione referenziata mostra il messaggio del `409` senza chiudere il contesto.

In store, catalogo e pagina:

- estendere `TypeFilter` e le opzioni col nuovo tipo;
- aggiungere un token colore `--type-sequence` e i mapping visuali; non affidarsi al fallback
  mock;
- aggiornare label, icone e i18n italiana/inglese;
- mantenere distinti `MockType`, `EndpointCreatableType` (`mock|handler|middleware`) e
  `GenericResponseDraftType` (`mock|handler|middleware`).

`ResponseDraft` e `MocksNextResponseForm` non devono conoscere la configurazione sequence.

## 10. Moduli da modificare

### Backend/runtime

- `src/mocks/sequence-config.js`
- `src/mocks/sequence-state.js`
- `src/mocks/endpoint-loader.js`
- `src/mocks/mock-registry.js`
- `src/mocks/local-route-groups.js`, solo se ospita l'helper di estrazione delle sequence attive
- `src/server.js`

### Admin

- `src/admin/endpoint-files.js`
- `src/admin/endpoint-operations.js`
- `src/admin/mock-catalog.js`
- `src/admin/admin-api.js`
- `src/admin/admin-fs.js`, per propagare e validare l'esito del reload
- `src/admin/admin-errors.js` non richiede modifiche: supporta già `details`

In `endpoint-files.js`, la lettura di una response sequence deve ricevere anche il contesto
dell'endpoint. L'attuale `readEndpointResponse(responseFilePath)` non possiede
`responseFiles`, quindi non può validare i riferimenti da sola. Aggiornare le firme dei
chiamanti oppure separare chiaramente:

- normalizzazione strutturale del singolo file;
- validazione contestuale/grafo rispetto all'endpoint.

Non duplicare le regole tra loader e admin.

### UI

- `mockxy-ui/src/app/mock-admin-api.types.ts`
- `mockxy-ui/src/app/mock-admin-api.service.ts`
- `mockxy-ui/src/app/pages/mocks-next/mocks-next.store.ts`
- `mockxy-ui/src/app/pages/mocks-next/detail/mocks-next-detail.ts`
- `mockxy-ui/src/app/pages/mocks-next/sequence/mocks-next-sequence-dialog.ts`
- catalogo, pagina, stili e file i18n
- relativi test `.spec.ts`

### Contratto e documentazione

- `docs/admin-api.openapi.yaml`
- `docs/progetto/DESIGN-SEQUENZE.md`
- `docs/it/ENDPOINT.md`, `docs/en/ENDPOINT.md`
- `docs/it/RESPONSE.md`, `docs/en/RESPONSE.md`
- `docs/it/ADMIN-API.md`, `docs/en/ADMIN-API.md`
- `docs/it/CATALOGO.md`, `docs/en/CATALOGO.md`
- README e fixture che mostrano le sequence

Il monitor mantiene la forma `sequenceStep` già esistente; cambia soltanto il vocabolario
della documentazione da “sequence dell'endpoint” a “response sequence selezionata”.

## 11. Rottura del formato e migrazione

Il rilascio non deve leggere entrambi i modelli. In runtime e admin:

- `endpoint.sequence` produce un errore esplicito;
- `PUT /mocks/:id` con `{ sequence }` produce `400`;
- tutte le nuove scritture usano esclusivamente response `type: "sequence"`.

Per conservare workspace esistenti si può fornire un comando una tantum, separato dal loader,
con `--dry-run` e backup. Per ogni endpoint legacy:

1. normalizza la vecchia definizione;
2. sceglie il prossimo filename libero;
3. crea la response sequence rimuovendo `enabled`;
4. aggiunge il file a `responseFiles`;
5. se `enabled !== false`, seleziona il nuovo file; altrimenti conserva la selezione corrente;
6. rimuove `endpoint.sequence`;
7. valida il grafo finale prima della sostituzione atomica;
8. alla seconda esecuzione, non trova campi legacy e non modifica nulla.

Il migratore non è compatibilità runtime: trasforma definitivamente i dati nel nuovo formato.
Se non viene implementato, la stessa procedura deve almeno essere documentata e il loader deve
comunque rifiutare il campo legacy, per evitare una disattivazione silenziosa delle sequence.

## 12. Ordine di implementazione e gate

### Fase 1 — Modello e runtime

1. nuovo normalizzatore e firma con filename;
2. loader della response sequence e risoluzione step condivisa;
3. route runtime e serving;
4. riconciliazione cursore/handler ai reload;
5. rifiuto esplicito del formato legacy.

**Gate:** test config, state, loader, serving e watch verdi; due sequence identiche nello stesso
endpoint non condividono il cursore.

### Fase 2 — Admin e persistenza

1. lettori e summary sequence;
2. create/update/select/reset/state;
3. validazione completa del grafo prima del successo;
4. indice riferimenti e cancellazione `409`;
5. clone e copia endpoint con chiusura minima;
6. OpenAPI aggiornato insieme al contratto.

**Gate:** nessuna mutazione sequence restituisce `2xx` lasciando il registry sulla route
precedente; una mutazione arrivata durante un reload attende il giro accodato; rollback
verificato su handler/asset rotto e su `loadErrors` del file interessato.

### Fase 3 — UI

1. tipi e service;
2. dialog create/edit per-step;
3. selettore, riepilogo dettaglio e reset/polling;
4. menu, filtri, colori, badge e i18n;
5. protezione dei flussi endpoint/form generico dal nuovo membro di `MockType`.

**Gate:** build TypeScript, test component/store/service e controlli AXE verdi; annullare la
creazione non lascia file.

### Fase 4 — Migrazione, E2E e documentazione

1. eventuale migratore una tantum;
2. aggiornamento fixture e documenti;
3. E2E su creazione, selezione, avanzamento, reset, disattivazione e cancellazione protetta;
4. suite completa backend/frontend/E2E.

**Gate finale:** i criteri della sezione seguente sono tutti dimostrati da test automatici.

## 13. Matrice minima di test

### Configurazione e loader

- default `onEnd: stay` e `resetAfterMs: null` nell'API;
- rifiuto di `enabled`, `endpoint.sequence`, un solo step, criteri invalidi e riferimenti fuori
  da `responseFiles`;
- rifiuto di step sequence/middleware/SSE/WS;
- step mock file-backed e handler caricati realmente;
- file/asset/sorgente mancanti degradano l'endpoint al reload manuale.

### Stato runtime

- `times`, `forMs`, stay, loop e reset per inattività invariati;
- sequence selezionata: `A, A, B, B...`;
- response normale selezionata: risposta stabile;
- A → B, sequence A → sequence B, sequence → mock → stessa sequence: reset corretto;
- riselezione identica, edit titolo e reload estraneo: stato conservato;
- edit definizione e disable/enable: stato resettato;
- modifica di body/sorgente di uno step: cursore conservato;
- reload invalido con graft della route precedente: route e stato precedenti conservati;
- endpoint diversi e client concorrenti condividono solo il cursore previsto per endpoint.

### Admin CRUD

- create, clone, update e selezione sequence;
- edit di una sequence non selezionata tramite filename senza attivarla;
- stato presente solo quando il tipo selezionato è sequence;
- reset e state endpoint su tipo non-sequence restituiscono `400`;
- broken handler, asset mancante e step di tipo errato rifiutano la mutazione e ripristinano i
  file;
- una mutazione concorrente con un reload non risponde prima che il proprio giro sia applicato;
- un `loadError` del file mutato produce rollback anche se il runtime ha innestato la route
  precedente;
- target referenziato non cancellabile, con elenco delle sequence dipendenti;
- cancellazione della sequence selezionata sceglie il fallback previsto;
- copia parziale include tutti e soli gli step/asset necessari;
- copia completa conserva anche sequence non selezionate;
- il vecchio `PUT { sequence }` e il campo endpoint legacy vengono rifiutati.

### UI ed E2E

- dialog create: cancel no-op, save crea e seleziona;
- dialog edit salva il file sequence corretto;
- sequence mista `times`/`forMs` fa round-trip senza perdita;
- solo mock/handler compaiono negli step;
- selezionare una response normale rimuove badge e polling sequence;
- filtro catalogo e colore sequence corretti;
- il nuovo `MockType` non appare nel dialog di creazione endpoint né nel form generico;
- reset aggiorna immediatamente lo stato e il polling viene cancellato alla chiusura;
- flusso completo: crea A/B, crea sequence, osserva A/A/B, seleziona A, osserva A stabile.

## 14. Criteri di accettazione

L'implementazione è completa quando sono vere tutte queste condizioni:

1. un endpoint non contiene più alcuna configurazione sequence;
2. la selezione di una response è l'unico selettore del comportamento;
3. più response sequence possono convivere nello stesso endpoint senza condividere stato;
4. nessuna operazione admin può salvare con successo una sequence non servibile;
5. non si può cancellare o omettere in copia un target necessario;
6. il dialog rappresenta senza perdita ogni configurazione ammessa dal backend;
7. un reload invalido mantiene insieme route e cursore precedenti;
8. runtime, Admin API, OpenAPI, UI e documentazione descrivono lo stesso modello;
9. il formato legacy fallisce in modo esplicito, mai silenzioso.

## 15. Valutazione finale

La proposta non è una cattiva idea né un vicolo cieco: è coerente con il catalogo a varianti e
abilita più scenari alternativi sullo stesso endpoint senza aggiungere altri flag speciali.
Il motore del cursore è già adatto; il lavoro aggiuntivo necessario riguarda soprattutto
identità dello stato e integrità referenziale.

La stima realistica resta nell'ordine di **6–10 giornate** per un'implementazione completa con
backend, UI, test, E2E e documentazione. L'assenza dell'adapter legacy riduce la complessità,
mentre la validazione condivisa, la copia sicura e l'editor per-step sono requisiti da non
tagliare: sono precisamente ciò che evita di scoprire a posteriori configurazioni accettate ma
non realmente eseguibili.
