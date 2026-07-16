# Design — Templating nei mock statici (proposta, da discutere)

Stato: **bozza per discussione** — non implementato.

## Il problema

Oggi tra «body completamente statico» e «scrivere un handler» non c'è niente in mezzo. Ma il
caso più frequente di dinamicità è banale: *l'id che mi chiedi te lo rimetto nella risposta*.

```
GET /api/utenti/42  →  { "id": 42, "nome": "Ada" }
```

Per ottenerlo oggi serve un handler JavaScript: sproporzionato per «ripeti un parametro».
Gli altri mock server lo risolvono con il **templating nel body**: WireMock (Handlebars,
opt-in per stub), Mockoon (Handlebars + faker, sempre attivo), Prism (esempi dinamici dalla
specifica). L'obiettivo è lo stesso: **ridurre i casi in cui serve davvero un handler**,
lasciando agli handler la logica vera (condizioni, lookup nei dati, stato).

## Il principio

**Sostituzione di valori, non linguaggio di programmazione.** Il template sa *ripetere* cose
note della richiesta (path param, query, header, body) e produrre pochi valori generati (ora,
uuid, numero casuale). Niente `if`, niente cicli, niente espressioni: appena serve logica, il
gradino giusto è l'handler — il templating non deve diventarne una brutta copia.

**Opt-in per variante.** I body esistenti possono contenere `{{...}}` letterali (esempi di
documentazione, payload di altri sistemi): il templating si attiva con un flag sulla variante,
mai di default, e nessun mock esistente cambia comportamento.

## MVP

### Attivazione e sintassi

Nel file della variante mock, un flag:

```json
{
  "type": "mock",
  "title": "Dettaglio utente",
  "status": 200,
  "templated": true,
  "body": {
    "id": "{{params.id | number}}",
    "nome": "Utente {{params.id}}",
    "filtro": "{{query.ruolo}}",
    "richiestoAlle": "{{now}}",
    "tracciamento": "{{uuid}}"
  }
}
```

Placeholder `{{ ... }}` con queste sorgenti:

- **`params.<nome>`** — parametri di percorso della rotta (`/api/utenti/:id` → `params.id`),
  già percent-decodificati;
- **`query.<nome>`** — parametri di query (primo valore, se ripetuto);
- **`headers.<nome>`** — header della richiesta, nomi in minuscolo;
- **`body.<percorso>`** — il body JSON della richiesta, con percorso a punti
  (`body.utente.email`); utile per i POST che "ripetono" ciò che hanno ricevuto;
- **helper generati**: `now` (ISO 8601), `nowMs` (epoch ms), `uuid`, `randomInt min max`.

### I tipi: il filtro `| number` / `| boolean` / `| json`

Il problema classico: `"id": "{{params.id}}"` produce `"id": "42"` (stringa), ma il contratto
vuole un numero. Quando **l'intero valore stringa è un solo placeholder** con filtro, il nodo
JSON viene sostituito *senza virgolette*:

- `"id": "{{params.id | number}}"` → `"id": 42` (se non è un numero valido → `null`);
- `"attivo": "{{query.attivo | boolean}}"` → `true`/`false` (`"true"`/`"1"` → true);
- `"extra": "{{body.extra | json}}"` → il sotto-albero JSON così com'è.

In ogni altra posizione (placeholder immerso in testo) il risultato è testuale. Nessun filtro
concatenato, nessuna pipeline: un filtro solo, per il solo problema dei tipi.

### Dove si applica

- **`body` JSON** — attraversamento dell'albero, sostituzione dentro le stringhe;
- **`body` stringa** (testo/XML/CSV) — sostituzione nel testo;
- **header della risposta** — stessa sostituzione (es. `Location: /api/utenti/{{params.id}}`);
- **non** sui payload `file` (serviti in streaming: non si tocca il contenuto su disco).

Ordine nel serving: prima il template, **poi** paginazione e filtri automatici — un body array
templato partecipa a `?page=&size=` come uno statico.

### Valori mancanti

Un placeholder che non risolve (query assente, campo del body inesistente) produce **stringa
vuota** (`| number`/`| json` → `null`); il motore logga un warning con il placeholder e il
percorso, così l'errore di battitura si vede subito nel log e nel monitor (body strano) senza
far fallire la risposta. Escape: `\{{` produce `{{` letterale.

### UI

- Nell'editor della variante mock, toggle **«Template»** (mappa `templated`);
- con il toggle attivo, un'**anteprima renderizzata**: la UI conosce i parametri della rotta e
  propone campi di prova (`id = 42`, query libere) mostrando il body risultante — l'errore di
  sintassi si vede prima di salvare;
- badge/hint sulla variante templata nella lista delle response.

### Validazione ed errori

- `templated` booleano; il template non si valida "a fondo" al load (i placeholder ignoti sono
  warning a runtime, non errori di caricamento): un typo non deve degradare l'endpoint;
- nessuna esecuzione di codice: solo lookup su sorgenti note e helper in whitelist — superficie
  di sicurezza invariata (a differenza dei template engine completi).

## Potenziamenti progressivi

1. **Lookup nei file dati** — `{{data.utenti | find id=params.id | json}}`: il caso «rispondi
   l'elemento del dataset che corrisponde al parametro» senza handler. Da disegnare con cura:
   è il confine oltre il quale il template diventa un linguaggio (forse è già oltre).
2. **Subset faker** — `{{faker.nome}}`, `{{faker.email}}`: dati verosimili per liste generate.
   Con seed opzionale per risposte riproducibili.
3. **Templating nei copioni SSE** — i `data` degli eventi (vedi DESIGN-SSE.md) riflettono
   `params`/`query` della connessione.
4. **Autocomplete nell'editor** — suggerimento dei placeholder disponibili (i param della
   rotta sono noti) mentre si digita `{{`.
5. **Generazione di liste** — `repeat`/range alla Mockoon. Da valutare con scetticismo: è già
   logica, e la risposta oggi è «usa un handler» o «usa un file dati».

## Non-obiettivi

- condizionali, cicli, espressioni aritmetiche — è il territorio degli handler;
- templating dei payload `file` (streaming);
- compatibilità di sintassi con WireMock/Mockoon: si imita l'idea, non il dialetto.

## Questioni aperte

1. Sintassi del filtro: `{{params.id | number}}` (proposto) o stile helper `{{number params.id}}`?
2. Placeholder mancante = stringa vuota + warning (proposto), oppure risposta `500`/`400`
   esplicita? La vuota non rompe i giri di prova, l'errore esplicito si nota di più.
3. Il templating negli **header** della risposta: dentro l'MVP (proposto, costa poco) o dopo?
4. `templated` per variante (proposto) o per endpoint? Per variante è più chirurgico: la
   variante "piena" statica e la "eco" templata convivono.
5. `query.<nome>` con parametro ripetuto: primo valore (proposto) o join con virgola?
