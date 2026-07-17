# 10 — Il templating: risposte che fanno eco alla richiesta

Un mock statico risponde sempre la stessa cosa — ed è un limite che si incontra presto.
`GET /api/utenti/42` e `GET /api/utenti/99` ricevono lo stesso body, e il frontend che mostra
«utente 42» dopo aver chiesto il 99 rende i giri di prova confusi. Il **templating** risolve
questa classe di problemi senza scrivere codice: con l'interruttore **Template** attivo sulla
response, i placeholder `{{...}}` nel body e negli header vengono sostituiti con valori presi
dalla richiesta.

## Prima e dopo

Il mock statico:

```json
{ "id": 1, "nome": "Utente demo", "ruolo": "user" }
```

Lo stesso mock, templato:

```json
{
  "id": "{{params.id | number}}",
  "nome": "Utente {{params.id}}",
  "ruolo": "{{query.ruolo}}",
  "richiestoAlle": "{{now}}"
}
```

Ora `GET /api/utenti/42?ruolo=admin` risponde `{"id": 42, "nome": "Utente 42", "ruolo":
"admin", "richiestoAlle": "2026-07-17T10:30:00.000Z"}` — e il 99 risponde con il 99. Il
templating funziona anche negli **header**: un `location: /api/utenti/{{params.id}}` su una
risposta 201 è il caso classico.

## Le sorgenti

| Placeholder | Valore |
|---|---|
| `{{params.<nome>}}` | il parametro di percorso (`:id` → `params.id`) |
| `{{query.<nome>}}` | il parametro di query (primo valore, se ripetuto) |
| `{{headers.<nome>}}` | l'header della richiesta (nomi in minuscolo) |
| `{{body.<percorso.a.punti>}}` | un campo del body JSON della richiesta, anche annidato (`body.cliente.email`) |

`body.*` è la sorgente che rende utile il templating sui `POST`: il mock di
`POST /api/ordini` può rispondere con un ordine che contiene i dati appena inviati dal form —
`{"cliente": "{{body.cliente.nome}}", "totale": "{{body.totale | number}}"}` — e il frontend
vede "salvato" esattamente ciò che ha spedito.

## Gli helper generati

| Helper | Valore |
|---|---|
| `{{now}}` | data/ora corrente in ISO 8601 |
| `{{nowMs}}` | epoch in millisecondi |
| `{{uuid}}` | un UUID nuovo a ogni richiesta |
| `{{randomInt min max}}` | un intero casuale nell'intervallo |

Gli usi tipici: `uuid` per l'id della risorsa «appena creata» da un POST, `now` per i campi
`createdAt`/`updatedAt` che devono sembrare freschi, `randomInt` per dati che devono variare
tra una richiesta e l'altra (un contatore di notifiche, un prezzo).

## Il filtro dei tipi

I placeholder producono stringhe — ma un JSON realistico ha numeri e booleani veri. Quando
**l'intero valore** di una stringa è un singolo placeholder, il filtro dopo la barra
verticale ne converte il tipo:

- `"{{params.id | number}}"` → `42` (senza virgolette; non numerico → `null`);
- `"{{query.attivo | boolean}}"` → `true`/`false`;
- `"{{body.indirizzo | json}}"` → il sotto-albero del body della richiesta, così com'è —
  utile per far rimbalzare intere strutture.

La regola va ricordata: il filtro vale solo quando il placeholder è **da solo** nel valore.
`"Utente {{params.id | number}}"` resta una stringa — la conversione di tipo dentro un testo
non avrebbe senso.

## Tolleranza e limiti

- **Placeholder non risolto** (un typo, un parametro assente): la risposta esce comunque —
  stringa vuota, o `null` con un filtro — e il motore logga un warning con il placeholder
  incriminato. Un errore di battitura non rompe il giro di prova.
- **Escape**: `\{{` produce `{{` letterale, per i rari body che contengono davvero doppie
  graffe.
- Il template si applica **prima** di paginazione e filtri automatici: un body-lista templato
  vi partecipa come uno statico.
- **Non ammesso sulle risposte con payload file** (la sorgente «File» del capitolo 9).
- **Niente condizioni, cicli o espressioni.** È una scelta di progetto: il templating copre
  l'eco dei valori, non la logica. Quando serve un `if` — «se manca il campo X rispondi
  400» — il gradino giusto è l'handler ([capitolo 15](15-handler.md)).

> 📷 **SCREENSHOT** — `10-editor-template.png`
> Cosa mostrare: l'editor della response con l'interruttore Template attivo e un body che usa
> più sorgenti e helper (params, query, body.*, now, uuid, un filtro `| number`).

> 📷 **SCREENSHOT** — `10-monitor-risolto.png`
> Cosa mostrare: il dettaglio nel monitor di una richiesta servita da quel mock, con il body
> di risposta a placeholder risolti — l'id della richiesta rimbalzato nel body, il timestamp
> reale. Il "dopo" dello screenshot precedente.

Il templating rende dinamico il singolo valore; il prossimo capitolo rende dinamica
un'intera lista — paginazione e filtri automatici sui body array:
[capitolo 11](11-liste-paginazione-filtri.md).
