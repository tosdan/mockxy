# Eseguire Mockxy: le vie di deployment

Oltre all'[app desktop](DESKTOP.md), Mockxy si esegue in tre modi. La bussola per scegliere:

| | Esecuzione diretta | Docker di sviluppo | Immagine standalone |
|---|---|---|---|
| A cosa serve | sviluppo sulla propria macchina | stesso scopo, senza Node locale | servire mock ad altri (Intranet, demo) |
| Admin API + interfaccia | sì | sì | **no** |
| Proxy fallback | sì | sì | **no** (solo mock) |
| Ricarica a caldo dei mock | sì | sì | no |

Per uno staging condiviso, con i mock dove il backend non arriva ancora e il backend vero
altrove, c'è un profilo dell'immagine standalone con il proxy acceso: la guida è
[STAGING.md](STAGING.md).

In tutti i casi la configurazione del motore passa **solo da variabili d'ambiente** (o CLI):
il censimento completo è in [CONFIGURAZIONI.md](CONFIGURAZIONI.md), e il file `.env.example`
documenta ogni variabile — comprese le porte host, che riguardano solo Docker Compose.

## Esecuzione diretta

```bash
npm install
cp .env.example .env      # raccomandato: configura almeno BACKEND_URL e PORT
npm run dev:backend       # sviluppo, con watch dei mock
node index.js             # esecuzione semplice
node index.js --delay=500 --delay-all   # con latenza simulata (vedi docs/RITARDI.md)
node index.js validate [workspace]      # controlla gli script del workspace ed esce (vedi docs/HANDLER.md)
```

Il file è tecnicamente facoltativo, ma per un uso headless reale è consigliabile crearlo e
rivederne almeno `BACKEND_URL` e `PORT`. Senza `.env` il server ascolta sulla porta `3000` e,
non avendo un backend configurato, resta in modalità solo-mock. I default sono comodi per una
prima prova, non sostituiscono una scelta esplicita della configurazione.

Con `NODE_ENV=production` il watch dei mock si spegne e l'admin API è disattivata di default:
è l'assetto giusto per un processo che deve solo servire.

## Docker di sviluppo

`docker compose up` avvia l'ambiente completo: il motore (porta host `3000`) e l'interfaccia
con ricaricamento automatico (porta host `4207`). Anche qui il `.env` è tecnicamente
facoltativo ma raccomandato per un uso reale; le porte host si cambiano con
`MOCKXY_HOST_PORT` e `MOCKXY_UI_HOST_PORT`.

Il punto qualificante è che **il workspace resta sul filesystem locale**, montato nel
container: ricarica a caldo, modifiche a mano e versionamento in git funzionano esattamente
come nell'esecuzione diretta. Sui volumi montati gli eventi nativi del filesystem non sono
affidabili, quindi il watcher lavora in polling dove serve (`CHOKIDAR_USEPOLLING`).

## Immagine standalone

`Dockerfile.standalone` (usata da `docker-compose.staging.yml`) applica il principio
**l'applicazione si distribuisce, i dati si montano**: l'immagine contiene solo il motore, già
configurato per la pura erogazione — admin spenta, proxy fallback spento, watch spento,
`NODE_ENV=production`. Mock e file dati arrivano a runtime come **bind mount in sola lettura**
su `/workspace/mocks` e `/workspace/files`:

- i mock si aggiornano sul filesystem del server (un `git pull`), **senza rebuild**
  dell'immagine ma con un **riavvio** del container: con watch e admin spenti il motore legge le
  definizioni solo all'avvio. File dati e risposte di tipo file invece si rileggono a ogni
  richiesta, quindi la sequenza sicura è **arresto, `git pull`, avvio**: a motore acceso, durante
  il pull convivrebbero definizioni vecchie e dati nuovi;
- per servire un altro workspace si cambiano i due mount;
- la parte locale del workspace (`.mockxy`) **non va mai montata** ([anatomia](WORKSPACE.md)).

Due note per l'uso su una rete interna: il bind è già `0.0.0.0` (sicuro qui: l'admin è spenta —
il quadro completo è in [RETE.md](RETE.md)), e se i frontend dei colleghi chiamano il server
**dal browser, da altre origin**, serve `CORS_ENABLED=true` ([il CORS automatico](CORS.md)).
Con il proxy verso un backend vero c'è un compose a parte, `docker-compose.staging-proxy.yml`,
descritto in [STAGING.md](STAGING.md).

### Aggiornare e controllare

L'[health](ADMIN-API.md#health) `GET /_admin/api/health` risponde anche con l'admin spenta:
`200` se il workspace si è caricato senza errori, `503` con i percorsi dei file rotti. Il compose
d'esempio la usa come `healthcheck`, così un file rotto arrivato con il pull rende il container
`unhealthy` invece di lasciarlo «sano» con un endpoint mancante. `MOCKS_VERSION` dice quale
versione dei mock sta rispondendo; il compose la passa al container:

```bash
docker compose -f docker-compose.staging.yml stop
git pull
MOCKS_VERSION=$(git rev-parse --short HEAD) docker compose -f docker-compose.staging.yml up -d
curl -s http://localhost:3000/_admin/api/health
```

I messaggi d'errore dei file rotti non sono nell'health, ma nel log di avvio
(`docker compose -f docker-compose.staging.yml logs mockxy`).

Con l'admin spenta il traffico si legge dagli stessi log, che sono JSON su stdout: ogni richiesta
chiude con una riga «Request completed». `mode` è la [provenienza](PROXY.md#da-dove-è-arrivata-la-risposta-x-mock-source) della risposta
(`mock`, `handler`, `middleware`, `backend`, …); quando ha risposto una variante del workspace,
`endpoint` e `variant` dicono quale, e `sequenceStep` il passo di una sequenza:

```json
{"time":"…","level":"info","msg":"Request completed.","method":"GET","path":"/api/ordini/7","mode":"mock","status":202,"durationMs":3,"endpoint":"/api/ordini/:id","variant":"001.response.json","sequenceStep":"1/2"}
```

## Dietro un reverse proxy

Spesso Mockxy non è esposto direttamente: davanti c'è un reverse proxy (nginx, Traefik, un
Ingress) che serve il sito in https e gli manda le chiamate API. In quel caso impostare
**`TRUST_PROXY=true`**: Mockxy legge `X-Forwarded-Proto` e `X-Forwarded-Host`, e

- i [redirect riscritti](REDIRECT.md#dietro-un-reverse-proxy) puntano all'indirizzo pubblico in
  https invece che a `http://` e all'host interno;
- i [cookie adattati](COOKIE.md) su https conservano `Secure` e `SameSite=None`, e perdono solo
  `Domain`.

Il proxy deve impostare quegli header. Con nginx, per esempio:

```nginx
location /api/ {
    proxy_pass http://mockxy:3000;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
}
```

`$http_host` e non `$host`: `$host` perde la porta, e su una porta diversa da 443 il redirect
riscritto la perderebbe a sua volta. Se il proxy serve anche il frontend sulla stessa origine, il [CORS](CORS.md) non serve.
L'opzione non tocca la guardia dell'admin API, che guarda sempre l'header `Host`
([RETE.md](RETE.md)). Senza un proxy davanti lasciarla spenta: quegli header li manda chiunque.
