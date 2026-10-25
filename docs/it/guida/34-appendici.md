# 34 — Appendici

Le pagine di consultazione rapida: le scorciatoie dell'editor, la lingua dell'interfaccia,
il glossario dei termini della guida, e l'indice «dove si fa cosa» per usare la guida come
riferimento a lettura finita.

## Le scorciatoie dell'editor

L'editor di codice (body delle response, script di handler e middleware) offre queste
scorciatoie — l'elenco è consultabile anche dall'app, nella dialog dedicata accanto
all'editor; su macOS si usa ⌘ al posto di Ctrl:

| Funzione | Scorciatoia |
|---|---|
| Cerca e sostituisci | `Ctrl` `F` |
| Completamento (JavaScript) | `Ctrl` `Spazio` |
| Formatta / indenta il documento | `Shift` `Alt` `F` |
| Indenta / riduci indentazione | `Tab` / `Shift` `Tab` |
| Commenta riga | `Ctrl` `/` |
| Annulla / ripeti | `Ctrl` `Z` / `Ctrl` `Y` |
| Comprimi / espandi sezione | `Ctrl` `Shift` `[` / `Ctrl` `Shift` `]` |

Nelle console SSE e WebSocket, `Ctrl` `Invio` nel compositore invia il messaggio.

> 📷 **SCREENSHOT** — `34-dialog-scorciatoie.png`
> Cosa mostrare: la dialog delle scorciatoie dell'editor aperta sopra un editor di codice.

## La lingua dell'interfaccia

L'interfaccia è disponibile in italiano e inglese; si cambia dal selettore nella barra
superiore, con effetto immediato. Dove vive la scelta: nel **browser** (headless) la ricorda
il browser stesso, per ciascuna macchina — al primo accesso segue il locale di sistema;
nell'**app desktop** è una preferenza globale accanto all'eseguibile, vale per tutti i
workspace e copre anche i dialoghi nativi. I log del motore restano in inglese.

## Glossario

| Termine | Significato |
|---|---|
| **Workspace** | la cartella che contiene un intero ambiente di mock: endpoint, file dati, impostazioni locali, traffico catturato ([cap. 2](02-concetti-fondamentali.md), [24](24-mock-come-file.md)) |
| **Endpoint** | un metodo HTTP + percorso mockato, con le sue varianti ([cap. 7](07-creare-endpoint.md)) |
| **Variante / response** | una delle risposte pronte di un endpoint; una sola è **selezionata** e viene servita ([cap. 8](08-scheda-endpoint.md)) |
| **Collection** | il raggruppamento degli endpoint nel catalogo; puro metadato dell'interfaccia ([cap. 6](06-catalogo.md)) |
| **Unsorted** | la collection virtuale degli endpoint non assegnati |
| **Proxy fallback** | l'inoltro al backend reale delle richieste senza mock ([cap. 26](26-proxy-fallback.md)) |
| **Solo-mock** | la modalità con fallback spento (o senza backend): le richieste senza mock ricevono 404 |
| **Proxy totale** | l'interruttore runtime che sospende tutti i mock, con il monitor attivo ([cap. 5](05-tour-interfaccia.md)) |
| **Provenienza** | chi ha prodotto una risposta — i valori di `x-mock-source`, colonna «Servita da» nel monitor |
| **Handler** | script JavaScript locale che calcola la risposta ([cap. 15](15-handler.md)) |
| **Middleware** | script che trasforma la risposta del backend reale proxato ([cap. 16](16-middleware.md)) |
| **File dati** | dataset JSON riusabile della pagina Dati, letto con `data()` ([cap. 17](17-pagina-dati.md)) |
| **Copione** | la scaletta temporizzata dei messaggi di una variante SSE o WS ([cap. 18–19](18-sse.md)) |
| **Sequenza** | la politica che fa servire le varianti in ordine, per richieste o a tempo ([cap. 12](12-sequenze.md)) |
| **Templating** | i placeholder `{{...}}` risolti con valori della richiesta ([cap. 10](10-templating.md)) |
| **Dump / storico** | l'archivio su disco del traffico del monitor ([cap. 22](22-storico-dump.md)) |
| **Skeleton** | un mock creato da una cattura con body non ricostruibile: struttura pronta, body da completare ([cap. 21](21-cattura-mock.md)) |
| **Ricarica a caldo** | la rilettura automatica dei file del workspace alla modifica ([cap. 24](24-mock-come-file.md)) |
| **Degradazione per-endpoint** | un file rotto esclude quell'endpoint, mai l'intero server ([cap. 24](24-mock-come-file.md)) |
| **Admin API** | l'API REST sotto `/_admin/api` su cui è costruita l'interfaccia ([cap. 30](30-admin-api.md)) |

## Dove si fa cosa

| Voglio… | Capitolo |
|---|---|
| installare / avviare Mockxy | [3](03-installazione-avvio.md) |
| collegare il mio frontend | [4](04-collegare-frontend.md) |
| capire gli interruttori globali | [5](05-tour-interfaccia.md) |
| organizzare gli endpoint in cartelle | [6](06-catalogo.md) |
| creare un endpoint / capire perché non matcha | [7](07-creare-endpoint.md) |
| tenere più risposte pronte e cambiarle al volo | [8](08-scheda-endpoint.md) |
| status, header, body, file binari, preset | [9](09-editor-response-mock.md) |
| far eco a parametri della richiesta senza codice | [10](10-templating.md) |
| paginare e filtrare una lista mockata | [11](11-liste-paginazione-filtri.md) |
| una risposta che evolve nel tempo (polling) | [12](12-sequenze.md) |
| duplicare un endpoint | [13](13-copiare-endpoint.md) |
| simulare lentezza e timeout | [14](14-ritardi.md) |
| scrivere logica JavaScript / mock stateful | [15](15-handler.md) |
| ritoccare la risposta del backend vero | [16](16-middleware.md) |
| dataset riusabili con `data()` | [17](17-pagina-dati.md) |
| mockare uno stream SSE | [18](18-sse.md) |
| mockare una WebSocket | [19](19-websocket.md) |
| osservare il traffico / diagnosticare | [20](20-monitor.md), [33](33-troubleshooting.md) |
| trasformare traffico reale in mock | [21](21-cattura-mock.md) |
| archiviare il traffico e catturare dal passato | [22](22-storico-dump.md) |
| generare i mock da una specifica OpenAPI | [23](23-import-openapi.md) |
| versionare i mock in git / modificarli a mano | [24](24-mock-come-file.md) |
| tutte le impostazioni del workspace | [25](25-impostazioni-workspace.md) |
| solo-mock, 404/501/502, timeout | [26](26-proxy-fallback.md) |
| CORS, login che non tiene, redirect | [27](27-topologia-proxy.md) |
| più workspace, preferenze, log errori | [28](28-desktop-workspace.md) |
| esporre Mockxy in LAN | [29](29-rete-sicurezza.md) |
| automatizzare da script e test e2e | [30](30-admin-api.md) |
| variabili d'ambiente, Docker, standalone | [31](31-headless-docker.md) |
| i flussi di lavoro completi | [32](32-scenari.md) |

Fine del percorso. Per la panoramica rapida resta il [README del progetto](../../../README.it.md);
per il dettaglio di riferimento, le pagine in [`docs/it/`](../README.md).
