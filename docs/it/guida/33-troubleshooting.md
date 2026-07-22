# 33 — Quando qualcosa non va: troubleshooting

La diagnosi in Mockxy usa sempre gli stessi tre strumenti, in quest'ordine:

1. **`x-mock-source`** sulla risposta — *chi* ha risposto davvero
   ([la tassonomia](26-proxy-fallback.md));
2. il **monitor** — *cosa* è arrivato e cosa è stato deciso
   ([capitolo 20](20-monitor.md));
3. il **log del server** — gli errori, con il file incriminato: il terminale in headless, la
   cartella `logs/` nell'app desktop ([capitolo 28](28-desktop-workspace.md)).

Quasi ogni sintomo si risolve senza andare oltre il primo o il secondo passo. Qui sotto, i
casi ricorrenti per area, in forma sintomo → diagnosi → rimedio.

## Il mock non risponde

- **La richiesta arriva al backend (o al 404) invece che al mock.** In solo-mock il body del
  404 dice già tutto: `path_not_mocked` = nessuna rotta combacia — occhio ai prefissi
  (`/api` di troppo o in meno) e al fatto che il match copre l'intero percorso;
  `method_not_mocked` = la rotta c'è ma non definisce quel metodo, e **non** si ripiega su
  rotte meno specifiche ([capitolo 7](07-creare-endpoint.md)). Con il fallback attivo, la
  stessa diagnosi si fa dal monitor: provenienza «backend» dove ci si aspettava «mock».
- **L'endpoint ha una query dichiarata nel path.** La query dichiarata pretende
  l'uguaglianza esatta dell'*intera* query: un parametro in più — `page`, `size`, un filtro
  — la esclude, e la richiesta scivola sulla gemella senza query o al fallback
  ([capitolo 7](07-creare-endpoint.md)).
- **Risponde, ma con la variante sbagliata.** Conta solo la variante **selezionata**; e se
  l'endpoint ha una **sequenza attiva**, comanda la sequenza, non la selezione — il badge
  SEQ nel catalogo lo segnala ([capitolo 12](12-sequenze.md)).
- **L'endpoint è sparito dopo una modifica a mano.** Un file invalido non ferma il server:
  l'endpoint viene saltato con un warning nel log, o mantiene l'ultima versione valida alla
  ricarica. Anche un **duplicato** metodo+percorso in un'altra cartella viene scartato e
  segnalato ([capitolo 24](24-mock-come-file.md)).
- **«Era acceso, giuro».** L'interruttore di una collection scrive lo stato **in massa** sul
  sottoalbero: riaccendere la collection riaccende anche ciò che era stato spento
  singolarmente ([capitolo 6](06-catalogo.md)). E il **proxy totale** dimenticato acceso
  bypassa tutti i mock — la runtime bar lo mostra ([capitolo 5](05-tour-interfaccia.md)).

## Filtri e paginazione

- **Il filtro non filtra.** Il *nome* del parametro deve coincidere con la chiave di primo
  livello in modo esatto (è il *valore* a essere case-insensitive), e la chiave deve avere
  valori scalari ([capitolo 11](11-liste-paginazione-filtri.md)).
- **La paginazione non si attiva.** Servono **entrambi** `page` e `size`, validi; e il body
  dev'essere un array, o un oggetto con un solo array di primo livello.
- **`X-Total-Count` non è quello dichiarato nel mock.** Con gli automatismi attivi vince
  sempre il valore calcolato.

## Errori dal proxy

- **`501 Backend Not Configured`** — serviva il backend ma `BACKEND_URL` non è impostato:
  configurarlo, o passare consapevolmente in solo-mock
  ([capitolo 26](26-proxy-fallback.md)).
- **`502 Bad Gateway`** — backend irraggiungibile, **oppure** timeout: il timeout copre solo
  fino ai primi header di risposta. Un backend morto a metà stream si manifesta come errore
  di rete lato client, non come 502.

## Handler e middleware

- **`500 Handler Execution Failed`** — eccezione o risultato invalido nello script: stack e
  file sono nel log ([capitolo 15](15-handler.md)). Un classico: `data is not defined` — a
  `resolveResponse` manca `data` tra i campi destrutturati del contesto.
- **`504 Handler Timeout`** — quasi sempre una promise che non risolve (una fetch senza
  timeout); il file è nel log.
- **`413 Payload Too Large`** — il body della richiesta supera i 2 MB: lo script non viene
  nemmeno eseguito.
- **Il middleware non trasforma.** Tre possibilità, tutte leggibili da `x-mock-source`:
  risposta oltre 10 MB o stream (`backend`, con avviso nel log); middleware fallito —
  fail-open, passa l'originale (`backend`, errore nel log); proxy totale attivo (i
  middleware non intervengono affatto). [Capitolo 16](16-middleware.md).

## CORS, cookie e redirect

- **Errore CORS in console.** Il frontend chiama Mockxy da un'altra origin e il CORS
  automatico è spento: attivarlo — o, meglio, passare dal proxy del dev server, dove il
  problema non esiste ([capitoli 4 e 27](04-collegare-frontend.md)).
- **Ho spento il CORS ma il browser "funziona" ancora.** I preflight restano in cache fino a
  10 minuti.
- **Il login non tiene.** Il login deve **passare da Mockxy**, il frontend deve inviare le
  credenziali (`credentials: 'include'` / `withCredentials`), e l'adattamento dei cookie
  dev'essere attivo. Cross-site su http i cookie non viaggiano comunque: lì si usa il token
  ([capitolo 27](27-topologia-proxy.md)).
- **Dopo un redirect l'app parla col backend diretto.** La riscrittura dei redirect è stata
  disattivata, o il `Location` punta a un host terzo — che passa intatto di proposito
  ([capitolo 27](27-topologia-proxy.md)).

## Monitor e storico

- **Il monitor è vuoto.** Il server è spento (il proxy totale registra, il server spento
  no); oppure si sta guardando traffico che il monitor esclude di proposito: admin/UI,
  preflight, upgrade WebSocket ([capitolo 20](20-monitor.md)). Se non compare *una specifica
  chiamata dell'app*, quella chiamata non sta passando da Mockxy: base URL o regola di proxy
  ([capitolo 4](04-collegare-frontend.md)).
- **Lo storico non scrive.** La scrittura su disco è opt-in: va accesa dall'interruttore
  Dump ([capitolo 22](22-storico-dump.md)).

## Ricarica e ambienti

- **Le modifiche ai file non vengono ricaricate.** Dove gli eventi del filesystem non
  arrivano (Docker con volumi montati, cartelle di rete) serve il polling:
  `CHOKIDAR_USEPOLLING=true` ([capitolo 31](31-headless-docker.md)).
- **`data()` fallisce.** Il messaggio elenca i file disponibili; occhio al nome canonico
  minuscolo e, fuori dal desktop, a `FILES_DIR` ([capitolo 17](17-pagina-dati.md)).
- **App desktop: porta rifiutata.** Il cambio esplicito verso una porta occupata non viene
  applicato; all'avvio, invece, il motore ripiega da solo su una porta libera
  ([capitolo 28](28-desktop-workspace.md)).

> 📷 **SCREENSHOT** — `33-diagnosi-monitor.png`
> Cosa mostrare: il monitor usato in diagnosi — una richiesta con provenienza inattesa
> («backend» dove ci si aspettava «mock») aperta nel dettaglio, con il percorso davvero
> chiamato in evidenza. Può riusare materiale del capitolo 26 se equivalente.

Restano le pagine di pura consultazione — scorciatoie, glossario e l'indice «dove si fa
cosa»: le [appendici](34-appendici.md).
