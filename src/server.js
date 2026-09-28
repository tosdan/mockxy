const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const { createApp } = require("./app");
const { loadConfig, WORKSPACE_SETTING_DEFAULTS } = require("./config");
const { loadEndpointRouteGroups } = require("./mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("./mocks/local-route-groups");
const { createLogger } = require("./utils/logger");
const { MockRegistry } = require("./mocks/mock-registry");
const { SequenceStateStore } = require("./mocks/sequence-state");
const { HandlerStateStore } = require("./mocks/handler-state");
const { SharedStateStore } = require("./mocks/shared-state");
const { SseConnectionStore } = require("./mocks/sse-connections");
const { WsConnectionStore } = require("./mocks/ws-connections");
const { createWsUpgradeDispatcher } = require("./mocks/ws-serving");
const { ProxyMiddlewareRegistry } = require("./proxy/proxy-middleware-registry");
const { sortRouteGroups } = require("./mocks/route-groups");
const { RequestMonitorStore } = require("./monitoring/request-monitor");
const { ServerStateStore } = require("./server-state");
const { MonitorDumpWriter } = require("./monitoring/monitor-dump");
const { createUpgradeHandler } = require("./proxy/upgrade-proxy");
const { createRuntimeIdentity } = require("./runtime-identity");
const { RELOAD_REASONS, RuntimeStatusStore } = require("./runtime-status");
const { CatalogRevisionTracker } = require("./catalog-revision");

// Reintegra nelle nuove route la versione precedente degli endpoint il cui file oggi non
// carica: a caldo un errore su un singolo file non deve far sparire una route che funzionava
// (né farla scivolare in silenzio sul proxy verso il backend reale), ma nemmeno bloccare gli
// aggiornamenti agli altri mock. All'avvio non c'è nulla da reintegrare: il rotto resta fuori.
function graftPreviousRoutes(nextRouteGroups, previousRouteGroups, erroredFilePaths) {
  const groupsByPath = new Map(nextRouteGroups.map((group) => [group.path, group]));
  let grafted = false;

  for (const previousGroup of previousRouteGroups) {
    for (const [method, entry] of previousGroup.methods.entries()) {
      if (!erroredFilePaths.has(entry.configFilePath)) {
        continue;
      }
      const nextGroup = groupsByPath.get(previousGroup.path);
      if (nextGroup == null) {
        groupsByPath.set(previousGroup.path, { ...previousGroup, methods: new Map([[method, entry]]) });
        grafted = true;
      } else if (!nextGroup.methods.has(method)) {
        nextGroup.methods.set(method, entry);
        grafted = true;
      }
    }
  }

  return grafted ? sortRouteGroups(Array.from(groupsByPath.values())) : nextRouteGroups;
}

// Definizioni installate, per file di configurazione. Il graft conserva gli oggetti entry per
// riferimento: la loro identità dice quale versione di una definizione è servita.
function collectInstalledDefinitions(routeGroups) {
  const installed = new Map();
  for (const group of routeGroups) {
    for (const entry of group.methods.values()) {
      if (entry.configFilePath == null) {
        continue;
      }
      const filePath = path.resolve(entry.configFilePath);
      if (!installed.has(filePath)) {
        installed.set(filePath, new Set());
      }
      installed.get(filePath).add(entry);
    }
  }
  return installed;
}

function createReloadHandler({ mocksDir, registry, proxyMiddlewareRegistry, logger, handlerStates, sseConnections, wsConnections, runtimeStatus, catalogRevision }) {
  let drainPromise = null;
  let queuedWaiters = [];

  // Esegue un tentativo e lo registra, concluso, nello stato del runtime con le cause delle
  // richieste che serve (§13 C2).
  const performReload = async (reasons) => {
    const startedAt = new Date().toISOString();
    const outcome = await loadAndInstall();
    runtimeStatus?.recordAttempt({
      reasons,
      startedAt,
      completedAt: new Date().toISOString(),
      outcome,
      registries: [registry, proxyMiddlewareRegistry],
    });
    // Ogni reload segue una modifica del workspace: la revisione del catalogo va riallineata.
    try {
      await catalogRevision?.refresh();
    } catch (error) {
      logger.warn("Catalog revision scan failed.", { error: error.message });
    }
    return outcome;
  };

  const loadAndInstall = async () => {
    try {
      const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, sseRouteGroups, wsRouteGroups, loadErrors } =
        await loadEndpointRouteGroups(mocksDir);
      let routeGroups = mergeLocalRouteGroups({
        mockRouteGroups,
        handlerRouteGroups,
        sequenceRouteGroups,
        sseRouteGroups,
        wsRouteGroups,
      });
      let middlewareRouteGroups = proxyMiddlewareRouteGroups;
      if (loadErrors.length > 0) {
        const erroredFilePaths = new Set(loadErrors.map((loadError) => loadError.filePath));
        routeGroups = graftPreviousRoutes(routeGroups, registry.routeGroups, erroredFilePaths);
        middlewareRouteGroups = graftPreviousRoutes(
          middlewareRouteGroups,
          proxyMiddlewareRegistry.routeGroups,
          erroredFilePaths
        );
        for (const loadError of loadErrors) {
          logger.warn("Endpoint failed to load. Keeping its previous version, if any.", {
            filePath: loadError.filePath,
            error: loadError.message,
          });
        }
      }
      const changedSequenceKeys = registry.setRouteGroups(routeGroups);
      proxyMiddlewareRegistry.setRouteGroups(middlewareRouteGroups);
      for (const key of changedSequenceKeys) {
        handlerStates?.reset(key);
      }
      // Le connessioni SSE/WS aperte vanno chiuse: stanno servendo copioni della configurazione
      // precedente. Il client riconnette da solo e il copione (eventualmente nuovo) riparte
      // — "riconnessione = reset" è la semantica documentata.
      sseConnections?.closeAll();
      wsConnections?.closeAll();
      logger.info("Runtime routes reloaded.", {
        routeCount: routeGroups.length,
        proxyMiddlewareCount: middlewareRouteGroups.length,
        endpointLoadErrors: loadErrors.length,
      });
      // Le definizioni davvero installate (versioni reinnestate comprese): le mutazioni admin le
      // confrontano con l'effetto richiesto, perché l'assenza di errori non basta a provarlo.
      const installedDefinitions = collectInstalledDefinitions([...routeGroups, ...middlewareRouteGroups]);
      return {
        applied: true,
        loadErrors,
        fatalError: null,
        installedConfigFilePaths: new Set(installedDefinitions.keys()),
        installedDefinitions,
      };
    } catch (error) {
      logger.error("Runtime reload failed. Keeping previous configuration.", {
        error: error.message,
      });
      return { applied: false, loadErrors: [], fatalError: error };
    }
  };

  // Ogni chiamante attende un giro iniziato dopo la propria richiesta. Le chiamate durante un
  // giro vengono aggregate nel successivo, ma non risolte prematuramente col risultato del giro
  // già in corso: le mutazioni admin possono così sapere che la loro scrittura è stata vista.
  // Il tentativo porta le cause di tutte le richieste che serve.
  const drainReloadQueue = async () => {
    while (queuedWaiters.length > 0) {
      const waiters = queuedWaiters;
      queuedWaiters = [];
      const outcome = await performReload(waiters.map((waiter) => waiter.reason));
      for (const { resolve } of waiters) {
        resolve(outcome);
      }
    }
    drainPromise = null;
  };

  // `reason` è la causa riportata da GET /runtime/status: le mutazioni admin chiamano senza
  // argomenti, il watcher passa "watcher".
  const reload = (reason = "admin") => new Promise((resolve) => {
    queuedWaiters.push({ resolve, reason: RELOAD_REASONS.includes(reason) ? reason : "admin" });
    if (drainPromise == null) {
      drainPromise = drainReloadQueue();
    }
  });
  // Fotografia delle definizioni servite in questo momento: le mutazioni admin la prendono prima
  // di scrivere, per verificare che un eventuale ripristino riporti le stesse versioni.
  reload.installedDefinitions = () =>
    collectInstalledDefinitions([...registry.routeGroups, ...proxyMiddlewareRegistry.routeGroups]);
  return reload;
}

// Canonicalizza il percorso da osservare (alias corti 8.3 di Windows, symlink) prima di
// avviare il watcher: libuv va in assert-crash — abbattendo l'intero processo — se la
// directory osservata contiene un componente in forma corta (es. C:\Users\MARIOR~1.ROS\...),
// perché gli eventi arrivano col nome lungo e il confronto di prefisso interno fallisce.
// realpathSync.native serve apposta: la realpath "JS" di Node non espande gli alias 8.3.
// La cartella viene creata se assente: un percorso inesistente non è canonicalizzabile, e
// chokidar aggancerebbe il primo antenato esistente usando la stringa NON canonica fornita
// qui — reintroducendo il crash alla comparsa della cartella. Vedi docs/sviluppo/TROUBLESHOOTING-DEV.md.
function resolveCanonicalWatchPath(watchPath) {
  try {
    fs.mkdirSync(watchPath, { recursive: true });
    return fs.realpathSync.native(watchPath);
  } catch (_error) {
    // Impossibile creare o risolvere (es. permessi): si osserva il percorso così com'è.
    return watchPath;
  }
}

// `watcherStatus`, se passato, riporta lo stato del watcher per GET /info (§13 C2).
function startMockWatcher({ config, registry, proxyMiddlewareRegistry, logger, reloadRuntime, watcherStatus }) {
  if (!config.watchEnabled) {
    return null;
  }

  const reload = reloadRuntime || createReloadHandler({
    mocksDir: config.mocksDir,
    registry,
    proxyMiddlewareRegistry,
    logger,
  });

  const watcher = chokidar.watch(resolveCanonicalWatchPath(config.mocksDir), {
    ignoreInitial: true,
    usePolling: config.watchUsePolling,
    interval: 100,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 25,
    },
  });

  // Gli eventi passano il percorso come primo argomento: la causa del reload va resa esplicita.
  const reloadFromWatcher = () => reload("watcher");
  watcher.on("add", reloadFromWatcher);
  watcher.on("change", reloadFromWatcher);
  watcher.on("unlink", reloadFromWatcher);
  watcher.on("unlinkDir", reloadFromWatcher);
  watcher.on("addDir", reloadFromWatcher);
  watcher.on("ready", () => {
    if (watcherStatus != null && watcherStatus.state === "starting") {
      watcherStatus.state = "ready";
    }
  });
  watcher.on("error", (error) => {
    logger.error("Mock watcher error.", { error: error.message });
    if (watcherStatus != null) {
      watcherStatus.state = "error";
      watcherStatus.lastError = error.message;
    }
  });

  logger.info("Mock watch enabled.", {
    mocksDir: config.mocksDir,
    usePolling: config.watchUsePolling,
  });
  return watcher;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

async function createServerRuntime({ configOverrides = {}, logger: extLogger } = {}) {
  const runtimeIdentity = createRuntimeIdentity();
  const config = loadConfig(configOverrides);
  const logger = extLogger || createLogger(config.logLevel);
  // L'admin API scrive file ed esegue JavaScript in-process: aperta su un'interfaccia di rete
  // equivale a esecuzione di codice per chiunque raggiunga la porta. Non blocchiamo (può essere
  // una scelta consapevole su una rete fidata), ma l'avviso deve essere impossibile da mancare.
  if (config.adminApiEnabled && (!config.host || !LOOPBACK_HOSTS.has(config.host))) {
    logger.warn(
      "Admin API enabled on a non-loopback interface: anyone who can reach this port can create handlers and execute code on this machine. Use HOST=127.0.0.1 or ADMIN_API_ENABLED=false unless this network is trusted.",
      { host: config.host || "(all interfaces)" }
    );
  }
  if (config.proxyFallbackEnabled && !config.backendUrl) {
    logger.warn(
      "BACKEND_URL is not configured. Mocks and local handlers work normally, but requests that fall through to the backend (proxy fallback) or use proxy middleware will return 501 until BACKEND_URL is set."
    );
  }
  const runtimeStatus = new RuntimeStatusStore({ runtimeId: runtimeIdentity.runtimeId, mocksDir: config.mocksDir });
  const catalogRevision = new CatalogRevisionTracker({ mocksDir: config.mocksDir });
  // Stato del watcher e indirizzo realmente in ascolto, riportati da GET /info.
  const watcherStatus = {
    state: config.watchEnabled ? "starting" : "disabled",
    polling: config.watchEnabled ? config.watchUsePolling === true : false,
    lastError: null,
  };
  const listener = { address: null };
  const startupStartedAt = new Date().toISOString();
  const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, sseRouteGroups, wsRouteGroups, loadErrors } =
    await loadEndpointRouteGroups(config.mocksDir);
  // Avvio resiliente: un file rotto non blocca il boot — l'endpoint viene saltato con un
  // warning per file, gli altri mock partono normalmente.
  for (const loadError of loadErrors) {
    logger.warn("Endpoint skipped due to a load error.", {
      filePath: loadError.filePath,
      error: loadError.message,
    });
  }
  const routeGroups = mergeLocalRouteGroups({
    mockRouteGroups,
    handlerRouteGroups,
    sequenceRouteGroups,
    sseRouteGroups,
    wsRouteGroups,
  });
  // I cursori delle sequenze vivono qui (non nel registry): sopravvivono alle ricariche a caldo
  // e vengono azzerati solo da riavvio, reset esplicito, inattività o cambio di definizione.
  const sequenceStates = new SequenceStateStore();
  // Memoria per-endpoint degli handler (state/callCount/firstRequestAt): come i cursori,
  // vive nel runtime e sopravvive alle ricariche a caldo; si azzera a riavvio o reset.
  const handlerStates = new HandlerStateStore();
  // Named JSON state shared by handlers. It survives hot reloads and is closed only with this
  // runtime, so no store or generation leaks across workspace/runtime boundaries.
  const sharedStates = new SharedStateStore({ logger });
  // Connessioni SSE vive + storico per la console; chiuse a ogni reload e allo shutdown.
  const sseConnections = new SseConnectionStore();
  // Connessioni WebSocket mockate + transcript bidirezionale; stessa vita delle SSE.
  const wsConnections = new WsConnectionStore();
  const registry = new MockRegistry(routeGroups, sequenceStates);
  const proxyMiddlewareRegistry = new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups);
  // Il caricamento iniziale è il primo tentativo: all'avvio nessuna versione precedente da mantenere.
  runtimeStatus.recordAttempt({
    reasons: ["startup"],
    startedAt: startupStartedAt,
    completedAt: new Date().toISOString(),
    outcome: { applied: true, loadErrors, fatalError: null },
    registries: [registry, proxyMiddlewareRegistry],
  });
  // La prima scansione fissa la revisione 1 del catalogo prima di servire qualunque richiesta:
  // calcolata più tardi, assorbirebbe nella base una modifica esterna successiva all'avvio,
  // lasciando alla revisione 1 un client che aveva già letto il catalogo precedente.
  await catalogRevision.refresh();
  const requestMonitor = new RequestMonitorStore(undefined, logger);
  const serverState = new ServerStateStore();
  const monitorDump = new MonitorDumpWriter({
    dumpDir: config.monitorDumpDir,
    intervalMs: config.monitorDumpIntervalMs,
    threshold: config.monitorDumpThreshold,
    maxFileBytes: config.monitorDumpMaxFileBytes,
    maxTotalBytes: config.monitorDumpMaxTotalBytes,
    logger,
  });
  const reloadRuntime = createReloadHandler({
    mocksDir: config.mocksDir,
    registry,
    proxyMiddlewareRegistry,
    logger,
    handlerStates,
    sseConnections,
    wsConnections,
    runtimeStatus,
    catalogRevision,
  });
  const app = createApp({
    registry,
    config,
    logger,
    runtimeIdentity,
    runtimeStatus,
    catalogRevision,
    watcherStatus,
    listener,
    proxyMiddlewareRegistry,
    reloadRuntime,
    requestMonitor,
    serverState,
    monitorDump,
    sequenceStates,
    handlerStates,
    sharedStates,
    sseConnections,
    wsConnections,
  });
  const watcher = startMockWatcher({
    config,
    registry,
    proxyMiddlewareRegistry,
    logger,
    reloadRuntime,
    watcherStatus,
  });

  return {
    app,
    config,
    logger,
    proxyMiddlewareRegistry,
    requestMonitor,
    serverState,
    monitorDump,
    registry,
    sequenceStates,
    handlerStates,
    sharedStates,
    sseConnections,
    wsConnections,
    reloadRuntime,
    watcher,
    runtimeIdentity,
    runtimeStatus,
    catalogRevision,
    watcherStatus,
    listener,
  };
}

async function startServer(options = {}) {
  const runtime = await createServerRuntime(options);
  const { port, host } = runtime.config;
  const onListening = () => {
    runtime.logger.info("Mockxy started.", {
      port,
      host: host || "(all interfaces)",
      backendUrl: runtime.config.backendUrl,
      delayAllRequests: runtime.config.delayAllRequests,
      globalDelayMs: runtime.config.globalDelayMs,
      mocksDir: runtime.config.mocksDir,
      uiServed: Boolean(runtime.config.uiDistDir),
      adminApiEnabled: runtime.config.adminApiEnabled,
      proxyFallbackEnabled: runtime.config.proxyFallbackEnabled,
      proxyMiddlewareCount: runtime.proxyMiddlewareRegistry.routeGroups.length,
      watchEnabled: runtime.config.watchEnabled,
    });
  };
  const server = host
    ? runtime.app.listen(port, host, onListening)
    : runtime.app.listen(port, onListening);

  // Le richieste di upgrade (WebSocket) non passano da Express: senza questo handler Node
  // chiuderebbe il socket e le WebSocket delle app attraverso Mockxy morirebbero in silenzio.
  // Prima il dispatcher dei mock ws (endpoint abilitato con variante selezionata ws →
  // handshake locale, vedi ws-serving.js), poi il passthrough verso il backend (upgrade-proxy.js).
  const upgradeHandler = createUpgradeHandler({
    config: runtime.config,
    serverState: runtime.serverState,
    logger: runtime.logger,
  });
  const upgradeDispatcher = createWsUpgradeDispatcher({
    registry: runtime.registry,
    serverState: runtime.serverState,
    wsConnections: runtime.wsConnections,
    logger: runtime.logger,
    fallback: upgradeHandler,
    // Knob non documentato (test e casi limite), come sseHeartbeatMs: default 30s.
    pingIntervalMs: runtime.config.wsPingIntervalMs,
  });
  server.on("upgrade", upgradeDispatcher);

  // Aspetta l'ascolto e propaga un eventuale errore (es. porta occupata) come rejection, invece
  // di lasciarlo come evento 'error' non gestito (che farebbe crashare il processo).
  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.removeListener("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.removeListener("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
  });
  // L'indirizzo realmente in ascolto, anche quando la porta richiesta era 0.
  const address = server.address();
  runtime.listener.address = address && typeof address === "object" ? { host: address.address, port: address.port } : null;

  const performShutdown = async () => {
    // Il runtime spento non deve restare agganciato al processo: senza questa rimozione ogni
    // riavvio del motore (es. cambio workspace nell'app desktop) accumula listener che
    // trattengono in memoria l'intero runtime e, a un segnale reale, fanno partire N shutdown.
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);

    // Ogni passo di pulizia è protetto: un errore (es. flush del dump su disco pieno) non deve
    // impedire la chiusura del server né propagarsi come unhandled rejection.
    const cleanupSteps = [
      // Invalidate handler capabilities before waiting on any I/O-bound cleanup operation.
      ["shared state close", () => runtime.sharedStates?.close()],
      ["monitor dump stop", () => runtime.monitorDump?.stop()],
      ["watcher close", () => runtime.watcher?.close()],
      // Gli stream SSE aperti trattengono server.close come le WebSocket: chiusura esplicita.
      ["sse connections close", () => runtime.sseConnections?.closeAll()],
      ["ws mock connections close", () => runtime.wsConnections?.closeAll()],
      // I tunnel di upgrade (WebSocket) si staccano dal tracking del server: vanno chiusi a mano,
      // altrimenti server.close resta appeso su una connessione lunga ancora attiva.
      ["upgrade tunnels close", () => upgradeHandler.closeConnections()],
    ];
    for (const [stepName, step] of cleanupSteps) {
      try {
        await step();
      } catch (error) {
        runtime.logger.error("Shutdown cleanup step failed.", {
          step: stepName,
          error: error?.message,
        });
      }
    }

    await new Promise((resolve) => {
      server.close(resolve);
      // Chiude le connessioni keep-alive ancora aperte (es. l'interfaccia già caricata): senza
      // questo `server.close` attende che si svuotino da sole e lo shutdown resta appeso — il che
      // bloccava il cambio di workspace nell'app desktop (riavvio del motore sulla stessa porta).
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    });
  };

  // Idempotente: chiamate ripetute (pool del desktop + segnale, o doppio segnale) riusano lo
  // stesso spegnimento invece di ripeterlo su risorse già chiuse.
  let shutdownPromise = null;
  const shutdown = () => {
    if (!shutdownPromise) {
      shutdownPromise = performShutdown();
    }
    return shutdownPromise;
  };

  const handleSignal = () => {
    shutdown().catch((error) => {
      runtime.logger.error("Shutdown failed after signal.", { error: error?.message });
    });
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  return { ...runtime, server, shutdown };
}

module.exports = {
  createReloadHandler,
  createServerRuntime,
  startServer,
  startMockWatcher,
  // Ri-esposto per il wrapper desktop, che carica il motore da qui (vedi electron/desktop-server.js).
  WORKSPACE_SETTING_DEFAULTS,
};
