# 03 — Installare e avviare Mockxy

Mockxy si esegue in tre forme: **app desktop** portable per Windows, **server Node.js** in
locale, **container Docker**. Le funzionalità di lavoro sono le stesse; cambiano il modo di
configurarle e un paio di capacità esclusive (il multi-workspace è solo dell'app desktop).
A queste si aggiunge l'immagine Docker **standalone**, che non è un ambiente di sviluppo ma
un erogatore di soli mock per ambienti condivisi: la trova spazio nel
[capitolo 31](31-headless-docker.md).

La bussola per scegliere:

| | App desktop | Server Node | Docker di sviluppo | Immagine standalone |
|---|---|---|---|---|
| A cosa serve | sviluppo quotidiano su Windows | sviluppo sulla propria macchina | stesso scopo, senza Node locale | servire mock ad altri (Intranet, demo) |
| Interfaccia web + admin API | sì | sì | sì | **no** |
| Proxy fallback verso il backend | sì | sì | sì | **no** (solo mock) |
| Ricarica a caldo dei mock | sì | sì | sì | no |
| Più workspace in parallelo | **sì** | no (un processo per workspace) | no | no |
| Configurazione | dialog nell'interfaccia | variabili d'ambiente | variabili d'ambiente | variabili d'ambiente |

Se sei su Windows e vuoi solo iniziare, l'app desktop è la via più rapida: zero installazione
e zero configurazione manuale.

## L'app desktop

L'app desktop è un singolo eseguibile **portable**: non si installa, e le preferenze viaggiano
in file accanto all'eseguibile — spostando la cartella, si sposta tutto. Motore e interfaccia
sono integrati: non serve Node, non serve un browser aperto a parte.

L'eseguibile si scarica dalle release del repository (o si compila con `npm run install:all &&
npm run dist:electron`, risultato in `electron/dist/Mockxy-<versione>-portable.exe`). Non è
firmato digitalmente: al primo avvio Windows SmartScreen può mostrare un avviso — «Ulteriori
informazioni» → «Esegui comunque».

### Il primo avvio e la schermata di benvenuto

All'avvio senza workspace aperti compare la schermata di benvenuto, da cui si apre una
cartella (o se ne riapre una recente). L'app distingue tre casi:

- **cartella nuova** — non è ancora un workspace: l'app chiede **conferma esplicita** prima
  di inizializzarla, così una cartella scelta per errore non viene modificata. Confermando,
  vengono creati il segnaposto `mockxy.json`, le cartelle `mocks/` e `files/`, un
  `.gitignore` e la parte locale `.mockxy/`;
- **workspace clonato da git** — il segnaposto c'è ma manca la parte locale: viene ricreata
  solo `.mockxy/` con le impostazioni di default. È il percorso normale quando si clona il
  workspace del team;
- **workspace completo** — si apre e basta, sulla porta salvata nelle sue impostazioni.

Alla prima apertura viene assegnata una porta libera e **salvata**: da lì in poi il workspace
riapre sempre sulla stessa porta, così il frontend configurato contro quell'indirizzo non va
più ritoccato.

> 📷 **SCREENSHOT** — `03-benvenuto.png`
> Cosa mostrare: la schermata di benvenuto dell'app desktop, nessun workspace aperto, con il
> pulsante di apertura cartella e l'eventuale elenco dei recenti visibili.

> 📷 **SCREENSHOT** — `03-conferma-inizializzazione.png`
> Cosa mostrare: la dialog nativa di conferma che compare aprendo una cartella non ancora
> inizializzata come workspace.

> 📷 **SCREENSHOT** — `03-workspace-vuoto.png`
> Cosa mostrare: l'app subito dopo l'inizializzazione di un workspace nuovo: catalogo vuoto
> con il messaggio «Workspace vuoto» e l'invito a creare il primo mock o importare da
> OpenAPI.

Le funzionalità desktop che vanno oltre il primo avvio — più workspace in parallelo a schede,
porte stabili, preferenze globali, log errori — hanno un capitolo dedicato, il
[28](28-desktop-workspace.md).

## Il server Node

Su macOS, Linux, o quando si preferisce il terminale, Mockxy gira come normale processo Node.
Requisito: **Node.js 24 o superiore** (le distribuzioni desktop e Docker portano con sé il
proprio runtime e non dipendono dal Node di sistema).

```bash
git clone https://github.com/tosdan/mockxy.git
cd mockxy

npm install              # dipendenze del server
npm run install:frontend # dipendenze dell'interfaccia web
cp .env.example .env     # configurazione di partenza (facoltativo: senza, valgono i default)

npm run dev:backend      # motore su http://localhost:3000
npm run dev:frontend     # interfaccia su http://localhost:4207 (in un secondo terminale)
```

Il repository include un workspace dimostrativo con qualche mock già pronto, quindi la
verifica è immediata:

```bash
curl http://localhost:3000/api/hello
# {"hello":"world", ...}
```

L'interfaccia si usa nel browser su `http://localhost:4207`. In questa forma il motore si
configura **solo con variabili d'ambiente** (o argomenti CLI): le due essenziali sono `PORT`
(default `3000`) e `BACKEND_URL` (il backend reale verso cui inoltrare le richieste senza
mock — senza, Mockxy lavora in modalità solo-mock). Il file `.env.example` è commentato e
documenta ogni variabile; il censimento ragionato è nel [capitolo 31](31-headless-docker.md).

Per un processo che deve solo servire (senza sviluppo attivo), `NODE_ENV=production` spegne
il watch dei file e disattiva di default l'admin API.

## Docker di sviluppo

Stesso scopo dell'esecuzione diretta, senza Node installato in locale. Serve Docker Compose
v2.24 o successivo:

```bash
docker compose up
# motore su http://localhost:3000, interfaccia su http://localhost:4207
```

Funziona anche su un clone fresco senza `.env` (se c'è viene letto, altrimenti valgono i
default); le porte host si cambiano con `MOCKXY_HOST_PORT` e `MOCKXY_UI_HOST_PORT`. Il punto
qualificante: **il workspace resta sul filesystem locale**, montato nel container — ricarica
a caldo, modifiche a mano e versionamento in git funzionano come nell'esecuzione diretta.
Unica particolarità: sui volumi montati gli eventi nativi del filesystem non sono sempre
affidabili, e se le modifiche ai file non vengono ricaricate si abilita il watcher in polling
con `CHOKIDAR_USEPOLLING=true`.

## Verifica finale

Qualunque via tu abbia scelto, a questo punto hai: il motore in ascolto su una porta
(l'app desktop la mostra nella barra del workspace; in headless è `PORT`), l'interfaccia
raggiungibile, e un workspace aperto — vuoto o dimostrativo. Una richiesta di prova con
`curl` o dal browser deve ricevere risposta, e comparire nella vista Monitor.

Resta il passaggio che dà senso a tutto: far parlare la **tua applicazione** con Mockxy
invece che con il backend. È il [capitolo 4](04-collegare-frontend.md).
