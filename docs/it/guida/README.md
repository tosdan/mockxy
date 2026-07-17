# La guida di Mockxy — progetto e convenzioni

Questa cartella ospita la **guida didattica** di Mockxy: un percorso completo, pensato per uno
sviluppatore junior, che parte da zero e arriva a coprire **tutte** le funzionalità
dell'applicazione. Non è la documentazione di riferimento (quella vive in [`docs/it/`](../)
ed è organizzata per feature, con taglio da consultazione): è un **corso**, da leggere in
ordine, che spiega cosa fa ogni funzione, come si usa dall'interfaccia, e perché è utile —
con esempi concreti calati nello sviluppo di una web app frontend.

## A chi si rivolge e con che tono

È una **guida utente pubblica** (verrà pubblicata su GitHub): il taglio è quello di una
documentazione tecnica professionale, non di un tutorial per principianti. Deve però restare
pienamente fruibile da uno sviluppatore frontend junior: sa cos'è una chiamata HTTP, un JSON
e un dev server, ma non va dato per scontato che conosca i dettagli (CORS, cookie di
sessione, reverse proxy, SSE, WebSocket…). Regole di scrittura:

- **Chiara, mai semplicistica**: si scrive per un professionista che sa leggere una
  documentazione tecnica. Niente toni paternalistici, incoraggiamenti («non ti preoccupare»,
  «è più facile di quanto sembri»), domande retoriche o entusiasmo artificiale: la chiarezza
  si ottiene con contesto e esempi, non abbassando il registro.
- **Il contesto giusto al momento giusto**: ogni concetto che entra in gioco viene introdotto
  con una o due frasi prima di essere usato — come farebbe una buona documentazione, non come
  una lezione. Se serve un approfondimento vero, si spiega qui il necessario e si rimanda
  alla pagina di riferimento per il resto.
- **Non telegrafici**: le funzioni non si elencano, si raccontano — cosa fanno, come si
  usano, e almeno un esempio di scenario reale di sviluppo frontend in cui tornano utili.
- **Ma nemmeno pesanti**: frasi piane, esempi prima della teoria, sezioni brevi con titoli
  parlanti. Il lettore deve poter riprendere la lettura da qualunque capitolo.
- Ogni capitolo si chiude idealmente con un aggancio al successivo, così la guida si legge
  anche come percorso continuo.

## La convenzione degli screenshot

Gli screenshot sono a carico dell'autore umano. Nel testo si inserisce un **placeholder** che
descrive esattamente cosa deve mostrare l'immagine — in che stato deve trovarsi l'app, quali
dati di esempio devono essere visibili — così lo scatto si può preparare senza rileggere il
capitolo. Formato:

```markdown
> 📷 **SCREENSHOT** — `nome-file-proposto.png`
> Cosa mostrare: [pagina o dialog, stato dell'app, dati di esempio visibili, eventuale
> elemento su cui l'occhio deve cadere].
```

Granularità: si fotografano **viste intere** (una pagina, una dialog, un pannello nel suo
contesto), mai il singolo pulsante o toggle. Se la stessa interfaccia assume **stati diversi
per funzioni diverse** (es. l'editor di response in modalità body-testo vs body-da-file, la
sequenza in modalità «per richieste» vs «a tempo»), si prevedono più screenshot, uno per
stato.

## Struttura e flusso di lavoro

- **[MAPPA.md](MAPPA.md)** è la mappa dell'intera guida: per ogni capitolo, titolo,
  descrizione di cosa coprirà, elenco ragionato dei contenuti e screenshot previsti. È il
  documento di lavoro da cui si parte per scrivere ogni capitolo — e va tenuta allineata se in
  corso d'opera si decide di spostare o accorpare contenuti.
- I capitoli si scrivono **uno (o pochi) per sessione**, espandendo la voce corrispondente
  della mappa. Nome file: prefisso numerico a due cifre + slug, es. `07-creare-un-endpoint.md`
  (i nomi proposti sono già nella mappa).
- Fonti per la scrittura: le pagine di riferimento in `docs/it/` (linkarle, non duplicarle
  quando il dettaglio è da consultazione — es. la tabella completa delle variabili d'ambiente),
  le stringhe dell'interfaccia in `mockxy-ui/src/i18n/it.json` (per citare i controlli con il
  loro nome esatto), e il codice quando serve verificare un comportamento.
- **Lingua**: si scrive tutto in italiano; la traduzione inglese (`docs/en/guide/`) si farà
  solo a guida completa.

## Stato di avanzamento

| Fase | Stato |
|---|---|
| Mappa completa dei contenuti (MAPPA.md) | ✅ fatta |
| Scrittura capitoli Parte I — Partire | ✅ (01–05) |
| Scrittura capitoli Parte II — Il lavoro quotidiano con i mock | ✅ (06–14) |
| Scrittura capitoli Parte III — Risposte dinamiche e streaming | ✅ (15–19) |
| Scrittura capitoli Parte IV — Osservare e catturare il traffico | ✅ (20–22) |
| Scrittura capitoli Parte V — Import e mock come file | ✅ (23–24) |
| Scrittura capitoli Parte VI — Configurazione e amministrazione | ✅ (25–31) |
| Scrittura capitoli Parte VII — Pratica e riferimenti rapidi | ✅ (32–34) |
| Inserimento screenshot | ⬜ |
| Revisione complessiva e indice finale | ⬜ |
| Traduzione inglese | ⬜ |
