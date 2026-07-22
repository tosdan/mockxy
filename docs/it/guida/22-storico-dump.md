# 22 — Lo storico dump: il monitor che non dimentica

La vista live del monitor tiene le ultime 250 richieste in memoria: abbastanza per
l'osservazione in diretta, non per tornare sulla sessione di ieri. Lo **storico dump** è la
memoria persistente: il traffico catturato viene riversato su disco, e la pagina **Storico**
permette di sfogliarlo e di creare mock **anche a distanza di giorni** — la sessione di prove
fatta martedì su staging diventa un set di mock giovedì, quando serve davvero.

## Accendere la cattura su disco

La scrittura **non parte da sola**: si accende con l'interruttore **Dump** nella runtime bar
(visibile da ogni vista) e si spegne allo stesso modo — allo spegnimento il buffer residuo
viene scritto, senza perdere nulla. Accanto all'interruttore, il conteggio delle richieste
in coda e il pulsante di **flush** per scriverle su disco immediatamente.

Il writer riceve ogni voce registrata dal monitor — già mascherata, con gli stessi limiti di
cattura della vista live — e la accumula in un buffer **indipendente dal tetto delle 250 voci
in RAM**: la vista dimentica, l'archivio no. La scrittura scatta al primo tra: soglia di voci
in attesa (default 100), cadenza temporale (default 30 secondi), flush manuale.

> 📷 **SCREENSHOT** — `22-runtime-bar-dump.png`
> Cosa mostrare: la runtime bar con il dump attivo e il conteggio delle richieste in coda
> visibile (tooltip o badge), più il pulsante di flush.

## Il formato su disco

L'archivio è in **NDJSON append-only** — una voce JSON per riga, leggibile anche con gli
strumenti da riga di comando (`grep`, `jq`). I file sono nominati con il timestamp della
sessione di cattura e **ruotano per dimensione** (default 50 MB); la cartella ha un **tetto
totale** (default 1 GB): superato, i file più vecchi vengono eliminati — mai quello in corso
di scrittura. Il pruning protegge il disco, non seleziona cosa tenere: una sessione
importante si conserva trasformandola in mock (o copiando il file). Cadenza, soglia,
dimensione di rotazione e tetto si regolano dalle impostazioni del workspace
([capitolo 25](25-impostazioni-workspace.md)) o dalle variabili d'ambiente in headless.

Nell'app desktop la cartella è `.mockxy/monitor-dump` — la **parte locale** del workspace,
fuori da git per costruzione: gli header sensibili sono mascherati alla cattura, ma body e
query string possono contenere dati personali, e i dump non vanno condivisi né montati su
server remoti.

## La pagina Storico

La pagina elenca i **file di dump** presenti su disco; caricandone uno, le voci si sfogliano
con scorrimento continuo (la lettura è paginata: anche gli archivi molto grandi si aprono
senza pesare). La lista si presenta come quella del monitor — metodo, percorso, status,
provenienza — e il dettaglio di una voce mostra le stesse quattro sezioni
richiesta/risposta, in sola lettura; i body oltre la soglia di cattura sono marcati
«troncato».

Da qui si creano mock **in blocco**, con due granularità:

- selezionando le voci caricate (con le scorciatoie «Seleziona caricate» / «Deseleziona») e
  confermando con **«Crea mock (N)»**;
- da un **intero file**, con l'azione dedicata sulla riga del file.

Valgono le stesse regole di travaso del [capitolo 21](21-cattura-mock.md) — header mascherati
esclusi, skeleton per i body non ricostruibili — e il comportamento batch: gli endpoint già
esistenti vengono saltati. Il riepilogo finale conta create, skeleton, già esistenti e
fallite. I file si eliminano singolarmente dalla pagina.

> 📷 **SCREENSHOT** — `22-storico-pagina.png`
> Cosa mostrare: la pagina Storico con più file di dump in elenco, uno caricato, alcune voci
> selezionate e il pulsante «Crea mock (N)» attivo; visibile anche il dettaglio in sola
> lettura di una voce.

## Live o storico?

La bussola è semplice: il **monitor live** serve mentre si lavora — diagnosi immediata,
cattura della schermata appena navigata; lo **storico** serve quando la distanza temporale
conta — la sessione di data entry da congelare con calma, il comportamento del backend di
settimana scorsa da confrontare, la campagna di cattura lunga che supererebbe le 250 voci.
Se l'obiettivo della sessione è catturare, conviene accendere il dump *prima* di navigare:
la vista live può dimenticare, l'archivio no.

Con la parte IV si chiude il ciclo osserva-cattura-mocka. La parte V riguarda i due modi di
popolare e possedere il workspace in blocco: l'[import OpenAPI](23-import-openapi.md) e i
[mock come file](24-mock-come-file.md).
