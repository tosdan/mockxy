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

## «Questo caso non riesco a riprodurlo»

Un 500, un timeout, una lista vuota, un dataset patologico: si fissa la risposta di **quel
singolo endpoint** — una [variante](RESPONSE.md) dedicata, o un [ritardo](RITARDI.md) per il
timeout — e si lascia passare tutto il resto. Le varianti restano nel workspace: il caso
difficile si rievoca con un interruttore, quando serve di nuovo.
