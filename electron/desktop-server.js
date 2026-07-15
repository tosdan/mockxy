// Avvio del motore di Mockxy "per l'app desktop".
//
// Questo modulo NON dipende da Electron: usa solo Node e il motore esistente (src/server).
// Così resta testabile dalla suite Jest del backend, e l'eventuale process principale di
// Electron lo richiama soltanto per ottenere un server già avviato e l'indirizzo da aprire
// nella finestra.

const net = require("net");

// Carica un modulo del motore di Mockxy. In sviluppo `src/` è la cartella accanto a
// `electron/` (`../src`); nel pacchetto electron-builder la copia dentro l'app (`./src`).
// Il fallback scatta solo se a mancare è proprio `./src/<subpath>`: un MODULE_NOT_FOUND
// qualsiasi (es. una dipendenza del motore assente dal pacchetto) deve propagarsi
// com'è, altrimenti l'errore reale viene mascherato da "modulo ../src/<subpath> non trovato".
function requireEngineModule(subpath) {
  try {
    return require(`./src/${subpath}`);
  } catch (error) {
    if (
      error &&
      error.code === "MODULE_NOT_FOUND" &&
      typeof error.message === "string" &&
      error.message.includes(`'./src/${subpath}'`)
    ) {
      return require(`../src/${subpath}`);
    }
    throw error;
  }
}
const { startServer, WORKSPACE_SETTING_DEFAULTS } = requireEngineModule("server");
const { createLogger } = requireEngineModule("utils/logger");
const { teeErrors } = require("./error-log");

// Trova una porta TCP libera lasciando che il sistema operativo ne assegni una (listen su 0).
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Verifica se una specifica porta TCP è libera sulla macchina locale (loopback): prova ad ascoltarci
// sopra e, se riesce, è libera; se l'ascolto fallisce (es. EADDRINUSE) la porta è occupata.
function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => {
      probe.close(() => resolve(true));
    });
  });
}

// Avvia il motore con le impostazioni tipiche dell'app desktop:
// - una porta libera (a meno che non sia imposta esplicitamente),
// - host di ascolto: loopback (default) o tutta la rete (0.0.0.0), secondo l'impostazione del workspace,
// - interfaccia servita dal motore stesso (quando si passa uiDistDir),
// - amministrazione attiva (il desktop è il banco di lavoro),
// - backendUrl del workspace (per-workspace): vuoto/assente = solo mock.
// Le altre opzioni (proxy fallback, ritardi) restano quelle della configurazione normale.
// Con onError le righe error del motore vengono duplicate verso il chiamante (il file di log
// dell'app desktop: in pacchetto lo stdout del motore non lo vede nessuno).
// startServerFn è iniettabile per i test.
async function startDesktopServer({
  mocksDir,
  filesDir,
  uiDistDir,
  monitorDumpDir,
  port,
  host,
  backendUrl,
  caseInsensitiveFilters,
  proxyFallbackEnabled,
  corsEnabled,
  adaptProxyCookies,
  rewriteProxyRedirects,
  globalDelayMs,
  delayAllRequests,
  requestTimeoutMs,
  monitorDumpIntervalMs,
  monitorDumpThreshold,
  monitorDumpMaxFileBytes,
  monitorDumpMaxTotalBytes,
  onError,
  startServerFn = startServer,
} = {}) {
  if (!mocksDir) {
    throw new Error("startDesktopServer richiede un mocksDir (la cartella del workspace).");
  }

  const resolvedPort = port || (await findFreePort());
  // Stesso livello di log della configurazione normale (LOG_LEVEL, default info): il logger
  // esterno sostituisce quello che il motore creerebbe da config.logLevel.
  const logger = onError
    ? teeErrors(createLogger(process.env.LOG_LEVEL || "info"), onError)
    : undefined;
  const runtime = await startServerFn({
    logger,
    configOverrides: {
      port: resolvedPort,
      // Solo i due valori noti sono ammessi a monte (main.js); qui il fallback resta loopback.
      host: host === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1",
      mocksDir,
      filesDir,
      uiDistDir,
      monitorDumpDir,
      backendUrl,
      caseInsensitiveFilters,
      proxyFallbackEnabled,
      corsEnabled,
      adaptProxyCookies,
      rewriteProxyRedirects,
      globalDelayMs,
      delayAllRequests,
      requestTimeoutMs,
      monitorDumpIntervalMs,
      monitorDumpThreshold,
      monitorDumpMaxFileBytes,
      monitorDumpMaxTotalBytes,
      adminApiEnabled: true,
    },
  });

  const url = uiDistDir
    ? `http://127.0.0.1:${resolvedPort}/_admin/ui/`
    : `http://127.0.0.1:${resolvedPort}/`;

  return { runtime, port: resolvedPort, url };
}

module.exports = { findFreePort, isPortFree, startDesktopServer, WORKSPACE_SETTING_DEFAULTS };
