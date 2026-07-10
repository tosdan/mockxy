# Lo storico dump

La vista live del [monitor](MONITOR.md) tiene le ultime 250 richieste in memoria: abbastanza
per l'osservazione in diretta, non per tornare sulla sessione di ieri. Lo **storico dump** è la
memoria persistente del monitor: il traffico catturato viene riversato su disco, e la pagina
«Storico» permette di sfogliarlo e di **creare mock in blocco** anche a distanza di giorni — la
sessione di prove fatta su staging diventa un workspace di mock quando serve, non solo
nell'istante della cattura.

## Accensione

La scrittura su disco **non parte da sola**: si accende dall'interruttore della pagina Storico
(o via admin API) e si spegne allo stesso modo — allo spegnimento il buffer residuo viene
scritto, senza perdere nulla. Cadenza di flush e soglia si possono regolare anche a runtime;
cartella di destinazione, rotazione e tetto totale arrivano dalla configurazione (vedi
[CONFIGURAZIONI.md](CONFIGURAZIONI.md)). Nell'app desktop la cartella è la parte locale del
[workspace](WORKSPACE.md) (`.mockxy/monitor-dump`), fuori da git.

## Come scrive

Il writer è un sottoscrittore del monitor: riceve ogni voce registrata — già **mascherata** e
con gli stessi limiti di cattura della vista live — e la accumula in un buffer **indipendente
dal tetto delle 250 voci in RAM**: la vista dimentica, l'archivio no. La scrittura avviene al
primo tra: soglia di voci in attesa (default 100), cadenza temporale (default 30 secondi),
flush manuale.

Il formato è **NDJSON append-only** — una voce per riga, leggibile anche con gli strumenti da
riga di comando. I file sono nominati con il timestamp della sessione di cattura e **ruotano
per dimensione** (default 50 MB); le scritture sono serializzate, e un errore di scrittura
viene loggato senza fermare né il monitor né il server.

## Retention

La cartella ha un **tetto totale** (default 1 GB, generoso di proposito): superato, i file più
vecchi vengono eliminati — **mai** quello in corso di scrittura. Il pruning protegge il disco
dalla crescita indefinita, non seleziona cosa tenere: per conservare una sessione importante,
la si trasforma in mock (o si copia il file). Con il tetto a `0` il pruning è disattivato.

## La pagina Storico

Oltre all'interruttore di cattura e al flush manuale, la pagina elenca i file di dump e li
sfoglia con scorrimento continuo (la lettura è paginata, anche su archivi molto grandi). Da un
file — intero, o da una selezione di voci — si **creano mock in blocco**, con le stesse regole
di travaso della vista live ([monitor](MONITOR.md)): header mascherati e ricalcolabili esclusi,
scheletri da completare per i body non ricostruibili. I file si eliminano singolarmente dalla
pagina.

## Privacy

Gli header sensibili sono mascherati già alla cattura, ma **body e query string possono
contenere dati personali o segreti** — e nei dump persistono su disco. La cartella è esclusa da
git per costruzione e non va condivisa né montata su server remoti (vedi [l'anatomia del
workspace](WORKSPACE.md) e le avvertenze del README).
