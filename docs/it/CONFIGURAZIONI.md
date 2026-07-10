# Configurazioni di Mockxy

Censimento completo di tutte le opzioni configurabili, per **livello**. Mockxy si configura su
livelli distinti che convivono:

1. **Motore** — variabili d'ambiente / `.env` / argomenti CLI, materializzate in `src/config.js`
   (`loadConfig`). È il cuore: tutto il resto o passa di qui (come override) o è di un altro livello.
2. **Workspace** (app desktop) — impostazioni locali per-workspace in `<workspace>/.mockxy/settings.json`,
   editabili dalla **dialog impostazioni workspace**. Vengono passate al motore come override e, al
   cambio, il motore del workspace **riparte**.
3. **Preferenze globali dell'app** (app desktop) — `mockxy-prefs.json` nella directory dati utente
   di Electron (accanto all'eseguibile solo nella build Windows portabile).
4. **Runtime operativo** — interruttori in memoria non persistiti (runtime-bar / admin API).
5. **Per-mock** — proprietà del singolo endpoint/variante, nei file dei mock.
6. **Docker / Compose** — variabili a livello di container e di orchestrazione.

> Nota importante: nell'app desktop **impacchettata** non c'è un `.env` accanto all'eseguibile, quindi
> le opzioni del motore che non sono esposte come impostazione di workspace restano al **default**.
> Per questo le opzioni comportamentali per-workspace vivono nella dialog (livello 2).

---

## 1. Motore (`src/config.js`)

Ogni opzione si legge da `overrides` (passati dal desktop/dai test) **oppure** dalla variabile
d'ambiente indicata, con fallback al default. La colonna «Dialog workspace» indica se è anche
impostabile per-workspace dall'app desktop.

| Chiave (`config`) | Variabile env / CLI | Default | Cosa fa | Dialog workspace |
|---|---|---|---|---|
| `port` | `PORT` | `3000` | Porta di ascolto del motore | ✅ |
| `host` | `HOST` | `127.0.0.1` | Interfaccia di bind; `0.0.0.0` = tutte (l'admin API scrive file ed esegue codice: esporre in rete è una scelta esplicita, a rischio dell'utente) | ✅ (toggle «Accessibile da tutta la rete»: 127.0.0.1 ↔ 0.0.0.0) |
| `backendUrl` | `BACKEND_URL` | — | URL del backend reale per il proxy; assente = solo mock | ✅ |
| `proxyFallbackEnabled` | `PROXY_FALLBACK_ENABLED` | `true` | Su richiesta non mockata: proxy al backend (`true`) vs `404` mock-only (`false`) | ✅ |
| `caseInsensitiveFilters` | `CASE_INSENSITIVE_FILTERS` | `true` | Filtri automatici sulle liste (`?chiave=valore`): confronto del valore senza distinguere maiuscole/minuscole | ✅ |
| `corsEnabled` | `CORS_ENABLED` | `false` | Gestione CORS del motore: risponde ai preflight e imposta gli header (origin riflessa, credenziali ammesse) su ogni risposta servita, sovrascrivendo la policy dei mock catturati e del backend proxato. Serve solo per chiamate browser cross-origin dirette | ✅ |
| `adaptProxyCookies` | `ADAPT_PROXY_COOKIES` | `true` | Adatta i `Set-Cookie` proxati: rimuove `Domain`, `Secure` e `SameSite=None` così i cookie di sessione si legano all'host di Mockxy e sopravvivono su http; nome/valore e altri attributi intatti | ✅ |
| `rewriteProxyRedirects` | `REWRITE_PROXY_REDIRECTS` | `true` | Riscrive i `Location` dei redirect proxati che puntano all'origin del backend verso l'host con cui il client ha raggiunto Mockxy (path e query preservati); relativi e host terzi intatti | ✅ |
| `globalDelayMs` | `MOCKXY_DELAY` · `--delay` · `npm_config_delay` | `0` | Ritardo (ms) applicato ai mock senza `delayMs` proprio | ✅ |
| `delayAllRequests` | `MOCKXY_DELAY_ALL` · `--delay-all` · `npm_config_delay_all` | `false` | Applica il ritardo globale anche alle richieste proxate | ✅ |
| `requestTimeoutMs` | `REQUEST_TIMEOUT_MS` | `15000` | Timeout (ms) verso backend/handler | ✅ |
| `monitorDumpIntervalMs` | `MONITOR_DUMP_INTERVAL_MS` | `30000` | Cadenza di flush su disco dei dump del monitor | ✅ |
| `monitorDumpThreshold` | `MONITOR_DUMP_THRESHOLD` | `100` | Voci in attesa che forzano un flush prima della cadenza | ✅ |
| `monitorDumpMaxFileBytes` | `MONITOR_DUMP_MAX_FILE_BYTES` | `52428800` (50 MB) | Dimensione massima di ogni file di dump (poi rotazione) | ✅ |
| `monitorDumpMaxTotalBytes` | `MONITOR_DUMP_MAX_TOTAL_BYTES` | `1073741824` (1 GB) | Tetto totale della cartella dump; `0` = pruning disattivato | ✅ |
| `adminApiEnabled` | `ADMIN_API_ENABLED` | dev: `true`, prod: `false` | Abilita l'admin API `/_admin/api` (mock, monitor, ecc.) | ❌ (desktop forza `true`) |
| `adminAllowedHosts` | `ADMIN_ALLOWED_HOSTS` | `[]` | Host extra ammessi dall'header Host verso l'admin API (guardia DNS-rebinding), oltre ai nomi loopback | ❌ |
| `logLevel` | `LOG_LEVEL` | `info` | Livello minimo del logger | ❌ |
| `mocksDir` | `MOCKS_DIR` | `mocks` | Cartella delle definizioni dei mock | ❌ (derivato dal workspace) |
| `filesDir` | `FILES_DIR` | `files` | Cartella dei file dati JSON per `data()` (pagina Dati) | ❌ (derivato dal workspace) |
| `monitorDumpDir` | `MONITOR_DUMP_DIR` | `monitor-dump` | Cartella dei dump del monitor | ❌ (derivato: `<workspace>/.mockxy/monitor-dump`) |
| `uiDistDir` | `UI_DIST_DIR` | — | Cartella dell'interfaccia compilata da servire sotto `/_admin/ui` | ❌ (impostata dall'app desktop) |
| `devWatch` / `watchEnabled` | `DEV_WATCH` | `true` (non in produzione) | Ricarica automatica dei mock in sviluppo | ❌ |
| `watchUsePolling` | `CHOKIDAR_USEPOLLING` | `false` | Polling del watcher (per Docker/cartelle di rete) | ❌ |
| `nodeEnv` | `NODE_ENV` | `development` | Ambiente; `production` disabilita watch e (di default) admin API | ❌ |

**CLI / npm.** Il ritardo si può passare anche da riga di comando: `npm run dev:backend -- --delay=500`
e `--delay-all`; in Docker/Compose gli stessi valori arrivano via `npm_config_delay` /
`npm_config_delay_all` (vedi §6). Parsing in `parseCliArgs` (`src/config.js`).

---

## 2. Impostazioni di workspace (`<workspace>/.mockxy/settings.json`)

Locali (fuori da git), gestite da `electron/workspace.js` (`readSettings`/`updateSettings`) ed
editabili dalla **dialog impostazioni workspace** (`mockxy-ui/.../workspace-settings-dialog.ts`, apribile
dall'ingranaggio nella barra workspace). Il flusso è via IPC Electron
(`window.desktop.getWorkspace`/`updateWorkspace` → `electron/main.js`), **non** via HTTP admin API.
Ogni campo è opzionale: se assente vale il default del motore. Al salvataggio il motore del workspace
riparte e la finestra si ricarica.

Campi persistiti:

- `port`, `backendUrl`, `host` — rete del workspace (`host`: `127.0.0.1` loopback vs `0.0.0.0` tutta la rete, a rischio dell'utente).
- `caseInsensitiveFilters` — filtri case-insensitive.
- `proxyFallbackEnabled` — proxy fallback su mock-miss.
- `globalDelayMs`, `delayAllRequests` — latenza simulata.
- `requestTimeoutMs` — timeout backend/handler.
- `monitorDumpIntervalMs`, `monitorDumpThreshold`, `monitorDumpMaxFileBytes`, `monitorDumpMaxTotalBytes`
  — ritenzione/rotazione dei dump del monitor.

Semantica e default: identici alle righe corrispondenti della tabella §1.

Il **titolo** del workspace non sta qui ma nel segnaposto condiviso in git `<workspace>/mockxy.json`
(`{ "formatVersion": 1, "title"?: string }`), perché è pensato per essere condiviso col team; è comunque
editabile dalla stessa dialog.

---

## 3. Preferenze globali dell'app (`mockxy-prefs.json`)

Preferenze utente cross-workspace, salvate nella directory dati utente di Electron
(`electron/global-prefs.js`); nella build Windows portabile sono invece accanto all'eseguibile. Non
per-workspace.

- `recentWorkspaces` — elenco dei workspace aperti di recente (l'ultimo in cima).
- `window` — dimensione/posizione/stato dell'ultima finestra, per riaprirla com'era.
- `language` — lingua dell'interfaccia (`it` / `en`), cambiabile dal selettore lingua in fondo alla
  runtime-bar (condivisa tra app e pagina di benvenuto).

---

## 4. Runtime operativo (in memoria, non persistito)

Interruttori "da banco di lavoro" nella runtime-bar; si azzerano al riavvio. Applicati via
`PATCH /_admin/api/server` (stato in `src/server-state.js`) e `PATCH /_admin/api/monitoring/dump`.

- `serverEnabled` — server ON/OFF (OFF = passthrough puro, nessun mock/monitor).
- `proxyAll` — inoltra **tutte** le richieste al backend (nessun mock, ma monitor attivo).
- Monitor: cattura live (pausa/avvia, solo runtime) e scrittura dump su disco ON/OFF (persistito lato
  backend) + flush manuale.

> Attenzione a non confondere `proxyAll` (runtime, bypassa tutti i mock) e `serverEnabled` (runtime,
> spegne il motore) con `proxyFallbackEnabled` (config di workspace, riguarda solo il comportamento sui
> **mock-miss**).

---

## 5. Per-mock (file dei mock)

Proprietà del singolo endpoint/variante, editabili dall'editor dei mock (persistite via
`/_admin/api/mocks`). Scope diverso da questo documento; in sintesi: `method`, `path`, `enabled`,
`status`, `headers`, `delayMs`, tipo payload (mock JSON/testo/file, handler, middleware), varianti di
risposta selezionabili (anche per query string), `description`, abilitazione delle collezioni.

---

## 6. Docker / Compose

`docker-compose.yml` imposta l'ambiente del container e alcuni knob di orchestrazione:

- Mapping porte host: `MOCKXY_HOST_PORT` (motore, default `3000`), `MOCKXY_UI_HOST_PORT` (UI, default `4207`).
- Ritardo simulato: `MOCKXY_DELAY` / `MOCKXY_DELAY_ALL` → passati come `npm_config_delay` /
  `npm_config_delay_all`.
- Env del container: `HOST=0.0.0.0` (il loopback del container non è raggiungibile dal port mapping),
  `ADMIN_API_ENABLED=true`, `PROXY_FALLBACK_ENABLED=true`, `DEV_WATCH=true`, `CHOKIDAR_USEPOLLING=true`
  (eventi nativi inaffidabili su volumi montati), `MOCKS_DIR`, `MONITOR_DUMP_DIR`.

Il file `.env.example` documenta le variabili del motore per l'uso headless (`node index.js` / Docker).

---

_Ultimo aggiornamento: 8 luglio 2026._
