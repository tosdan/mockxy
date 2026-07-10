# Il file endpoint

Ogni endpoint mockato è dichiarato da un **file endpoint**: un JSON che dice quale metodo e
percorso l'endpoint copre, se è attivo, quali varianti di risposta esistono e quale è quella
attualmente servita. È il punto d'ingresso di tutto ciò che riguarda quell'endpoint: il motore
scopre gli endpoint cercando questi file, e l'interfaccia li crea e li modifica per conto
dell'utente — ma restano normali file JSON, modificabili a mano con qualunque editor e
ricaricati a caldo quando il watch è attivo.

## Posizione e nome

Il motore percorre ricorsivamente la cartella dei mock e raccoglie ogni file il cui nome termina
in `.endpoint.json`. Il nome del file è `<METODO>.endpoint.json` (es. `GET.endpoint.json`), così
una stessa cartella può ospitare più metodi dello stesso percorso. Le varianti di risposta
vivono nella sottocartella gemella `<METODO>.responses/`.

```
mocks/api/utenti/{id}/
├── GET.endpoint.json        # dichiara GET /api/utenti/:id
├── GET.responses/           # varianti di risposta del GET
│   ├── 001.response.json
│   └── 002.response.json
└── DELETE.endpoint.json     # stesso percorso, altro metodo
```

La posizione della cartella è **una convenzione, non un vincolo**: il percorso servito è quello
dichiarato nel campo `path`, non quello ricostruito dalle cartelle. L'interfaccia crea le
cartelle rispecchiando il percorso dell'API (con `{id}` per i parametri, perché `:` non è
ammesso nei nomi di cartella su Windows), ed è la forma consigliata anche a mano: rende il
workspace navigabile.

## I campi

```json
{
  "method": "GET",
  "path": "/api/utenti/:id",
  "description": "Dettaglio utente",
  "enabled": true,
  "responseFiles": ["001.response.json", "002.response.json"],
  "selectedResponseFile": "001.response.json"
}
```

- **`method`** — uno tra `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` (maiuscolo).
  Deve coincidere con il metodo nel nome del file: la ridondanza è voluta, così il contenuto del
  file è autosufficiente anche fuori dal suo contesto.
- **`path`** — il percorso servito, con eventuali parametri (`/api/utenti/:id`) e query string.
  Le regole di formato e di precedenza tra rotte sono documentate nella pagina sulla convenzione
  dei path.
- **`description`** — testo libero, facoltativo; mostrato nel catalogo dell'interfaccia.
- **`enabled`** — obbligatorio. A `false` l'endpoint non viene registrato: le richieste che lo
  avrebbero raggiunto seguono il flusso di fallback (proxy verso il backend reale, o `404` in
  modalità solo-mock). È l'interruttore per «passare al reale» un endpoint alla volta.
- **`responseFiles`** — l'elenco delle varianti disponibili: nomi di file dentro
  `<METODO>.responses/`, senza percorsi (solo nome file, suffisso `.response.json`), senza
  duplicati, almeno una voce. L'ordine è quello mostrato dall'interfaccia.
- **`selectedResponseFile`** — la variante attualmente servita; deve essere una di quelle
  elencate in `responseFiles`. Cambiare variante significa cambiare questo campo — dalla UI o a
  mano.

Il contenuto delle varianti (status, header, body o file binario, ritardo, tipo mock/handler/
middleware) è documentato nella pagina sul formato delle risposte.

## Validazione ed errori

Il file viene validato al caricamento: metodo riconosciuto e coerente col nome del file,
percorso non vuoto e ben formato, `enabled` booleano, elenco varianti non vuoto e senza
duplicati, variante selezionata presente nell'elenco. I nomi in `responseFiles` che tentano di
uscire dalla cartella (separatori di percorso, riferimenti relativi) vengono rifiutati.

Due proprietà del caricamento utili da conoscere:

- **la degradazione è per-endpoint**: un file rotto — JSON invalido, variante selezionata
  mancante, validazione fallita — viene saltato e segnalato, senza impedire il caricamento
  degli altri endpoint. All'avvio l'errore compare come warning nel log; alla ricarica a caldo
  l'endpoint mantiene l'ultima versione valida finché il file non torna corretto;
- **i duplicati sono un errore**: due file endpoint che dichiarano la stessa coppia
  metodo+percorso (in cartelle diverse) sono in conflitto — vale il primo incontrato, il
  secondo viene segnalato e ignorato.

## Modifica a mano

Qualunque modifica al file — cambiare variante selezionata, spegnere l'endpoint, aggiungere una
voce a `responseFiles` dopo aver creato il file della variante — viene raccolta dalla ricarica a
caldo quando il watch è attivo (`DEV_WATCH`, attivo di default in sviluppo). Non serve riavviare
né passare dall'interfaccia: file e UI sono due viste equivalenti sugli stessi dati.

Per i mock scritti nel vecchio formato v1 esiste lo script di migrazione
`node scripts/migrate-mocks-v2.js <cartella>`.
