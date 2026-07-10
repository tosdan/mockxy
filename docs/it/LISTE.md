# Liste: filtri e paginazione automatici

Quando il body di un [mock](RESPONSE.md) è una lista, Mockxy le dà comportamento da vera API:
le richieste possono **filtrare** gli elementi con parametri di query e **paginare** il
risultato, senza che il mock debba prevedere nulla. Si definisce una volta il dataset completo
e le combinazioni vengono da sé — l'alternativa sarebbe un mock per ogni combinazione di filtri
e pagine, cioè esattamente ciò che un mock server dovrebbe evitare.

Le due funzioni condividono la meccanica e l'header di conteggio, e il **filtro si applica
prima della pagina**: questa pagina le documenta insieme.

## Quando si attivano

Solo sui body **JSON di tipo `mock`** che sono:

- un **array** (`[ ... ]`), oppure
- un **oggetto con esattamente una proprietà array di primo livello** — ad esempio
  `{ "items": [...], "meta": {...} }`. La forma della risposta viene preservata: la pagina o il
  filtrato sostituiscono l'array, le altre proprietà passano intatte. Con due o più proprietà
  array l'automatismo non si attiva (non ci sarebbe un criterio per scegliere).

Restano fuori: body testuali, payload da `file`, risposte di handler e middleware, risposte
proxate.

## I filtri

Ogni parametro di query **il cui nome coincide con una chiave di primo livello di almeno un
elemento** della lista diventa un filtro di uguaglianza; tutti gli altri parametri vengono
ignorati (un mock esistente continua a rispondere anche a richieste con parametri estranei).

```
GET /utenti?ruolo=admin              → solo gli elementi con "ruolo": "admin"
GET /utenti?ruolo=admin&attivo=true  → AND tra parametri diversi
GET /utenti?ruolo=admin&ruolo=editor → OR tra i valori dello stesso parametro
```

Le regole di confronto:

- il confronto avviene sul **valore convertito a stringa**: `?id=3` trova sia `"id": 3` sia
  `"id": "3"`;
- di default è **case-insensitive** (`?ruolo=ADMIN` trova `"ruolo": "admin"`); si rende esatto
  con l'interruttore «Filtri case-insensitive» nelle impostazioni del workspace (app desktop) o
  con `CASE_INSENSITIVE_FILTERS=false` (headless). Il *nome* del parametro, invece, deve
  coincidere con la chiave esattamente, maiuscole comprese;
- partecipano solo chiavi di primo livello con **valori scalari** (stringhe, numeri, booleani):
  `null`, oggetti e array non combaciano mai — un filtro su una chiave annidata non è
  esprimibile;
- con almeno un filtro attivo, gli elementi della lista che non sono oggetti vengono esclusi
  dal risultato;
- `page` e `size` sono **riservati** alla paginazione e non diventano mai filtri;
- i valori ripetuti arrivano dalla query string grezza: `?a=1&a=2` è un OR reale anche quando
  il parser del framework li rappresenterebbe diversamente.

## La paginazione

Si attiva **solo quando `page` e `size` sono entrambi presenti e validi**: `page` intero da `0`
in su (numerazione da zero), `size` intero da `1` in su. Un solo parametro, o valori invalidi,
disattivano la paginazione — la risposta torna intera (eventualmente filtrata), senza errori.

```
GET /utenti?page=0&size=10            → primi 10 elementi
GET /utenti?ruolo=admin&page=1&size=5 → seconda pagina dei soli admin
```

Una pagina oltre la fine del dataset restituisce una lista vuota con status invariato: è il
comportamento che i componenti di paginazione dei frontend si aspettano.

## `X-Total-Count`

Quando filtro o paginazione sono attivi, la risposta porta l'header **`X-Total-Count`** con il
totale degli elementi **dopo il filtro e prima della pagina** — il valore che serve al frontend
per calcolare il numero di pagine. Se il mock dichiara un proprio header `x-total-count` (con
qualunque combinazione di maiuscole), con filtro o paginazione attivi **vince il valore
calcolato**; senza automatismi attivi, l'header dichiarato passa inalterato.

## Interazione con la query dichiarata nel path

Un mock il cui `path` dichiara una query string richiede l'**uguaglianza esatta dell'intera
query** (vedi [la convenzione dei path](PATH.md)): i parametri di filtro e paginazione sono
parametri in più, quindi quelle richieste non raggiungono la variante con query dichiarata.
Filtri e paginazione automatici lavorano al meglio sui mock **senza** query nel path, che
accettano qualunque query.
