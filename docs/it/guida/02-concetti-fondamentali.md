# 02 — I concetti fondamentali

Prima di installare qualcosa, conviene fissare il vocabolario che l'interfaccia (e questa
guida) usa in ogni pagina, e capire come Mockxy decide, richiesta per richiesta, chi risponde.
Sono poche nozioni, ma reggono tutto il resto.

## Il vocabolario

**Workspace.** La cartella che contiene un intero ambiente di mock: le definizioni degli
endpoint, i file dati riusabili, le impostazioni locali e il traffico catturato. È un'unità
autosufficiente e portabile: si versiona in git, si condivide con il team, si apre nell'app
desktop o si serve con il server headless. Un progetto frontend tipicamente tiene il proprio
workspace dentro il repository, accanto al codice.

**Endpoint.** Un metodo HTTP più un percorso, mockato: `GET /api/utenti/:id` è un endpoint,
`POST /api/utenti` è un altro. Ogni endpoint può essere attivo o disattivo: disattivarlo non
lo cancella — le richieste su quella rotta tornano semplicemente a passare verso il backend
reale (o al 404, in modalità solo-mock).

**Variante di risposta (response).** Uno stesso endpoint può avere più risposte pronte: il
200 con dati, la lista vuota, il 404, il 500. In ogni momento **una sola variante è
selezionata**, ed è quella che l'endpoint serve; cambiare comportamento significa selezionare
un'altra variante, senza toccare i contenuti. È il meccanismo con cui, in pochi secondi, si
prova come il frontend reagisce al caso d'errore. Le varianti hanno cinque nature possibili —
mock statico, handler, middleware, SSE, WebSocket — introdotte nel capitolo 1 e approfondite
nelle parti II e III.

**Collection.** L'organizzazione a cartelle del catalogo: gli endpoint si raggruppano in
collection, anche annidate, per tenere ordinato un workspace che cresce. È un metadato
dell'interfaccia: spostare un endpoint in una collection non cambia né il percorso servito né
la posizione dei file su disco.

**Monitor.** La vista in tempo reale del traffico che attraversa Mockxy — mockato e proxato —
con la possibilità di trasformare in mock ciò che passa. Insieme al proxy è l'altro pilastro
dell'applicazione (capitoli 20–22).

## Il principio: interfaccia e file sono la stessa cosa

Ogni azione dell'interfaccia scrive normali file JSON dentro il workspace, e ogni modifica
fatta a mano ai file compare nell'interfaccia grazie alla ricarica a caldo. Non c'è un
database, non c'è uno stato nascosto: **il workspace è la fonte di verità**, e interfaccia e
file sono due viste equivalenti sugli stessi dati.

Le conseguenze pratiche sono importanti: l'intero set di mock si versiona in git e viaggia
con il progetto; un refactoring di massa si può fare con un cerca-e-sostituisci nell'editor;
e nulla di ciò che fai dall'interfaccia è opaco — puoi sempre aprire il file e guardare cosa
c'è scritto. La struttura dei file è il tema del [capitolo 24](24-mock-come-file.md).

## Il percorso di una richiesta

Quando una richiesta arriva a Mockxy (esclusi i percorsi riservati `/_admin/...`, usati
dall'interfaccia stessa), la decisione su chi risponde segue sempre lo stesso ordine:

1. **Controlli globali.** Due interruttori nella barra dell'interfaccia governano l'intero
   motore: con il server dei mock **spento**, o in modalità **proxy totale**, nessun mock
   interviene e tutto va dritto al backend reale. Servono a sospendere i mock in blocco senza
   toccarli uno a uno (capitolo 5).
2. **Match dell'endpoint.** Mockxy cerca tra le rotte registrate quella che combacia con il
   percorso della richiesta — vince sempre la più specifica — e poi verifica che la rotta
   definisca il metodo HTTP richiesto. Le regole precise (parametri di percorso, query
   dichiarate, precedenze) sono nel [capitolo 7](07-creare-endpoint.md).
3. **La variante selezionata risponde.** Se l'endpoint esiste ed è attivo, risponde la sua
   variante selezionata: il mock statico, l'handler, o il middleware (che passa comunque dal
   backend). Un'eventuale sequenza di varianti può scegliere automaticamente quale step
   servire (capitolo 12).
4. **Fallback.** Se nessun mock copre la richiesta, decide il **proxy fallback**: attivo
   (default) e con un backend configurato, la richiesta viene inoltrata al backend reale;
   disattivo, la risposta è un `404 Mock Not Found` con la ragione del mancato match nel
   body; attivo ma senza backend configurato, `501 Backend Not Configured`.

Il fallback disattivo è la **modalità solo-mock**: utile per demo offline o per essere certi
che il frontend non tocchi mai un ambiente reale. Il capitolo 26 approfondisce fallback,
errori e timeout.

## `x-mock-source`: chi ha risposto davvero

Ogni risposta che esce da Mockxy porta un header tecnico, **`x-mock-source`**, che dichiara
chi l'ha prodotta. È lo strumento di diagnosi numero uno — quando una richiesta non fa ciò
che ti aspetti, la prima domanda è sempre «chi ha risposto?», e la risposta è già negli
header:

| Valore | Significato |
|---|---|
| `mock` | risposta statica di un mock |
| `handler` | generata da un handler locale |
| `middleware` | risposta del backend trasformata da un middleware |
| `backend` | proxata al backend senza trasformazioni |
| `mock-only` | `404` con proxy fallback disattivo |
| `backend-unconfigured` | `501` per assenza di backend configurato |
| `cors-preflight` | preflight `OPTIONS` gestito dal CORS automatico |

Per leggerlo dal browser: DevTools → scheda Network → clic sulla richiesta → sezione
*Response Headers*. Gli stessi valori compaiono come colonna «Servita da» nel monitor, che ne
è di fatto la legenda.

> 📷 **SCREENSHOT** — `02-x-mock-source-devtools.png`
> Cosa mostrare: i DevTools del browser (scheda Network) con una richiesta selezionata e il
> pannello dei Response Headers aperto, l'header `x-mock-source: mock` visibile. Ideale se
> nella lista si vedono anche altre richieste, per dare contesto.

## I concetti sullo schermo

Per ancorare i termini all'interfaccia: nel catalogo, ogni riga è un **endpoint** (badge del
metodo + percorso), raggruppato nelle **collection**; selezionandone uno, la scheda a destra
mostra le sue **varianti di risposta**, con l'indicazione di quella selezionata. Tutto ciò
che vedi corrisponde a file dentro il **workspace** aperto.

> 📷 **SCREENSHOT** — `02-endpoint-varianti.png`
> Cosa mostrare: la vista Catalogo con un endpoint selezionato la cui scheda mostra almeno
> tre varianti (es. «200 con dati», «Lista vuota», «500 Internal Server Error»), con la
> selezione ben visibile sulla prima. Serve ad ancorare visivamente i termini
> endpoint/variante/selezione.

Con il vocabolario a posto, si può installare: il [capitolo 3](03-installazione-avvio.md)
copre l'app desktop, il server Node e Docker, dal download al primo workspace aperto.
