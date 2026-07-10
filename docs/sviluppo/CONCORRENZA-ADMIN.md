# Mutazioni concorrenti dell'admin API — analisi e posizione

Nato dalla code review del 9 luglio 2026 (scheda `archived/code-review-2026-07-09/02-bug-admin-ereditati.md`,
punto 7, l'unico finding di quel documento rimasto aperto). Questo documento sviscera il problema,
spiega perché il fix suggerito dalla review non è applicabile così com'è, e cataloga le soluzioni
possibili per il giorno in cui servissero.

## La posizione di prodotto (decisa il 9 lug 2026)

**L'uso previsto di Mockxy è mono-utente**: una persona, un'app desktop o una UI nel browser, che fa
una cosa alla volta. In questo perimetro il problema descritto qui sotto è praticamente
irraggiungibile. Usare l'admin API con strumenti esterni (script, client REST, automazioni che
sparano richieste in parallelo) è ammesso ma è un uso non previsto: **la correttezza sotto mutazioni
concorrenti non è una garanzia dell'applicazione**, e la responsabilità di serializzare le proprie
chiamate è di chi automatizza. Di conseguenza questo lavoro resta deliberatamente non fatto.

Il verdetto va rivisto solo se cambia il perimetro d'uso, cioè se si materializza almeno uno di
questi scenari:

- un'interfaccia admin **condivisa tra più utenti** contemporanei (es. un Mockxy di team con
  l'admin API esposta — oggi l'immagine standalone per ambienti condivisi ha l'admin spenta per design);
- **automazioni interne** dell'app che mutano il workspace in background mentre l'utente lavora
  (sincronizzazioni, import automatici, agenti);
- un'offerta hosted/multi-tenant.

## Il problema, nel dettaglio

Ogni mutazione admin (creare/modificare/cancellare endpoint e response, assegnare collection,
spegnimenti di massa) è una sequenza di **letture e scritture di file su disco** intervallate da
`await`. Niente impedisce a due mutazioni in volo nello stesso momento di intrecciarsi tra un
`await` e l'altro.

Lo stato attuale della protezione è asimmetrico:

- le operazioni che toccano lo stato delle collection (`.collections.json`) passano da una **coda
  per workspace**: `serializedByWorkspace` in `src/admin/collections-state.js` incatena le
  operazioni sullo stesso `mocksDir` una dietro l'altra (una catena di promise per workspace,
  righe ~597-618). Otto operazioni delle collection sono avvolte così;
- le mutazioni sui **file degli endpoint** (`src/admin/endpoint-operations.js`, tutte) e lo
  spegnimento di massa (`updateAdminCollectionEnabled` in `collection-operations.js`) **non passano
  da nessuna coda**.

### Gli intrecci possibili (race window)

Il pattern vulnerabile è sempre lo stesso: *read-modify-write* non atomico. Esempi concreti:

1. **Toggle di massa vs modifica puntuale** (il caso della review). `updateAdminCollectionEnabled`
   legge tutti i file endpoint della collection, poi li riscrive uno a uno col flag `enabled`
   cambiato. Se tra la lettura e la riscrittura di un file arriva una `PUT` che ne cambia la
   description, il toggle riscrive il file dal suo snapshot ormai vecchio: **la modifica
   concorrente è persa in silenzio**. Aggravante: se il toggle poi fallisce, il suo rollback
   (`commitWithRollback`) ripristina i backup presi *prima* del toggle su tutti i file — cancellando
   anche modifiche concorrenti andate a buon fine su file diversi.
2. **Due mutazioni sullo stesso endpoint**: due `PUT` simultanee sulla stessa response fanno ognuna
   il proprio read-modify-write; vince l'ultima scrittura, l'altra sparisce.
3. **Rollback che si pesta con una mutazione**: la busta transazionale (backup → scritture → reload
   → rollback su errore, `commitWithRollback` in `admin-fs.js`) assume di essere l'unica in corsa:
   un ripristino di backup concorrente a una scrittura altrui può riportare in vita uno stato misto.

Il danno massimo osservabile è la **perdita di una modifica** o il ripristino di uno stato
precedente: i file restano JSON validi e il runtime continua a servire. Non è corruzione, è lost
update.

## Perché il fix "ovvio" non funziona

La review suggeriva: estendere la serializzazione per workspace a tutte le mutazioni. Applicato
alla lettera, **deadlocka**. La coda è dichiaratamente non rientrante (commento a
`collections-state.js` ~597: "una funzione serializzata non deve mai chiamarne un'altra
serializzata") e oggi le mutazioni degli endpoint chiamano già funzioni serializzate al proprio
interno:

- `deleteAdminMock` invoca `removeCollectionMembership` (serializzata) dentro il proprio commit;
- l'import OpenAPI (`openapi-admin-import.js`) compone in loop `createAdminCollection`,
  `createAdminMock` e `assignAdminCollection`, le prime e l'ultima serializzate.

Avvolgendo anche le funzioni esterne nella stessa coda, la richiesta esterna terrebbe occupata la
coda in attesa di un'operazione interna accodata dietro di lei: blocco permanente.

## Le soluzioni possibili, se un giorno servisse

In ordine di preferenza per rapporto semplicità/rischio:

### 1. Gate a livello di router (consigliata come primo passo)

Serializzare le richieste HTTP mutanti (POST/PUT/PATCH/DELETE sotto `/_admin/api`) **per
workspace, all'ingresso**: un middleware nel router admin che tiene una catena di promise e fa
entrare una mutazione alla volta. La composizione interna resta com'è: la coda interna delle
collection non può mai trovarsi in competizione, perché a monte gira una sola richiesta mutante
alla volta — quindi niente deadlock e niente refactoring delle operazioni.

- Pro: poche righe, in un solo punto; chiude *tutte* le race tra richieste; zero cambi alle
  operazioni; le letture (GET) restano parallele.
- Contro: le operazioni lunghe (un import OpenAPI corposo) bloccano le altre mutazioni per la loro
  durata. Nel perimetro mono-utente è irrilevante; in uno scenario multi-utente è una latenza, non
  un errore.

### 2. Composizione esplicita con varianti "Unlocked"

Il pattern già usato dentro `collection-operations.js`: ogni operazione esiste in variante nuda
(`...Unlocked`) e la versione accodata avvolge solo il perimetro esterno. Estenderlo significa:
tutte le operazioni di `endpoint-operations.js` diventano `Unlocked`, gli usi interni
(`removeCollectionMembership` dentro la delete, le compose dell'import) chiamano le varianti nude,
e la coda avvolge soltanto ciò che il router espone.

- Pro: modello esplicito e leggibile; la granularità si sceglie caso per caso (es. l'import può
  accodarsi per singolo elemento invece che per l'intero batch).
- Contro: refactoring pervasivo (tutte le firme e gli export), rischio di regressione più alto;
  ogni nuova operazione deve ricordarsi la disciplina (una chiamata interna alla variante accodata
  reintroduce il deadlock in silenzio).

### 3. Lock rientrante

La coda riconosce se il contesto asincrono corrente detiene già il lock (un token propagato con
`AsyncLocalStorage`) e in quel caso esegue inline invece di accodarsi. Le operazioni non cambiano.

- Pro: nessun refactoring dei call site.
- Contro: è la soluzione più sottile da capire e da testare (i rami paralleli *dentro* un detentore
  del lock vanno pensati bene); il debugging dei problemi di lock rientranti è notoriamente ingrato.

### 4. Scartate

- **Lock a livello di singolo file** (o versioning ottimistico per file, stile ETag): granularità
  fine ma esplode la complessità (ordinamento dei lock per evitare deadlock tra file, gestione dei
  gruppi endpoint+response+collections) per un beneficio che nessuno scenario richiede.
- **Non fare nulla nemmeno in futuro**: se il perimetro diventa multi-utente, il lost update
  diventa un bug visibile e frequente; la posizione attuale vale solo dentro il perimetro dichiarato.

## Nota per chi riprende in mano il tema

Prima di implementare qualunque soluzione: rileggere l'esito della scheda 02 §7 della review (che
contiene la stessa conclusione in breve) e verificare se nel frattempo la composizione interna
delle operazioni è cambiata — l'inventario delle chiamate annidate fatto qui è del 9 lug 2026.
