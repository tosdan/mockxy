const express = require("express");
const {
  getAdminMockDetail,
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
const { importAdminOpenapi } = require("./openapi-admin-import");
const {
  listAdminDataFiles,
  readAdminDataFile,
  putAdminDataFile,
  renameAdminDataFile,
  deleteAdminDataFile,
} = require("./admin-data-files");
const { setNoCacheHeaders } = require("../utils/cache");
const {
  listDumpFiles,
  readDumpPage,
  isSafeDumpFileName,
  deleteDumpFile,
} = require("../monitoring/monitor-dump-reader");

const PARSED_JSON_BODY_BYTES = Symbol("parsedJsonBodyBytes");

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
    sendJson(res, 400, {
      error: "Bad Request",
      message: "Request body must be an empty JSON object ({}).",
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

function createAdminApiRouter({ config, reloadRuntime, requestMonitor, serverState, monitorDump, sequenceStates, handlerStates, sharedStates, sseConnections, wsConnections }) {
  const router = express.Router();
  // Store dello scenario runtime, passati alle mutazioni che possono invalidarlo: il reload da
  // solo non basta, perche' aggrega piu' scritture in un giro unico (vedi invalidateScenario).
  const scenarioStates = { sequenceStates, handlerStates };

  router.use(express.json({ limit: "2mb", verify: markParsedJsonBodyLength }));

  router.get('/monitoring/requests', (_req, res) => {
    const items = requestMonitor?.listEntries() || [];
    sendJson(res, 200, { items });
  });

  router.delete('/monitoring/requests', (_req, res) => {
    requestMonitor?.clear();
    sendJson(res, 204);
  });

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

  // --- Dump su disco del monitor: cattura durevole del traffico per lo storico ---
  router.get('/monitoring/dump', (_req, res) => {
    sendJson(res, 200, monitorDump ? monitorDump.getStatus() : { enabled: false });
  });

  router.patch('/monitoring/dump', async (req, res) => {
    if (!monitorDump) {
      sendJson(res, 200, { enabled: false });
      return;
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if ('enabled' in body && typeof body.enabled !== 'boolean') {
      sendJson(res, 400, { error: 'Bad Request', message: 'enabled must be a boolean.' });
      return;
    }
    if ('intervalMs' in body && (typeof body.intervalMs !== 'number' || !Number.isFinite(body.intervalMs) || body.intervalMs <= 0)) {
      sendJson(res, 400, { error: 'Bad Request', message: 'intervalMs must be a positive number.' });
      return;
    }
    if ('threshold' in body && (!Number.isInteger(body.threshold) || body.threshold <= 0)) {
      sendJson(res, 400, { error: 'Bad Request', message: 'threshold must be a positive integer.' });
      return;
    }
    monitorDump.setConfig({ intervalMs: body.intervalMs, threshold: body.threshold });
    if (body.enabled === true) {
      monitorDump.start(requestMonitor);
    } else if (body.enabled === false) {
      await monitorDump.stop();
    }
    sendJson(res, 200, monitorDump.getStatus());
  });

  router.post('/monitoring/dump/flush', requireEmptyJsonObject, async (_req, res) => {
    const flushed = monitorDump ? await monitorDump.flush() : 0;
    sendJson(res, 200, { flushed, ...(monitorDump ? monitorDump.getStatus() : {}) });
  });

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
  router.post('/monitoring/dumps/create-mocks', async (req, res) => {
    const result = await createMocksFromDump(config.mocksDir, config.monitorDumpDir, req.body, reloadRuntime);
    sendJson(res, 201, result);
  });

  router.delete('/monitoring/dumps/:file', async (req, res) => {
    if (!isSafeDumpFileName(req.params.file)) {
      sendJson(res, 400, { error: 'Bad Request', message: 'Invalid dump file name.' });
      return;
    }
    await deleteDumpFile(config.monitorDumpDir, req.params.file);
    sendJson(res, 204);
  });

  const DEFAULT_SERVER_STATE = { serverEnabled: true, proxyAll: false };

  router.get('/server', (_req, res) => {
    sendJson(res, 200, serverState ? serverState.getState() : DEFAULT_SERVER_STATE);
  });

  router.patch('/server', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if ('serverEnabled' in body && typeof body.serverEnabled !== 'boolean') {
      sendJson(res, 400, { error: 'Bad Request', message: 'serverEnabled must be a boolean.' });
      return;
    }
    if ('proxyAll' in body && typeof body.proxyAll !== 'boolean') {
      sendJson(res, 400, { error: 'Bad Request', message: 'proxyAll must be a boolean.' });
      return;
    }
    sendJson(res, 200, serverState ? serverState.setState(body) : DEFAULT_SERVER_STATE);
  });

  // Runtime shared state is intentionally metadata-only: values remain private to handlers.
  router.get("/runtime/shared-state", (_req, res) => {
    sendJson(res, 200, sharedStates.listMetadata());
  });

  router.post(
    "/runtime/shared-state/:name/reset",
    requireEmptyJsonObject,
    (req, res) => {
      try {
        const normalizedName = String(req.params.name).trim().toLowerCase();
        const reset = sharedStates.reset(req.params.name);
        sendJson(res, 200, { name: normalizedName, reset });
      } catch (error) {
        if (error?.code === "SHARED_STATE_INVALID_NAME") {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return;
        }
        throw error;
      }
    }
  );

  router.post(
    "/runtime/shared-state/reset",
    requireEmptyJsonObject,
    (_req, res) => {
      sendJson(res, 200, { resetCount: sharedStates.resetAll() });
    }
  );

  router.get("/mocks", async (_req, res) => {
    // Gli endpoint illeggibili non spengono il catalogo: vengono saltati e segnalati qui.
    const loadErrors = [];
    const items = await listAdminMocks(config.mocksDir, loadErrors);
    const collections = await listAdminCollections(config.mocksDir, items);
    const childOrder = await listAdminChildOrder(config.mocksDir, items);
    sendJson(res, 200, { items, collections, childOrder, loadErrors });
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

  router.post("/mocks/collections", async (req, res) => {
    const collection = await createAdminCollection(config.mocksDir, req.body);
    sendJson(res, 201, collection);
  });

  router.patch("/mocks/collections/order", async (req, res) => {
    const collections = await reorderAdminCollections(config.mocksDir, req.body);
    sendJson(res, 200, collections);
  });

  router.patch("/mocks/collections/:id/parent", async (req, res) => {
    const collections = await reparentAdminCollection(config.mocksDir, req.params.id, req.body);
    sendJson(res, 200, collections);
  });

  router.patch("/mocks/collections/:id/items/order", async (req, res) => {
    const items = await reorderAdminCollectionItems(config.mocksDir, req.params.id, req.body);
    sendJson(res, 200, { items });
  });

  router.patch("/mocks/collections/:parentKey/children/order", async (req, res) => {
    const items = await reorderAdminCollectionChildren(config.mocksDir, req.params.parentKey, req.body);
    sendJson(res, 200, { items });
  });

  router.patch("/mocks/collections/:id/enabled", async (req, res) => {
    const items = await updateAdminCollectionEnabled(
      config.mocksDir,
      req.params.id,
      req.body,
      reloadRuntime
    );
    const collections = await listAdminCollections(config.mocksDir, items);
    const childOrder = await listAdminChildOrder(config.mocksDir, items);
    sendJson(res, 200, { items, collections, childOrder });
  });

  router.delete("/mocks/collections/:id", async (req, res) => {
    await deleteAdminCollection(config.mocksDir, req.params.id);
    sendJson(res, 204);
  });

  router.delete("/mocks/collections/:id/contents", async (req, res) => {
    const result = await eraseAdminCollection(
      config.mocksDir,
      req.params.id,
      reloadRuntime
    );
    sendJson(res, 200, result);
  });

  // Registrata prima di /mocks/:id: "enabled" non è l'id di una definizione.
  router.patch("/mocks/enabled", async (req, res) => {
    const items = await updateAdminEndpointsEnabled(config.mocksDir, req.body, reloadRuntime);
    const collections = await listAdminCollections(config.mocksDir, items);
    const childOrder = await listAdminChildOrder(config.mocksDir, items);
    sendJson(res, 200, { items, collections, childOrder });
  });

  router.get("/mocks/:id", async (req, res) => {
    const detail = await getAdminMockDetail(config.mocksDir, req.params.id);
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
  router.post("/mocks/:id/sequence/reset", requireEmptyJsonObject, async (req, res) => {
    const result = await resetAdminSequence(config.mocksDir, req.params.id, sequenceStates, handlerStates);
    sendJson(res, 200, result);
  });

  // Console SSE: push manuale broadcast e stato (connessioni aperte + storico) dell'endpoint
  // la cui variante selezionata è di tipo sse. Azioni runtime, nessun file toccato.
  router.post("/mocks/:id/sse/push", async (req, res) => {
    const result = await pushAdminSseMessage(config.mocksDir, req.params.id, req.body, sseConnections);
    sendJson(res, 200, result);
  });
  router.get("/mocks/:id/sse/connections", async (req, res) => {
    const result = await listAdminSseState(config.mocksDir, req.params.id, sseConnections);
    sendJson(res, 200, result);
  });

  router.post("/mocks/:id/ws/push", async (req, res) => {
    const result = await pushAdminWsMessage(config.mocksDir, req.params.id, req.body, wsConnections);
    sendJson(res, 200, result);
  });
  router.get("/mocks/:id/ws/connections", async (req, res) => {
    const result = await listAdminWsState(config.mocksDir, req.params.id, wsConnections);
    sendJson(res, 200, result);
  });

  router.put("/mocks/:id/collection", async (req, res) => {
    const detail = await assignAdminCollection(config.mocksDir, req.params.id, req.body);
    sendJson(res, 200, detail);
  });

  router.post("/mocks", async (req, res) => {
    const detail = await createAdminMock(config.mocksDir, req.body, reloadRuntime);
    sendJson(res, 201, detail);
  });

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
    async (req, res) => {
      const dryRun = String(req.query.dryRun) === "true";
      const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
      const result = await importAdminOpenapi(config.mocksDir, req.body, reloadRuntime, { dryRun, prefix });
      sendJson(res, dryRun ? 200 : 201, result);
    }
  );

  // Copia un endpoint verso un nuovo metodo+path; dryRun usa lo stesso planner ma non scrive.
  router.post("/mocks/:id/copy", async (req, res) => {
    const dryRunValues = new URL(req.originalUrl, "http://mockxy.local")
      .searchParams
      .getAll("dryRun");
    if (
      dryRunValues.length > 1
      || (dryRunValues.length === 1 && !["true", "false"].includes(dryRunValues[0]))
    ) {
      sendJson(res, 400, {
        error: "Bad Request",
        message: "dryRun must be specified at most once and be exactly true or false.",
      });
      return;
    }

    if (dryRunValues[0] === "true") {
      const preview = await previewAdminEndpointCopy(config.mocksDir, req.params.id, req.body);
      sendJson(res, 200, preview);
      return;
    }
    const detail = await copyAdminEndpoint(config.mocksDir, req.params.id, req.body, reloadRuntime);
    sendJson(res, 201, detail);
  });

  router.put("/mocks/:id/endpoint", async (req, res) => {
    const detail = await updateAdminEndpoint(
      config.mocksDir,
      req.params.id,
      req.body,
      reloadRuntime
    );
    sendJson(res, 200, detail);
  });

  router.post("/mocks/:id/responses", async (req, res) => {
    const detail = await createAdminResponse(
      config.mocksDir,
      req.params.id,
      req.body,
      reloadRuntime,
      scenarioStates
    );
    sendJson(res, 201, detail);
  });

  router.put("/mocks/:id/responses/:responseFileName", async (req, res) => {
    const detail = await updateAdminResponse(
      config.mocksDir,
      req.params.id,
      req.params.responseFileName,
      req.body,
      reloadRuntime,
      scenarioStates
    );
    sendJson(res, 200, detail);
  });

  // Upload raw dei bytes per rendere una response file-backed. I bytes arrivano come
  // application/octet-stream (cosi' express.json globale non li intercetta); il MIME reale
  // e il nome file viaggiano in querystring (?contentType=...&filename=...).
  router.put(
    "/mocks/:id/responses/:responseFileName/file",
    express.raw({ type: () => true, limit: "12mb" }),
    async (req, res) => {
      const detail = await setAdminResponseFile(
        config.mocksDir,
        req.params.id,
        req.params.responseFileName,
        req.body,
        { filename: req.query.filename, contentType: req.query.contentType },
        reloadRuntime
      );
      sendJson(res, 200, detail);
    }
  );

  router.delete("/mocks/:id/responses/:responseFileName", async (req, res) => {
    const detail = await deleteAdminResponse(
      config.mocksDir,
      req.params.id,
      req.params.responseFileName,
      reloadRuntime,
      scenarioStates
    );
    sendJson(res, 200, detail);
  });

  router.put("/mocks/:id", async (req, res) => {
    const detail = await updateAdminMock(
      config.mocksDir,
      req.params.id,
      req.body,
      reloadRuntime,
      scenarioStates
    );
    sendJson(res, 200, detail);
  });

  router.delete("/mocks/:id", async (req, res) => {
    await deleteAdminMock(config.mocksDir, req.params.id, reloadRuntime);
    sendJson(res, 204);
  });

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
    async (req, res) => {
      const { detail, created } = await putAdminDataFile(config.filesDir, req.params.name, req.body);
      sendJson(res, created ? 201 : 200, detail);
    }
  );

  router.patch("/files/:name", async (req, res) => {
    const detail = await renameAdminDataFile(config.filesDir, config.mocksDir, req.params.name, req.body?.name, {
      rewriteReferences: req.body?.rewriteReferences === true,
    });
    // La riscrittura ha toccato i sorgenti degli handler: ricarica il runtime così i moduli già
    // compilati puntano al nuovo nome (altrimenti chiamerebbero data('vecchio'), ormai inesistente).
    if (detail.referencesRewritten > 0 && typeof reloadRuntime === "function") {
      await reloadRuntime();
    }
    sendJson(res, 200, detail);
  });

  router.delete("/files/:name", async (req, res) => {
    await deleteAdminDataFile(config.filesDir, req.params.name);
    sendJson(res, 204);
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
