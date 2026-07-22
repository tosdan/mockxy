# 20 — Il monitor

Il monitor è il secondo pilastro di Mockxy, accanto al proxy: la vista in tempo reale di
**tutto il traffico** che attraversa il motore — mockato e proxato — con il dettaglio
completo di ogni scambio. È lo strumento di diagnosi quotidiano («cosa è arrivato davvero?
chi ha risposto?») e, dal prossimo capitolo, la sorgente da cui i mock si creano con un
click.

> 📷 **SCREENSHOT** — `20-monitor-panoramica.png`
> Cosa mostrare: il monitor pieno di traffico misto — voci servite da mock, handler e
> backend — con la colonna della provenienza ben leggibile, le statistiche in testa
> (richieste, errori, ms medi) e la barra dei filtri visibile.

## Cosa viene registrato

Ogni richiesta servita dal motore, con tre esclusioni deliberate: il traffico dell'admin API
e dell'interfaccia stessa (`/_admin/...`), i preflight CORS automatici, e le connessioni di
upgrade WebSocket (che non attraversano la pipeline HTTP).

La voce viene scritta a risposta completata e contiene metodo, percorso e URL completo,
status, latenza, la **provenienza** — gli stessi valori dell'header `x-mock-source`, di cui
il monitor è la legenda visiva — la rotta abbinata, e header e body di richiesta e risposta.
Per gli endpoint con una sequenza attiva, la voce registra anche lo step che ha servito la
richiesta (badge **SEQ n/m**, [capitolo 12](12-sequenze.md)).

### I limiti di cattura

Tre regole da conoscere, perché spiegano cosa si vede (e cosa no):

- gli **header sensibili** — `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`,
  `X-Api-Key`, `X-Auth-Token` — vengono **mascherati (`***`) già alla cattura**: i segreti
  non entrano né nella vista né negli archivi su disco. Il resto del payload può comunque
  contenere dati personali — è il motivo per cui gli archivi restano fuori da git;
- i **body** vengono catturati fino a **156 KB** ciascuno: oltre, la preview è troncata e la
  voce lo dichiara, con il conteggio reale dei byte;
- i payload **compressi** vengono decompressi per la preview (se non troncati); i **binari**
  mostrano un segnaposto con la dimensione; il JSON viene riformattato leggibile.

La vista live tiene in memoria le ultime **250 richieste**: per la finestra oltre, c'è
l'archivio su disco del [capitolo 22](22-storico-dump.md).

## Quando registra

La registrazione segue l'interruttore globale del server ([capitolo 5](05-tour-interfaccia.md)):
a server spento il monitor è fermo; in **proxy totale resta attivo** — è proprio la modalità
«osserva il backend vero per catturare». Il badge «Live / In pausa» in testa alla pagina
riflette lo stato della connessione live dell'interfaccia (gli aggiornamenti arrivano in
streaming), e l'interruttore di pausa nella runtime bar sospende l'aggiornamento della vista.

## Leggere la lista

Le colonne: metodo e percorso, status, provenienza, latenza e ora. I filtri, combinabili:

- **testo libero** su path e URL;
- **metodo** HTTP;
- **classe di status** (2xx … 5xx);
- **provenienza** («Servita da») — una voce per ciascun valore (mock, handler, middleware,
  proxy, miss) più la voce combinata **«Backend vero»**: tutto ciò che *non* è uscito dai
  mock o dagli handler del workspace — la vista naturale quando si osserva il traffico che
  passa dal backend reale.

Il pulsante **«Pulisci»** svuota la lista live in ogni momento (l'archivio su disco non ne è
toccato); **«Esporta»** salva le voci in JSON.

> 📷 **SCREENSHOT** — `20-monitor-filtri.png`
> Cosa mostrare: il monitor con il filtro provenienza impostato su «Backend vero» e la lista
> ridotta di conseguenza; visibili anche i filtri per metodo e classe di status.

## Il dettaglio di una voce

Selezionando una voce si apre il dettaglio, in quattro sezioni: header e body della
richiesta, header e body della risposta (i pannelli si ridimensionano trascinando il
divisore). Da qui:

- **copia come cURL** — il comando pronto da rieseguire in terminale: la via più rapida per
  riprodurre una chiamata fuori dal browser, allegarla a una issue, o ripeterla variando un
  parametro;
- **esporta** la voce in JSON;
- **«Apri la definizione nel catalogo»** — sulle voci servite da un mock, il salto diretto
  all'endpoint che le ha generate;
- **«Vai al mock»** — sulle voci passate dal backend la cui rotta è *oggi* coperta da un
  endpoint del catalogo, il collegamento all'endpoint (segnalato anche quando è
  disabilitato). La copertura è calcolata al momento: il badge compare e scompare seguendo
  l'evoluzione del catalogo, la voce catturata non viene mai alterata.

> 📷 **SCREENSHOT** — `20-monitor-dettaglio.png`
> Cosa mostrare: il dettaglio di una voce con le quattro sezioni richiesta/risposta ×
> header/body visibili e le azioni (cURL, esporta) in evidenza.

## Il metodo di lavoro

Il monitor è il secondo passo fisso della diagnosi introdotta nel capitolo 2: prima
`x-mock-source` sulla risposta (chi ha risposto), poi il monitor (cosa è arrivato e cosa è
stato deciso), poi il log (gli errori con il file incriminato). La maggior parte dei «perché
il mock non risponde?» si risolve qui, guardando il percorso *davvero* chiamato e la
provenienza *davvero* assegnata — il [capitolo 33](33-troubleshooting.md) cataloga i casi.

Osservare è metà del lavoro; l'altra metà è **catturare**: trasformare le voci del monitor in
mock, una alla volta o in blocco — [capitolo 21](21-cattura-mock.md).
