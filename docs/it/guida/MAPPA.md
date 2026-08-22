# Mappa della guida

Questa è la mappa completa della guida: l'elenco di tutti i capitoli, con la descrizione di
cosa dovrà coprire ciascuno, i contenuti da trattare e gli screenshot previsti. Ogni voce è
scritta per essere comprensibile da sola: leggendo la mappa si deve capire esattamente di che
funzionalità si parla, senza dover andare a decifrare sigle o richiami.

Le convenzioni di scrittura (tono, placeholder screenshot, nomi file) sono nel
[README](README.md). I link a `../NOMEPAGINA.md` puntano alla documentazione di riferimento,
che resta la fonte tecnica da cui attingere per ogni capitolo.

---

## Parte I — Partire

L'obiettivo della prima parte è che il lettore capisca **a cosa serve Mockxy**, lo installi,
lo colleghi alla sua web app e sappia orientarsi nell'interfaccia. Alla fine di questa parte
non ha ancora creato mock "sul serio", ma ha l'app funzionante in mezzo tra il suo frontend e
il backend, e sa leggere quello che vede sullo schermo.

### 01 — Cos'è Mockxy e perché ti serve (`01-cose-mockxy.md`)

Il capitolo di apertura: presenta il problema (sviluppare un frontend quando il backend non
c'è, è instabile, è condiviso, o non produce il caso che ti serve) e l'idea che distingue
Mockxy dagli altri mock server — **non devi mockare tutto**: Mockxy sta in mezzo tra la tua
app e il backend vero, risponde lui solo per gli endpoint che hai deciso di mockare e inoltra
tutto il resto al backend reale, come se non ci fosse. Da qui il concetto di **confine mobile
tra mockato e reale**, che si sposta un endpoint alla volta durante la vita del progetto.

Contenuti:
- Il problema, raccontato con situazioni riconoscibili da chi sviluppa frontend: il backend
  non ancora implementato, lo staging che viene resettato, l'errore 500 impossibile da
  provocare, il lavoro offline (ripresi da [../SCENARI.md](../SCENARI.md) in forma narrativa,
  gli scenari completi passo-passo arrivano nel capitolo 33).
- Come funziona in una figura: il diagramma richiesta → Mockxy → (mock | handler | backend
  reale, con o senza middleware). Introdurre qui, in modo leggero, i quattro modi di
  rispondere che la guida approfondirà: mock statico, handler JavaScript, middleware sul
  proxy, passthrough puro.
- Cosa NON è Mockxy: non è un tool di test automatico, non è un API gateway di produzione —
  aspettative giuste fin da subito.
- I tre modi di eseguirlo (app desktop, server Node, Docker), solo annunciati: la scelta è
  materia del capitolo 3.

Screenshot previsti:
- Vista d'insieme dell'app (catalogo popolato con qualche endpoint realistico) come "copertina".

### 02 — I concetti fondamentali (`02-concetti-fondamentali.md`)

Il vocabolario minimo che tutta la guida userà, spiegato una volta per tutte e bene:
**workspace** (la cartella che contiene tutto: definizioni dei mock, dati, impostazioni),
**endpoint** (metodo + percorso mockato), **variante di risposta** (uno stesso endpoint può
avere più risposte pronte — il caso pieno, la lista vuota, il 500 — e una sola è selezionata),
**collection** (l'organizzazione a cartelle del catalogo), **monitor** (la vista del traffico
reale). E il principio architetturale che rende tutto trasparente: **ogni cosa che
l'interfaccia fa scrive file JSON leggibili su disco**, versionabili in git — interfaccia e
file sono due viste equivalenti sugli stessi dati.

Contenuti:
- Il percorso di una richiesta, passo per passo: come Mockxy decide chi risponde (prima gli
  interruttori globali, poi la ricerca dell'endpoint per percorso e metodo, poi la variante
  selezionata, altrimenti proxy verso il backend o 404 in modalità solo-mock). Versione
  discorsiva di [../PROXY.md](../PROXY.md).
- L'header **`x-mock-source`**: ogni risposta di Mockxy dichiara chi l'ha prodotta (mock,
  handler, middleware, proxy, miss). È lo strumento di debug numero uno e conviene conoscerlo
  dal giorno zero — mostrare come leggerlo dai DevTools del browser.
- La terminologia workspace / endpoint / variante / collection con un esempio concreto di
  cartella alla mano (anteprima di ciò che il capitolo 24 approfondirà).

Screenshot previsti:
- DevTools del browser aperti sulla scheda Network con evidenza dell'header `x-mock-source`
  su una risposta.
- Vista del catalogo con un endpoint espanso che mostra più varianti, per ancorare
  visivamente i termini endpoint/variante.

### 03 — Installare e avviare Mockxy (`03-installazione-avvio.md`)

La guida pratica all'avvio in tutte le forme in cui Mockxy si esegue, con la bussola per
scegliere: **app desktop** portable per Windows (la via consigliata per iniziare: zero
installazione, gestione a schede di più workspace), **server Node** locale, **Docker** di
sviluppo, e un cenno all'immagine **standalone** (solo-mock, senza interfaccia — approfondita
nel capitolo 31). Comprende il primissimo avvio dell'app desktop: la schermata di benvenuto,
l'apertura di una cartella e la **conferma di inizializzazione** quando la cartella non è
ancora un workspace, con la spiegazione di cosa viene creato.

Contenuti:
- App desktop: dove scaricarla, l'avviso SmartScreen al primo avvio (eseguibile non firmato),
  la natura portable (le preferenze viaggiano accanto all'exe).
- Primo avvio: schermata di benvenuto, aprire/inizializzare un workspace, cosa compare su
  disco dopo l'inizializzazione.
- Server Node: requisiti (Node ≥ 24), avvio da riga di comando, le due-tre variabili
  essenziali (`PORT`, `BACKEND_URL`) rimandando il censimento completo al capitolo 31.
- Docker di sviluppo con docker-compose: quando conviene (niente Node locale) e cosa cambia
  (bind, porte mappate).
- Tabella di orientamento "quale via scegliere" (da [../DEPLOYMENT.md](../DEPLOYMENT.md)).

Screenshot previsti:
- Schermata di benvenuto dell'app desktop (nessun workspace aperto).
- Dialog nativa di conferma inizializzazione di una cartella nuova.
- App aperta su un workspace appena inizializzato (catalogo vuoto con l'invito «Workspace
  vuoto — crea il primo mock»).

### 04 — Collegare la tua web app a Mockxy (`04-collegare-frontend.md`)

Il capitolo-ponte con il mondo del lettore: come far sì che la propria applicazione parli con
Mockxy invece che con il backend. Le due strade di [../FRONTEND.md](../FRONTEND.md), spiegate
per esteso: la **strada consigliata** è il proxy del dev server (Angular
`proxy.conf.json`, Vite `server.proxy`, CRA, webpack devServer) — il browser vede un'origin
sola e il CORS non entra mai in gioco; la strada alternativa è chiamare Mockxy direttamente da
un'altra origin, che funziona ma richiede il CORS automatico (capitolo 27). Qui va spesa una
sezione didattica su **cos'è il CORS** in due paragrafi, perché è il primo muro contro cui un
junior sbatte.

Contenuti:
- Lo schema della catena: browser → dev server del frontend → Mockxy → backend reale, e dove
  si configura ogni anello (`BACKEND_URL` su Mockxy, il proxy sul dev server).
- Esempi di configurazione proxy per i dev server più comuni (Angular, Vite), copiabili.
- La strada diretta e quando ha senso (client non-browser, app mobile, Postman), con rimando
  al CORS automatico.
- Verifica del collegamento: una richiesta di prova e la lettura di `x-mock-source` per
  capire da dove è passata.

Screenshot previsti:
- Il monitor che mostra le prime richieste dell'app in transito verso il backend (tutte
  «proxy»): la prova visiva che la catena funziona.

### 05 — Il tour dell'interfaccia (`05-tour-interfaccia.md`)

La visita guidata dell'interfaccia prima di iniziare a lavorarci: la **barra superiore** con il
selettore delle viste (Catalogo, Monitor, Storico, Dati), la **runtime bar** con gli
interruttori e gli indicatori di stato del motore, la barra dei workspace (solo desktop), il
selettore della lingua e il menu dell'ingranaggio (impostazioni workspace / preferenze app).
Il cuore del capitolo sono i **controlli globali**: due interruttori indipendenti — server
attivo/spento e «mock attivi / dritto al backend» (proxy totale) — che producono tre modalità
effettive, con la tabella di cosa fa ciascuna (da [../CONTROLLI.md](../CONTROLLI.md)).

Contenuti:
- Le quattro viste e a cosa serve ciascuna (una frase l'una: i dettagli sono i capitoli
  dedicati). La persistenza dello stato delle viste tra una navigazione e l'altra.
- La runtime bar controllo per controllo: interruttore del server, interruttore proxy totale
  («mock attivi» / «dritto al backend»), indicatore del monitor live (live / in pausa),
  interruttore del dump su disco con il conteggio delle richieste in coda e il pulsante di
  flush immediato (solo introdotti: i dettagli nei capitoli 20 e 22).
- Le tre modalità effettive: Attivo (mock + fallback), Proxy totale (tutto al backend, il
  monitor continua a registrare — la modalità «osserva il backend vero»), Server spento.
  Esempi d'uso di ciascuna.
- Lingua dell'interfaccia (italiano/inglese, effetto immediato) e dove viene ricordata la
  scelta a seconda che si usi browser o app desktop (da [../LINGUA.md](../LINGUA.md)).

Screenshot previsti:
- L'app con annotazioni/frecce sulle aree della barra superiore (viste, runtime bar,
  ingranaggio, lingua).
- La runtime bar in modalità «Proxy totale» (per far vedere come cambia l'indicatore rispetto
  alla modalità normale).

---

## Parte II — Il lavoro quotidiano con i mock

La parte centrale della guida: creare, organizzare e raffinare mock statici dal catalogo. Alla
fine il lettore sa creare un endpoint con più varianti, dargli header e body giusti, simulare
errori e lentezza, sfruttare templating, paginazione automatica e sequenze.

### 06 — Il catalogo dei mock (`06-catalogo.md`)

La vista di lavoro principale: l'elenco di tutti gli endpoint del workspace, organizzato in
**collection** annidabili e riordinabili col trascinamento. Il capitolo copre la struttura
della pagina (albero a sinistra, scheda dell'endpoint selezionato a destra, pannello
ridimensionabile), la ricerca testuale e i **filtri** (per tipo di risposta: mock / handler /
middleware / SSE / WebSocket; per stato: attivi / disattivi), e tutte le azioni sulle
collection: creare, rinominare, spostare su/giù, spostare sotto un'altra collection,
**abilitare/disabilitare tutti** gli endpoint contenuti, **dissolvere** (la collection sparisce
e gli endpoint tornano in Unsorted) ed **eliminare** (spariscono anche gli endpoint, con
conferma che dichiara il conteggio).

Contenuti:
- L'albero: collection, sotto-collection, la collection virtuale **Unsorted** per gli
  endpoint non assegnati; il drag & drop per riordinare e spostare endpoint tra collection.
- La natura delle collection: pura organizzazione dell'interfaccia (file `.collections.json`
  condiviso in git), non tocca i percorsi serviti né le cartelle su disco — importante per
  non temere il riordino.
- Ricerca e filtri combinati; il pulsante «Reimposta filtri» e il messaggio quando nessun
  endpoint corrisponde; espandi/collassa tutte le cartelle.
- La riga endpoint: badge del metodo, percorso, interruttore attivo/disattivo direttamente
  dalla lista, badge «sequenza attiva» quando c'è una sequenza in corso.
- Il piè di pagina con i contatori (endpoint totali, collection, attivi/totali).
- Il pulsante «Ricarica dal disco» e quando serve (modifiche fatte a mano ai file).
- Le azioni distruttive con conferma: eliminare una collection con tutto il contenuto,
  svuotare Unsorted (attenzione: include anche gli endpoint nascosti dai filtri correnti).

Screenshot previsti:
- Catalogo popolato con collection annidate, filtri chiusi: la vista "normale".
- Catalogo con il pannello filtri aperto e un filtro attivo (es. solo Handler), per mostrare
  come cambia la lista.
- Menu contestuale delle azioni di una collection aperto (sposta, dissolvi, elimina, abilita
  tutti…).

### 07 — Creare un endpoint e capire i path (`07-creare-endpoint.md`)

La creazione guidata del primo mock con la dialog **«Nuovo»**: scelta del metodo HTTP, del
percorso, dello status e del body. Metà capitolo è dedicata alla **convenzione dei percorsi**
(da [../PATH.md](../PATH.md)), che è la causa numero uno dei «perché il mio mock non
risponde?»: parametri di percorso (`/api/utenti/:id`), la regola «vince la rotta più
specifica», il match sull'intero percorso (occhio ai prefissi come `/api`), la query string
dichiarata nel path che pretende **uguaglianza esatta dell'intera query**, e la scelta in due
tempi (prima il percorso, poi il metodo — senza ripiego su rotte meno specifiche se il metodo
manca).

Contenuti:
- La dialog di creazione campo per campo, inclusi i messaggi di validazione del path (deve
  iniziare con `/`, il carattere `^` è riservato, compatibilità con la convenzione delle
  collection).
- Il tipo di risposta si sceglie già alla creazione (mock / handler / middleware / SSE / WS):
  in questo capitolo si crea un mock statico, gli altri tipi sono annunciati e rimandati.
- Path parameters con esempi progressivi: rotta fissa, `:id`, più parametri, la precedenza
  fisso-batte-parametro spiegata con un caso concreto (`/api/utenti/me` vs `/api/utenti/:id`).
- La query nel path: quando dichiararla (varianti diverse per `?stato=aperto` e
  `?stato=chiuso`) e il costo (un parametro in più esclude il match).
- Dove è finito il mock appena creato: nel catalogo e su disco (anteprima del capitolo 24).

Screenshot previsti:
- Dialog «Nuovo» compilata per un mock statico realistico (es. `GET /api/utenti/:id`).
- La stessa dialog con un errore di validazione del path visibile.

### 08 — La scheda dell'endpoint (`08-scheda-endpoint.md`)

Il pannello di dettaglio che si apre selezionando un endpoint dal catalogo: l'anagrafica
(metodo, percorso, **descrizione** modificabile, percorso del file su disco), l'interruttore
**attivo/disattivo** (cosa succede alle richieste quando è disattivo: tornano al proxy o al
404), la lista delle **response** (varianti) con la selezione di quella attiva, e la barra
delle azioni: aggiungere una response (di ogni tipo), modificarla, eliminarla (deve restarne
almeno una), **Copia** l'endpoint, **Sequenza**, **Elimina** l'endpoint. Il capitolo introduce
il concetto operativo più importante della guida: tenere **più varianti pronte** e cambiare
comportamento dell'API con un click.

Contenuti:
- Anatomia della scheda, zona per zona.
- La descrizione dell'endpoint: a cosa serve in un team (documentare il perché di un mock),
  come si modifica.
- Varianti: crearne una seconda (es. il 404 accanto al 200), selezionarla, tornare indietro.
  Il flusso "provo il caso d'errore nella UI del mio frontend in 5 secondi".
- Le voci di menu «Clona in nuova response handler / middleware»: partire dal body statico
  per evolvere verso una risposta dinamica (anticipazione dei capitoli 15-16).
- Il menu di aggiunta response con i cinque tipi e quando scegliere ciascuno (tabella di
  orientamento).
- Eliminazione endpoint e response, con le conferme.

Screenshot previsti:
- Scheda endpoint completa con 3 varianti (200 con dati, lista vuota, 500) e la selezione
  sulla prima.
- Il menu «Aggiungi response» aperto con i cinque tipi visibili.

### 09 — L'editor delle response mock (`09-editor-response-mock.md`)

Il capitolo più "manuale utente" della guida: tutti i controlli dell'editor di una response
statica. **Status** (combobox con i codici HTTP e descrizione), **titolo** della variante,
**delay** in millisecondi (il ritardo di quella singola risposta), gli **header** (combobox
con i nomi noti, valori, rimozione, e il menu **«Inserisci bundle»** con set pronti: CORS
sviluppo, CORS preflight, no-cache, security headers, Auth Bearer), il **body** nelle sue tre
forme — JSON con validazione, testo libero (con content-type impostabile), **file** caricato
con drag & drop (servito in streaming, adatto anche a payload grossi: immagini, PDF, zip; max
12 MB da interfaccia, content-type dedotto dal file e sovrascrivibile via header) — e i
**preset di response** (menu con risposte pronte: 400, 401, 403, 404, 409, 422, 429, 500,
503, lista paginata) che sostituiscono status e body in un colpo, con conferma.

Contenuti:
- Giro completo dell'editor, controllo per controllo, con il "perché" di ciascuno.
- Le tre modalità del body e quando usarle: JSON (il caso normale), testo (XML, CSV, HTML),
  file (binari e payload pesanti — spiegare lo streaming: il file non passa mai per la
  memoria).
- I bundle di header spiegati uno a uno: cosa contengono e in che scenario servono (es.
  no-cache per i problemi di caching del browser durante lo sviluppo).
- I preset di errore come acceleratore: costruire in un minuto la variante 500 di qualunque
  endpoint. Il preset «Lista paginata» come ponte verso il capitolo 11.
- L'editor di codice integrato: formattazione, ricerca, folding — con rimando alla dialog
  delle scorciatoie (capitolo 34).
- Salvataggio e annullamento; cosa succede su disco a ogni salvataggio.

Screenshot previsti:
- Editor con body JSON e la lista header popolata.
- Editor in modalità body-da-file con un file caricato (es. un PDF), per mostrare lo stato
  alternativo dell'interfaccia.
- Menu dei preset di response aperto.
- Menu «Inserisci bundle» aperto sugli header.

### 10 — Il templating: risposte che fanno eco alla richiesta (`10-templating.md`)

Il gradino tra mock statico e handler: con l'interruttore **«Template»** attivo sulla
response, i placeholder `{{...}}` nel body e negli header vengono sostituiti con valori presi
dalla richiesta. Il caso d'uso da cui partire: `GET /api/utenti/:id` che risponde con l'`id`
davvero richiesto dentro il body — senza scrivere una riga di JavaScript. Copre tutte le
sorgenti (`params.<nome>`, `query.<nome>`, `headers.<nome>`, `body.<percorso.a.punti>`), gli
helper generati (`now`, `nowMs`, `uuid`, `randomInt min max`), il **filtro dei tipi**
(`{{params.id | number}}` per ottenere un numero senza virgolette; anche `| boolean` e
`| json`), il comportamento tollerante dei placeholder non risolti (risposta comunque emessa,
warning nel log) e i limiti dichiarati: niente condizioni né cicli — quando serve logica, si
passa all'handler.

Contenuti:
- Esempio guida completo prima/dopo: stesso mock senza e con template.
- Tabella delle sorgenti e degli helper con un esempio ciascuno, calato in scenari frontend
  (l'`uuid` per gli id generati, `now` per i timestamp «appena creato», `randomInt` per dati
  che variano).
- Il filtro dei tipi spiegato bene: perché serve (JSON con numeri veri, non stringhe) e la
  regola "vale quando l'intero valore è un solo placeholder".
- L'escape `\{{` e l'interazione col capitolo 11 (il template si applica prima di paginazione
  e filtri).
- Il vincolo: niente template sulle risposte con payload file.

Screenshot previsti:
- Editor response con l'interruttore Template attivo e un body ricco di placeholder.
- Il monitor con la risposta risultante, placeholder risolti, a fianco (o due screenshot in
  sequenza richiesta→risposta).

### 11 — Liste con paginazione e filtri automatici (`11-liste-paginazione-filtri.md`)

Una delle feature più comode per il frontend: se il body di un mock è una **lista** (array
JSON, o oggetto con un solo array di primo livello), Mockxy le dà comportamento da vera API —
`?page=0&size=10` restituisce solo la pagina richiesta con il totale nell'header
`X-Total-Count`, e `?chiave=valore` filtra gli elementi per uguaglianza (case-insensitive di
default, configurabile). Si definisce **una volta** il dataset completo e tutte le
combinazioni di filtri e pagine vengono da sé: l'alternativa sarebbe un mock per ogni
combinazione, cioè esattamente ciò che un mock server dovrebbe evitare.

Contenuti:
- Quando si attiva (solo body JSON di tipo mock che sono liste) e quando no.
- La paginazione: parametri riconosciuti, l'header `X-Total-Count`, cosa succede oltre
  l'ultima pagina. Esempio con una tabella frontend con paginatore.
- I filtri di uguaglianza: sintassi, il confronto case-insensitive e l'opzione workspace che
  lo governa, filtro su più chiavi, l'ordine filtro-poi-pagina.
- Scenario completo: costruire il mock di una lista utenti da 50 elementi e far funzionare
  ricerca + paginazione della propria tabella senza backend.
- Limiti onesti: uguaglianza semplice, niente ordinamento né operatori — cosa fare quando
  serve di più (handler, capitolo 15).

Screenshot previsti:
- Response mock con body array grande, e a fianco (o in sequenza) il monitor che mostra la
  richiesta `?page=1&size=10` con la risposta parziale e l'header `X-Total-Count`.

### 12 — Le sequenze di varianti (`12-sequenze.md`)

La risposta che **evolve da sola**: una sequenza dice all'endpoint di servire le varianti in
ordine — la prima per N richieste (o per una durata di tempo), poi la successiva, fino
all'ultimo step. Il caso d'uso simbolo: il polling di un job asincrono («in coda» → «in
elaborazione» → «completato») che il frontend interroga a intervalli, impossibile da simulare
con un mock statico. Copre la dialog completa: modalità **«Per richieste»** vs **«A tempo»**,
il comportamento alla fine (**resta sull'ultimo** o **ricomincia**), l'**auto-reset per
inattività** (dopo X ms senza richieste la sequenza riparte dal primo step — così ogni giro di
prova manuale ricomincia da capo senza dover toccare nulla), la composizione degli step
(variante + valore), lo stato corrente (step attivo, richieste servite) e il pulsante
**«Riparti dall'inizio»**.

Contenuti:
- Il concetto e il caso del polling, sviluppato per intero come esempio guida.
- Prerequisito: almeno due varianti mock o handler (SSE e WS non possono essere step).
- La dialog campo per campo, incluse le validazioni (minimo 2 step, valori ≥ 1).
- Come si riconosce una sequenza attiva: il badge nel catalogo, il tooltip sulla scheda
  endpoint («l'endpoint sta servendo gli step, non la variante selezionata»), e il badge
  «SEQ n/m» sulle voci del monitor che dice quale step ha servito ogni richiesta.
- Differenza tra modalità a richieste e a tempo, con uno scenario per ciascuna (polling
  contato vs "il servizio si riprende dopo 30 secondi").
- Il cursore della sequenza è stato runtime: cosa lo resetta (reset manuale, auto-reset,
  ricarica) — da [../ENDPOINT.md](../ENDPOINT.md).

Screenshot previsti:
- Dialog sequenza compilata in modalità «Per richieste» con 3 step (esempio del job).
- La stessa dialog in modalità «A tempo», per lo stato alternativo dei campi.
- Il monitor con più richieste successive allo stesso endpoint che mostrano il badge di
  avanzamento SEQ 1/3 → 2/3 → 3/3.

### 13 — Copiare endpoint e riusare il lavoro (`13-copiare-endpoint.md`)

Capitolo breve sulla dialog **«Copia endpoint»**: duplicare un endpoint esistente cambiando
metodo e/o percorso, scegliendo se portarsi dietro **tutte le response** o solo quella
selezionata. I casi d'uso: creare `GET /api/ordini/:id` partendo da `GET /api/ordini` già
rifinito, clonare un endpoint per una versione v2 dell'API, o creare la variante di metodo
(il PUT accanto al GET) senza rifare gli header.

Contenuti:
- La dialog campo per campo (metodo, path con placeholder d'esempio, interruttore «copia
  tutte le response» e cosa cambia quando è spento).
- Cosa viene copiato esattamente (file di risposta, script referenziati) e cosa no.
- Buone pratiche: costruire un endpoint "modello" ben fatto e clonarlo.

Screenshot previsti:
- Dialog di copia compilata, con l'origine visibile («da GET /api/...»).

### 14 — Simulare la lentezza: i ritardi (`14-ritardi.md`)

Perché in locale tutto risponde in 3 millisecondi e il frontend sembra perfetto: spinner mai
visti, race condition invisibili, timeout che non scattano. Il capitolo mette insieme i tre
livelli di ritardo (da [../RITARDI.md](../RITARDI.md)): il **`delayMs` per variante**
(l'endpoint singolo lento: la ricerca pesante, l'export), il **ritardo globale** del workspace
(tutti i mock senza delay proprio — emulare una rete lenta per intero), e l'opzione **«Ritardo
anche sul proxy»** che estende il ritardo globale alle richieste inoltrate al backend. La
regola di precedenza: il delay per variante, quando maggiore di zero, **vince** sul globale —
non si sommano.

Contenuti:
- I tre livelli con uno scenario ciascuno; dove si imposta ciascuno (editor response, dialog
  impostazioni workspace, variabile d'ambiente per l'headless).
- Cosa guardare nel frontend mentre si prova: skeleton, spinner, pulsanti disabilitati,
  doppio-click, annullamento richieste.
- Simulare un timeout vero: delay oltre il timeout del client HTTP del frontend.

Screenshot previsti:
- Editor response con delay impostato (es. 3000 ms) — può riusare/variare uno screenshot del
  capitolo 9.
- Sezione della dialog impostazioni workspace con «Ritardo globale» e «Ritardo anche sul
  proxy» valorizzati.

---

## Parte III — Risposte dinamiche e streaming

Quando il JSON statico non basta: scrivere logica (handler), ritoccare il backend vero
(middleware), separare i dati dalla logica (pagina Dati), e mockare i protocolli di streaming
(SSE e WebSocket) con copioni e console di regia.

### 15 — Gli handler: risposte calcolate in JavaScript (`15-handler.md`)

Il gradino sopra il mock statico: una variante di tipo **handler** è uno script JavaScript
locale che riceve la richiesta e costruisce la risposta. Il capitolo va scritto in forma
molto guidata (è il primo contatto del lettore con il codice dentro Mockxy): la forma dello
script (`resolveResponse(context)` che restituisce status/headers/body), il **contesto**
ricevuto (params, query, headers, body), e la parte più potente — lo **stato per endpoint**:
`state` (memoria effimera che sopravvive tra le richieste), `callCount`, `firstRequestAt`,
con cui si costruiscono mock **stateful** (il carrello che si riempie davvero, il contatore di
tentativi, il rate-limit simulato). Include l'editor integrato con i template di partenza
(pulsante «Rigenera template»), il `require` di file locali con ricompilazione automatica al
cambio, e gli errori (il 500 «Handler Execution Failed» e dove leggere il dettaglio).

Contenuti:
- Quando serve un handler e quando no (scala mock statico → template → handler, richiamando
  i capitoli 9-10).
- Creazione dall'interfaccia: nuova response handler (o «Clona in handler» da un mock
  esistente, che precompila il body come punto di partenza).
- Lo script riga per riga su un esempio vero: eco di un parametro, validazione del body con
  400 in risposta, POST che "crea" e GET che rilegge grazie a `state`.
- Il contratto: cosa può restituire, cosa non può dichiarare (method/path/disabled — il
  routing resta nel file endpoint), timeout d'esecuzione.
- `require` locali e hot reload dello script e delle sue dipendenze.
- Debug: log del server, monitor, l'errore 500 dedicato.
- Scenario finale completo: un piccolo CRUD in memoria (lista + crea + elimina) per far
  lavorare il frontend come se il backend esistesse.

Screenshot previsti:
- Editor dell'handler con uno script d'esempio leggibile e completo.
- Il monitor che mostra richieste successive con risposte diverse prodotte dallo stato
  (es. il callCount che cresce nel body).

### 16 — I middleware: ritoccare le risposte del backend vero (`16-middleware.md`)

Il terzo modo di rispondere, a metà tra mock e backend: la richiesta **arriva davvero** al
backend attraverso il proxy, ma la risposta passa da uno script locale
(`transformResponse`) che può modificarla prima che raggiunga l'app. I casi d'uso che lo
giustificano: aggiungere il campo che il contratto nuovo prevede ma il backend non manda
ancora (senza rinunciare ai dati veri), forzare un valore per provocare un caso specifico
nel frontend, mascherare dati sensibili in demo. Stessa meccanica di script degli handler
(CommonJS, require locali, hot reload), con il suo contratto specifico.

Contenuti:
- Il posizionamento concettuale: quando un middleware batte sia il mock (servono dati veri)
  sia l'handler (il backend c'è già).
- Creazione dall'interfaccia e forma dello script; cosa riceve (richiesta + risposta del
  backend) e cosa può cambiare (status, header, body).
- Esempio guida: arricchire la risposta reale con un campo calcolato; secondo esempio:
  forzare `stato: "SOSPESO"` su un utente per testare il banner del frontend.
- Comportamento con backend irraggiungibile, e con la modalità proxy totale (i middleware non
  intervengono — il backend si osserva al naturale).
- Come si distingue nel monitor una risposta passata da middleware (provenienza dedicata).

Screenshot previsti:
- Editor del middleware con script d'esempio.
- Monitor con la stessa rotta prima e dopo l'attivazione del middleware (provenienza proxy
  vs middleware).

### 17 — La pagina Dati e `data()` (`17-pagina-dati.md`)

I **file dati**: dataset JSON riusabili, caricati nella pagina Dati e letti da handler e
middleware con l'accessor `data("nome")`. Separano i dati dalla logica: lo script resta corto,
il dataset si modifica dalla pagina (o con un editor) senza toccare codice, e viaggia in git
con i mock. Il capitolo copre tutta la pagina: upload con drag & drop (solo `.json`), anteprima
del contenuto, **rinomina** (con l'opzione di riscrivere automaticamente i riferimenti
`data()` negli handler che lo usano), eliminazione (con avviso se qualche endpoint lo sta
usando), **copia riferimento** (lo snippet `data('nome')` pronto da incollare), il badge
**«usato da N»** che elenca gli endpoint che referenziano il file (con l'avvertenza sui
riferimenti dinamici non rilevabili), e l'avviso sui file **grandi** (oltre 5 MB la lettura si
paga a ogni richiesta che chiama `data()`).

Contenuti:
- Il contratto su disco: cartella `files/` piatta, nomi in minuscolo normalizzati, il nome
  senza estensione è l'identificatore per `data()`.
- Giro completo della pagina, azione per azione.
- Esempio guida che chiude il cerchio col capitolo 15: caricare `utenti.json` con 50 utenti e
  scrivere un handler di 5 righe che lo serve filtrato.
- La tracciabilità: badge «usato da», la rinomina che aggiorna i riferimenti, l'avviso
  all'eliminazione di un file usato.
- Prestazioni: il limite dei 5 MB e perché.

Screenshot previsti:
- Pagina Dati con alcuni file caricati, uno selezionato con anteprima e badge «usato da».
- La riga di un file in modalità rinomina con l'opzione «aggiorna anche i riferimenti data()»
  visibile.

### 18 — Mockare gli stream: Server-Sent Events (`18-sse.md`)

Le risposte di tipo **SSE**: la connessione resta aperta e gli eventi escono secondo un
**copione** — la scaletta di eventi con ritardi (`afterMs`), nome evento e payload — oppure
dalla **console di regia** in tempo reale. Il capitolo parte spiegando in breve cos'è SSE e
dove si incontra (notifiche, avanzamento di un job, feed live), poi costruisce l'esempio
guida: la barra di avanzamento (`progress 10% → 60% → done`). Copre l'editor del copione, il
comportamento a fine copione (**resta aperta** / **chiude** / **ricomincia**), il `retryMs`,
i **preset** (messaggi pronti da lanciare dalla console), e la **console**: connessioni
aperte, storico dei messaggi, invio manuale broadcast (`Ctrl+Invio`), re-invio di un
messaggio dallo storico.

Contenuti:
- SSE in due paragrafi per chi non lo ha mai usato, con lo snippet `EventSource` lato
  frontend per provare subito.
- Il copione: struttura delle voci, il copione che riparte **a ogni connessione** (e cosa
  significa per la riconnessione automatica del client).
- Le tre chiusure (`keep-open`/`close`/`loop`) con uno scenario ciascuna; l'heartbeat
  automatico nei silenzi.
- La console come strumento di prova interattivo: dirigere manualmente gli eventi mentre si
  guarda il frontend reagire; i preset come macro.
- Cosa registra il monitor (la voce nasce alla chiusura della connessione).
- Limite: una variante SSE non può far parte di una sequenza.

Screenshot previsti:
- Editor della response SSE con il copione dell'esempio (3 eventi progress).
- Console SSE con una connessione attiva e qualche messaggio nello storico (origine copione
  vs manuale distinguibili).

### 19 — Mockare le WebSocket (`19-websocket.md`)

Il gemello bidirezionale del capitolo precedente: le varianti di tipo **WS** gestiscono
localmente l'handshake di upgrade e parlano col client secondo tre meccanismi combinabili —
il **copione** dei messaggi in uscita, le **regole dichiarative** sui messaggi in arrivo
(match per testo esatto, sottostringa o subset JSON; la prima che matcha vince; la risposta
va solo alla connessione che ha parlato), e la **console** con il transcript bidirezionale
(▶ inviati / ◀ ricevuti) e l'invio manuale. E l'altra metà della storia: gli upgrade che
**non** matchano un endpoint WS seguono il **passthrough** verso il backend reale — il caso
tipico dell'app che mocka le API HTTP ma tiene viva la connessione notifiche vera.

Contenuti:
- WebSocket in breve (upgrade, frame, differenza da SSE) per il lettore junior.
- Il copione (identico nella meccanica all'SSE) e le chiusure, incluse `closeCode` e
  `closeReason`.
- Le regole richiesta→risposta con esempi progressivi: ping/pong, il subscribe JSON con
  conferma; la filosofia dichiarata «niente logica nelle regole: per quella c'è l'handler».
- La console e il transcript: leggere la conversazione, reinviare un payload, broadcast.
- Il passthrough degli upgrade non mockati e il 426 sulle richieste HTTP normali a un
  endpoint WS.
- Scenario: simulare il canale notifiche dell'app (benvenuto + promo a tempo + risposta al
  subscribe).

Screenshot previsti:
- Editor della response WS con copione e una regola compilata.
- Console WS con transcript bidirezionale popolato (frecce ▶/◀ e origini diverse visibili).

---

## Parte IV — Osservare e catturare il traffico

Il secondo pilastro di Mockxy: guardare il traffico vero e trasformarlo in mock. Qui la guida
insegna il flusso di lavoro che dà più valore nel quotidiano: navigare l'app contro il
backend reale e congelare in mock ciò che serve.

### 20 — Il monitor (`20-monitor.md`)

La vista live del traffico: **ogni richiesta** servita dal motore (mockata e proxata), con
metodo, percorso, status, latenza e **provenienza** — la colonna «Servita da», che usa la
stessa tassonomia dell'header `x-mock-source` ed è la legenda per capire chi ha risposto.
Il capitolo copre la lista e i suoi **filtri** (testo libero, metodo, classe di status,
provenienza — inclusa la voce combinata «Backend vero»), il pannello di dettaglio
(header e body di richiesta e risposta, pannelli ridimensionabili), le statistiche in testa
(richieste, errori, latenza media), l'**export JSON**, il **copia come cURL** (rieseguire la
richiesta identica da terminale), il salto **«Apri la definizione nel catalogo»** dalle voci
servite da un mock, e i limiti di cattura che è bene conoscere: finestra live di 250
richieste, body fino a 156 KB (oltre: troncati e dichiarati), header sensibili
(`Authorization`, `Cookie`, …) **mascherati già alla cattura**.

Contenuti:
- Cosa viene registrato e le tre esclusioni deliberate (traffico `/_admin`, preflight CORS
  automatici, connessioni di upgrade).
- La lettura della lista: colonne, badge, il badge «SEQ n/m» per gli endpoint con sequenza.
- Tutti i filtri combinati, con lo scenario "trova il 500 di ieri mattina… no, quello è nel
  capitolo Storico — trova il 500 di due minuti fa".
- Dettaglio voce: le quattro sezioni (request/response × headers/body), payload compressi
  decompressi per la preview, binari come segnaposto, JSON riformattato.
- Il badge Live/In pausa (stato della connessione dell'interfaccia, non un interruttore) e
  l'interruttore di pausa; «Pulisci» (non tocca l'archivio su disco).
- Il mascheramento dei segreti e le sue conseguenze (i `***` non finiscono nei mock creati).
- Copia cURL ed export JSON con casi d'uso (riprodurre un bug, allegare a una issue).

Screenshot previsti:
- Monitor pieno di traffico misto (mock, proxy, handler) con la colonna provenienza ben
  visibile.
- Dettaglio di una voce con request/response affiancate.
- La barra dei filtri con un filtro provenienza «Backend vero» attivo.

### 21 — Da traffico a mock: la cattura (`21-cattura-mock.md`)

Il flusso simbolo di Mockxy, che merita un capitolo a sé: dal dettaglio di una voce del
monitor — o **in blocco**, selezionando più voci — si crea un mock con tutto già pronto:
metodo e percorso dalla richiesta, status, header e body dalla risposta. Il capitolo racconta
le regole di travaso (gli header mascherati e quelli ricalcolati dal server non finiscono nel
mock; un body non ricostruibile produce comunque il mock ma come **skeleton da completare**,
marcato nella descrizione), il caso **endpoint già esistente** — la dialog che propone di
aggiungere la risposta catturata come **nuova variante**, col titolo «dal monitor · HH:mm:ss»,
che diventa la selezionata — e la creazione **massiva** (che invece salta gli esistenti, di
proposito). Chiude con i collegamenti incrociati: il toast «Apri il mock creato», e il badge
«Vai al mock» sulle voci backend la cui rotta è oggi coperta da un endpoint del catalogo
(anche se disabilitato, segnalato come tale).

Contenuti:
- Il flusso singolo passo-passo, con l'esempio guida "congela la risposta vera di
  `GET /api/ordini` prima che lo staging venga resettato".
- La selezione multipla e la creazione in blocco; la lettura del riepilogo (create /
  skeleton / già esistenti / fallite).
- La dialog «Il mock esiste già» e la scelta aggiungi-variante; perché il batch non fa
  domande.
- Gli skeleton: quando nascono e come completarli.
- Il round-trip completo: catturato → ritoccato nel catalogo → attivo — e da lì il confine
  mock/reale si è spostato di un endpoint.
- Il legame col proxy totale: la modalità di cattura per eccellenza (mock sospesi, si osserva
  e registra il backend vero).

Screenshot previsti:
- Monitor in modalità selezione con più voci spuntate e il pulsante «Crea mock (N)».
- La dialog «Il mock esiste già» con la proposta di aggiunta come variante.
- Il toast di conferma con «Apri il mock creato».

### 22 — Lo storico dump: il monitor che non dimentica (`22-storico-dump.md`)

La memoria persistente del monitor: la vista live tiene 250 richieste, lo **storico dump**
riversa il traffico su disco e la pagina «Storico» permette di sfogliarlo e di **creare mock
anche a distanza di giorni** — la sessione di prove fatta martedì su staging diventa un
workspace di mock giovedì, quando serve. Copre l'accensione esplicita (l'interruttore
«Dump» nella runtime bar, con il conteggio delle voci in coda e il **flush** manuale), la
pagina: elenco dei file di dump, caricamento, selezione delle voci caricate, il dettaglio in
sola lettura, la **creazione mock in blocco** (anche da un intero file), l'eliminazione dei
dump, e i parametri di regolazione (cadenza e soglia di flush, rotazione per dimensione,
tetto totale della cartella con pruning dei più vecchi) rimandando i default alla dialog
impostazioni (capitolo 26).

Contenuti:
- Live vs storico: quando serve l'uno e quando l'altro; il dump che parte solo su richiesta
  e scrive il residuo allo spegnimento.
- Giro della pagina: file, caricamento, selezione, dettaglio, badge «troncato».
- Creazione mock dal passato, con le stesse regole del capitolo 21 (skeleton, esistenti
  saltati) e il riepilogo dei risultati.
- Igiene e privacy: gli archivi restano fuori da git (sono nella parte locale del workspace),
  gli header sensibili sono già mascherati, ma i body possono contenere dati personali.
- Rotazione e retention in due parole (i dettagli nel capitolo 26).

Screenshot previsti:
- Pagina Storico con più file di dump, uno caricato e voci selezionate per la creazione in
  blocco.
- La runtime bar con il dump attivo e richieste in coda visibili nel tooltip/badge.

---

## Parte V — Import e mock come file

Come si popola un workspace in fretta (import OpenAPI) e cosa c'è davvero su disco (file
endpoint, file di risposta, anatomia del workspace, git e hot reload).

### 23 — L'import OpenAPI (`23-import-openapi.md`)

Se l'API ha una specifica, il workspace non si costruisce a mano: l'import genera **un mock
per ogni endpoint dichiarato**, con body derivati da esempi e schemi — l'obiettivo dichiarato
è una **base solida da ritoccare**, non dati realistici. Il capitolo copre la dialog completa:
il drop del file (OpenAPI 3.0/3.1 e Swagger 2.0, JSON o YAML; le versioni vecchie convertite
da sole, i `$ref` risolti anche annidati), l'**anteprima** con i conteggi (da creare / già
esistenti / collection), i filtri della lista (tutti / da creare / saltati), l'import vero e
proprio con il riepilogo (creati / saltati / falliti), e l'organizzazione risultante in
collection (dai tag della specifica).

Contenuti:
- Quando conviene l'import rispetto alla cattura dal monitor (spec disponibile vs traffico
  disponibile) — i due approcci si completano.
- Formati accettati e tolleranza (versioni, YAML, `$ref`).
- Da dove vengono i body generati (esempi della spec, poi schemi) e cosa aspettarsi.
- La dialog passo per passo, anteprima compresa; il comportamento sugli endpoint già
  esistenti (saltati, non sovrascritti).
- Il dopo-import: rifinire i mock che contano per il proprio flusso, attivare/disattivare a
  gruppi con le collection.
- Scenario: il contratto è stato aggiornato — reimportare la spec nuova aggiunge solo i mock
  degli endpoint nuovi.

Screenshot previsti:
- Dialog di import con l'anteprima popolata (conteggi e lista con azioni «Da creare» /
  «Esiste»).
- Il catalogo dopo l'import, organizzato in collection dai tag.

### 24 — I mock sono file: dentro il workspace (`24-mock-come-file.md`)

Il capitolo che apre il cofano, fondamentale per lavorare in team: **tutto ciò che
l'interfaccia fa scrive file leggibili**. L'anatomia del workspace (da
[../WORKSPACE.md](../WORKSPACE.md)): la parte **condivisa** destinata a git (cartella dei
mock, `files/` dei dati, `.collections.json`, il segnaposto del workspace) e la parte
**locale** che non deve lasciare la macchina (`.mockxy/` con impostazioni personali e dump
del traffico), con il `.gitignore` che li separa. Poi i due file protagonisti: il **file
endpoint** (`<METODO>.endpoint.json`: metodo, percorso, attivo, elenco varianti, variante
selezionata, sequenza) e i **file di risposta** nella cartella `<METODO>.responses/`
(`001.response.json`, script `.handler.js`/`.middleware.js`, payload file). Infine la
**ricarica a caldo**: si modifica un file a mano e il motore lo ricarica, con la
**degradazione per-endpoint** (un file rotto non abbatte il server: l'endpoint viene saltato
con warning e resta in vigore l'ultima versione valida).

Contenuti:
- La mappa della cartella con un albero commentato, riga per riga.
- Condiviso vs locale: cosa committare, cosa no, e perché (impostazioni personali, dump con
  dati potenzialmente sensibili).
- Il file endpoint e il file di risposta letti campo per campo su un esempio reale (versione
  guidata di [../ENDPOINT.md](../ENDPOINT.md) e [../RESPONSE.md](../RESPONSE.md), che
  restano il riferimento completo).
- Modificare a mano: quando conviene (refactoring di massa, cerca-e-sostituisci su molti
  mock), la ricarica a caldo, il pulsante «Ricarica dal disco» del catalogo.
- La degradazione per-endpoint e come si legge il warning nel log.
- Lavorare in team: il workspace nel repo del frontend, i mock nelle code review, i conflitti
  git tipici e come evitarli.

Screenshot previsti:
- Albero del workspace in un file manager o editor (cartelle mock + `.mockxy/` + `files/`).
- Un file endpoint e un file di risposta aperti in un editor, affiancati al catalogo che
  mostra lo stesso endpoint: le "due viste sugli stessi dati".

---

## Parte VI — Configurazione e amministrazione

Tutte le regolazioni: le impostazioni del workspace nella dialog dedicata, la topologia
browser→Mockxy→backend (CORS, cookie, redirect), il multi-workspace dell'app desktop,
l'esposizione in rete, l'admin API e la configurazione headless/Docker.

### 25 — Le impostazioni del workspace (`25-impostazioni-workspace.md`)

La dialog delle impostazioni, voce per voce — il capitolo-catalogo delle regolazioni, da cui
gli altri capitoli dipendono. Le voci: **titolo** (l'unica condivisa col team: l'etichetta
del progetto nelle tab), **porta** (con la validazione e il rifiuto delle porte occupate),
**Backend URL** (il backend reale del proxy fallback; vuoto = solo mock), **accessibile da
tutta la rete** (con l'avvertenza di sicurezza — approfondita nel capitolo 29), la sezione
**Comportamento** (proxy fallback on/off, CORS automatico, adattamento cookie, riscrittura
redirect, filtri case-insensitive, ritardo globale, ritardo anche sul proxy, timeout backend)
e la sezione **Monitor · dump su disco** (cadenza flush, soglia flush, dimensione massima per
file, tetto totale della cartella). E la regola generale: al salvataggio il motore del
workspace **riparte** e la finestra si ricarica.

Contenuti:
- Ogni voce con: cosa fa, default, quando toccarla, e il rimando al capitolo che la
  approfondisce (proxy→cap. 2/27, CORS/cookie/redirect→cap. 27, ritardi→cap. 14,
  dump→cap. 22, rete→cap. 29).
- La distinzione condiviso/locale (solo il titolo viaggia in git; tutto il resto è della
  macchina) e perché è disegnata così.
- Il riavvio al salvataggio e le sue conseguenze pratiche (connessioni SSE/WS chiuse, stato
  runtime azzerato).
- Nota per chi usa l'headless: queste stesse regolazioni esistono come variabili d'ambiente
  (capitolo 31).

Screenshot previsti:
- La dialog aperta sulla parte alta (titolo, porta, backend URL, esposizione rete con
  avvertenza visibile).
- La dialog scorsa alla sezione Comportamento con gli interruttori.
- La sezione Monitor · dump su disco.

### 26 — La porta, il backend e il proxy fallback (`26-proxy-fallback.md`)

Approfondimento operativo sul cuore di Mockxy già introdotto nel capitolo 2: il **proxy
fallback** e le sue regolazioni. La decisione richiesta-per-richiesta ripresa in dettaglio
(controlli globali → match endpoint → variante → fallback), la modalità **solo-mock**
(fallback spento o Backend URL vuoto: le richieste senza mock ricevono un 404 strutturato,
con `path_not_mocked` vs `method_not_mocked` nel body — i due errori che insegnano a leggere
il routing), il **501 Backend Not Configured**, il **timeout backend** e il comportamento a
backend irraggiungibile, e la tassonomia completa di `x-mock-source` come tabella di
riferimento.

Contenuti:
- Il flusso di decisione come diagramma commentato (versione estesa del capitolo 2).
- Solo-mock vs fallback: quando lavorare nell'una e nell'altra modalità (demo offline e test
  deterministici vs sviluppo quotidiano).
- La lettura dei 404 solo-mock come strumento di debug.
- Timeout ed errori del proxy: cosa vede il frontend, cosa dice il monitor.
- Tabella `x-mock-source` completa con una riga di spiegazione per valore.

Screenshot previsti:
- Monitor con una richiesta «miss» (404 solo-mock) aperta nel dettaglio, body
  `path_not_mocked` visibile.

### 27 — Browser, cookie, CORS e redirect: la topologia del proxy (`27-topologia-proxy.md`)

Il capitolo che spiega i tre interruttori "misteriosi" delle impostazioni — CORS automatico,
adattamento cookie, riscrittura redirect — raccontando il problema che ciascuno risolve
quando in mezzo tra browser e backend c'è Mockxy. **CORS automatico** (da
[../CORS.md](../CORS.md)): serve solo se il frontend chiama Mockxy da un'altra origin senza
passare dal proxy del dev server; risponde ai preflight e riflette l'origin, sovrascrivendo
la policy dei mock catturati e del backend. **Adattamento cookie** (da
[../COOKIE.md](../COOKIE.md)): i `Set-Cookie` dello staging (Domain, Secure, SameSite=None)
verrebbero scartati in silenzio dal browser che parla con Mockxy su http — il classico login
che «non tiene» — quindi di default vengono adattati. **Riscrittura redirect** (da
[../REDIRECT.md](../REDIRECT.md)): un `Location` assoluto verso il backend farebbe uscire il
browser da Mockxy senza alcun segnale; di default viene riscritto verso Mockxy (relativi e
host terzi passano intatti).

Contenuti:
- Premessa didattica: perché browser + proxy in mezzo = questi tre problemi (origin, cookie,
  redirect), con disegni semplici.
- Ciascuna opzione: il sintomo senza, cosa fa esattamente, il default e quando spegnerla
  (es. spegnere l'adattamento cookie per osservare i `Set-Cookie` originali).
- Il filo conduttore: il flusso di login attraverso Mockxy che funziona, come storia
  completa che tocca tutti e tre.
- Troubleshooting mirato: login che non tiene, richieste che "scavalcano" Mockxy dopo un
  redirect, errori CORS in console.

Screenshot previsti:
- La sezione Comportamento della dialog impostazioni con i tre interruttori (può riusare lo
  screenshot del capitolo 25 se identico).
- DevTools: un `Set-Cookie` adattato nella risposta passata da Mockxy (confronto col
  cookie originale se fattibile).

### 28 — L'app desktop fino in fondo: multi-workspace e preferenze (`28-desktop-workspace.md`)

Le funzionalità esclusive dell'app desktop (da [../DESKTOP.md](../DESKTOP.md)): **più
workspace in parallelo, un motore ciascuno su una propria porta** — il caso d'uso dei due
worktree git con due frontend che puntano a due set di mock diversi, contemporaneamente. La
barra dei workspace a schede (aprire, cambiare, chiudere con conferma, i **recenti** con
rimozione), le **porte stabili** (assegnate alla prima apertura e ricordate; il ripiego
automatico se occupata all'avvio vs il rifiuto di un cambio esplicito verso una porta
occupata), la finestra con titlebar integrata, e le **Preferenze app** globali: lingua,
geometria della finestra, recenti, e il **log errori su disco** (`logs/` accanto
all'eseguibile, un file al giorno, dove finiscono anche gli errori dei motori — l'unico posto
dove leggere il dettaglio di un 500 da handler nell'app impacchettata).

Contenuti:
- La barra dei workspace azione per azione; aprire una cartella qualunque e la conferma di
  inizializzazione (richiamo al capitolo 3).
- Il modello "un motore per workspace": porte separate, configurazioni separate, frontend
  diversi che puntano a workspace diversi.
- Le porte stabili e i due comportamenti sulla porta occupata.
- Preferenze app vs impostazioni workspace: cosa vive dove (con la natura portable: tutto
  accanto all'exe).
- Il log errori: dove sta, quando scrive, come disattivarlo, e perché è prezioso.

Screenshot previsti:
- App con 2-3 workspace aperti nelle tab e il menu dei recenti aperto.
- Dialog «Preferenze dell'app» (log errori con percorso della cartella visibile).

### 29 — Esporre Mockxy in rete, in sicurezza (`29-rete-sicurezza.md`)

Perché di default Mockxy ascolta **solo su loopback** e cosa significa accendere «Accessibile
da tutta la rete»: l'admin API crea handler, cioè **scrive file ed esegue JavaScript** —
chiunque raggiunga la porta può eseguire codice sulla macchina. Il capitolo spiega il rischio
in termini comprensibili, i casi legittimi (far provare l'app a un collega in LAN, il device
mobile fisico che deve raggiungere i mock), le protezioni esistenti (guardia anti DNS
rebinding sull'header Host, l'avvertenza esplicita nella UI, mutazioni solo JSON come difesa
CSRF), e le alternative più sicure quando servono **solo i mock** (l'immagine standalone
senza admin API, capitolo 31).

Contenuti:
- Loopback vs 0.0.0.0 spiegato da zero (il junior spesso non sa la differenza).
- Come si espone: interruttore nella dialog (desktop), `HOST=0.0.0.0` (headless), la
  peculiarità Docker (bind aperto nel container, esposizione decisa dal port mapping).
- Il modello di rischio raccontato onesto: cosa può fare chi raggiunge la porta.
- Le mitigazioni e le buone pratiche: reti fidate, spegnere quando non serve, standalone per
  la sola erogazione.

Screenshot previsti:
- La dialog impostazioni con l'interruttore di esposizione attivo e l'avvertenza rossa ben
  visibile.

### 30 — L'admin API: automatizzare Mockxy (`30-admin-api.md`)

Tutta l'interfaccia è costruita sull'**admin API** sotto `/_admin/api`: non esiste operazione
della UI che non passi da lì — quindi **tutto è automatizzabile**. Il capitolo presenta l'idea
e i casi d'uso per uno sviluppatore frontend: lo script di setup che popola un workspace, la
suite e2e che resetta lo stato e seleziona la variante giusta prima di ogni test (es. attivare
il 500 di un endpoint da Playwright/Cypress), la pipeline che reimporta la spec aggiornata.
Non duplica il riferimento ([../ADMIN-API.md](../ADMIN-API.md)): insegna il modello (risorse,
mutazioni solo JSON, quando è attiva) e sviluppa due-tre esempi completi con `curl` e con un
test e2e.

Contenuti:
- Quando risponde (attiva in sviluppo, spenta in produzione di default) e il legame con la
  sicurezza del capitolo 29 (niente autenticazione: le regole di esposizione sono lì).
- Il modello: le risorse principali (endpoint, response, selezione variante, controlli
  runtime, monitor/dump, dati) con una riga ciascuna e il rimando al riferimento.
- Esempio 1: script bash che crea un mock e ne seleziona la variante.
- Esempio 2: test e2e che mette l'endpoint in variante-errore, esegue, ripristina.
- Esempio 3: accendere il proxy totale / spegnere il server da script (gli interruttori
  della runtime bar via API).

Screenshot previsti:
- Nessuno obbligatorio (capitolo di codice); eventualmente il monitor che mostra l'effetto
  di uno script (variante cambiata al volo).

### 31 — Headless e Docker: configurare senza interfaccia (`31-headless-docker.md`)

Il capitolo per chi esegue Mockxy fuori dall'app desktop: la configurazione del motore passa
**solo da variabili d'ambiente** (o CLI), censite in [../CONFIGURAZIONI.md](../CONFIGURAZIONI.md)
e documentate in `.env.example`. Copre i livelli di configurazione (motore, workspace,
preferenze app, runtime, per-mock, Docker) come mappa mentale, le variabili essenziali
raggruppate per tema (bind e porta, backend e proxy, comportamento, monitor/dump), il Docker
di sviluppo con compose (variabili lette solo da compose, volumi del workspace), e
l'**immagine standalone**: solo mock, niente admin API né interfaccia né proxy fallback —
per servire mock ad altri (Intranet, demo, CI) senza esporre l'esecuzione di codice.

Contenuti:
- La tabella dei livelli di configurazione e chi vince su chi.
- Le env var per tema, con la corrispondenza "interruttore della dialog ↔ variabile" (così
  chi ha letto i capitoli 25-27 ritrova tutto).
- Compose di sviluppo: struttura, volumi, porte host.
- Standalone: cosa c'è e cosa manca, quando è la scelta giusta, esempio di avvio con un
  workspace montato.
- Cenno al deploy per il team (mock condivisi su un server interno) con le cautele del
  capitolo 29.

Screenshot previsti:
- Nessuno obbligatorio (capitolo da terminale); eventualmente un terminale con l'avvio
  headless e le righe di log iniziali.

---

## Parte VII — Pratica e riferimenti rapidi

La chiusura del percorso: gli scenari end-to-end che mettono insieme tutto, la risoluzione
dei problemi, e le appendici di consultazione.

### 32 — Scenari completi, dall'inizio alla fine (`32-scenari.md`)

Il capitolo-palestra: gli scenari di [../SCENARI.md](../SCENARI.md) sviluppati come
walkthrough completi che incrociano le funzionalità apprese, con i rimandi ai capitoli. Ogni
scenario è una storia con contesto, sequenza di azioni nell'interfaccia e risultato:
1. **«Il backend non esiste ancora»** — import della spec OpenAPI, rifinitura dei mock che
   contano, sviluppo in solo-mock, poi spegnimento dei mock un'area alla volta man mano che
   il backend arriva.
2. **«Lo staging è stato resettato di nuovo»** — data entry sul backend vero, cattura dal
   monitor (o dump), congelamento in mock, e la mattina dopo il reset non fa più male.
3. **«Devo provare il caso d'errore»** — la variante 500/timeout/lista-vuota su un singolo
   endpoint mentre tutto il resto resta reale; con la sequenza per il "si rompe poi si
   riprende".
4. **«Il contratto è avanti rispetto al backend»** — middleware che aggiunge i campi nuovi
   sopra la risposta vera, o mock catturato e arricchito.
5. **«Demo/offline»** — workspace completo in solo-mock, ritardi realistici, dati curati.

Contenuti: i cinque scenari come sopra, ciascuno autoconsistente e con i link ai capitoli di
dettaglio usati.

Screenshot previsti:
- Da valutare in scrittura: al minimo uno per scenario nel passaggio-chiave (es. la selezione
  multipla nel monitor per lo scenario 2).

### 33 — Quando qualcosa non va: troubleshooting (`33-troubleshooting.md`)

La versione didattica di [../TROUBLESHOOTING.md](../TROUBLESHOOTING.md), organizzata per
sintomo e costruita sul metodo in tre passi presentato fin dal capitolo 2: guarda
**`x-mock-source`** (chi ha risposto davvero), guarda il **monitor** (cosa è arrivato e cosa
è stato deciso), guarda il **log** (gli errori col file incriminato). I sintomi ricorrenti:
il mock non risponde (prefissi, query dichiarata, metodo mancante, endpoint disattivo,
proxy totale acceso per sbaglio), il login che non tiene (cookie), gli errori CORS, il
redirect che fa uscire da Mockxy, l'handler che dà 500, il file che non si ricarica, la
porta occupata.

Contenuti:
- Il metodo dei tre passi come flusso di lavoro fisso.
- Schede sintomo→diagnosi→rimedio, con rimandi ai capitoli che spiegano il perché.
- Dove stanno i log in ogni forma di esecuzione (terminale, Docker, il file `logs/`
  dell'app desktop).

Screenshot previsti:
- Un 404 solo-mock nel monitor con il body esplicativo (riuso dal capitolo 26 se identico).

### 34 — Appendici (`34-appendici.md`)

Le pagine di consultazione rapida che non meritano un capitolo: la dialog delle **scorciatoie
dell'editor** (cerca e sostituisci, completamento JS, formatta, indenta, commenta riga,
annulla/ripeti, folding — con la nota macOS ⌘), il **cambio lingua** dell'interfaccia e dove
vive la scelta, il glossario dei termini della guida (workspace, endpoint, variante,
collection, fallback, provenienza, dump, skeleton…), e l'indice "dove si fa cosa" — la
tabella funzione → capitolo per usare la guida come riferimento a lettura finita.

Contenuti:
- Scorciatoie editor (dalla dialog dedicata dell'app).
- Lingua (sintesi di [../LINGUA.md](../LINGUA.md)).
- Glossario.
- Indice funzione→capitolo.

Screenshot previsti:
- La dialog delle scorciatoie dell'editor aperta.

---

## Copertura: la checklist delle funzionalità

Verifica finale di completezza — ogni funzionalità nota dell'app e il capitolo che la copre.
Da aggiornare se in scrittura emergono funzioni non mappate.

| Funzionalità | Capitoli |
|---|---|
| Proxy fallback e decisione di routing | 02, 26 |
| Header `x-mock-source` | 02, 26, 33 |
| App desktop: avvio, benvenuto, inizializzazione workspace | 03 |
| Esecuzione Node, Docker dev, immagine standalone | 03, 31 |
| Collegamento frontend (proxy dev server / diretto) | 04 |
| Viste e navigazione, persistenza stato viste | 05 |
| Runtime bar: server on/off, proxy totale, monitor live/pausa, dump+flush | 05, 20, 22 |
| Lingua interfaccia | 05, 34 |
| Catalogo: collection annidate, drag&drop, ricerca, filtri tipo/stato | 06 |
| Azioni collection: crea/sposta/dissolvi/elimina, abilita/disabilita tutti | 06 |
| Ricarica dal disco | 06, 24 |
| Creazione endpoint (dialog Nuovo), validazioni path | 07 |
| Convenzione path: parametri, specificità, query dichiarata | 07, 26, 33 |
| Scheda endpoint: descrizione, attivo/disattivo, percorso file | 08 |
| Varianti: creazione, selezione, eliminazione, clona in handler/middleware | 08 |
| Editor mock: status, titolo, delay, header, bundle header, preset response | 09 |
| Body: JSON, testo+content-type, file in streaming (drag&drop, 12 MB) | 09 |
| Editor di codice: formattazione, ricerca, folding, scorciatoie | 09, 34 |
| Templating: sorgenti, helper, filtri tipo, escape | 10 |
| Paginazione automatica, `X-Total-Count`, filtri query, case-insensitive | 11 |
| Sequenze: modalità, fine, auto-reset, reset, badge SEQ | 12 |
| Copia endpoint (tutte le response / solo selezionata) | 13 |
| Ritardi: per variante, globale, anche sul proxy | 14 |
| Handler: contratto, contesto, state/callCount/firstRequestAt, require, template | 15 |
| Middleware: contratto, casi d'uso, comportamento in proxy totale | 16 |
| Pagina Dati: upload, anteprima, rinomina+riscrittura riferimenti, usato-da, `data()` | 17 |
| SSE: copione, onEnd, retryMs, preset, console, heartbeat | 18 |
| WebSocket: copione, regole, console/transcript, passthrough upgrade, 426 | 19 |
| Monitor: cattura, esclusioni, filtri, dettaglio, export, cURL, mascheramento, troncamento | 20 |
| Crea mock da traffico: singolo, massivo, variante-su-esistente, skeleton, vai-al-mock | 21 |
| Storico dump: accensione, flush, sfoglia, crea in blocco, elimina, rotazione/retention | 22 |
| Import OpenAPI: formati, anteprima, esiti, collection dai tag | 23 |
| Anatomia workspace, condiviso/locale, git | 24 |
| File endpoint e file response, hot reload, degradazione per-endpoint | 24 |
| Impostazioni workspace: tutte le voci della dialog | 25 |
| Solo-mock, 404 strutturati, 501, timeout backend | 26 |
| CORS automatico, adattamento cookie, riscrittura redirect | 27 |
| Multi-workspace, porte stabili, recenti, preferenze app, log errori | 28 |
| Esposizione in rete, rischi e protezioni | 29 |
| Admin API e automazione (e2e, script) | 30 |
| Variabili d'ambiente, livelli di configurazione, compose | 31 |
| Scenari end-to-end | 32 |
| Troubleshooting per sintomo | 33 |
| Scorciatoie, glossario, indice funzione→capitolo | 34 |
