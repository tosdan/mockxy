# 07 — Creare un endpoint e capire i path

Il primo mock si crea dal pulsante **«Nuovo»** del catalogo. La dialog chiede poco — metodo,
percorso, e il contenuto della prima risposta — ma il campo percorso merita più attenzione di
quanta sembri richiederne: le regole con cui Mockxy abbina le richieste ai percorsi dichiarati
sono la causa più frequente del dubbio «perché il mio mock non risponde?», e conoscerle in
anticipo evita quasi tutte le sorprese.

## La dialog «Nuovo»

I campi, nell'ordine:

- **Tipo** — la natura della prima variante dell'endpoint: mock statico, handler, middleware,
  SSE o WebSocket. In questo capitolo si crea un mock statico; per gli altri tipi la dialog
  sostituisce i campi della risposta con un editor di codice precompilato da un template di
  partenza (capitoli 15, 16, 18, 19).
- **Metodo** — il metodo HTTP: GET, POST, PUT, PATCH, DELETE…
- **Path** — il percorso, assoluto, con eventuali parametri (regole nella prossima sezione).
  La validazione segnala subito i problemi: il path deve iniziare con `/`, il carattere `^`
  è riservato all'uso interno, e il percorso deve essere compatibile con la convenzione
  delle collection.
- **Status e body** — lo status della risposta e il body, in modalità JSON (con validazione:
  un JSON rotto non si salva) o testo, oppure un file trascinato nella zona di drop. Sono gli
  stessi controlli dell'editor delle response, descritti per esteso nel
  [capitolo 9](09-editor-response-mock.md).

Alla conferma l'endpoint compare nel catalogo (in Unsorted, pronto da spostare in una
collection) ed è **subito attivo**: la prossima richiesta che combacia riceve il mock. Su
disco è nato un file endpoint con la sua cartella delle risposte — l'anatomia è nel
[capitolo 24](24-mock-come-file.md).

> 📷 **SCREENSHOT** — `07-dialog-nuovo.png`
> Cosa mostrare: la dialog «Nuovo» compilata per un mock statico realistico — es.
> `GET /api/utenti/:id` con status 200 e un body JSON di esempio — pronta alla conferma.

> 📷 **SCREENSHOT** — `07-dialog-errore-path.png`
> Cosa mostrare: la stessa dialog con un errore di validazione del path visibile (es. un
> percorso senza `/` iniziale e il relativo messaggio).

## Il formato del percorso

Il percorso dichiara cosa l'endpoint copre. Le forme possibili:

```
/api/utenti                  percorso esatto
/api/utenti/:id              parametro nominato
/api/utenti/:id/ordini/:num  più parametri
/api/utenti?attivo=true      percorso esatto + query richiesta
```

- **`:nome`** cattura un segmento di percorso: `/api/utenti/:id` combacia con
  `/api/utenti/42` e con `/api/utenti/mario`, e il valore catturato è disponibile a
  templating e handler. Un parametro copre **un** segmento: `/api/:id` combacia con `/api/42`
  ma non con `/api/42/extra`.
- Il pattern copre **l'intero percorso**, mai un prefisso: `/api/utenti` non combacia con
  `/api/utenti/extra`. È anche il motivo del più classico dei mancati match: l'applicazione
  chiama `/api/v2/utenti` e il mock dichiara `/api/utenti` — il prefisso di troppo (o in
  meno) esclude il match per intero.
- Un `*` jolly non è supportato, e `^` è vietato.

## La scelta avviene in due tempi

Quando arriva una richiesta, Mockxy sceglie l'endpoint in due passi, e l'ordine ha una
conseguenza precisa:

1. **prima il percorso** — tra le rotte registrate viene scelta la più specifica che combacia
   con percorso e query della richiesta;
2. **poi il metodo** — dentro la rotta scelta si cerca il metodo HTTP della richiesta.

La scelta del percorso è **definitiva**: se la rotta scelta non definisce il metodo
richiesto, la richiesta va al fallback — *non* viene cercata una rotta meno specifica che
magari quel metodo lo avrebbe. Esempio: con `/api/utenti/:id` che definisce solo `GET`, una
`POST /api/utenti/42` finisce al fallback anche se esistesse una rotta più generica con la
`POST`.

L'esito della decisione è sempre osservabile: l'header `x-mock-source` dice chi ha risposto,
e in modalità solo-mock il body del 404 riporta la ragione del mancato match —
`path_not_mocked` (nessuna rotta combacia) oppure `method_not_mocked` (rotta trovata, metodo
assente).

### La specificità

Quando più rotte potrebbero combaciare, vince la più specifica, in quest'ordine:

1. percorsi **esatti** prima di quelli con parametri — è così che `/api/utenti/me` può
   convivere con `/api/utenti/:id`: la richiesta `GET /api/utenti/me` prende la rotta esatta,
   tutte le altre (`/api/utenti/42`…) cadono sul parametro;
2. tra percorsi con parametri, vince chi ha **più segmenti statici**
   (`/api/utenti/:id` batte `/api/:risorsa/:id`);
3. a parità di percorso, la variante **con query dichiarata** viene provata prima della
   gemella senza;
4. i pareggi restanti si risolvono in modo deterministico, così il comportamento non cambia
   tra un riavvio e l'altro.

## La query dichiarata

Se il path include una query string, quella query diventa un requisito di **uguaglianza
esatta sull'intera query** della richiesta:

- l'ordine dei parametri non conta (`?a=1&b=2` ≡ `?b=2&a=1`);
- nomi e valori si confrontano case-sensitive;
- **niente parametri in più né in meno**: `/api/utenti?attivo=true` *non* combacia con
  `?attivo=true&page=0` — la richiesta con il parametro extra scivola sulla gemella senza
  query (se esiste) o al fallback.

L'ultimo punto è il più insidioso, soprattutto in combinazione con la paginazione automatica
del capitolo 11: una rotta con query dichiarata non riceverà mai le richieste paginate,
perché `page` e `size` sono parametri in più. La query dichiarata serve a distinguere **casi
puntuali** — «questa esatta combinazione di filtri risponde diversamente» — non a vincolare
famiglie di richieste. Per il caso generale, si dichiara il percorso senza query e si
lasciano lavorare filtri e paginazione automatici.

A parità di percorso, la rotta con query dichiarata è più specifica: viene provata prima, e
la gemella senza query raccoglie tutto il resto.

## Un percorso, più metodi

Metodi diversi sullo stesso percorso sono endpoint distinti che confluiscono nella stessa
rotta: il `GET` e il `DELETE` di `/api/utenti/:id` convivono, ciascuno con le proprie
varianti. Per crearli c'è la dialog «Nuovo» — o, più comodo se il primo è già rifinito, la
**copia** dell'endpoint sul nuovo metodo ([capitolo 13](13-copiare-endpoint.md)).

L'endpoint c'è e risponde; il passo successivo è la sua scheda — descrizione, attivazione,
e soprattutto le varianti di risposta: [capitolo 8](08-scheda-endpoint.md).
