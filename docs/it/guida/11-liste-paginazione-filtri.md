# 11 — Liste con paginazione e filtri automatici

Quasi ogni frontend ha una tabella o un elenco con paginatore e ricerca — e mockarli con
risposte statiche sarebbe un incubo: servirebbe un mock per ogni combinazione di pagina e
filtro. Mockxy lo evita alla radice: quando il body di un mock è una **lista**, le richieste
possono paginarla e filtrarla con normali parametri di query, senza che il mock debba
prevedere nulla. Si definisce **una volta** il dataset completo, e tutte le combinazioni
vengono da sé.

## Quando si attiva

L'automatismo vale solo per i body **JSON di tipo mock** che sono:

- un **array** (`[ ... ]`), oppure
- un **oggetto con esattamente una proprietà array di primo livello** — il formato
  «involucro» comune, es. `{ "items": [...], "meta": {...} }`. La forma della risposta viene
  preservata: la pagina o il filtrato sostituiscono l'array, le altre proprietà passano
  intatte. Con due o più proprietà array l'automatismo non si attiva (non ci sarebbe un
  criterio per scegliere).

Restano fuori body testuali, payload da file, risposte di handler e middleware, e risposte
proxate. Un body templato ([capitolo 10](10-templating.md)) partecipa normalmente: il
template si applica prima.

## La paginazione

Si attiva quando **`page` e `size` sono entrambi presenti e validi**: `page` intero da `0` in
su (numerazione da zero), `size` intero da `1` in su.

```
GET /api/utenti?page=0&size=10   → i primi 10 elementi
GET /api/utenti?page=2&size=10   → dal 21° al 30°
```

Un solo parametro dei due, o valori invalidi, disattivano la paginazione: la risposta torna
intera, senza errori. Una pagina oltre la fine del dataset restituisce una **lista vuota**
con status invariato — esattamente ciò che i componenti di paginazione si aspettano.

## I filtri

Ogni parametro di query **il cui nome coincide con una chiave di primo livello** degli
elementi diventa un filtro di uguaglianza; i parametri che non corrispondono a nessuna chiave
vengono ignorati (il mock continua a rispondere anche a richieste con parametri estranei).

```
GET /api/utenti?ruolo=admin              → solo gli elementi con "ruolo": "admin"
GET /api/utenti?ruolo=admin&attivo=true  → AND tra parametri diversi
GET /api/utenti?ruolo=admin&ruolo=editor → OR tra i valori dello stesso parametro
```

Le regole di confronto:

- il confronto avviene sul valore **convertito a stringa**: `?id=3` trova sia `"id": 3` sia
  `"id": "3"`;
- di default è **case-insensitive** (`?ruolo=ADMIN` trova `"ruolo": "admin"`); si rende
  esatto con l'interruttore «Filtri case-insensitive» nelle impostazioni del workspace, o
  `CASE_INSENSITIVE_FILTERS=false` in headless. Il **nome** del parametro deve invece
  coincidere con la chiave esattamente, maiuscole comprese;
- partecipano solo chiavi di primo livello con **valori scalari** (stringhe, numeri,
  booleani): un filtro su una chiave annidata non è esprimibile;
- `page` e `size` sono riservati alla paginazione e non diventano mai filtri.

Il **filtro si applica prima della pagina**: `?ruolo=admin&page=1&size=5` è la seconda pagina
dei soli admin.

## `X-Total-Count`

Con filtro o paginazione attivi, la risposta porta l'header **`X-Total-Count`**: il totale
degli elementi **dopo il filtro e prima della pagina** — il numero che serve al frontend per
calcolare quante pagine mostrare. Se il mock dichiara un proprio `x-total-count`, con gli
automatismi attivi vince il valore calcolato; senza, l'header dichiarato passa inalterato.

## In pratica: la tabella senza backend

Lo scenario completo: il frontend ha una tabella utenti con paginatore e filtro per ruolo, e
il backend non c'è. Si crea `GET /api/utenti` con un body-array di 50 utenti plausibili
(generarli è un buon lavoro per il preset «Lista paginata» come base, o per un ciclo in un
qualunque generatore) — e basta: il paginatore chiama `?page=N&size=10` e riceve le pagine
giuste con il totale nell'header, la tendina del ruolo chiama `?ruolo=admin` e riceve il
sottoinsieme. Un solo mock, l'intera griglia funzionante.

> 📷 **SCREENSHOT** — `11-lista-monitor.png`
> Cosa mostrare: il dettaglio nel monitor di una richiesta `GET /api/utenti?ruolo=admin&page=0&size=10`
> servita dal mock: nella risposta il body con i soli elementi filtrati della prima pagina e,
> negli header, `X-Total-Count` ben visibile.

## I limiti, dichiarati

L'uguaglianza è l'unico operatore: niente `>`/`<`, niente ricerca parziale (`?nome=mar` non
trova «Mario»), niente ordinamento, niente chiavi annidate. È una scelta di semplicità: copre
il grosso delle griglie reali, e quando il frontend ha bisogno di semantiche più ricche — la
ricerca full-text, il sort dal server — il gradino giusto è un handler che legge il dataset e
applica la logica vera ([capitolo 15](15-handler.md), con i dati tenuti fuori dal codice come
nel [capitolo 17](17-pagina-dati.md)).

Un'avvertenza già anticipata nel capitolo 7 e che qui morde davvero: una rotta con **query
dichiarata nel path** pretende l'uguaglianza esatta dell'intera query — `page`, `size` e i
filtri sono parametri in più, e quelle richieste non la raggiungono mai. Paginazione e filtri
automatici lavorano sui mock **senza** query nel path.

Finora l'endpoint risponde sempre allo stesso modo finché non si cambia variante a mano. Il
prossimo capitolo automatizza anche quello: le [sequenze di varianti](12-sequenze.md).
