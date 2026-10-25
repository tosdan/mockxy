# 14 — Simulare la lentezza: i ritardi

In locale ogni risposta arriva in pochi millisecondi, e il frontend sembra sempre perfetto:
gli spinner non si vedono mai, le race condition non si manifestano, i timeout non scattano.
Sono bug che si presentano solo dal cliente, su una rete vera. I ritardi simulati riportano
la latenza nel quadro durante lo sviluppo — per vedere l'interfaccia come la vedrà un utente
reale.

## I tre livelli

1. **Per variante** — il campo **Delay (ms)** nell'editor della response
   ([capitolo 9](09-editor-response-mock.md)): il ritardo di quella singola risposta. È lo
   strumento per il *singolo endpoint lento* — la ricerca pesante, l'export, l'upload — su
   cui il frontend deve mostrare uno stato di attesa dedicato.
2. **Globale** — un ritardo applicato a **tutti i mock che non dichiarano un delay proprio**:
   l'emulazione della rete lenta per l'intera applicazione. Regola di precedenza: quando una
   variante ha un delay maggiore di zero, **vince sul globale** — i due non si sommano.
3. **Anche sul proxy** — di default il ritardo globale riguarda solo i mock; l'opzione
   dedicata lo estende alle **richieste inoltrate al backend reale** (incluso il proxy
   totale). Il ritardo si applica prima dell'inoltro e si somma al tempo reale del backend;
   il timeout verso il backend non ne è consumato. Serve quando si vuole una lentezza
   uniforme su tutto, non solo sulla parte mockata.

Non ricevono mai ritardi: le risposte degli **handler** (uno script che vuole essere lento
attende al proprio interno, con un timer), e le risposte di servizio del motore (il 404
solo-mock, il 501 senza backend, i preflight CORS).

## Dove si configura

- **Per variante**: il campo Delay nell'editor della response.
- **Globale e proxy** — a seconda della forma di esecuzione:
  - app desktop: impostazioni del workspace, «Ritardo globale (ms)» e «Ritardo anche sul
    proxy» (al salvataggio il motore del workspace riparte);
  - riga di comando: `node index.js --delay=500 --delay-all` (o
    `npm run dev:backend -- --delay=500`);
  - Docker Compose: le variabili `MOCKXY_DELAY` e `MOCKXY_DELAY_ALL`, che il compose traduce
    nei flag di lancio.

> 📷 **SCREENSHOT** — `14-impostazioni-ritardi.png`
> Cosa mostrare: la sezione Comportamento della dialog impostazioni workspace con «Ritardo
> globale (ms)» valorizzato (es. 800) e l'interruttore «Ritardo anche sul proxy» visibile.

## Cosa guardare nel frontend

Qualche verifica che i ritardi rendono finalmente possibile:

- **stati di caricamento**: spinner e skeleton compaiono davvero? restano visibili senza
  "lampeggiare"? scompaiono al momento giusto?
- **protezione dal doppio invio**: con un `POST` da 2 secondi, il pulsante di submit si
  disabilita? cliccare due volte crea due risorse?
- **race condition**: due richieste in volo che tornano in ordine inverso (una ricerca lenta
  superata dalla successiva) — la UI mostra il risultato giusto o l'ultimo arrivato?
- **timeout e annullamento**: con un delay per variante superiore al timeout del client HTTP
  del frontend, scatta la gestione d'errore prevista? La navigazione via da una pagina
  annulla le richieste pendenti?

Il pattern operativo tipico: ritardo globale moderato (300–800 ms) sempre attivo durante lo
sviluppo, per vivere l'app a velocità realistica; delay puntuali e generosi (3000+ ms) sulle
varianti degli endpoint di cui si sta curando lo stato di attesa; una variante con delay
oltre il timeout del client per provare il caso limite.

Qui si chiude la parte II: mock statici, con tutte le loro leve. La parte III passa alle
risposte che *calcolano* — a cominciare dagli [handler JavaScript](15-handler.md).
