# Il catalogo dei mock

Il catalogo è la vista di lavoro sul workspace: l'elenco di tutti gli endpoint, organizzabile e
ricercabile, da cui si crea, si modifica e si accende ogni mock. Vale la regola fondante di
Mockxy: **il catalogo e i file sono due viste equivalenti sugli stessi dati** — ogni azione
dell'interfaccia scrive i [file endpoint](ENDPOINT.md) e [di risposta](RESPONSE.md) documentati
nelle pagine dedicate, e ogni modifica fatta a mano sui file compare nel catalogo grazie alla
ricarica a caldo.

## Collezioni

Gli endpoint si organizzano in **collezioni**, anche annidate, riordinabili e spostabili con
trascinamento. L'organizzazione è un metadato dell'interfaccia (il file `.collections.json`
nella cartella dei mock, condiviso in git come il resto): non tocca né i percorsi serviti né la
posizione delle cartelle su disco. Gli endpoint non assegnati vivono nella collezione virtuale
dei *non ordinati*.

Tre semantiche da conoscere:

- **Dissolvi collection** rimuove il raggruppamento senza eliminare i mock: l'intero sottoalbero
  di collezioni sparisce e gli endpoint contenuti tornano in Unsorted;
- **Elimina collection** elimina definitivamente l'intero sottoalbero, gli endpoint contenuti e
  tutte le relative varianti. La stessa azione su Unsorted elimina tutti gli endpoint non assegnati,
  anche se alcuni sono nascosti dai filtri correnti;
- **l'interruttore di abilitazione a livello di collezione è un'azione in massa**: scrive lo
  stesso stato `enabled` su *tutti* gli endpoint del sottoalbero, file per file. È il modo
  rapido per spegnere un'area intera (« tutta l'anagrafica al backend vero »), ma è una
  scrittura uniforme: riaccendendo la collezione si riaccende tutto, anche ciò che era stato
  disabilitato singolarmente prima.

La lista si restringe con la ricerca libera e i filtri per metodo, tipo di variante attiva
(`mock`, `handler`, `middleware`, `sse`, `ws`) e stato. Un badge **SEQ** identifica gli endpoint
con una [sequenza di varianti](ENDPOINT.md) attiva.

## Gli endpoint

Dal catalogo si crea un endpoint scegliendo metodo, percorso (con parametri, secondo [la
convenzione dei path](PATH.md)) e tipo della prima variante — mock statico, oppure
[handler](HANDLER.md) o [middleware](MIDDLEWARE.md) con un template di partenza già nella forma
giusta. Ogni endpoint si può poi:

- **modificare** in metodo, percorso e descrizione;
- **duplicare** su un nuovo metodo+percorso, scegliendo se copiare anche le varianti — la via
  rapida per il « come il GET, ma in POST »;
- **abilitare/disabilitare**: da spento, le sue richieste seguono il [fallback](PROXY.md);
- **eliminare**, insieme alle sue varianti.

Il pulsante **Sequenza** apre la configurazione degli step, del criterio per numero di richieste
o durata, del comportamento finale e del reset per inattività. La stessa dialog mostra lo step
runtime corrente e permette di azzerare subito il cursore.

## Le varianti e l'editor

Ogni endpoint elenca le proprie varianti di risposta: se ne aggiungono di nuove, si modificano,
si eliminano, e si sceglie l'**attiva** — quella effettivamente servita. L'editor valida prima
di scrivere:

- lo **status** con un combobox che suggerisce i codici comuni ma accetta qualunque intero
  100–599;
- il **percorso** secondo la convenzione, con errori spiegati;
- il **body** JSON con validazione sintattica (un JSON rotto non viene salvato), o in modalità
  testo con content-type esplicito;
- gli **header** con preset per i casi comuni;
- il **ritardo** in millisecondi della variante ([i ritardi](RITARDI.md)).

Sui mock JSON o testuali il toggle **Template** abilita i placeholder descritti nella
[pagina sulle risposte](RESPONSE.md). Le varianti `sse` e `ws` sostituiscono l'anteprima del
body con la rispettiva console: connessioni e storico/transcript, compositore per il broadcast
manuale e macro configurate nei preset. Si aggiungono dal menu delle nuove risposte e il loro
copione si modifica su file o tramite admin API.

Per servire un **file binario** (immagini, PDF, archivi) si carica il file direttamente sulla
variante — fino a 12 MB via interfaccia — con content-type ricordato; il payload viene servito
in streaming come documentato nella [pagina sulle risposte](RESPONSE.md).

La vista ricorda in `localStorage` l'ultimo endpoint selezionato e le collezioni compresse:
tornando al catalogo, anche dopo un riavvio, lo si ritrova come lasciato. I valori non più
validi vengono ignorati e il comando «vai al mock» dal monitor ha sempre la precedenza.
