# Anatomia di un workspace

Un **workspace** è la cartella che contiene tutto ciò che definisce un ambiente di mock: le
definizioni degli endpoint, i file dati riusabili, le impostazioni locali e il traffico
catturato. È un'unità autosufficiente e portabile: la stessa cartella si versiona in git, si
condivide con il team, si apre nell'app desktop e si serve con il server headless o con
l'immagine Docker standalone.

Il principio che governa la struttura è la separazione tra **parte condivisa** (ciò che descrive
i mock, destinato a git) e **parte locale** (impostazioni personali e dati di lavoro, che non
devono lasciare la macchina). La riga di confine è la sottocartella `.mockxy/`.

## Struttura

```
mio-workspace/
├── mockxy.json              # segnaposto: marca la cartella come workspace   (condiviso)
├── .gitignore               # generato/aggiornato a ogni apertura            (condiviso)
├── mocks/                   # definizioni degli endpoint                     (condiviso)
│   ├── api/utenti/
│   │   ├── GET.endpoint.json
│   │   └── GET.responses/
│   │       └── 001.response.json
│   └── .collections.json    # organizzazione del catalogo in collezioni (UI)
├── files/                   # file dati JSON per handler e middleware        (condiviso)
└── .mockxy/                 # parte locale                                   (fuori da git)
    ├── settings.json        # impostazioni per-workspace dell'app desktop
    └── monitor-dump/        # traffico catturato, archiviato su disco (NDJSON)
```

## La parte condivisa

**`mockxy.json`** è il segnaposto che identifica la cartella come workspace. Contiene la versione
del formato e, se impostato dalla dialog delle impostazioni, il **titolo** personalizzato del
workspace — l'unica impostazione condivisa, perché è un'etichetta del progetto e non una
preferenza personale. Senza titolo, il nome mostrato è quello della cartella.

**`mocks/`** contiene le definizioni degli endpoint: una cartella per endpoint che rispecchia il
percorso dell'API, con un file di definizione per metodo HTTP e le varianti di risposta in una
sottocartella dedicata. Il file `.collections.json` alla radice memorizza l'organizzazione del
catalogo in collezioni usata dall'interfaccia (raggruppamenti e ordinamento). Il formato dei
file è documentato nelle pagine dedicate al formato endpoint e response.

**`files/`** contiene i file dati JSON della pagina Dati: dataset riusabili che handler e
middleware leggono a runtime tramite l'accessor `data()`. La cartella è piatta (nessuna
sottocartella) e i nomi dei file sono normalizzati a lowercase.

**`.gitignore`** viene generato alla prima apertura e ri-verificato a ogni apertura successiva:
la riga che esclude la parte locale (`.mockxy/`) viene aggiunta se mancante, ed eventuali righe
scritte da versioni precedenti e non più usate vengono rimosse. Il resto del file non viene
toccato: un `.gitignore` personalizzato resta intatto.

## La parte locale: `.mockxy/`

**`settings.json`** raccoglie le impostazioni per-workspace gestite dalla dialog dell'app
desktop: porta, URL del backend per il proxy, interfaccia di bind, comportamento del motore
(filtri case-insensitive, proxy fallback, CORS automatico, adattamento dei cookie proxati,
riscrittura dei redirect, latenza simulata, timeout) e ritenzione dei dump del monitor. Due
proprietà di queste impostazioni:

- sono **locali per definizione**: porta e backend URL della macchina di uno sviluppatore non
  hanno senso su quella di un collega — per questo vivono fuori da git;
- sono **lette solo dall'app desktop**, che le passa al motore all'avvio del workspace. Il
  server headless non legge questo file: si configura esclusivamente con variabili d'ambiente
  (vedi [CONFIGURAZIONI.md](CONFIGURAZIONI.md), che censisce entrambe le vie e i default).

**`monitor-dump/`** è l'archivio su disco del traffico catturato dal monitor, in formato NDJSON
append-only con rotazione per dimensione e pruning oltre un tetto configurabile. Contiene
richieste e risposte reali: può includere dati personali o segreti, e non deve essere condiviso
né montato su server remoti.

## Ciclo di vita

All'apertura di una cartella, l'app desktop distingue tre casi:

- **cartella nuova** — viene inizializzata: segnaposto, `mocks/`, `files/`, `.gitignore` e parte
  locale. L'inizializzazione richiede conferma esplicita, così una cartella scelta per errore
  non viene modificata;
- **workspace clonato da git** — il segnaposto c'è ma la parte locale no: viene ricreata solo
  `.mockxy/`, con i default del motore come impostazioni. È il percorso normale quando un
  collega clona il workspace del team;
- **workspace completo** — non viene toccato nulla; la porta salvata nelle impostazioni vince
  sul default proposto.

Alla prima apertura viene assegnata (e salvata) una porta libera; da lì in poi il workspace
riapre sempre sulla stessa porta, così i client configurati contro quell'indirizzo continuano a
funzionare.

## Cosa condividere con il team

Tutto tranne `.mockxy/`, che il `.gitignore` generato esclude già. Due avvertenze:

- **handler e middleware sono codice**: chi apre un workspace ne esegue gli script. Vale la
  stessa fiducia che si accorda a qualunque repository che si clona ed esegue;
- prima di pubblicare un workspace fuori dal team, verificare che i body dei mock (spesso nati
  da catture di traffico reale) non contengano dati sensibili.

## Lo stesso workspace, senza app desktop

Il server headless e le immagini Docker servono un workspace puntando le variabili d'ambiente
`MOCKS_DIR` e `FILES_DIR` alle due sottocartelle condivise. La parte locale è irrilevante per il
motore e — nel caso dell'immagine standalone per ambienti condivisi — **non va montata**: i bind
mount riguardano solo `mocks/` e `files/`.

Se la cartella indicata da `MOCKS_DIR` non esiste ancora, il server con il watch attivo (il
default in sviluppo) **la crea vuota all'avvio**: si può partire da zero e aggiungere i mock a
caldo, senza riavvii.
