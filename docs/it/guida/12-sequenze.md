# 12 — Le sequenze di varianti

Alcuni endpoint non hanno *una* risposta giusta: ne hanno una **serie**. Il caso simbolo è il
polling di un job asincrono — il frontend interroga `GET /api/jobs/42` a intervalli e si
aspetta di vedere «in coda», poi «in elaborazione», infine «completato». Con le sole varianti
del capitolo 8 bisognerebbe cambiare selezione a mano tra una richiesta e l'altra; una
**sequenza** lo fa da sola: dice all'endpoint di servire le varianti in ordine, ciascuna per
un numero di richieste o per una durata, e poi passare alla successiva.

La sequenza è una **politica di selezione sopra le varianti esistenti**: i contenuti restano
nelle normali response, la sequenza decide solo *quale* risponde a ogni richiesta. Ogni
variante servita segue le regole della propria natura — ritardi, paginazione automatica,
templating.

## La dialog

Il pulsante **Sequenza** nella scheda dell'endpoint apre la configurazione. Prerequisito:
almeno **due varianti di tipo mock o handler** (le varianti SSE e WebSocket non possono
essere step; i middleware nemmeno) — con una sola, la dialog invita a crearne un'altra.

I controlli:

- **Sequenza attiva** — l'interruttore generale. Da spenta, la definizione resta salvata ma
  l'endpoint torna alla selezione classica della variante.
- **Modalità** — come avanzano gli step:
  - **Per richieste**: ogni step risponde a N richieste, poi si passa al successivo;
  - **A tempo**: ogni step risponde per N millisecondi **dalla sua prima richiesta** (non
    dall'orologio del server: il conto parte quando qualcuno chiama).
- **Step** — la scaletta: ogni step indica la variante e il valore (volte o millisecondi);
  gli step si riordinano, si aggiungono e si eliminano. L'**ultimo step può non avere
  valore**: è lo stato terminale, quello marcato «finale». La stessa variante può comparire
  in più step (utile per «funziona → si rompe → torna a funzionare»).
- **Alla fine** — esaurito l'ultimo step: **Resta sull'ultimo** (default), o **Ricomincia**
  dal primo (in tal caso anche l'ultimo step deve avere un valore).
- **Auto-reset per inattività** — senza richieste per il tempo indicato, la sequenza riparte
  dal primo step alla chiamata successiva. È il dettaglio che rende le sequenze comode nelle
  prove manuali ripetute: il polling si ferma quando il frontend vede l'esito finale, si
  ricarica la pagina qualche minuto dopo, e la storia ricomincia da capo senza toccare nulla.

In fondo, la dialog mostra lo **stato runtime** — step corrente e richieste servite — e il
pulsante **«Riparti dall'inizio»** per azzerare subito il cursore.

Le validazioni: minimo 2 step, ogni step deve indicare una variante, ogni step non finale un
valore intero ≥ 1, e l'auto-reset un intero ≥ 1 (o vuoto per disattivarlo).

> 📷 **SCREENSHOT** — `12-sequenza-richieste.png`
> Cosa mostrare: la dialog compilata in modalità «Per richieste» con i 3 step dell'esempio
> del job (in coda ×2, in elaborazione ×3, completato finale), auto-reset valorizzato e la
> riga dello stato runtime visibile.

> 📷 **SCREENSHOT** — `12-sequenza-tempo.png`
> Cosa mostrare: la stessa dialog in modalità «A tempo», per documentare come cambiano i
> campi degli step (unità in ms).

## L'esempio guida: il job di export

L'endpoint `GET /api/export/:id/stato` ha tre varianti mock: «In coda»
(`{"stato": "QUEUED"}`), «In elaborazione» (`{"stato": "PROCESSING", "percent": 60}`),
«Completato» (`{"stato": "DONE", "url": "/api/export/42/download"}`). La sequenza: step 1
per 2 richieste, step 2 per 3 richieste, step 3 finale; alla fine «Resta sull'ultimo»;
auto-reset 30000 ms.

Il frontend avvia l'export e parte il polling: le prime due risposte dicono QUEUED, le tre
successive PROCESSING, poi DONE — e la UI attraversa spinner, barra di avanzamento e pulsante
di download, in un giro solo, senza backend. Mezzo minuto di pausa e si può riprovare da
capo.

La variante «a tempo» dello stesso schema serve per i casi guidati dall'orologio anziché dal
numero di chiamate: «il servizio risponde 503 per 30 secondi, poi si riprende» — due step,
il primo con la variante 503 per 30000 ms, il secondo finale con il 200.

## Come si riconosce una sequenza attiva

- nel **catalogo**, l'endpoint porta il badge **SEQ**;
- nella **scheda endpoint**, il tooltip avverte che l'endpoint sta servendo gli step, *non*
  la variante selezionata (la selezione classica resta definita, ma è la sequenza a
  comandare finché è attiva);
- nel **monitor**, ogni richiesta servita da una sequenza porta il badge **«SEQ n/m»** con lo
  step che l'ha servita: la progressione si legge scorrendo le voci — ed è anche il modo più
  rapido di verificare che la sequenza faccia ciò che ci si aspetta.

> 📷 **SCREENSHOT** — `12-monitor-seq.png`
> Cosa mostrare: il monitor con più richieste successive allo stesso endpoint e i badge di
> avanzamento SEQ 1/3 → 2/3 → 3/3 visibili nelle voci.

## Il cursore è stato runtime

La posizione della sequenza non è scritta su file: si azzera al riavvio del motore, con il
reset esplicito, per inattività, e quando la definizione della sequenza cambia. Le modifiche
all'endpoint che non toccano la sequenza (una descrizione aggiornata) non la azzerano. In
git, quindi, viaggia la *definizione* della sequenza, mai il suo stato momentaneo.

Con le sequenze si chiude la parte "automatica" dei mock statici. I prossimi due capitoli
sono più brevi e operativi: [copiare gli endpoint](13-copiare-endpoint.md) e
[simulare la lentezza](14-ritardi.md).
