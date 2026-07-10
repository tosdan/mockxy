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
al middleware coinvolto, più header e body di richiesta e risposta.

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
vero per catturare» ([il flusso completo](PROXY.md)). Il badge «Live / In pausa» in testa alla
pagina riflette lo stato della connessione live dell'interfaccia (gli aggiornamenti arrivano in
streaming), non un interruttore a sé.

## La pagina

La lista si filtra per testo libero, metodo, classe di status e provenienza della risposta —
il filtro «Servita da», con una voce per ciascuna provenienza (mock, proxy, handler,
middleware, miss) più la voce combinata «**Backend vero**»: tutto ciò che non è uscito dai
mock o dagli handler del workspace, la vista naturale quando si osserva il traffico che passa
dal backend reale. Il dettaglio di una voce mostra richiesta e risposta complete (header e
body), si esporta in JSON e si copia come comando cURL pronto da rieseguire; dalle voci
servite da un mock si salta direttamente all'endpoint che le ha generate. La lista si può
ripulire in ogni momento (l'archivio su disco non ne è toccato).

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
