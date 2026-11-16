# Gli scenari d'uso, passo per passo

Mockxy è costruito attorno a un'idea: **mockare non è una scelta tutto-o-niente** — il confine
tra mockato e reale si sposta di continuo durante la vita di un progetto. Questa guida percorre
gli scenari ricorrenti da cui il design proxy+cattura è nato, indicando per ciascuno la
sequenza concreta e le pagine di dettaglio.

## «Il database di staging è stato resettato di nuovo»

Il backend condiviso funziona, ma i dati inseriti a mano per provare le interfacce spariscono a
ogni reseeding. La difesa è congelare gli scenari **mentre esistono**:

1. si lavora con il [proxy fallback](PROXY.md) attivo verso staging: nessun mock, tutto reale;
2. si fa data entry dalle maschere dell'app, finché gli scenari sono ben popolati;
3. nel [monitor](MONITOR.md) si selezionano le risposte che li rappresentano — o si accende lo
   [storico](STORICO.md) a inizio sessione, per ripescarle anche a giorni di distanza;
4. **crea mock**, anche in blocco: da quel momento quegli endpoint rispondono con i dati
   congelati, e il prossimo reset non li tocca;
5. i mock sono [file in git](WORKSPACE.md): lo scenario si condivide con il team.

## «Il contratto è avanti rispetto al backend»

La specifica OpenAPI è aggiornata, il client API rigenerato — ma l'endpoint reale risponde
ancora nel formato vecchio. Due strade, a seconda di quanto contano i dati veri:

- **dati veri, forma nuova**: un [middleware proxy](MIDDLEWARE.md) sulla rotta aggiunge o
  ritocca i campi che il nuovo contratto prevede, sopra la risposta reale — si continua a
  lavorare con dati vivi;
- **forma nuova e basta**: si cattura la risposta vera dal monitor, la si trasforma in mock e
  si aggiungono i campi a mano ([catalogo](CATALOGO.md)) — oppure si riparte
  dall'[import della specifica](OPENAPI.md), che è incrementale e non tocca l'esistente.

Quando il backend si allinea, si spegne il ritocco e si torna al reale.

## «Il backend non c'è ancora» (e il confine si sposta)

A inizio progetto si [importa la specifica](OPENAPI.md) o si creano i mock a mano, e il
frontend parte subito in modalità anche solo-mock (fallback spento). Man mano che il backend
matura, il confine si sposta **una zona alla volta**:

- si punta `BACKEND_URL` al backend nascente e si attiva il [fallback](PROXY.md);
- si **disabilitano** i mock degli endpoint ormai implementati — singolarmente o [a
  collezioni intere](CATALOGO.md): quelle richieste tornano a passare verso il reale, le altre
  restano mockate;
- per il confronto rapido «come si comporta il backend su *tutto*?» c'è il [proxy
  totale](CONTROLLI.md), che sospende i mock senza perderli.

Se lo stesso confine vive in uno staging usato da tutto il team, il percorso è in
[STAGING.md](STAGING.md): i mock arrivano con una PR e il confine si sposta allo stesso modo.

### «Il frontend deve già provare un flusso GET → POST → GET»

Una risposta statica non basta quando il frontend crea un elemento e si aspetta di ritrovarlo
nella lista successiva. Si usa lo [stato runtime condiviso degli handler](HANDLER.md):

1. si prepara `files/items.json` con il dataset iniziale;
2. GET e POST diventano due handler distinti che aprono entrambi `items` con la stessa
   `seedKey: "items@v1"` e `initialize: () => data("items")`;
3. la GET restituisce `items.read()` e, se serve, `applyListQuery: true` per conservare filtri e
   paginazione;
4. la POST valida il body e usa `items.mutate(draft => ...)` per aggiungerlo atomicamente;
5. prima di ogni prova si ferma il polling del frontend e si azzera `items` da **Dati → Stato
   runtime** o dall'Admin API; la GET seguente riparte dal file seed.

Il file non viene riscritto: è la baseline versionata in git, mentre gli item aggiunti vivono
solo nel processo. Più browser condividono la stessa risorsa. Se la forma cambia, si incrementa
la `seedKey`, si trova dal Monitor qualunque handler rimasto alla firma precedente e si esegue
un reset esplicito. Riavvio o cambio effettivo del motore azzerano comunque tutto.

## «La funzione nuova è pronta, il suo backend no»

Una funzione del frontend ha bisogno di endpoint nuovi, e chi lavora al backend non riesce a
consegnarli nello stesso momento: coordinarsi così puntualmente sulla stessa funzione è raro. I
mock diventano parte della funzione, finché il backend non arriva:

1. si creano i mock degli endpoint nuovi e li si lascia **accesi**: si lavora contro di loro
   fino a funzione finita, poi li si committa così;
2. la funzione entra nel ramo di sviluppo del frontend. Da quel momento il frontend **dipende**
   da quegli endpoint: chiunque lo avvii ha bisogno che rispondano, e che lo faccia il mock o il
   backend poco cambia. È git a consegnare a tutti i mock già accesi, con la variante giusta;
3. quando il backend conferma di averli implementati, i mock si **spengono**: un altro
   salvataggio e un altro commit, e da lì le richieste di tutti passano al backend.

È il motivo per cui accendere, spegnere e scegliere la variante **salvano nei file**: qui lo
stato di un endpoint è una decisione del team, e deve arrivare ai colleghi come ci arriva il
codice. I due scenari che seguono sono l'altro caso — uno stato che dura quanto un debug o un
test, e che in git non deve arrivare.

## «Questo caso non riesco a riprodurlo»

Un 500, un timeout, una lista vuota, un dataset patologico: si fissa la risposta di **quel
singolo endpoint** — una [variante](RESPONSE.md) dedicata, o un [ritardo](RITARDI.md) per il
timeout — e si lascia passare tutto il resto. Le varianti restano nel workspace: il caso
difficile si rievoca quando serve di nuovo.

Spesso l'endpoint esiste già nel backend, e il mock serve solo a farsi restituire i dati che
innescano un bug: risolto il bug — di solito in giornata — deve tornare a rispondere il
backend. Lo si accende in [stato temporaneo](CATALOGO.md#stato-temporaneo):

1. se il caso che innesca il bug non c'è ancora, si crea una variante apposta, senza «Attiva
   subito», o si ritoccano i dati di una esistente. Questo è contenuto, e si salva nei file
   come sempre: a bug risolto si decide se tenerlo, per rievocare il caso, o scartarlo con git;
2. dal pulsante con l'orologio si accende l'endpoint **temporaneamente** e, se serve, si fa
   servire temporaneamente quella variante;
3. a bug risolto, **Torna a come è salvato**: le richieste tornano al backend. Anche
   dimenticandolo, il file dice ancora `"enabled": false`: non finisce acceso in un commit per
   distrazione, e un riavvio lo spegne comunque.

## «I test end-to-end hanno bisogno ognuno del suo mondo»

Un repository di mock dedicato ai test, in cui **tutto è spento**: ogni test dichiara lo
scenario che gli serve — quali endpoint rispondono, e con quale variante — e il successivo
dichiara il suo, magari con un'altra variante degli stessi endpoint.

1. il test, nella sua preparazione, chiama una sola volta
   [`PUT /activation`](ADMIN-API.md#attivazioni-temporanee) con l'elenco degli endpoint da
   accendere e la variante di ciascuno;
2. la dichiarazione **sostituisce** quella precedente: ciò che il test non nomina torna spento,
   quindi non serve una chiusura, e un test interrotto non lascia nulla al successivo;
3. niente viene scritto nei file: il repository resta com'è in git, qualunque cosa succeda
   durante l'esecuzione.

Prima dello stato temporaneo lo stesso test accendeva gli endpoint salvandoli e li rispegneva
alla fine: un'esecuzione interrotta lasciava i file modificati, e il test dopo partiva da uno
scenario che non era il suo.

Nell'app desktop il repository dei test si apre in una scheda sua, accanto al workspace su cui
si sviluppa: ogni workspace ha il proprio motore, sulla propria porta, e il proprio stato
temporaneo. Lo scenario di un test non tocca l'altro workspace.

Il motore è uno per workspace: i test che cambiano scenario girano uno alla volta contro la
stessa istanza.

## Salvare, o stato temporaneo?

| Situazione | Gesto | Dove vive | Chi lo riceve |
|---|---|---|---|
| I mock di una funzione il cui backend non c'è ancora | interruttore e tendina delle varianti | nei file, in git | tutto il team, e lo [staging](STAGING.md) |
| Il backend ha consegnato: si passa al reale | interruttore (spento) | nei file, in git | tutto il team |
| Un mock acceso per riprodurre un bug | pulsante con l'orologio | nella memoria del motore | solo chi usa quel motore, fino al riavvio |
| Lo scenario di un test | `PUT /activation` | nella memoria del motore | solo quel test |

La domanda che decide è una: **i colleghi devono ritrovarselo così?** Se sì, si salva. Se
serve soltanto adesso, è stato temporaneo.
