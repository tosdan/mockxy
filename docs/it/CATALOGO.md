# Il catalogo dei mock

Il catalogo è la vista di lavoro sul workspace: l'elenco di tutti gli endpoint, organizzabile e
ricercabile, da cui si crea, si modifica e si accende ogni mock. Vale la regola fondante di
Mockxy: **il catalogo e i file sono due viste equivalenti sugli stessi dati** — ogni azione
che cambia un mock scrive i [file endpoint](ENDPOINT.md) e [di risposta](RESPONSE.md)
documentati nelle pagine dedicate, e ogni modifica fatta a mano sui file compare nel catalogo
grazie alla ricarica a caldo.

La regola riguarda **i dati del workspace**. Ne resta fuori, per scelta, ciò che è stato
operativo di una sessione e non un dato: i [controlli globali](CONTROLLI.md), che valgono per
tutto il motore, e lo [stato temporaneo](#stato-temporaneo) di un singolo endpoint. Non vengono
scritti, non compaiono nei file e un riavvio li elimina.

## Collezioni

Gli endpoint si organizzano in **collezioni**, anche annidate, riordinabili e spostabili con
trascinamento. L'organizzazione è un metadato dell'interfaccia (il file `.collections.json`
nella cartella dei mock, condiviso in git come il resto): non tocca né i percorsi serviti né la
posizione delle cartelle su disco. Gli endpoint non assegnati vivono nella collezione virtuale
**Non assegnati** (*Unsorted* nell'interfaccia inglese): nessuna collezione può chiamarsi con
uno di questi due nomi.

Tre semantiche da conoscere:

- **Dissolvi collection** rimuove il raggruppamento senza eliminare i mock: l'intero sottoalbero
  di collezioni sparisce e gli endpoint contenuti tornano fra i **Non assegnati**;
- **Elimina collection** elimina definitivamente l'intero sottoalbero, gli endpoint contenuti e
  tutte le relative varianti. La stessa azione su **Non assegnati** elimina tutti gli endpoint non assegnati,
  anche se alcuni sono nascosti dai filtri correnti;
- **l'interruttore di abilitazione a livello di collezione è un'azione in massa**: scrive lo
  stesso stato `enabled` su *tutti* gli endpoint del sottoalbero, file per file. È il modo
  rapido per spegnere un'area intera (« tutta l'anagrafica al backend vero »), ma è una
  scrittura uniforme: riaccendendo la collezione si riaccende tutto, anche ciò che era stato
  disabilitato singolarmente prima.

La lista si restringe con la ricerca libera e i filtri per metodo, tipo di variante selezionata
(`mock`, `handler`, `middleware`, `sse`, `ws`, `sequence`) e stato. Un badge **SEQ** identifica
gli endpoint la cui variante selezionata è una [sequenza](RESPONSE.md). Ogni riga mostra il tipo
con un'icona, la stessa usata per la provenienza nel [monitor](MONITOR.md). Con un filtro acceso
la testata dice quanti endpoint restano sul totale, il testo cercato è evidenziato nei percorsi e
spariscono le collezioni senza risultati; il riordino a trascinamento è sospeso, e un avviso lo
ricorda a chi prova a trascinare.

## Selezione e tastiera

Un clic su un endpoint lo apre nel dettaglio; **Ctrl+clic** (⌘+clic su Mac) lo spunta senza
aprirlo, e un secondo lo toglie. Il pulsante **Seleziona** accanto a «⋮» avvia la modalità
selezione: lì un clic spunta la riga invece di aprirla, finché **Fine** non la chiude tenendo le
spunte. **Esc** chiude la modalità e toglie tutte le spunte, da qualunque punto della pagina
tranne i campi di testo, i menu e le finestre.

Le righe spuntate hanno una tinta indaco e un bordo sinistro dello stesso colore; quella aperta
nel dettaglio ha una sfumatura verso destra e il bordo destro chiaro, così i due segni non si
confondono. Le collezioni hanno una casella a tre stati: spunta tutti gli endpoint del
sottoalbero, sottocollezioni comprese (sotto filtro, solo quelli che il filtro mostra); lo stesso
fa Ctrl+clic sulla collezione, mentre il clic semplice la apre o la chiude. Una collezione
spuntata per intero ha la tinta e il bordo continuo, una spuntata in parte ha strisce e bordo
tratteggiato, e il suo contatore dice quanti endpoint sono spuntati sul totale. Le azioni in massa —
abilita, disabilita, sposta, elimina — agiscono su tutti gli endpoint spuntati che il filtro
mostra, anche dentro collezioni chiuse; ciò che il filtro nasconde non viene mai toccato.

Il catalogo si usa anche da tastiera, con un solo punto di Tab: le frecce si spostano fra le
righe e aprono o chiudono le collezioni, **Invio** apre l'endpoint nel dettaglio, **Spazio** lo
spunta (su una collezione spunta il sottoalbero). Dalla ricerca, Freccia giù entra nella lista.

Dal menu «⋮» accanto a «Nuovo» si sceglie la **densità compatta**: una riga per endpoint, con il
solo necessario a distinguerli. La scelta resta per le visite successive.

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

### Stato temporaneo

Abilitare un endpoint o scegliere una variante **salva nei file** del workspace: è la decisione
che va in git e che i colleghi ricevono, ed è ciò che serve quando un mock sostituisce un
backend che [non c'è ancora](SCENARI.md#la-funzione-nuova-è-pronta-il-suo-backend-no). Lo stesso
gesto però non va bene quando lo stato serve solo per un momento — riprodurre un bug su un
endpoint che il backend ha già, provare il caso d'errore, preparare un test: il file resta
modificato, e prima o poi finisce in un commit uno stato che nessuno ha scelto. Per questi casi
c'è lo **stato temporaneo**, dal pulsante con l'orologio accanto all'interruttore dell'endpoint:

- **accendi / spegni temporaneamente**, senza toccare l'interruttore che salva;
- **servi temporaneamente** una variante diversa da quella selezionata;
- **torna a come è salvato**.

Lo stato temporaneo vive nella memoria del motore: i file non cambiano, `git status` resta
pulito, e un riavvio lo elimina. Non può passare inosservato: la riga del catalogo porta il
segno **TEMP** (`TEMP ON`, `TEMP OFF`), il pulsante nel dettaglio dice cosa c'è di diverso, e la
barra di stato conta gli endpoint in stato temporaneo con **Azzera**, che li riporta tutti a
come sono salvati. Compare anche quando lo scenario l'ha impostato un test via
[API](ADMIN-API.md#attivazioni-temporanee).

Un salvataggio normale sullo stesso endpoint vince: spegnerlo dall'interruttore, o selezionare
una variante dalla tendina, fa decadere lo stato temporaneo di quel campo. Modificare i dati di
una variante, o crearne una senza «Attiva subito», non lo tocca.

Interruttore, tendina e righe del catalogo continuano a mostrare **ciò che è salvato**: un
endpoint acceso temporaneamente ha l'interruttore su «Disattivo» e il segno `TEMP ON`. Sono
entrambi veri — il primo dice cosa c'è nel file, il secondo cosa risponde adesso.

Nel dettaglio, una **fascia** sotto la testata li mette uno accanto all'altro: «ora: Non trovato
404. Nel file: OK 200». **Vedi cosa risponde** mostra in sola lettura la variante servita, senza
cambiare quella che il dettaglio sta mostrando; nella tendina delle varianti, quella servita ora
e quella del file sono marcate. Dalla fascia si esce in due modi: **Torna a come è salvato**
toglie lo stato temporaneo, **Salva così** lo scrive nel file dell'endpoint — da quel momento è
la decisione salvata, quella che va in git.

Il conteggio nella barra di stato apre l'**elenco** degli endpoint in stato temporaneo, da
qualunque pagina: per ognuno cosa risponde ora e cosa dice il file, **Salva così**, la X che lo
riporta a come è salvato, e il percorso, che apre l'endpoint nel catalogo. In fondo, **Salva
tutto nei file** e **Azzera**.

Nell'app desktop, salvare le [impostazioni del workspace](DESKTOP.md) riavvia il motore e quindi
elimina lo stato temporaneo; la dialog lo dice prima di salvare. Quale gesto usare, caso per caso, è
in [SCENARI.md](SCENARI.md#salvare-o-stato-temporaneo).

Il pulsante **Sequenza** crea una variante sequence oppure modifica quella selezionata. La dialog
configura per ogni step il criterio per numero di richieste o durata, il comportamento finale e
il reset per inattività; in modifica mostra anche lo stato live e può azzerare il cursore.

## Le varianti e l'editor

Ogni endpoint elenca le proprie varianti di risposta: se ne aggiungono di nuove, si modificano,
si eliminano, e si sceglie l'**attiva** — quella servita, finché uno [stato
temporaneo](#stato-temporaneo) non ne fa servire un'altra. L'editor valida prima di scrivere:

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

Catalogo ed endpoint aperto si aggiornano da soli quando un agente, un'altra finestra o una
modifica ai file li cambiano: mentre è visibile, l'interfaccia interroga il motore ogni 2 secondi
e rilegge tutto quando si torna sulla finestra. Se il motore non risponde, la barra in fondo
segnala «Non aggiornato»; lì compaiono anche gli errori dell'ultimo caricamento, con quello che il
runtime serve al loro posto (per esempio la versione precedente di un handler rotto).

Descrizione, form della variante e dialog della sequenza salvano sulla risorsa aperta: se nel
frattempo un agente o un altro client attiva un'altra variante, la modifica resta su quella di
partenza. Gli aggiornamenti automatici non toccano una bozza aperta: se la sua risorsa cambia, un
avviso lo segnala prima del salvataggio. Se la risorsa è cambiata, il salvataggio non la
sovrascrive: la bozza resta com'è e un pannello permette di **confrontarla** con la versione
attuale, di **ricaricare** quest'ultima al posto della bozza (con conferma se modificata) o di
**salvare la propria versione** dopo averla vista. Se la risorsa è stata eliminata, il testo resta da copiare e il salvataggio è disabilitato.
Status, ritardo e template cambiati in linea, attivazione e selezione sono azioni immediate:
vince l'ultima.

La vista ricorda in `localStorage` l'ultimo endpoint selezionato e le collezioni compresse:
tornando al catalogo, anche dopo un riavvio, lo si ritrova come lasciato. I valori non più
validi vengono ignorati e il comando «vai al mock» dal monitor ha sempre la precedenza.
