# L'admin API — riferimento

Tutta l'interfaccia di Mockxy è costruita sull'**admin API** sotto `/_admin/api`: non esiste
un'operazione della UI che non passi da qui. La conseguenza utile è che **tutto ciò che fa
l'interfaccia è automatizzabile** — script di setup che popolano un workspace, suite e2e che
resettano lo stato tra i test, pipeline che importano una specifica aggiornata.

## Quando risponde e come si protegge

- Attiva con `ADMIN_API_ENABLED` (default: attiva in sviluppo, spenta in produzione). Da
  spenta, ogni rotta risponde `404` con un messaggio esplicito.
- **Niente autenticazione**: crea handler, cioè scrive file ed esegue codice. Le protezioni e
  le regole di esposizione sono nella pagina sull'[esposizione in rete](RETE.md) (guardia
  anti DNS rebinding sull'header `Host`, avviso su bind non-loopback).
- Le mutazioni accettano solo **JSON esplicito**: è anche la difesa anti-CSRF — una richiesta
  cross-origin con `content-type: application/json` scatena il preflight del browser e muore
  lì. L'unica eccezione strutturale è l'import OpenAPI, che accetta YAML ma **rifiuta
  `text/plain` con `415`** proprio per non aprire la falla delle richieste "semplici".

## Convenzioni

- **`:id`** degli endpoint è il percorso relativo del file endpoint codificato base64url: si
  ottiene dalle liste e si tratta come **opaco**.
- Gli **errori** sono JSON `{ error, message, details? }` con lo status appropriato
  (`400` input invalido, `404` non trovato, `415` media type, `500`).
- Le mutazioni sul catalogo **ricaricano il runtime immediatamente**: la modifica è servita
  dalla richiesta successiva, senza riavvii. I file dati non ricaricano nulla ([`data()`
  rilegge a ogni chiamata](DATI.md)), con un'eccezione: la rinomina con riscrittura dei
  riferimenti ricarica, perché ha toccato i sorgenti degli handler.

## Catalogo ed endpoint

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /mocks` | l'intero catalogo: endpoint, collezioni e ordinamenti; ogni endpoint espone anche `sequenceActive` per il badge SEQ. Un file endpoint illeggibile (JSON invalido, variante selezionata mancante) non fa fallire la richiesta: quell'endpoint viene saltato e segnalato in `loadErrors` (`[{ configFilePath, message }]`), come fa il runtime al caricamento |
| `GET /mocks/resolve?method&path` | l'endpoint che oggi coprirebbe una richiesta concreta (path con eventuale query), disabilitati inclusi; `{ mock: null }` se nessuno. Fatto derivato col matching del serving, usato dal monitor per "vai al mock" |
| `POST /mocks` | crea un endpoint (mock statico, o handler/middleware con sorgente); se per rotta+metodo esiste già risponde `409` con `details.existingMockId`, così il client può proporre l'aggiunta di una variante a quell'endpoint |
| `GET /mocks/:id` | dettaglio di un endpoint con le sue varianti: `endpoint.sequence` e `sequenceState`, flag `templated` dei mock e configurazioni normalizzate `sse`/`ws` della variante selezionata |
| `PUT /mocks/:id` | aggiorna la definizione (inclusi `enabled`, variante selezionata e — con body `{ sequence }`, `null` per rimuoverla — la [sequenza di varianti](ENDPOINT.md)) |
| `POST /mocks/:id/sequence/reset` | azzera il cursore della sequenza: la prossima richiesta riparte dal primo step. Risponde con lo stato azzerato (`sequenceState`) |
| `POST /mocks/:id/sse/push` | push manuale della console [SSE](RESPONSE.md): body `{ data, event?, id? }`, broadcast a tutte le connessioni aperte — risponde `{ delivered, connections }` |
| `GET /mocks/:id/sse/connections` | stato della console SSE: connessioni aperte (con posizione nel copione) e storico dei messaggi usciti |
| `POST /mocks/:id/ws/push` | push manuale della console [WS](RESPONSE.md): body `{ data }`, broadcast a tutte le connessioni aperte — risponde `{ delivered, connections }` |
| `GET /mocks/:id/ws/connections` | stato della console WS: connessioni aperte (con posizione nel copione) e transcript bidirezionale (usciti e ricevuti) |
| `PUT /mocks/:id/endpoint` | aggiorna metodo, percorso, descrizione |
| `POST /mocks/:id/copy` | duplica su nuovo metodo+percorso — body `{ method, path, copyResponses }` |
| `PUT /mocks/:id/collection` | assegna l'endpoint a una collezione |
| `DELETE /mocks/:id` | elimina endpoint e varianti |

## Varianti di risposta

| Metodo e percorso | Cosa fa |
|---|---|
| `POST /mocks/:id/responses` | aggiunge una variante di tipo `mock`, `handler`, `middleware`, `sse` o `ws`; a parità di tipo clona la selezionata, altrimenti usa i default del tipo richiesto |
| `PUT /mocks/:id/responses/:file` | aggiorna una variante, inclusi `templated` per i mock e copione/regole/preset per SSE e WebSocket |
| `PUT /mocks/:id/responses/:file/file` | carica i byte grezzi che rendono la variante [file-backed](RESPONSE.md) — body `application/octet-stream` (fino a 12 MB), MIME e nome in query (`?contentType=…&filename=…`) |
| `DELETE /mocks/:id/responses/:file` | elimina una variante |

## Collezioni

| Metodo e percorso | Cosa fa |
|---|---|
| `POST /mocks/collections` | crea una collezione (anche annidata) |
| `PATCH /mocks/collections/order` | riordina le collezioni radice |
| `PATCH /mocks/collections/:id/parent` | sposta una collezione nell'albero |
| `PATCH /mocks/collections/:id/items/order` | riordina gli endpoint di una collezione |
| `PATCH /mocks/collections/:key/children/order` | riordina le sottocollezioni |
| `PATCH /mocks/collections/:id/enabled` | abilita/disabilita **in massa** il sottoalbero ([semantica](CATALOGO.md)) |
| `DELETE /mocks/collections/:id` | **dissolve** il sottoalbero; gli endpoint tornano in Unsorted |
| `DELETE /mocks/collections/:id/contents` | elimina definitivamente il sottoalbero e tutti gli endpoint contenuti; con `id=unsorted` elimina tutti e soli gli endpoint non assegnati — risposta `{ deleted }` |

## Import OpenAPI

| Metodo e percorso | Cosa fa |
|---|---|
| `POST /mocks/import/openapi` | importa la specifica (body grezzo JSON/YAML, fino a 12 MB) — [regole di generazione](OPENAPI.md) |
| `POST /mocks/import/openapi?dryRun=true` | solo il piano con i conteggi, senza scrivere nulla |

## File dati

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /files` | elenco con metadati e endpoint che li usano (`usedBy`) |
| `GET /files/:name` | contenuto di un file dati |
| `PUT /files/:name` | crea (`201`) o sostituisce (`200`) — byte grezzi fino a 25 MB, JSON validato prima di scrivere |
| `PATCH /files/:name` | rinomina — body `{ name, rewriteReferences }` ([rinomina sicura](DATI.md)) |
| `DELETE /files/:name` | elimina il file |

## Monitor e storico

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /monitoring/requests` | le voci in RAM, dalla più recente |
| `DELETE /monitoring/requests` | svuota la vista live (gli archivi non sono toccati) |
| `GET /monitoring/requests/stream` | flusso live degli eventi (SSE) |
| `GET /monitoring/dump` | stato della scrittura su disco |
| `PATCH /monitoring/dump` | accende/spegne e regola cadenza/soglia a runtime — body `{ enabled?, intervalMs?, threshold? }` |
| `POST /monitoring/dump/flush` | flush manuale; risponde con il numero di voci scritte |
| `GET /monitoring/dumps` | elenco dei file di dump |
| `GET /monitoring/dumps/read` | lettura paginata a cursore (`?fileIndex&lineIndex&limit`) |
| `POST /monitoring/dumps/create-mocks` | crea mock in blocco da un file o da una selezione di voci |
| `DELETE /monitoring/dumps/:file` | elimina un file di dump |

## Stato del server

| Metodo e percorso | Cosa fa |
|---|---|
| `GET /server` | `{ serverEnabled, proxyAll }` — [le tre modalità](CONTROLLI.md) |
| `PATCH /server` | aggiornamento parziale dei due booleani |

## Esempi

```bash
# il catalogo completo
curl -s http://localhost:3000/_admin/api/mocks

# sospendi i mock: proxy totale verso il backend
curl -s -X PATCH http://localhost:3000/_admin/api/server \
  -H "content-type: application/json" -d '{"proxyAll": true}'

# anteprima di un import OpenAPI senza creare nulla
curl -s -X POST "http://localhost:3000/_admin/api/mocks/import/openapi?dryRun=true" \
  -H "content-type: application/yaml" --data-binary @openapi.yaml

# accendi la scrittura su disco dello storico e forza un flush
curl -s -X PATCH http://localhost:3000/_admin/api/monitoring/dump \
  -H "content-type: application/json" -d '{"enabled": true}'
curl -s -X POST http://localhost:3000/_admin/api/monitoring/dump/flush
```

Per la struttura esatta dei body di creazione e aggiornamento, la fonte più affidabile è
l'interfaccia stessa: ogni sua azione è una chiamata a queste rotte, osservabile dagli
strumenti di sviluppo del browser.
