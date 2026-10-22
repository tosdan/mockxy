# 24 — I mock sono file: dentro il workspace

Tutto ciò che l'interfaccia fa scrive normali file JSON — e questo capitolo apre il cofano.
Conoscere la struttura serve a tre cose molto concrete: **versionare** i mock in git e
condividerli con il team, **modificarli a mano** quando l'editor è più rapido
dell'interfaccia (un cerca-e-sostituisci su cinquanta mock), e **capire cosa si sta
committando** quando il workspace vive nel repository del frontend.

## La struttura

```
mio-workspace/
├── mockxy.json              # segnaposto: marca la cartella come workspace   (condiviso)
├── .gitignore               # generato/aggiornato a ogni apertura            (condiviso)
├── mocks/                   # definizioni degli endpoint                     (condiviso)
│   ├── api/utenti/
│   │   ├── GET.endpoint.json
│   │   └── GET.responses/
│   │       └── 001.response.json
│   └── .collections.json    # organizzazione del catalogo in collection (UI)
├── files/                   # file dati JSON per handler e middleware        (condiviso)
└── .mockxy/                 # parte locale                                   (fuori da git)
    ├── settings.json        # impostazioni per-workspace dell'app desktop
    └── monitor-dump/        # traffico catturato, archiviato su disco (NDJSON)
```

La riga di confine è la sottocartella **`.mockxy/`**: sopra c'è la **parte condivisa** — ciò
che descrive i mock, destinata a git — sotto la **parte locale**, che non deve lasciare la
macchina. La separazione non è una convenzione da ricordare: il `.gitignore` generato
all'apertura esclude già `.mockxy/`, e viene ri-verificato a ogni apertura (un `.gitignore`
personalizzato non viene toccato nel resto).

Perché la parte locale resta locale: `settings.json` contiene porta e backend URL — che sulla
macchina di un collega non avrebbero senso — e `monitor-dump/` contiene traffico reale, che
può includere dati personali. Il **titolo** del workspace è l'unica impostazione condivisa
(vive nel segnaposto `mockxy.json`): è un'etichetta del progetto, non una preferenza.

## Il file endpoint

Ogni endpoint è dichiarato da `<METODO>.endpoint.json` — così una stessa cartella ospita più
metodi dello stesso percorso — con le varianti nella sottocartella gemella
`<METODO>.responses/`:

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

Ogni campo corrisponde a qualcosa di già incontrato nell'interfaccia: `enabled` è
l'interruttore dell'endpoint, `responseFiles` la lista delle varianti (nell'ordine mostrato),
`selectedResponseFile` la variante selezionata — **cambiare variante a mano è cambiare questo
campo**. L'eventuale sequenza del capitolo 12 vive qui, nel campo `sequence`, come politica
di selezione sopra le varianti.

Un dettaglio utile: la posizione della cartella è una convenzione, non un vincolo — il
percorso servito è quello del campo `path`, non quello ricostruito dalle cartelle.
L'interfaccia crea le cartelle rispecchiando il percorso dell'API (con `{id}` al posto di
`:id`, perché `:` non è ammesso nei nomi di cartella su Windows), ed è la forma consigliata
anche a mano: rende il workspace navigabile.

## Il file di risposta

Ogni variante è un file autonomo in `<METODO>.responses/`:

```json
{
  "type": "mock",
  "title": "Utente trovato",
  "status": 200,
  "headers": { "x-esempio": "true" },
  "delayMs": 150,
  "body": { "id": 1, "nome": "Ada", "ruolo": "admin" }
}
```

Il campo `type` distingue le cinque nature — `mock`, `handler`, `middleware`, `sse`, `ws` —
e il resto rispecchia l'editor del capitolo 9: `status`, `headers`, `delayMs`, `templated`,
e `body` *oppure* `file` (il payload binario servito in streaming). Le varianti handler e
middleware sono solo il collegamento: `sourceFile` punta allo script `.handler.js` o
`.middleware.js` nella stessa cartella. Il formato completo, campo per campo, è nella
[documentazione di riferimento](../RESPONSE.md).

> 📷 **SCREENSHOT** — `24-due-viste.png`
> Cosa mostrare: un editor di testo con un file endpoint e un file di risposta aperti,
> affiancato all'interfaccia che mostra lo stesso endpoint nel catalogo — le "due viste
> sugli stessi dati" rese visibili.

## La ricarica a caldo

Con il watch attivo (`DEV_WATCH`, il default in sviluppo; nell'app desktop sempre), qualunque
modifica ai file viene raccolta al volo: si cambia `selectedResponseFile` con l'editor, si
salva, e la richiesta successiva serve l'altra variante — l'interfaccia si aggiorna da sola.
Vale anche in senso costruttivo: un nuovo endpoint si può creare interamente a mano (cartella,
file endpoint, variante) e compare nel catalogo.

La rete di sicurezza è la **degradazione per-endpoint**: un file rotto — JSON invalido,
variante selezionata mancante, validazione fallita — **non abbatte il server**. L'endpoint
viene saltato con un warning nel log (che indica il file incriminato), e alla ricarica a
caldo resta in vigore l'ultima versione valida finché il file non torna corretto. Anche i
**duplicati** sono gestiti: due file che dichiarano la stessa coppia metodo+percorso sono in
conflitto — vale il primo incontrato, il secondo viene segnalato e ignorato.

Due strumenti collegati: il pulsante «Ricarica dal disco» del catalogo, per forzare la
rilettura dopo operazioni esterne massicce (un `git pull`, un cambio di branch); e lo script
`node scripts/migrate-mocks-v2.js <cartella>` per convertire mock scritti nel vecchio
formato v1.

## Lavorare in team

Il pattern consolidato: il workspace vive **nel repository del frontend** (una cartella
`mockxy/` o simile), e viaggia con il codice. Ne seguono alcune pratiche:

- i mock **entrano nelle code review** come qualunque altro file: un contratto sbagliato in
  un mock si vede nel diff;
- i conflitti git sono rari e leggibili — file piccoli, uno per variante. Il punto di
  attrito tipico è `selectedResponseFile` quando due persone selezionano varianti diverse:
  conviene trattare la selezione come stato di lavoro e non contendersela, o normalizzarla
  prima del commit;
- **handler e middleware sono codice**: chi apre un workspace ne esegue gli script — per un
  workspace vale la stessa fiducia che si accorda a un repository che si clona ed esegue;
- prima di pubblicare un workspace fuori dal team, verificare che i body dei mock — spesso
  nati da catture di traffico reale — non contengano dati sensibili.

Il server headless e le immagini Docker servono lo stesso workspace puntando `MOCKS_DIR` e
`FILES_DIR` alle due cartelle condivise; la parte locale è irrilevante per il motore e non va
mai montata ([capitolo 31](31-headless-docker.md)).

Con i file chiari, la parte VI affronta le regolazioni: si comincia dal pannello che le
raccoglie tutte, le [impostazioni del workspace](25-impostazioni-workspace.md).
