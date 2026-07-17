# 31 — Headless e Docker: configurare senza interfaccia

Fuori dall'app desktop non c'è la dialog delle impostazioni: il motore si configura **solo
con variabili d'ambiente** (o argomenti CLI), da un file `.env` o dall'ambiente del processo.
Questo capitolo dà la mappa dei livelli di configurazione, le variabili raggruppate per tema
con la corrispondenza verso gli interruttori della dialog, e le due forme Docker. Il
censimento esaustivo — ogni chiave, ogni default — resta in
[CONFIGURAZIONI.md](../CONFIGURAZIONI.md), e il file `.env.example` del repository è
commentato variabile per variabile.

## I livelli di configurazione

Le regolazioni di Mockxy vivono su livelli distinti che convivono — averli chiari evita di
cercare un'opzione nel posto sbagliato:

1. **Motore** — variabili d'ambiente / `.env` / CLI: il cuore, tutto il resto o passa di qui
   o è di un altro livello;
2. **Workspace** (solo app desktop) — la dialog del [capitolo 25](25-impostazioni-workspace.md),
   che passa i valori al motore come override; il server headless **non legge**
   `.mockxy/settings.json`;
3. **Preferenze globali dell'app** (solo desktop) — lingua, recenti, log errori;
4. **Runtime** — gli interruttori della runtime bar, in memoria, mai persistiti;
5. **Per-mock** — le proprietà nei file dei mock (delay della variante, template, sequenze);
6. **Docker / Compose** — variabili lette solo dall'orchestrazione, non dal motore.

## Le variabili per tema

**Rete e cartelle**

| Variabile | Default | Cosa fa |
|---|---|---|
| `PORT` | `3000` | porta di ascolto |
| `HOST` | `127.0.0.1` | interfaccia di bind; `0.0.0.0` = esposto ([capitolo 29](29-rete-sicurezza.md)) |
| `MOCKS_DIR` | `mocks` | cartella delle definizioni dei mock |
| `FILES_DIR` | `files` | cartella dei file dati per `data()` |

**Proxy e comportamento** (gli interruttori dei capitoli 25–27)

| Variabile | Default | Equivalente nella dialog |
|---|---|---|
| `BACKEND_URL` | — | Backend URL (assente = solo mock) |
| `PROXY_FALLBACK_ENABLED` | `true` | Proxy fallback |
| `CORS_ENABLED` | `false` | CORS automatico |
| `ADAPT_PROXY_COOKIES` | `true` | Adatta i cookie del proxy |
| `REWRITE_PROXY_REDIRECTS` | `true` | Riscrivi i redirect del proxy |
| `CASE_INSENSITIVE_FILTERS` | `true` | Filtri case-insensitive |
| `REQUEST_TIMEOUT_MS` | `15000` | Timeout backend |

**Ritardi** — via CLI: `node index.js --delay=500 --delay-all`
([capitolo 14](14-ritardi.md)).

**Monitor e dump** ([capitolo 22](22-storico-dump.md))

| Variabile | Default | Equivalente nella dialog |
|---|---|---|
| `MONITOR_DUMP_DIR` | `monitor-dump` | — (derivata dal workspace, nel desktop) |
| `MONITOR_DUMP_INTERVAL_MS` | `30000` | Cadenza flush |
| `MONITOR_DUMP_THRESHOLD` | `100` | Soglia flush |
| `MONITOR_DUMP_MAX_FILE_BYTES` | 50 MB | Dimensione max per file |
| `MONITOR_DUMP_MAX_TOTAL_BYTES` | 1 GB | Tetto totale cartella (`0` = mai) |

**Amministrazione e sviluppo**

| Variabile | Default | Cosa fa |
|---|---|---|
| `ADMIN_API_ENABLED` | dev `true`, prod `false` | l'admin API `/_admin/api` |
| `ADMIN_ALLOWED_HOSTS` | — | host extra ammessi verso l'admin (guardia DNS rebinding) |
| `DEV_WATCH` | `true` (non in produzione) | ricarica a caldo dei mock |
| `CHOKIDAR_USEPOLLING` | `false` | watcher in polling (Docker, cartelle di rete) |
| `LOG_LEVEL` | `info` | verbosità del log |
| `NODE_ENV` | `development` | `production` spegne watch e (di default) admin |
| `UI_DIST_DIR` | — | serve l'interfaccia compilata sotto `/_admin/ui` |

Per servire un workspace esistente in headless si puntano `MOCKS_DIR` e `FILES_DIR` alle due
cartelle condivise del workspace ([capitolo 24](24-mock-come-file.md)); se la cartella dei
mock non esiste, con il watch attivo viene creata vuota all'avvio. La parte locale
(`.mockxy/`) è irrilevante per il motore.

## Docker di sviluppo

Il compose del repository (`docker compose up`) avvia motore e interfaccia con il workspace
**montato dal filesystem locale**: hot reload e git funzionano come nell'esecuzione diretta
([capitolo 3](03-installazione-avvio.md)). Alcune variabili sono lette **solo dal compose**,
non dal motore: `MOCKXY_HOST_PORT` e `MOCKXY_UI_HOST_PORT` (le porte host) e
`MOCKXY_DELAY` / `MOCKXY_DELAY_ALL` (tradotte nei flag di ritardo). Dentro il container il
bind è `HOST=0.0.0.0` per necessità (il loopback del container non è raggiungibile dal port
mapping) e il watcher è in polling, perché gli eventi nativi sui volumi montati non sono
affidabili.

## L'immagine standalone

`Dockerfile.standalone` (usata da `docker-compose.staging.yml`) applica un principio diverso:
**l'applicazione si distribuisce, i dati si montano**. L'immagine contiene solo il motore,
già configurato per la pura erogazione — admin API spenta, proxy fallback spento, watch
spento, `NODE_ENV=production`. Mock e file dati arrivano a runtime come **bind mount in sola
lettura** su `/workspace/mocks` e `/workspace/files`:

- i mock si aggiornano sul filesystem del server (un `git pull`), senza rebuild né riavvio;
- per servire un altro workspace si cambiano i due mount;
- la parte locale (`.mockxy/`) **non va mai montata**.

È la risposta giusta a «vorrei che il team usasse questi mock»: un server interno che eroga
il workspace condiviso, senza interfaccia, senza esecuzione di codice via rete, senza proxy.
Gli handler funzionano (sono file del workspace, con `data()` incluso), ma nessuno può
crearne di nuovi da remoto. Due note per la rete interna: il bind è già `0.0.0.0` (sicuro
qui: l'admin è spenta), e se i frontend dei colleghi chiamano il server dal browser, da
altre origin, serve `CORS_ENABLED=true`.

## Assetti tipici

| Obiettivo | Assetto |
|---|---|
| Sviluppo quotidiano senza Node locale | compose di sviluppo |
| Processo locale che deve solo servire | `node index.js` con `NODE_ENV=production` |
| Mock per il team su un server interno | immagine standalone + bind mount del workspace |
| CI: e2e del frontend contro i mock | immagine standalone (o headless) in modalità solo-mock |

Con la configurazione censita si chiude la parte VI. Resta la parte pratica: gli
[scenari completi](32-scenari.md), il [troubleshooting](33-troubleshooting.md) e le
[appendici](34-appendici.md).
