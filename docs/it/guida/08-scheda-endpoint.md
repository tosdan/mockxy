# 08 — La scheda dell'endpoint

Selezionando un endpoint dal catalogo, il pannello di destra ne mostra la scheda: anagrafica,
stato, e la lista delle varianti di risposta. È il centro di comando del singolo mock, e il
posto dove si impara il gesto più utile di Mockxy: tenere più risposte pronte e cambiare
comportamento dell'endpoint con un click.

> 📷 **SCREENSHOT** — `08-scheda-endpoint.png`
> Cosa mostrare: la scheda completa di un endpoint con tre varianti realistiche (es. «200 con
> dati», «Lista vuota», «500 Internal Server Error»), la selezione ben visibile sulla prima,
> l'interruttore di attivazione e la barra delle azioni (Copia, Sequenza, Elimina).

## L'anagrafica

In testa alla scheda: il badge del metodo, il percorso, e la **descrizione** — un campo di
testo libero, modificabile in linea, che vale la pena usare quando il workspace è condiviso:
due righe sul *perché* un mock esiste («riproduce il bug #1234», «dati demo per il cliente X»)
risparmiano domande a chi arriva dopo. Un tooltip sul percorso mostra la **posizione del file
endpoint su disco**, utile quando si vuole aprire il file a mano.

L'interruttore **Attivo/Disattivo** governa l'endpoint intero: da disattivo, l'endpoint resta
nel catalogo con tutte le sue varianti, ma le richieste su quella rotta tornano a seguire il
fallback — al backend reale, o al 404 in modalità solo-mock. È l'operazione con cui il
confine mock/reale si sposta all'indietro: il backend ha implementato l'endpoint vero, il
mock si spegne, e resta lì pronto per la prossima volta.

La barra delle azioni completa l'anagrafica: **Copia** duplica l'endpoint su un nuovo
metodo/percorso ([capitolo 13](13-copiare-endpoint.md)), **Sequenza** apre la configurazione
della sequenza di varianti ([capitolo 12](12-sequenze.md)), **Elimina** rimuove endpoint e
varianti, con conferma.

## Le varianti di risposta

La lista delle response è il cuore della scheda. Ogni endpoint ne ha almeno una; la
**selezionata** è quella che l'endpoint serve, e la selezione si cambia con un click. Le
altre restano intatte, pronte da riselezionare.

Il valore pratico sta tutto qui: un endpoint ben attrezzato ha la variante «felice» e
accanto i casi che il frontend deve saper gestire — la lista vuota, il 404, il 500. Provare
come l'interfaccia reagisce a un errore diventa: click sulla variante d'errore, refresh
dell'app, click per tornare indietro. Nessun file toccato, nessun contenuto perso.

Ogni variante ha un **titolo** libero («Utente trovato», «Errore server»), che conviene
tenere parlante: è ciò che si legge quando si sceglie.

### Aggiungere una response

Il pulsante di aggiunta apre un menu con le cinque nature possibili, più due scorciatoie:

| Voce | Cosa crea | Approfondimento |
|---|---|---|
| Nuova response **mock** | risposta statica: status, header, body | [capitolo 9](09-editor-response-mock.md) |
| Nuova response **handler** | script JavaScript che calcola la risposta | [capitolo 15](15-handler.md) |
| Nuova response **middleware** | script che trasforma la risposta del backend reale | [capitolo 16](16-middleware.md) |
| Nuova response **SSE** (stream) | stream di eventi con copione e console | [capitolo 18](18-sse.md) |
| Nuova response **WebSocket** (canale) | canale WS mockato con copione, regole e console | [capitolo 19](19-websocket.md) |
| **Clona in nuova response handler** | un handler precompilato con il body del mock corrente | [capitolo 15](15-handler.md) |
| **Clona in nuova response middleware** | un middleware, partendo dalla response corrente | [capitolo 16](16-middleware.md) |

Le due voci di clonazione meritano una nota: sono il percorso di crescita naturale di un
mock. Si parte da una risposta statica; quando serve logica, «Clona in handler» crea la
variante dinamica **con il body statico già dentro come punto di partenza** — si aggiunge la
logica attorno a dati già giusti, invece di ripartire da zero. L'originale statico resta
nella lista, riselezionabile in ogni momento.

> 📷 **SCREENSHOT** — `08-menu-aggiungi-response.png`
> Cosa mostrare: il menu di aggiunta response aperto, con i cinque tipi e le due voci di
> clonazione visibili.

### Modificare ed eliminare

Le azioni sulla variante selezionata: **modifica** apre l'editor (il capitolo 9 lo copre per
i mock statici; per gli script si apre l'editor di codice), **elimina** la rimuove con
conferma — con un vincolo: **deve restare almeno una response** per endpoint. Se l'obiettivo
è che l'endpoint non risponda più, la strada giusta è disattivarlo, non svuotarlo.

## Scegliere il tipo giusto

Una bussola rapida, che i capitoli successivi motivano nel dettaglio:

- **mock** quando la risposta può essere scritta a mano — è il caso di gran lunga più
  frequente, e con templating, paginazione automatica e sequenze copre più di quanto sembri;
- **handler** quando serve logica o stato: rispondere in base al body ricevuto, generare
  dati, simulare un CRUD;
- **middleware** quando il backend c'è e va usato, ma la sua risposta va ritoccata;
- **SSE / WebSocket** quando l'endpoint non è richiesta/risposta ma uno stream o un canale.

Il prossimo passo è l'editor con cui si costruisce la risposta statica — status, header,
body nelle sue tre forme, ritardi e preset: [capitolo 9](09-editor-response-mock.md).
