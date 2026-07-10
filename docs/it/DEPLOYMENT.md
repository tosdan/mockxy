# Eseguire Mockxy: le vie di deployment

Oltre all'[app desktop](DESKTOP.md), Mockxy si esegue in tre modi. La bussola per scegliere:

| | Esecuzione diretta | Docker di sviluppo | Immagine standalone |
|---|---|---|---|
| A cosa serve | sviluppo sulla propria macchina | stesso scopo, senza Node locale | servire mock ad altri (Intranet, demo) |
| Admin API + interfaccia | sì | sì | **no** |
| Proxy fallback | sì | sì | **no** (solo mock) |
| Ricarica a caldo dei mock | sì | sì | no |

In tutti i casi la configurazione del motore passa **solo da variabili d'ambiente** (o CLI):
il censimento completo è in [CONFIGURAZIONI.md](CONFIGURAZIONI.md), e il file `.env.example`
documenta ogni variabile — comprese quelle lette *solo* da Docker Compose e non dal motore
(porte host e latenza `MOCKXY_*`).

## Esecuzione diretta

```bash
npm install
cp .env.example .env      # facoltativo: senza, valgono i default
npm run dev:backend       # sviluppo, con watch dei mock
node index.js             # esecuzione semplice
node index.js --delay=500 --delay-all   # con latenza simulata (vedi docs/RITARDI.md)
```

Con `NODE_ENV=production` il watch dei mock si spegne e l'admin API è disattivata di default:
è l'assetto giusto per un processo che deve solo servire.

## Docker di sviluppo

`docker compose up` avvia l'ambiente completo: il motore (porta host `3000`) e l'interfaccia
con ricaricamento automatico (porta host `4207`). Il `.env` è facoltativo; le porte host si
cambiano con `MOCKXY_HOST_PORT` e `MOCKXY_UI_HOST_PORT`.

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

- i mock si aggiornano sul filesystem del server (un `git pull`), **senza rebuild** né riavvio
  dell'immagine;
- per servire un altro workspace si cambiano i due mount;
- la parte locale del workspace (`.mockxy`) **non va mai montata** ([anatomia](WORKSPACE.md)).

Due note per l'uso su una rete interna: il bind è già `0.0.0.0` (sicuro qui: l'admin è spenta —
il quadro completo è in [RETE.md](RETE.md)), e se i frontend dei colleghi chiamano il server
**dal browser, da altre origin**, serve `CORS_ENABLED=true` ([il CORS automatico](CORS.md)).
