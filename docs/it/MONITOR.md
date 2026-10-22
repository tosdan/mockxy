# Il monitor

Il monitor è il secondo pilastro di Mockxy, accanto al proxy: **osserva il traffico reale** —
mockato e proxato — e permette di **trasformarlo in mock** con un click. È lo strumento con cui
il confine mock/reale si sposta nella pratica: si naviga l'applicazione contro il backend vero,
si guarda cosa è passato, e ciò che serve diventa un mock.

La vista live tiene in memoria le ultime **250 richieste**; oltre quella finestra, il traffico
viene archiviato su disco dai dump del monitor (la pagina «Storico dump» dell'interfaccia), con
rotazione e retention configurabili — vedi [CONFIGURAZIONI.md](CONFIGURAZIONI.md).

## Cosa viene registrato

Ogni richiesta servita dal motore, con tre esclusioni deliberate: il traffico dell'admin API e
dell'interfaccia (`/_admin/...`), i [preflight CORS automatici](CORS.md) e le [connessioni di
upgrade](WEBSOCKET.md), che non attraversano la pipeline HTTP.

La voce viene scritta **a risposta completata** e contiene: metodo, percorso e URL completo,
status, latenza, la **provenienza** (gli stessi valori dell'header `x-mock-source` — la
[tassonomia](PROXY.md) è la legenda del monitor), la rotta abbinata e gli eventuali riferimenti
al middleware coinvolto, più header e body di richiesta e risposta. Per gli endpoint con una
[sequenza di varianti](ENDPOINT.md) la voce registra anche **lo step che ha servito la
richiesta** (posizione e variante, badge «SEQ n/m»): la progressione della sequenza si legge
scorrendo il monitor.

Se un errore non intercettato nasce dallo [stato runtime condiviso](HANDLER.md), la voce porta
anche `sharedStateError`: codice, nome della risorsa, `seedKey` richiesta/corrente e origine
dell'accesso, quando disponibili. La risposta HTTP resta deliberatamente sanitizzata e non
espone questi dettagli alla superficie pubblica del mock; il Monitor è invece amministrativo
ed è il percorso diagnostico anche per chiamate partite da `curl`, test o applicazioni esterne.
Il dettaglio offre **«Apri stato condiviso»**, che porta alla riga corrispondente in **Dati →
Stato runtime**. I metadati seguono la voce anche negli archivi su disco; non includono mai il
valore, il draft, il body della richiesta o lo stack.

## Mascheramento e limiti di cattura

- Gli header sensibili — `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`,
  `X-Api-Key`, `X-Auth-Token` — vengono **mascherati** (`***`) già alla cattura: i segreti non
  entrano né nella vista né negli archivi su disco. Il resto del payload, però, può comunque
  contenere dati personali: è il motivo per cui gli archivi restano fuori da git.
- I body vengono catturati fino a **156 KB** ciascuno: oltre, la preview è troncata (e la voce
  lo dichiara, insieme al conteggio reale dei byte).
- I payload **compressi** vengono decompressi per la preview; se la cattura è troncata la
  decompressione non è possibile e resta un segnaposto con la dimensione. I payload **binari**
  mostrano un segnaposto con il conteggio dei byte. Il JSON viene riformattato leggibile.

## Quando registra

La registrazione segue l'interruttore globale del **server**: a server spento il monitor è
fermo; in modalità **proxy totale** resta attivo — è proprio lo scenario «osserva il backend
vero per catturare» ([il flusso completo](PROXY.md)). La cattura live dell'interfaccia (gli
aggiornamenti arrivano in streaming) si mette in pausa e si riprende dalla barra in alto, dove
compare come «Monitor live / in pausa»; quando è in pausa la testata della pagina lo dice, perché
spiega come mai la lista non si muove.

## La pagina

La testata conta le richieste; con un filtro acceso mostra quante ne restano sul totale. Ogni
voce dice da dove viene con un'icona e un nome: documento per i mock, ƒ per gli handler, due
cerchi per i middleware, server per il proxy, antenna per SSE, doppia freccia per WebSocket,
lente barrata per i miss. Una barra ambra a sinistra segna le richieste **non mockate**: quelle
non servite da un mock, un handler o uno stream SSE o WebSocket del workspace, cioè passate dal
backend (proxy, middleware) o rimaste senza mock né backend a cui girarle.

La lista si filtra per testo libero, metodo, classe di status e provenienza della risposta —
il filtro «Servita da», con una voce per ciascuna provenienza (mock, proxy, handler,
middleware, miss) più la voce combinata «**Backend vero**», che tiene proprio le non mockate:
la vista naturale quando si osserva il traffico che passa dal backend reale. Il chip «N non
mockate» in cima alla lista accende e spegne quel filtro con un clic. I chip delle classi di
status contano le proprie voci fra quelle che passano gli altri filtri, così 4xx e 5xx dicono
quanti errori ci sono e di che tipo.

Le voci si selezionano come nel catalogo: il clic sulla riga la apre nel dettaglio, il clic
sulla sua casella la spunta (con Maiuscole l'intervallo dall'ultima spuntata). Da tastiera le
frecce, Home e Fine si spostano fra le voci e le aprono, Spazio spunta quella attiva e
Maiuscole+Spazio l'intervallo. Con una selezione compare in fondo alla lista la barra delle
azioni: crea i mock delle voci spuntate, con l'opzione di attivarli subito. Dal menu «⋮» della
testata si sceglie la **densità compatta**, una riga per voce, ricordata alla visita successiva.

Il dettaglio di una voce mostra richiesta e risposta complete (header e body), si esporta in
JSON e si copia come comando cURL pronto da rieseguire; dalle voci servite da un mock si salta
direttamente all'endpoint che le ha generate. La lista si può ripulire in ogni momento
(l'archivio su disco non ne è toccato).

## Da traffico a mock

Dal dettaglio di una voce — o in blocco, selezionando più voci — si crea un mock con la
struttura già pronta: metodo e percorso dalla richiesta, status, header e body dalla risposta.
Le regole di travaso:

- gli header **mascherati** non finiscono nel mock (niente `***` fossilizzati), e nemmeno
  quelli che il server ricalcola da sé (`Content-Length` e simili);
- un body **non ricostruibile** — binario, o troncato perché oltre la soglia di cattura —
  produce comunque il mock, ma come **scheletro da completare**, marcato nella descrizione;
- gli header CORS della risposta catturata viaggiano nel mock come tutti gli altri: con
  l'opzione [CORS automatico](CORS.md) attiva è la policy del motore a vincere su di essi;
- se per quella rotta e metodo **l'endpoint esiste già**, invece di un errore l'app propone di
  aggiungere la response catturata come **nuova variante** dell'endpoint esistente: la variante
  viene creata col titolo «dal monitor · HH:mm:ss» e diventa quella **selezionata** (le altre
  restano intatte, pronte da riselezionare). La creazione **massiva** invece continua a saltare
  gli esistenti, di proposito: un batch non deve fare domande a raffica.

Il mock creato è un endpoint come gli altri ([file endpoint](ENDPOINT.md) + variante): si
ritocca dal catalogo o a mano, e da quel momento il confine mock/reale si è spostato di un
endpoint. Il toast di conferma offre la scorciatoia **«Apri il mock creato»**, e il dettaglio
di una entry backend mostra **«Vai al mock»** quando la sua rotta è *oggi* coperta da un
endpoint del catalogo (anche disabilitato, segnalato come tale). La copertura è un fatto
**derivato**, chiesto al motore al momento: la entry catturata non viene mai alterata, e il
collegamento appare o sparisce da solo seguendo l'evoluzione del catalogo.
