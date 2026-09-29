const fs = require("fs");
const path = require("path");
const express = require("express");
const {
  getAdminMockDetail,
  getAdminMockResponse,
  listAdminChildOrder,
  listAdminCollections,
  listAdminMocks,
  resolveAdminMockForRequest,
} = require("./mock-catalog");
const {
  copyAdminEndpoint,
  previewAdminEndpointCopy,
  createAdminMock,
  createAdminResponse,
  deleteAdminMock,
  deleteAdminResponse,
  updateAdminEndpoint,
  updateAdminMock,
  updateAdminResponse,
  setAdminResponseFile,
  getAdminSequenceState,
  resetAdminSequence,
  pushAdminSseMessage,
  listAdminSseState,
  pushAdminWsMessage,
  listAdminWsState,
  updateAdminEndpointsEnabled,
} = require("./endpoint-operations");
const {
  assignAdminCollection,
  createAdminCollection,
  deleteAdminCollection,
  eraseAdminCollection,
  reorderAdminCollections,
  reorderAdminCollectionChildren,
  reorderAdminCollectionItems,
  reparentAdminCollection,
  updateAdminCollectionEnabled,
} = require("./collection-operations");
const { createMocksFromDump } = require("./dump-to-mock");
const { countCaptureOutcomes, createMocksFromCaptures, parseBatchOptions } = require("./capture-to-mock");
const { importAdminOpenapi } = require("./openapi-admin-import");
const { createAdminError } = require("./admin-errors");
const {
  listAdminDataFiles,
  readAdminDataFile,
  putAdminDataFile,
  renameAdminDataFile,
  deleteAdminDataFile,
} = require("./admin-data-files");
const { setNoCacheHeaders } = require("../utils/cache");
const { describeRuntimeConfig, pickRuntimeConfig } = require("./runtime-config");
const { ENGINE_VERSION, ObservedRevision, describeWorkspace } = require("../runtime-info");
const { canonicalPath } = require("../utils/canonical-path");
const { trackWrites } = require("../utils/write-tracking");
const { getEndpointResponsesDir } = require("./endpoint-files");
const { resolveAdminFilePath } = require("./mock-ids");
const { runWithWorkspaceId } = require("./revision-tokens");
const {
  listDumpFiles,
  readDumpPage,
  isSafeDumpFileName,
  deleteDumpFile,
} = require("../monitoring/monitor-dump-reader");
const { parseMonitorPageQuery, readMonitorEntry, readMonitorPage } = require("../monitoring/request-monitor-page");

// Monitor assente (motore incorporato senza cattura): pagine vuote, nessuna voce per ID.
const EMPTY_MONITOR = {
  snapshot: () => ({ entries: [], generation: 1, highWatermark: 0 }),
  getEntry: () => undefined,
};

const PARSED_JSON_BODY_BYTES = Symbol("parsedJsonBodyBytes");

// Fonte canonica del contratto, risolta rispetto a questo modulo e non alla cwd: è lo stesso file
// in un checkout, nel pacchetto Electron (che copia src/) e nell'immagine Docker di sviluppo.
const ADMIN_OPENAPI_PATH = path.join(__dirname, "admin-api.openapi.yaml");

// Coda delle mutazioni admin per workspace (piano agent/API, §13 C1): una mutazione alla volta
// per mocksDir canonico, anche fra runtime distinti dello stesso processo. È distinta dalla coda
// non rientrante di .collections.json, che le operazioni continuano a usare al loro interno. Il
// turno segue la promise dell'operazione, non la connessione: un client che si disconnette non
// libera la coda mentre l'operazione sta ancora scrivendo. Letture, serving e push ne restano fuori.
const mutationQueues = new Map();

function canonicalWorkspaceKey(mocksDir) {
  if (typeof mocksDir !== "string" || mocksDir === "") {
    return "";
  }
  return canonicalPath(mocksDir);
}

function runInMutationQueue(key, task) {
  const previousTail = mutationQueues.get(key) || Promise.resolve();
  const run = previousTail.then(task);
  // Un errore chiude il turno senza bloccare le mutazioni successive.
  const tail = run.catch(() => {});
  mutationQueues.set(key, tail);
  tail.then(() => {
    if (mutationQueues.get(key) === tail) {
      mutationQueues.delete(key);
    }
  });
  return run;
}

// Un 400 che esce da una mutazione senza codice è un rifiuto deciso prima di scrivere: gli
// errori successivi alle scritture passano da commitWithRollback, che dichiara il ripristino.
function markRejectedBeforeWriting(error) {
  if (error?.status === 400 && error.details?.code == null) {
    error.details = { ...(error.details || {}), code: "MUTATION_REJECTED", rollback: "not_needed" };
  }
  return error;
}

// Trattiene la fine della risposta finché non viene rilasciata: il gestore compone la risposta
// come sempre, ma arriva al client solo dopo il lavoro che deve precederla. Il rilascio ripristina
// il metodo originale e invia la risposta trattenuta, se c'è.
function holdResponse(res) {
  const originalEnd = res.end;
  let pending = null;
  res.end = function heldEnd(...args) {
    pending = args;
    return res;
  };
  return () => {
    res.end = originalEnd;
    if (pending != null) {
      originalEnd.apply(res, pending);
    }
  };
}

// File del catalogo di cui GET /mocks/:id ha letto il contenuto: definizione, varianti elencate,
// sorgente della variante selezionata e asset di un mock servito da file (letto per il token).
function detailReadPaths(detail) {
  const responsesDir = detail.responseFilePath ? path.dirname(detail.responseFilePath) : null;
  return [
    detail.definitionFilePath,
    ...(responsesDir == null ? [] : (detail.responses || []).map((response) => path.join(responsesDir, response.fileName))),
    detail.sourceFilePath,
    detail.fileInfo != null ? detail.payloadFilePath : null,
  ].filter((filePath) => typeof filePath === "string" && filePath !== "");
}

// File del catalogo di cui GET /mocks/:id/responses/:file ha letto il contenuto: definizione,
// variante, sorgente diretto e asset (letto per il token).
function variantReadPaths(mocksDir, variant) {
  const endpointPath = resolveAdminFilePath(mocksDir, variant.id);
  const responsesDir = getEndpointResponsesDir(endpointPath);
  const sourceFile = variant.source != null ? variant.response?.sourceFile : null;
  return [
    endpointPath,
    path.join(responsesDir, variant.responseFile),
    ...(typeof sourceFile === "string" ? [path.join(responsesDir, sourceFile)] : []),
    ...(variant.fileInfo != null ? [path.resolve(responsesDir, variant.fileInfo.name)] : []),
  ];
}

function markParsedJsonBodyLength(req, _res, buffer) {
  req[PARSED_JSON_BODY_BYTES] = buffer.length;
}

// Parameterless administrative mutations use one unambiguous wire contract: an actual,
// non-empty application/json payload whose parsed value is exactly {}.
function requireEmptyJsonObject(req, res, next) {
  if (!req.is("application/json")) {
    sendJson(res, 415, {
      error: "Unsupported Media Type",
      message: "Use Content-Type: application/json.",
    });
    return;
  }

  const prototype = req.body != null && typeof req.body === "object"
    ? Object.getPrototypeOf(req.body)
    : undefined;
  const isEmptyPlainObject = (
    req[PARSED_JSON_BODY_BYTES] > 0
    && prototype === Object.prototype
    && Reflect.ownKeys(req.body).length === 0
  );
  if (!isEmptyPlainObject) {
    // Il middleware protegge solo rotte di mutazione: è un rifiuto prima di scrivere.
    sendJson(res, 400, {
      error: "Bad Request",
      message: "Request body must be an empty JSON object ({}).",
      details: { code: "MUTATION_REJECTED", rollback: "not_needed" },
    });
    return;
  }
  next();
}

// Sends a structured Server-Sent Events payload to a live monitoring client.
function sendSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(res, status, payload) {
  setNoCacheHeaders(res);
  res.status(status).json(payload);
}

function createAdminApiRouter({ config, runtimeIdentity, runtimeStatus, catalogRevision, watcherStatus, listener, registry, proxyMiddlewareRegistry, reloadRuntime, requestMonitor, serverState, monitorDump, sequenceStates, handlerStates, sharedStates, sseConnections, wsConnections }) {
  const router = express.Router();
  // Store dello scenario runtime, passati alle mutazioni che possono invalidarlo: il reload da
  // solo non basta, perche' aggrega piu' scritture in un giro unico (vedi invalidateScenario).
  const scenarioStates = { sequenceStates, handlerStates };
  // Registri del runtime installato: il bersaglio delle console SSE/WS si risolve da qui.
  const installed = { registry, proxyMiddlewareRegistry };
  // Configurazione di avvio, fotografata alla creazione del runtime (§13 C2).
  const startupConfig = pickRuntimeConfig(config);
  const workspaceKey = canonicalWorkspaceKey(config?.mocksDir);
  // Esegue il gestore di una rotta di mutazione nel turno del workspace, dopo parsing e limiti
  // del body (già applicati dai middleware della rotta).
  // La revisione del catalogo si pubblica prima della risposta della mutazione (§13 C2): la
  // risposta resta trattenuta finché la scansione, che rilegge esattamente i file scritti dalla
  // mutazione anche a firma invariata, non è conclusa. GET /info legge poi soltanto l'ultima
  // revisione pubblicata, senza attese.
  const mutation = (handler) => (req, res) =>
    runInMutationQueue(workspaceKey, async () => {
      const written = new Set();
      const releaseResponse = holdResponse(res);
      try {
        return await trackWrites(written, () => withWorkspace(() => handler(req, res)));
      } finally {
        await catalogRevision?.refresh({ invalidate: written }).catch(() => {});
        releaseResponse();
      }
    }).catch((error) => {
      throw markRejectedBeforeWriting(error);
    });
  // Identità del workspace (i percorsi sono fissi per il runtime; senza mocksDir si calcola alla
  // prima lettura di GET /info) e revisioni degli stati configurabili. Le letture e le mutazioni
  // del router calcolano i token di revisione con la stessa identità, nel contesto di questo
  // runtime e non in un registro globale.
  let workspace = config?.mocksDir ? describeWorkspace(config) : null;
  const withWorkspace = (task) => runWithWorkspaceId(workspace?.id, task);
  const serverRevision = new ObservedRevision(() => JSON.stringify(serverState?.getState() ?? null));
  const dumpRevision = new ObservedRevision(() => JSON.stringify(monitorDump == null ? null : {
    enabled: monitorDump.enabled,
    intervalMs: monitorDump.intervalMs,
    threshold: monitorDump.threshold,
    maxFileBytes: monitorDump.maxFileBytes,
    maxTotalBytes: monitorDump.maxTotalBytes,
  }));

  router.use(express.json({ limit: "2mb", verify: markParsedJsonBodyLength }));

  // Contratto della versione in esecuzione, dalla fonte confezionata col motore (§13 C2).
  router.get("/openapi.yaml", async (_req, res) => {
    const source = await fs.promises.readFile(ADMIN_OPENAPI_PATH);
    setNoCacheHeaders(res);
    res.status(200).type("application/yaml").send(source);
  });

  // Configurazione effettiva in sola lettura: le nove chiavi di C8, senza altre variabili d'ambiente.
  router.get("/config", (_req, res) => {
    sendJson(res, 200, describeRuntimeConfig({ runtimeId: runtimeIdentity?.runtimeId ?? null, startup: startupConfig, config }));
  });

  // Identità del runtime e del workspace, indirizzo, watcher e revisioni leggere delle risorse
  // osservabili (§13 C2): uno snapshot in memoria, senza scansioni né attese. Le revisioni si
  // aggiornano con le operazioni.
  router.get("/info", (_req, res) => {
    sendJson(res, 200, {
      version: ENGINE_VERSION,
      runtimeId: runtimeIdentity?.runtimeId ?? null,
      startedAt: runtimeIdentity?.startedAt ?? null,
      workspace: (workspace ??= describeWorkspace(config ?? {})),
      listener: listener?.address ?? null,
      watcher: watcherStatus == null
        ? { state: "disabled", polling: false, lastError: null }
        : { state: watcherStatus.state, polling: watcherStatus.polling, lastError: watcherStatus.lastError },
      revisions: {
        catalog: catalogRevision?.revision ?? 1,
        server: serverRevision.observe(),
        dump: dumpRevision.observe(),
        diagnostics: runtimeStatus?.revision ?? 1,
        // Nessuna configurazione modificabile a runtime prima di S8.
        config: 1,
      },
    });
  });

  // Esito dell'ultimo tentativo di caricamento ed errori per file del registro installato: 200
  // anche in stato degradato o fallito (§13 C2).
  router.get("/runtime/status", (_req, res) => {
    const status = runtimeStatus?.snapshot() ?? {
      runtimeId: runtimeIdentity?.runtimeId ?? null,
      lastAttempt: null,
      lastAppliedAttemptId: null,
      errors: [],
      fatalError: null,
    };
    sendJson(res, 200, status);
  });

  // Senza query: la vista storica {items}, più recente prima. Con view=page: pagine crescenti con
  // cursore, filtri e gap (§13 C5); ogni altro parametro, o un parametro senza view=page, è un 400.
  router.get('/monitoring/requests', (req, res) => {
    const page = parseMonitorPageQuery(req.query);
    if (page == null) {
      sendJson(res, 200, { items: requestMonitor?.listEntries() || [] });
      return;
    }
    sendJson(res, 200, readMonitorPage(requestMonitor ?? EMPTY_MONITOR, runtimeIdentity?.runtimeId ?? null, page));
  });

  router.delete('/monitoring/requests', mutation((_req, res) => {
    requestMonitor?.clear();
    sendJson(res, 204);
  }));

  router.get('/monitoring/requests/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sendSseEvent(res, {
      type: 'snapshot',
      items: requestMonitor?.listEntries() || [],
    });

    const unsubscribe = requestMonitor?.subscribe((event) => {
      sendSseEvent(res, event);
    });

    const keepAliveTimer = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      unsubscribe?.();
    });
  });

  // Mock dal traffico del Monitor (§13 C7), nell'ordine richiesto. Il runtime deve essere quello
  // delle catture (gli ID ripartono a ogni avvio), e l'abilitazione dei nuovi endpoint va dichiarata:
  // nessuna attivazione implicita dietro una cattura. Le voci si copiano all'inizio del turno nella
  // coda: un'espulsione successiva non invalida una cattura già acquisita.
  router.post('/monitoring/requests/create-mocks', mutation(async (req, res) => {
    const body = req.body;
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      throw createAdminError(400, 'The body must be a JSON object.');
    }
    const allowed = new Set(['runtimeId', 'ids', 'onConflict', 'selectAddedVariants', 'newEndpointEnabled']);
    const unknown = Object.keys(body).find((name) => !allowed.has(name));
    if (unknown !== undefined) {
      throw createAdminError(400, `Unknown field: ${unknown}.`);
    }
    if (typeof body.runtimeId !== 'string' || body.runtimeId === '') {
      throw createAdminError(400, 'runtimeId is required: the runtime the request ids belong to.');
    }
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 250
      || !ids.every((id) => typeof id === 'string' && /^(0|[1-9][0-9]*)$/.test(id))
      || new Set(ids).size !== ids.length) {
      throw createAdminError(400, 'ids must be 1 to 250 distinct decimal request ids.');
    }
    const options = parseBatchOptions(body);
    const runtimeId = runtimeIdentity?.runtimeId ?? null;
    if (body.runtimeId !== runtimeId) {
      throw createAdminError(409, 'The runtime restarted: these request ids belong to another runtime.', { code: 'RUNTIME_CHANGED', runtimeId });
    }
    const captures = ids.map((id) => {
      const entry = requestMonitor?.getEntry(id);
      return { ref: { requestId: id }, entry: entry == null ? null : structuredClone(entry) };
    });
    const result = await createMocksFromCaptures({
      mocksDir: config.mocksDir,
      captures,
      options,
      source: 'monitor',
      reloadRuntime,
      scenarioStates,
      rejectionLabel: 'Mock creation from the monitor',
    });
    sendJson(res, 201, { runtimeId, counts: countCaptureOutcomes(result.items), ...result });
  }));

  // Una voce per ID, completa. Dichiarata dopo /stream: il percorso statico non deve finire nella
  // rotta parametrica.
  router.get('/monitoring/requests/:id', (req, res) => {
    sendJson(res, 200, readMonitorEntry(requestMonitor ?? EMPTY_MONITOR, runtimeIdentity?.runtimeId ?? null, req.params.id, req.query));
  });

  // --- Dump su disco del monitor: cattura durevole del traffico per lo storico ---
  router.get('/monitoring/dump', (_req, res) => {
    sendJson(res, 200, monitorDump ? monitorDump.getStatus() : { enabled: false });
  });

  router.patch('/monitoring/dump', mutation(async (req, res) => {
    if (!monitorDump) {
      sendJson(res, 200, { enabled: false });
      return;
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if ('enabled' in body && typeof body.enabled !== 'boolean') {
      throw createAdminError(400, 'enabled must be a boolean.');
    }
    if ('intervalMs' in body && (typeof body.intervalMs !== 'number' || !Number.isFinite(body.intervalMs) || body.intervalMs <= 0)) {
      throw createAdminError(400, 'intervalMs must be a positive number.');
    }
    if ('threshold' in body && (!Number.isInteger(body.threshold) || body.threshold <= 0)) {
      throw createAdminError(400, 'threshold must be a positive integer.');
    }
    monitorDump.setConfig({ intervalMs: body.intervalMs, threshold: body.threshold });
    if (body.enabled === true) {
      monitorDump.start(requestMonitor);
    } else if (body.enabled === false) {
      await monitorDump.stop();
    }
    dumpRevision.observe();
    sendJson(res, 200, monitorDump.getStatus());
  }));

  router.post('/monitoring/dump/flush', requireEmptyJsonObject, mutation(async (_req, res) => {
    const flushed = monitorDump ? await monitorDump.flush() : 0;
    sendJson(res, 200, { flushed, ...(monitorDump ? monitorDump.getStatus() : {}) });
  }));

  router.get('/monitoring/dumps', async (_req, res) => {
    const files = await listDumpFiles(config.monitorDumpDir);
    sendJson(res, 200, { files });
  });

  // Lettura paginata a cursore in avanti per il virtual scroll dello storico.
  router.get('/monitoring/dumps/read', async (req, res) => {
    const fileIndex = Number.parseInt(req.query.fileIndex, 10);
    const lineIndex = Number.parseInt(req.query.lineIndex, 10);
    const limit = Number.parseInt(req.query.limit, 10);
    const cursor = {
      fileIndex: Number.isInteger(fileIndex) ? fileIndex : 0,
      lineIndex: Number.isInteger(lineIndex) ? lineIndex : 0,
    };
    const page = await readDumpPage(config.monitorDumpDir, cursor, Number.isInteger(limit) ? limit : undefined);
    sendJson(res, 200, page);
  });

  // Creazione massiva di mock dal dump, guidata dalla selezione del frontend (file intero o insieme di chiavi).
  router.post('/monitoring/dumps/create-mocks', mutation(async (req, res) => {
    const result = await createMocksFromDump(config.mocksDir, config.monitorDumpDir, req.body, reloadRuntime, scenarioStates);
    sendJson(res, 201, result);
  }));

  router.delete('/monitoring/dumps/:file', mutation(async (req, res) => {
    if (!isSafeDumpFileName(req.params.file)) {
      throw createAdminError(400, 'Invalid dump file name.');
    }
    await deleteDumpFile(config.monitorDumpDir, req.params.file);
    sendJson(res, 204);
  }));

  const DEFAULT_SERVER_STATE = { serverEnabled: true, proxyAll: false };

  router.get('/server', (_req, res) => {
    sendJson(res, 200, serverState ? serverState.getState() : DEFAULT_SERVER_STATE);
  });

  router.patch('/server', mutation((req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if ('serverEnabled' in body && typeof body.serverEnabled !== 'boolean') {
      throw createAdminError(400, 'serverEnabled must be a boolean.');
    }
    if ('proxyAll' in body && typeof body.proxyAll !== 'boolean') {
      throw createAdminError(400, 'proxyAll must be a boolean.');
    }
    const state = serverState ? serverState.setState(body) : DEFAULT_SERVER_STATE;
    serverRevision.observe();
    sendJson(res, 200, state);
  }));

  // Runtime shared state is intentionally metadata-only: values remain private to handlers.
  router.get("/runtime/shared-state", (_req, res) => {
    sendJson(res, 200, sharedStates.listMetadata());
  });

  router.post(
    "/runtime/shared-state/:name/reset",
    requireEmptyJsonObject,
    mutation((req, res) => {
      try {
        const normalizedName = String(req.params.name).trim().toLowerCase();
        const reset = sharedStates.reset(req.params.name);
        sendJson(res, 200, { name: normalizedName, reset });
      } catch (error) {
        if (error?.code === "SHARED_STATE_INVALID_NAME") {
          throw createAdminError(400, error.message);
        }
        throw error;
      }
    })
  );

  router.post(
    "/runtime/shared-state/reset",
    requireEmptyJsonObject,
    mutation((_req, res) => {
      sendJson(res, 200, { resetCount: sharedStates.resetAll() });
    })
  );

  router.get("/mocks", async (_req, res) => {
    // Gli endpoint illeggibili non spengono il catalogo: vengono saltati e segnalati qui.
    const loadErrors = [];
    const items = await listAdminMocks(config.mocksDir, loadErrors);
    const collections = await listAdminCollections(config.mocksDir, items);
    const childOrder = await listAdminChildOrder(config.mocksDir, items);
    sendJson(res, 200, { items, collections, childOrder, loadErrors });
    // Una lettura del catalogo è un'occasione per riallineare la revisione senza watcher.
    catalogRevision?.refresh().catch(() => {});
  });

  // Risolve una richiesta concreta (es. una entry del monitor) nell'endpoint del catalogo
  // che oggi la coprirebbe — disabilitati inclusi. Fatto derivato, mai persistito: serve
  // alla UI per offrire "vai al mock" senza alterare le entry catturate.
  // Registrata prima di /mocks/:id per non farsi catturare dal parametro.
  router.get("/mocks/resolve", async (req, res) => {
    const method = String(req.query.method || "").toUpperCase();
    const requestPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) {
      sendJson(res, 400, { error: "Bad Request", message: "method must be a valid HTTP method." });
      return;
    }
    if (!requestPath.startsWith("/")) {
      sendJson(res, 400, { error: "Bad Request", message: "path must be an absolute request path." });
      return;
    }

    const mock = await resolveAdminMockForRequest(config.mocksDir, method, requestPath);
    sendJson(res, 200, { mock });
  });

  router.post("/mocks/collections", mutation(async (req, res) => {
    const collection = await createAdminCollection(config.mocksDir, req.body);
    sendJson(res, 201, collection);
  }));

  router.patch("/mocks/collections/order", mutation(async (req, res) => {
    const collections = await reorderAdminCollections(config.mocksDir, req.body);
    sendJson(res, 200, collections);
  }));

  router.patch("/mocks/collections/:id/parent", mutation(async (req, res) => {
    const collections = await reparentAdminCollection(config.mocksDir, req.params.id, req.body);
    sendJson(res, 200, collections);
  }));

  router.patch("/mocks/collections/:id/items/order", mutation(async (req, res) => {
    const items = await reorderAdminCollectionItems(config.mocksDir, req.params.id, req.body);
    sendJson(res, 200, { items });
  }));

  router.patch("/mocks/collections/:parentKey/children/order", mutation(async (req, res) => {
    const items = await reorderAdminCollectionChildren(config.mocksDir, req.params.parentKey, req.body);
    sendJson(res, 200, { items });
  }));

  router.patch("/mocks/collections/:id/enabled", mutation(async (req, res) => {
    const items = await updateAdminCollectionEnabled(
      config.mocksDir,
      req.params.id,
      req.body,
      reloadRuntime
    );
    const collections = await listAdminCollections(config.mocksDir, items);
    const childOrder = await listAdminChildOrder(config.mocksDir, items);
    sendJson(res, 200, { items, collections, childOrder });
  }));

  router.delete("/mocks/collections/:id", mutation(async (req, res) => {
    await deleteAdminCollection(config.mocksDir, req.params.id);
    sendJson(res, 204);
  }));

  router.delete("/mocks/collections/:id/contents", mutation(async (req, res) => {
    const result = await eraseAdminCollection(
      config.mocksDir,
      req.params.id,
      reloadRuntime
    );
    sendJson(res, 200, result);
  }));

  // Registrata prima di /mocks/:id: "enabled" non è l'id di una definizione.
  router.patch("/mocks/enabled", mutation(async (req, res) => {
    const items = await updateAdminEndpointsEnabled(config.mocksDir, req.body, reloadRuntime);
    const collections = await listAdminCollections(config.mocksDir, items);
    const childOrder = await listAdminChildOrder(config.mocksDir, items);
    sendJson(res, 200, { items, collections, childOrder });
  }));

  router.get("/mocks/:id", async (req, res) => {
    const detail = await withWorkspace(() => getAdminMockDetail(config.mocksDir, req.params.id));
    // Il dettaglio legge i contenuti effettivi: se differiscono da quelli in cache (una modifica
    // esterna a firma invariata, un file comparso), la revisione del catalogo lo registra (§13 C2).
    // L'osservazione non entra nella coda delle scansioni: una scansione lenta non ritarda la GET.
    await catalogRevision?.observeFiles(detailReadPaths(detail)).catch(() => {});
    // Stato runtime presente solo quando la response selezionata è una sequence.
    if (sequenceStates != null && detail.sequence != null) {
      detail.sequenceState = sequenceStates.getState(
        `${detail.method} ${detail.path}`,
        detail.selectedResponseFile,
        detail.sequence
      );
    }
    sendJson(res, 200, detail);
  });

  router.get("/mocks/:id/sequence/state", async (req, res) => {
    const result = await getAdminSequenceState(config.mocksDir, req.params.id, sequenceStates);
    sendJson(res, 200, result);
  });

  // Reset del cursore della sequenza (e della memoria handler dell'endpoint): azione runtime
  // immediata, nessun file toccato.
  router.post("/mocks/:id/sequence/reset", requireEmptyJsonObject, mutation(async (req, res) => {
    const result = await resetAdminSequence(config.mocksDir, req.params.id, sequenceStates, handlerStates);
    sendJson(res, 200, result);
  }));

  // Console SSE/WS: push manuale broadcast e stato (connessioni aperte + storico/transcript)
  // dell'endpoint che il runtime installato serve come sse o ws. Azioni runtime, nessun file
  // toccato, fuori dalla coda delle mutazioni.
  router.post("/mocks/:id/sse/push", (req, res) => {
    const result = pushAdminSseMessage(installed, config.mocksDir, req.params.id, req.body, sseConnections);
    sendJson(res, 200, result);
  });
  router.get("/mocks/:id/sse/connections", (req, res) => {
    const result = listAdminSseState(installed, config.mocksDir, req.params.id, sseConnections);
    sendJson(res, 200, result);
  });

  router.post("/mocks/:id/ws/push", (req, res) => {
    const result = pushAdminWsMessage(installed, config.mocksDir, req.params.id, req.body, wsConnections);
    sendJson(res, 200, result);
  });
  router.get("/mocks/:id/ws/connections", (req, res) => {
    const result = listAdminWsState(installed, config.mocksDir, req.params.id, wsConnections);
    sendJson(res, 200, result);
  });

  router.put("/mocks/:id/collection", mutation(async (req, res) => {
    const detail = await assignAdminCollection(config.mocksDir, req.params.id, req.body);
    sendJson(res, 200, detail);
  }));

  router.post("/mocks", mutation(async (req, res) => {
    const detail = await createAdminMock(config.mocksDir, req.body, reloadRuntime);
    sendJson(res, 201, detail);
  }));

  // Import OpenAPI: corpo grezzo (YAML/JSON) come text; ?dryRun=true ritorna solo il piano + conteggi.
  // ?prefix=/be antepone un prefisso ai path importati (il corpo e' il documento, quindi le opzioni
  // viaggiano in query string).
  // Content-type ammessi: espliciti e mai "simple request" — è la difesa CSRF. text/plain è escluso
  // apposta: una POST cross-origin text/plain partirebbe dal browser senza preflight, e questo è
  // l'unico endpoint mutante che non richiede JSON. Con i tipi sotto, il tentativo cross-origin
  // scatena il preflight CORS e muore lì, come per il resto dell'admin API.
  const OPENAPI_IMPORT_CONTENT_TYPES = [
    "application/json",
    "application/yaml",
    "application/x-yaml",
    "text/yaml",
  ];
  router.post(
    "/mocks/import/openapi",
    (req, res, next) => {
      if (!OPENAPI_IMPORT_CONTENT_TYPES.some((contentType) => req.is(contentType))) {
        sendJson(res, 415, {
          error: "Unsupported Media Type",
          message: `Use one of: ${OPENAPI_IMPORT_CONTENT_TYPES.join(", ")}. text/plain is rejected on purpose (CSRF guard).`,
        });
        return;
      }
      next();
    },
    express.text({ type: OPENAPI_IMPORT_CONTENT_TYPES, limit: "12mb" }),
    mutation(async (req, res) => {
      const dryRun = String(req.query.dryRun) === "true";
      const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
      const result = await importAdminOpenapi(config.mocksDir, req.body, reloadRuntime, { dryRun, prefix });
      sendJson(res, dryRun ? 200 : 201, result);
    })
  );

  // Copia un endpoint verso un nuovo metodo+path; dryRun usa lo stesso planner ma non scrive.
  router.post("/mocks/:id/copy", mutation(async (req, res) => {
    const dryRunValues = new URL(req.originalUrl, "http://mockxy.local")
      .searchParams
      .getAll("dryRun");
    if (
      dryRunValues.length > 1
      || (dryRunValues.length === 1 && !["true", "false"].includes(dryRunValues[0]))
    ) {
      throw createAdminError(400, "dryRun must be specified at most once and be exactly true or false.");
    }

    if (dryRunValues[0] === "true") {
      const preview = await previewAdminEndpointCopy(config.mocksDir, req.params.id, req.body);
      sendJson(res, 200, preview);
      return;
    }
    const detail = await copyAdminEndpoint(config.mocksDir, req.params.id, req.body, reloadRuntime);
    sendJson(res, 201, detail);
  }));

  router.put("/mocks/:id/endpoint", mutation(async (req, res) => {
    const detail = await updateAdminEndpoint(
      config.mocksDir,
      req.params.id,
      req.body,
      reloadRuntime
    );
    sendJson(res, 200, detail);
  }));

  router.post("/mocks/:id/responses", mutation(async (req, res) => {
    const detail = await createAdminResponse(
      config.mocksDir,
      req.params.id,
      req.body,
      reloadRuntime,
      scenarioStates
    );
    sendJson(res, 201, detail);
  }));

  // Una variante per filename, attiva o no, senza cambiare selezione né scenario (§13 C3).
  router.get("/mocks/:id/responses/:responseFileName", async (req, res) => {
    const variant = await withWorkspace(() => getAdminMockResponse(config.mocksDir, req.params.id, req.params.responseFileName));
    await catalogRevision?.observeFiles(variantReadPaths(config.mocksDir, variant)).catch(() => {});
    sendJson(res, 200, variant);
  });

  router.put("/mocks/:id/responses/:responseFileName", mutation(async (req, res) => {
    const detail = await updateAdminResponse(
      config.mocksDir,
      req.params.id,
      req.params.responseFileName,
      req.body,
      reloadRuntime,
      scenarioStates
    );
    sendJson(res, 200, detail);
  }));

  // Upload raw dei bytes per rendere una response file-backed. I bytes arrivano come
  // application/octet-stream (cosi' express.json globale non li intercetta); il MIME reale
  // e il nome file viaggiano in querystring (?contentType=...&filename=...).
  router.put(
    "/mocks/:id/responses/:responseFileName/file",
    express.raw({ type: () => true, limit: "12mb" }),
    mutation(async (req, res) => {
      const detail = await setAdminResponseFile(
        config.mocksDir,
        req.params.id,
        req.params.responseFileName,
        req.body,
        {
          filename: req.query.filename,
          contentType: req.query.contentType,
          // Precondizione dell'upload raw (§13 C4): header dedicato, mai dati di controllo nel file.
          expectedRevision: req.get("x-mockxy-expected-revision"),
        },
        reloadRuntime
      );
      sendJson(res, 200, detail);
    })
  );

  router.delete("/mocks/:id/responses/:responseFileName", mutation(async (req, res) => {
    const detail = await deleteAdminResponse(
      config.mocksDir,
      req.params.id,
      req.params.responseFileName,
      reloadRuntime,
      scenarioStates
    );
    sendJson(res, 200, detail);
  }));

  router.put("/mocks/:id", mutation(async (req, res) => {
    const detail = await updateAdminMock(
      config.mocksDir,
      req.params.id,
      req.body,
      reloadRuntime,
      scenarioStates
    );
    sendJson(res, 200, detail);
  }));

  router.delete("/mocks/:id", mutation(async (req, res) => {
    await deleteAdminMock(config.mocksDir, req.params.id, reloadRuntime);
    sendJson(res, 204);
  }));

  // File dati JSON riusabili dagli handler/middleware via data() (pagina Dati). Nessun
  // reloadRuntime: i file dati non toccano le rotte, l'accessor li rilegge a ogni chiamata.
  router.get("/files", async (_req, res) => {
    sendJson(res, 200, await listAdminDataFiles(config.filesDir, config.mocksDir));
  });

  router.get("/files/:name", async (req, res) => {
    sendJson(res, 200, await readAdminDataFile(config.filesDir, req.params.name));
  });

  // Upload/replace raw (come l'upload dei file di response): i byte arrivano application/octet-stream
  // così express.json globale non li intercetta; la validazione JSON avviene prima di scrivere.
  router.put(
    "/files/:name",
    express.raw({ type: () => true, limit: "25mb" }),
    mutation(async (req, res) => {
      const { detail, created } = await putAdminDataFile(config.filesDir, req.params.name, req.body);
      sendJson(res, created ? 201 : 200, detail);
    })
  );

  router.patch("/files/:name", mutation(async (req, res) => {
    // Con la riscrittura dei riferimenti l'operazione ricarica il runtime e ne verifica l'esito:
    // i moduli già compilati devono puntare al nuovo nome, altrimenti chiamerebbero data('vecchio').
    const detail = await renameAdminDataFile(config.filesDir, config.mocksDir, req.params.name, req.body?.name, {
      rewriteReferences: req.body?.rewriteReferences === true,
      reloadRuntime,
    });
    sendJson(res, 200, detail);
  }));

  router.delete("/files/:name", mutation(async (req, res) => {
    await deleteAdminDataFile(config.filesDir, req.params.name);
    sendJson(res, 204);
  }));

  // Il namespace /_admin/api è riservato: una rotta o un metodo sconosciuti finiscono qui
  // invece di proseguire nel serving dei mock e nel proxy, dove raggiungerebbero il backend.
  // Deve restare l'ultima registrazione del router.
  router.use((req, res) => {
    sendJson(res, 404, {
      error: "Not Found",
      message: `Unknown admin API route: ${req.method} ${req.originalUrl.split("?")[0]}.`,
      details: { code: "ADMIN_ROUTE_NOT_FOUND" },
    });
  });

  return router;
}

function sendAdminApiDisabled(_req, res) {
  sendJson(res, 404, {
    error: "Admin API disabled",
    message: "The local mock administration API is disabled for this runtime.",
  });
}

module.exports = {
  createAdminApiRouter,
  requireEmptyJsonObject,
  sendAdminApiDisabled,
};
