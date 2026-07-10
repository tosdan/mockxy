# La convenzione dei path

Questa pagina descrive come Mockxy decide, richiesta per richiesta, **quale endpoint risponde**:
il formato dei percorsi dichiarati nei [file endpoint](ENDPOINT.md), le regole di precedenza
quando più rotte potrebbero combaciare, e il ruolo del metodo HTTP. È la meccanica dietro al
dubbio più frequente — «perché il mio mock non risponde?» — e conoscerla in anticipo evita la
maggior parte delle sorprese.

## La scelta avviene in due tempi

1. **Prima il percorso**: tra le rotte registrate viene scelta la più specifica il cui pattern
   combacia con percorso e query della richiesta.
2. **Poi il metodo**: dentro la rotta scelta si cerca il metodo HTTP della richiesta.

La conseguenza importante è che **la scelta del percorso è definitiva**: se la rotta scelta non
definisce il metodo richiesto, la richiesta va al fallback (proxy verso il backend, o `404` in
modalità solo-mock) — *non* viene cercata una rotta meno specifica che magari quel metodo lo
avrebbe. Esempio: con `/api/utenti/:id` che definisce solo `GET`, una `POST /api/utenti/42`
finisce al fallback anche se esistesse un'altra rotta più generica con la `POST`.

L'esito della decisione è osservabile: l'header `x-mock-source` dice chi ha risposto, e il body
del `404` solo-mock riporta la ragione — `method_not_mocked` (rotta trovata, metodo assente)
oppure `path_not_mocked` (nessuna rotta combacia).

## Il formato del percorso

Il campo `path` del file endpoint dichiara un percorso **assoluto** (inizia con `/`), con
eventuali **parametri nominati** ed eventuale **query string richiesta**:

```
/api/utenti                  percorso esatto
/api/utenti/:id              parametro nominato
/api/utenti/:id/ordini/:num  più parametri
/api/utenti?attivo=true      percorso esatto + query richiesta
```

- **`:nome`** cattura un segmento di percorso; il valore arriva agli handler già decodificato
  (percent-decoding). Un parametro copre *un* segmento: `/api/:id` combacia con `/api/42` ma
  non con `/api/42/extra`.
- Il pattern copre **l'intero percorso**, mai un prefisso: `/api/utenti` non combacia con
  `/api/utenti/extra`.
- Il carattere **`^` è vietato** nel path: è riservato all'uso interno (codifica la parte query
  nei nomi delle cartelle derivate su disco).
- Un **`*` nudo non è supportato** e viene rifiutato al caricamento: l'endpoint risulta
  invalido e viene scartato con un warning, secondo la degradazione per-endpoint descritta
  nella [pagina sul file endpoint](ENDPOINT.md).

## La query dichiarata

Se il `path` include una query string, quella query diventa un **requisito di uguaglianza
esatta sull'intera query della richiesta**:

- l'ordine dei parametri non conta: `?a=1&b=2` e `?b=2&a=1` sono equivalenti;
- nomi e valori sono confrontati **case-sensitive** (`?attivo=true` ≠ `?ATTIVO=true`);
- **niente parametri in più né in meno**: `/api/utenti?attivo=true` *non* combacia con
  `?attivo=true&page=0` — la richiesta con il parametro extra scivola sulla gemella senza query
  (se esiste) o al fallback.

L'ultimo punto è il più insidioso, specie in combinazione con la paginazione automatica: una
variante con query dichiarata non riceverà le richieste paginate, perché `page` e `size` sono
parametri in più. La query dichiarata è pensata per distinguere *casi puntuali* («questa
esatta combinazione di filtri risponde diversamente»), non per vincolare famiglie di richieste.

A parità di percorso, la rotta **con** query dichiarata è più specifica della gemella senza —
viene provata prima, e la gemella (che accetta qualunque query) raccoglie tutto il resto.

## La specificità

Quando più rotte potrebbero combaciare, l'ordine di prova è:

1. **percorsi esatti** (senza parametri) prima di quelli **con parametri**;
2. tra percorsi con parametri, vince chi ha **più segmenti statici**
   (`/api/utenti/:id` batte `/api/:risorsa/:id`);
3. a parità di percorso, la variante **con query dichiarata** prima della gemella senza;
4. i pareggi restanti si risolvono in modo deterministico (ordine stabile dei file), così il
   comportamento non cambia tra un riavvio e l'altro.

## Un percorso, più metodi

Tutti i file endpoint che dichiarano lo stesso `path` — anche da cartelle diverse — confluiscono
nella **stessa rotta**, ciascuno con il proprio metodo: è così che `GET` e `DELETE` di
`/api/utenti/:id` convivono. Due file che dichiarano la stessa coppia metodo+percorso sono
invece un conflitto, gestito come descritto nella [pagina sul file endpoint](ENDPOINT.md).
