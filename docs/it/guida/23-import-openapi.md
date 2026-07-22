# 23 — L'import OpenAPI

Se l'API ha una specifica, il workspace non si costruisce a mano: l'import genera **un mock
per ogni endpoint dichiarato**, con body derivati da esempi e schemi. L'obiettivo dichiarato
è una **base solida da ritoccare** — mock plausibili e subito funzionanti, non dati
realistici: i valori che contano per il proprio flusso si sistemano dopo, dal catalogo.

Import e cattura dal monitor si completano: la cattura parte dal traffico disponibile (dati
veri, ma servono un backend e una navigazione), l'import dalla specifica (copertura completa
in pochi secondi, ma dati campionati). Quando ci sono entrambi, l'ordine tipico è: import per
lo scheletro completo, cattura o ritocco per gli endpoint che contano.

## Formati e tolleranza

Sono accettate specifiche **OpenAPI 3.0 / 3.1 e Swagger 2.0**, in **JSON o YAML** (documento
fino a 12 MB). Le versioni più vecchie vengono convertite automaticamente alla struttura 3.1,
e i riferimenti `$ref` sono risolti — anche annidati o tra componenti: la specifica si passa
così com'è, senza pre-lavorazioni.

## Cosa viene generato

Per ogni coppia percorso+metodo (metodi importati: `get`, `post`, `put`, `delete`, `patch`;
`head` e `options` sono esclusi, coerentemente con la creazione manuale):

- il **percorso**, convertito nella convenzione di Mockxy: `/users/{id}` → `/users/:id`;
- lo **status**: il primo `2xx` dichiarato tra le risposte;
- il **body**: dall'**esempio** della specifica quando c'è; altrimenti **campionato dallo
  schema**, in modo deterministico — stessa specifica, stessi valori: rilanciare l'import non
  produce dati diversi a caso;
- la **collection**: dai **tag** della specifica, riusando per nome le collection già
  presenti nel catalogo. Endpoint senza tag restano in Unsorted.

La regola che rende l'import **rilanciabile**: gli endpoint già esistenti nel workspace
(stessa coppia metodo+percorso) **non vengono toccati** — l'import crea solo i nuovi. Quando
il contratto si aggiorna, si rilancia l'import della specifica nuova: si aggiunge ciò che
manca, e i ritocchi fatti nel frattempo restano intatti.

## La dialog

«Importa OpenAPI» sta nella barra della vista Catalogo. La dialog accetta il documento con
trascinamento o selezione file (`.json`, `.yaml`, `.yml`) e — prima di scrivere qualunque
cosa — mostra l'**anteprima**: i conteggi (da creare / già esistenti / collection) e
l'elenco completo degli endpoint, ciascuno marcato «Da creare» o «Esiste», filtrabile
(tutti / da creare / saltati). Solo **«Importa»** esegue il piano; il riepilogo finale conta
creati, saltati e falliti.

> 📷 **SCREENSHOT** — `23-import-anteprima.png`
> Cosa mostrare: la dialog di import con l'anteprima popolata da una specifica reale — i
> conteggi in testa e la lista degli endpoint con le azioni «Da creare» / «Esiste», il
> filtro visibile.

> 📷 **SCREENSHOT** — `23-catalogo-dopo-import.png`
> Cosa mostrare: il catalogo subito dopo l'import, organizzato in collection derivate dai
> tag della specifica, per rendere visibile il risultato dell'operazione.

## Il dopo-import

L'import consegna uno scheletro completo e funzionante: da lì, tre mosse tipiche:

- **rifinire i dati che contano**: i body campionati sono plausibili ma generici — per le
  schermate su cui si lavora davvero, si sostituiscono con dati sensati (o si catturano dal
  backend reale quando arriva);
- **dotare gli endpoint chiave di varianti**: il preset 500, la lista vuota
  ([capitoli 8–9](08-scheda-endpoint.md));
- **accendere e spegnere a zone**: le collection da tag permettono di abilitare/disabilitare
  intere aree con l'azione di collection ([capitolo 6](06-catalogo.md)) — mock per l'area
  non ancora implementata, backend reale per il resto.

Via API l'import si automatizza (`POST /_admin/api/mocks/import/openapi`, con `?dryRun=true`
per la sola anteprima; il content-type deve essere esplicito — `application/json` o
`application/yaml`): una pipeline può reimportare la specifica a ogni aggiornamento del
contratto. Il quadro dell'automazione è nel [capitolo 30](30-admin-api.md).

L'import scrive molti file in un colpo — ed è il momento giusto per guardare *cosa* scrive:
l'anatomia del workspace e dei suoi file è il [capitolo 24](24-mock-come-file.md).
