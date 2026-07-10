# Documentazione di dettaglio

Approfondimenti per feature, complementari al [README](../../README.it.md) principale (che resta la
panoramica e l'avvio rapido). Il piano che ha prodotto queste pagine è completato e archiviato
([archived/PIANO-DOCS.md](../../archived/PIANO-DOCS.md)); regola viva: ogni feature nuova o
comportamento cambiato aggiorna la pagina pertinente nello stesso giro del codice.

## Pagine

- [Anatomia di un workspace](WORKSPACE.md) — la struttura della cartella: parte condivisa
  (mock, file dati, segnaposto) e parte locale (impostazioni, traffico catturato), ciclo di
  vita, cosa condividere con il team.
- [Il file endpoint](ENDPOINT.md) — il JSON che dichiara ogni endpoint mockato: nome e
  posizione, campi, varianti e variante selezionata, validazione, degradazione per-endpoint e
  ricarica a caldo.
- [Il file di risposta](RESPONSE.md) — le varianti: risposte statiche (status, header, body
  JSON o testuale, payload da file in streaming, ritardo), handler e middleware come
  collegamenti a script, validazione della sola variante selezionata.
- [La convenzione dei path](PATH.md) — come viene scelto l'endpoint che risponde: parametri
  nominati, query dichiarata (uguaglianza esatta), regole di specificità, verifica del metodo
  dopo la scelta della rotta e diagnosi dei mancati match.
- [Liste: filtri e paginazione](LISTE.md) — i comportamenti automatici sui body lista: filtri
  di uguaglianza dai parametri di query (AND/OR, confronto come stringhe, case-insensitivity
  configurabile), paginazione con `page`/`size` e l'header `X-Total-Count`.
- [I ritardi simulati](RITARDI.md) — latenza per variante, globale ed estesa al proxy: regole
  di precedenza, cosa non riceve ritardi e dove si configura ciascun livello.
- [Gli handler](HANDLER.md) — risposte calcolate da script locali: il contratto di
  `resolveResponse`, il contesto ricevuto (parametri, query, header, body in tre forme,
  `data()`), il formato del risultato, errori, timeout e limiti.
- [I middleware proxy](MIDDLEWARE.md) — trasformare le risposte del backend reale: il
  contratto di `transformResponse`, header fusi sopra quelli del backend, i casi di bypass
  (stream, oltre 10 MB) e il fail-open sugli errori.
- [I file dati e `data()`](DATI.md) — i dataset JSON riusabili: contratto su disco (nomi
  canonici, cartella piatta), semantica di rilettura e copia per chiamata, la pagina Dati
  (upload, rinomina sicura con riscrittura dei riferimenti), limiti di dimensione.
- [Il proxy fallback](PROXY.md) — la decisione mock/proxy richiesta per richiesta, cosa viene
  inoltrato al backend, errori e semantica del timeout (fino ai primi header), e la tassonomia
  completa dell'header `x-mock-source`.
- [Il CORS automatico](CORS.md) — quando serve (frontend browser su un'altra origin), la
  policy a eco che vince su mock catturati e risposte proxate, i preflight automatici e la
  precedenza dei mock `OPTIONS`.
- [L'adattamento dei cookie proxati](COOKIE.md) — perché i `Set-Cookie` del backend vanno
  adattati (Domain, Secure, SameSite=None), come funziona una sessione attraverso Mockxy e i
  limiti che restano (site diversi su http).
- [La riscrittura dei redirect proxati](REDIRECT.md) — i `Location` assoluti verso il backend
  riportati sull'indirizzo di Mockxy; relativi e host terzi intatti.
- [WebSocket e upgrade](WEBSOCKET.md) — passthrough puro verso il backend: handshake
  inoltrato, tunnel senza timeout di inattività, rifiuti onesti (501 senza backend, 404 in
  solo-mock).
- [Esposizione in rete](RETE.md) — loopback di default e perché, come esporre (env, dialog,
  Docker), la difesa anti DNS rebinding dell'admin API e il promemoria per il caso LAN.
- [Il catalogo dei mock](CATALOGO.md) — la vista di lavoro: collezioni annidate e le loro
  semantiche (eliminazione che non tocca i mock, abilitazione in massa), creazione/copia/
  modifica degli endpoint, varianti ed editor con validazioni, upload di file binari.
- [Il monitor](MONITOR.md) — la cattura del traffico: cosa viene registrato e cosa è escluso,
  mascheramento dei segreti e limiti di cattura, filtri della pagina e il travaso da traffico
  a mock (scheletri inclusi).
- [Lo storico dump](STORICO.md) — la memoria persistente del monitor: accensione a runtime,
  NDJSON con rotazione per sessione e dimensione, retention col tetto totale, creazione di
  mock in blocco dagli archivi.
- [I controlli globali](CONTROLLI.md) — due interruttori, tre modalità (attivo, proxy totale,
  server spento come puro proxy): cosa resta acceso in ciascuna e perché lo stato non è
  persistito.
- [L'import da OpenAPI](OPENAPI.md) — la base da ritoccare: formati accettati, cosa viene
  generato (path, status, body da esempi o campionato), gli esistenti mai toccati, anteprima
  dry-run e la difesa anti-CSRF sull'endpoint.
- [La lingua dell'interfaccia](LINGUA.md) — italiano e inglese: dove vive la scelta nel
  browser e nell'app desktop, dialoghi nativi inclusi.
- [L'admin API](ADMIN-API.md) — il riferimento completo delle rotte sotto `/_admin/api`
  (catalogo, varianti, collezioni, import, file dati, monitor, stato del server), con le
  convenzioni su id, errori, ricarica del runtime e le difese anti-CSRF.
- [L'app desktop](DESKTOP.md) — più workspace in parallelo con un motore ciascuno, la barra a
  schede, le porte stabili, la dialog delle impostazioni (titolo condiviso, resto locale),
  preferenze portable e compilazione.
- [Le vie di deployment](DEPLOYMENT.md) — esecuzione diretta, Docker di sviluppo (workspace
  montato dal filesystem) e immagine standalone (solo motore, bind mount in sola lettura), con
  la bussola per scegliere.

## Guide

- [Gli scenari d'uso](SCENARI.md) — i percorsi passo-passo dietro al design proxy+cattura:
  staging resettato, contratto avanti al backend, confine mock/reale che si sposta, il caso
  difficile da riprodurre.
- [Collegare il frontend](FRONTEND.md) — proxy del dev server o chiamata diretta cross-origin:
  cosa serve per ciascuna strada e come verificare che tutto passi da Mockxy.
- [Risoluzione dei problemi](TROUBLESHOOTING.md) — sintomo per sintomo, area per area, con la
  cassetta degli attrezzi (`x-mock-source`, monitor, log) e i rimandi alle pagine.
- [Configurazioni](CONFIGURAZIONI.md) — censimento completo: ogni opzione del motore, la
  variabile d'ambiente corrispondente, il default e la presenza nella dialog di workspace.

## Per chi sviluppa Mockxy

Le pagine qui sopra sono per chi **usa** Mockxy. Chi lavora **sul suo codice** trova il resto in
due cartelle tematiche:

- [`sviluppo/`](../sviluppo/) — [risoluzione dei problemi di sviluppo](../sviluppo/TROUBLESHOOTING-DEV.md)
  (ambiente, test, build — es. il crash del watcher coi percorsi corti 8.3 su Windows), la
  [nota di architettura dei server e2e](../sviluppo/E2E-ARCHITETTURA-SERVER.md) e le due analisi
  tecniche aperte ([concorrenza delle mutazioni admin](../sviluppo/CONCORRENZA-ADMIN.md),
  [contratto del workspace duplicato admin/loader](../sviluppo/CONTRATTO-ADMIN-LOADER.md)).
- [`progetto/`](../progetto/) — i documenti di lavoro vivi: [backlog di prodotto](../progetto/BACKLOG-PRODOTTO.md),
  [idee future](../progetto/IDEE-FUTURE.md), [TODO](../progetto/TODO.md) e la
  [checklist di pubblicazione](../progetto/PUBBLICAZIONE.md).
