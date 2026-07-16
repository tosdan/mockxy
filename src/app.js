const fs = require("fs");
const path = require("path");
const express = require("express");
const { createAdminApiRouter, sendAdminApiDisabled } = require("./admin/admin-api");
const { createMissingBackendUrlMessage } = require("./config");
const { createDataFileReader } = require("./mocks/data-files");
const {
  cloneHeaders,
  isValidHttpStatus,
  parseJsonBody,
  readStreamToBuffer,
  readTextBody,
  removeHeader,
  stripBodyDependentHeaders,
} = require("./utils/http-body-utils");
const { forwardToBackend, TECH_HEADER } = require("./proxy/proxy");
const { isMonitoringCandidate, startRequestCapture, startResponseCapture } = require("./monitoring/request-monitor");
const { runWithTimeout } = require("./utils/run-with-timeout");
const { ServerStateStore } = require("./server-state");
const { setNoCacheHeaders } = require("./utils/cache");

const MAX_HANDLER_REQUEST_BODY_BYTES = 2 * 1024 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeMockHeaders(headers) {
  const sanitized = { ...(headers || {}) };
  delete sanitized["content-length"];
  delete sanitized["Content-Length"];
  return sanitized;
}

// Parses pagination parameters only when both page and size are valid integers and size is positive.
function parsePaginationValues(pageValue, sizeValue) {
  if (pageValue == null || sizeValue == null) {
    return undefined;
  }

  const page = Number.parseInt(String(pageValue), 10);
  const size = Number.parseInt(String(sizeValue), 10);
  if (!Number.isInteger(page) || !Number.isInteger(size) || page < 0 || size < 1) {
    return undefined;
  }

  return { page, size };
}

// Reads pagination from the parsed query object when available.
function readPagination(query) {
  if (query == null || query.page == null || query.size == null) {
    return undefined;
  }

  return parsePaginationValues(query.page, query.size);
}

// Falls back to the raw querystring so pagination still works when req.query is not populated.
function readPaginationFromUrl(requestUrl) {
  if (requestUrl == null || !String(requestUrl).includes("?")) {
    return undefined;
  }

  const queryString = String(requestUrl).slice(String(requestUrl).indexOf("?") + 1);
  const params = new URLSearchParams(queryString);
  return parsePaginationValues(params.get("page"), params.get("size"));
}

// Resolves pagination from either req.query or the raw URL querystring.
function resolvePagination(req) {
  return readPagination(req?.query) || readPaginationFromUrl(req?.originalUrl || req?.url);
}

// Finds the collection to paginate while preserving the original response shape.
function resolvePaginableCollection(body) {
  if (Array.isArray(body)) {
    return {
      items: body,
      createBody: (items) => items,
    };
  }

  if (body == null || typeof body !== "object") {
    return undefined;
  }

  const arrayEntries = Object.entries(body).filter(([, value]) => Array.isArray(value));
  if (arrayEntries.length !== 1) {
    return undefined;
  }

  const [propertyName, items] = arrayEntries[0];
  return {
    items,
    createBody: (paginatedItems) => ({
      ...body,
      [propertyName]: paginatedItems,
    }),
  };
}

// Query parameters that belong to pagination and are never treated as list filters.
const RESERVED_LIST_QUERY_PARAMS = new Set(["page", "size"]);

// Collects query parameters as name → values, preserving repeated parameters (?a=1&a=2).
// Reads the raw querystring first (always the ground truth), falling back to req.query.
function collectQueryEntries(req) {
  const entries = new Map();
  const requestUrl = req?.originalUrl || req?.url;
  if (requestUrl != null && String(requestUrl).includes("?")) {
    const queryString = String(requestUrl).slice(String(requestUrl).indexOf("?") + 1);
    for (const [key, value] of new URLSearchParams(queryString)) {
      if (!entries.has(key)) {
        entries.set(key, []);
      }
      entries.get(key).push(value);
    }
    return entries;
  }

  for (const [key, value] of Object.entries(req?.query ?? {})) {
    const values = (Array.isArray(value) ? value : [value]).filter(
      (item) => typeof item === "string"
    );
    if (values.length > 0) {
      entries.set(key, values);
    }
  }
  return entries;
}

// Only scalar item values participate in filtering; objects, arrays and null never match.
function isFilterableScalar(value) {
  return (
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  );
}

// A query parameter becomes a filter only when its name is a top-level key of at least one
// element in the list; anything else is ignored so existing mocks keep responding unchanged.
function resolveListFilters(req, items) {
  const filters = [];
  for (const [key, values] of collectQueryEntries(req)) {
    if (RESERVED_LIST_QUERY_PARAMS.has(key)) {
      continue;
    }

    const isItemKey = items.some(
      (item) =>
        item != null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        Object.prototype.hasOwnProperty.call(item, key)
    );
    if (isItemKey) {
      filters.push({ key, values });
    }
  }
  return filters;
}

// Distinct parameters combine as AND; repeated values of the same parameter combine as OR.
// Values compare as strings so ?id=3 matches both "id": 3 and "id": "3". The value comparison is
// case-insensitive by default (?ruolo=ADMIN matches "ruolo": "admin"); caseInsensitive=false makes
// it exact. Only the compared value is normalized: the parameter name still matches the key exactly.
function applyListFilters(items, filters, caseInsensitive = true) {
  if (filters.length === 0) {
    return items;
  }

  const normalize = caseInsensitive ? (value) => value.toLowerCase() : (value) => value;
  const matchesValue = (values, actual) =>
    values.some((value) => normalize(value) === normalize(actual));

  return items.filter((item) =>
    filters.every(
      ({ key, values }) =>
        item != null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        isFilterableScalar(item[key]) &&
        matchesValue(values, String(item[key]))
    )
  );
}

// Applies query filters and pagination to array bodies or to objects that expose a single
// top-level array. Filtering runs before pagination so X-Total-Count reflects the filtered total.
// caseInsensitiveFilters (default true) controls whether list-filter values compare ignoring case.
function buildMockPayload(body, req, caseInsensitiveFilters = true) {
  const collection = resolvePaginableCollection(body);
  if (collection == null) {
    return {
      body,
      totalCount: undefined,
    };
  }

  const filters = resolveListFilters(req, collection.items);
  const filteredItems = applyListFilters(collection.items, filters, caseInsensitiveFilters);

  const pagination = resolvePagination(req);
  if (pagination == null) {
    if (filters.length === 0) {
      return {
        body,
        totalCount: undefined,
      };
    }

    return {
      body: collection.createBody(filteredItems),
      totalCount: filteredItems.length,
    };
  }

  const startIndex = pagination.page * pagination.size;
  return {
    body: collection.createBody(
      filteredItems.slice(startIndex, startIndex + pagination.size)
    ),
    totalCount: filteredItems.length,
  };
}

function isFileMockResponse(mockResponse) {
  return mockResponse.payloadType === "file";
}

function isTextMockResponse(mockResponse) {
  return mockResponse.payloadType === "text";
}

// Buffers the matched handler request so the resolver can inspect headers and body locally.
async function readHandlerRequestSnapshot(req) {
  const requestHeaders = cloneHeaders(req.headers);
  const bodyBuffer = await readStreamToBuffer(req, {
    maxBytes: MAX_HANDLER_REQUEST_BODY_BYTES,
  });

  return {
    requestHeaders,
    bodyBuffer,
    bodyText: readTextBody(bodyBuffer, requestHeaders),
    jsonBody: parseJsonBody(bodyBuffer, requestHeaders),
  };
}

// Normalizes an optional list of headers removed by a local handler response.
function normalizeRemovedHeaders(removeHeaders) {
  if (removeHeaders == null) {
    return [];
  }

  if (!Array.isArray(removeHeaders)) {
    throw new Error("resolveResponse must return removeHeaders as an array when provided");
  }

  return removeHeaders.map((headerName) => String(headerName));
}

// Validates and converts the local handler result into a response payload.
function buildHandlerResponsePayload(handlerResult) {
  const isObjectResult = handlerResult != null && typeof handlerResult === "object";
  if (!isObjectResult || Array.isArray(handlerResult)) {
    throw new Error("resolveResponse must return an object");
  }

  const responseStatus = handlerResult.status == null ? 200 : Number(handlerResult.status);
  if (!isValidHttpStatus(responseStatus)) {
    throw new Error("resolveResponse must return a valid HTTP status when provided");
  }

  const hasBody = Object.prototype.hasOwnProperty.call(handlerResult, "body");
  const hasJsonBody = Object.prototype.hasOwnProperty.call(handlerResult, "jsonBody");
  if (hasBody && hasJsonBody) {
    throw new Error("resolveResponse cannot return both body and jsonBody");
  }

  const headers = sanitizeMockHeaders(cloneHeaders(handlerResult.headers));
  normalizeRemovedHeaders(handlerResult.removeHeaders).forEach((headerName) => {
    removeHeader(headers, headerName);
  });

  if (hasJsonBody) {
    stripBodyDependentHeaders(headers);
    headers["content-type"] = "application/json; charset=utf-8";
    return {
      status: responseStatus,
      headers,
      body: handlerResult.jsonBody,
      sendAsJson: true,
    };
  }

  if (hasBody) {
    const isSupportedBody = Buffer.isBuffer(handlerResult.body)
      || typeof handlerResult.body === "string";
    if (!isSupportedBody) {
      throw new Error("resolveResponse body must be a Buffer or a string");
    }

    stripBodyDependentHeaders(headers);
    return {
      status: responseStatus,
      headers,
      body: handlerResult.body,
      sendAsJson: false,
    };
  }

  return {
    status: responseStatus,
    headers,
    body: undefined,
    sendAsJson: false,
  };
}

// Logs local handler failures with route and file metadata so invalid definitions are traceable.
function logHandlerFailure(logger, req, handlerConfig, error) {
  logger.error("Local handler failed.", {
    method: req.method,
    requestPath: req.originalUrl || req.url,
    handlerPath: handlerConfig.path,
    handlerFilePath: handlerConfig.configFilePath,
    error: error.message,
    errorName: error.name,
    errorStack: error.stack,
  });
}

// Returns a stable request context passed to local dynamic handlers. The `data` accessor reads
// a JSON data file on demand (lazily: files never referenced are never opened).
function buildHandlerContext(req, decision, requestSnapshot, dataFileReader) {
  return {
    req,
    params: decision.params || {},
    query: req.query || {},
    requestHeaders: cloneHeaders(requestSnapshot.requestHeaders),
    bodyBuffer: Buffer.from(requestSnapshot.bodyBuffer),
    bodyText: requestSnapshot.bodyText,
    jsonBody: requestSnapshot.jsonBody,
    data: dataFileReader || createDataFileReader(undefined),
  };
}

// Sends the fully materialized response generated by a local dynamic handler.
function sendHandlerResponse(res, responsePayload) {
  Object.entries(responsePayload.headers).forEach(([headerName, value]) => {
    res.setHeader(headerName, value);
  });
  setNoCacheHeaders(res);
  res.setHeader(TECH_HEADER, "handler");

  if (responsePayload.sendAsJson) {
    res.status(responsePayload.status).json(responsePayload.body);
    return;
  }

  if (responsePayload.body === undefined) {
    res.status(responsePayload.status).end();
    return;
  }

  res.status(responsePayload.status).send(responsePayload.body);
}

// Executes a local dynamic handler without contacting the backend.
async function respondWithHandler(req, res, decision, logger, requestTimeoutMs, dataFileReader) {
  try {
    const requestSnapshot = await readHandlerRequestSnapshot(req);
    const handlerResult = await runWithTimeout(
      () => decision.handler.resolveResponse(buildHandlerContext(req, decision, requestSnapshot, dataFileReader)),
      requestTimeoutMs,
      {
        code: "HANDLER_TIMEOUT",
        message: `Handler timed out after ${requestTimeoutMs}ms.`,
      }
    );
    sendHandlerResponse(res, buildHandlerResponsePayload(handlerResult));
  } catch (error) {
    logHandlerFailure(logger, req, decision.handler, error);

    setNoCacheHeaders(res);
    res.setHeader(TECH_HEADER, "handler");
    if (error.code === "BODY_TOO_LARGE") {
      res.status(413).json({
        error: "Payload Too Large",
        message: `Handler request body exceeded ${MAX_HANDLER_REQUEST_BODY_BYTES} bytes.`,
      });
      return;
    }

    if (error.code === "HANDLER_TIMEOUT") {
      res.status(504).json({
        error: "Handler Timeout",
        message: `The local handler did not produce a response within ${requestTimeoutMs}ms.`,
      });
      return;
    }

    res.status(500).json({
      error: "Handler Execution Failed",
      message: "Unable to generate a local handler response.",
    });
  }
}

// Resolves the effective response delay by giving precedence to the mock-specific delay.
function resolveMockDelayMs(mockResponse, globalDelayMs = 0) {
  const mockDelayMs = mockResponse?.delayMs || 0;
  if (mockDelayMs > 0) {
    return mockDelayMs;
  }

  if (globalDelayMs > 0) {
    return globalDelayMs;
  }

  return 0;
}

// Resolves the effective delay for proxied requests when the launch flag enables it.
function resolveProxyDelayMs(config) {
  const globalDelayMs = config?.globalDelayMs || 0;
  const delayAllRequests = config?.delayAllRequests === true;

  if (!delayAllRequests || globalDelayMs <= 0) {
    return 0;
  }

  return globalDelayMs;
}

function isProxyFallbackEnabled(config) {
  return config?.proxyFallbackEnabled !== false;
}

const LOOPBACK_HOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

// Estrae il nome host dall'header Host ("nome:porta", "[v6]:porta" o solo "nome"), senza porta
// e senza parentesi quadre IPv6, in minuscolo. null se assente o malformato.
function extractHostName(hostHeader) {
  if (typeof hostHeader !== "string" || hostHeader.trim() === "") {
    return null;
  }
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const closingIndex = trimmed.indexOf("]");
    return closingIndex > 0 ? trimmed.slice(1, closingIndex) : null;
  }
  return trimmed.split(":")[0] || null;
}

// Difesa DNS-rebinding per l'admin API: un sito ostile può far ri-risolvere il proprio dominio
// verso 127.0.0.1 e pilotare l'admin dal browser della vittima — per il browser la richiesta è
// same-origin, quindi CORS non interviene e l'attaccante legge pure le risposte. L'header Host
// però conserva il dominio dell'attaccante: qui si accettano solo host loopback (più eventuali
// extra configurati, es. alias in /etc/hosts). Il controllo vale solo col bind su loopback o
// con allowlist esplicita: su un bind di rete gli host legittimi non sono prevedibili, e lì
// vale già l'avviso di esposizione dell'admin API. I mock non sono filtrati: devono poter
// essere consumati con qualunque Host.
function createAdminHostGuard(config) {
  const extraAllowedHosts = Array.isArray(config?.adminAllowedHosts) ? config.adminAllowedHosts : [];
  const allowedHostNames = new Set([
    ...LOOPBACK_HOST_NAMES,
    ...extraAllowedHosts.map((hostName) => String(hostName).toLowerCase()),
  ]);
  const enforced = LOOPBACK_HOST_NAMES.has(String(config?.host || "").toLowerCase())
    || extraAllowedHosts.length > 0;

  return (req, res, next) => {
    if (!enforced) {
      next();
      return;
    }
    const hostName = extractHostName(req.headers.host);
    if (hostName != null && allowedHostNames.has(hostName)) {
      next();
      return;
    }
    setNoCacheHeaders(res);
    res.status(403).json({
      error: "Forbidden",
      message: "Admin API rejected the request: unexpected Host header (DNS rebinding guard). Allowed hosts: loopback names plus ADMIN_ALLOWED_HOSTS.",
    });
  };
}

function respondWithMockOnlyMiss(req, res, decision) {
  setNoCacheHeaders(res);
  res.setHeader(TECH_HEADER, "mock-only");
  res.status(404).json({
    error: "Mock Not Found",
    message: "No active mock is configured for this request and proxy fallback is disabled.",
    method: req.method,
    path: req.path,
    reason: decision.reason,
    routePath: decision.routePath,
  });
}

// Reports that a request needs the backend (proxy fallback or proxy middleware) but BACKEND_URL is not configured.
function respondWithBackendNotConfigured(req, res) {
  setNoCacheHeaders(res);
  res.setHeader(TECH_HEADER, "backend-unconfigured");
  res.status(501).json({
    error: "Backend Not Configured",
    message: createMissingBackendUrlMessage(),
    method: req.method,
    path: req.path,
  });
}

// Serve il payload file in streaming dal disco: il contenuto non vive nel registry (un mock
// da centinaia di MB non occupa RAM), al costo di una lettura per richiesta. Un file sparito
// dopo il load rigetta prima degli header (→ 500 dall'error handler); un errore a trasferimento
// iniziato tronca la connessione, perché a quel punto non c'è modo pulito di segnalarlo.
async function sendFileMockResponse(res, mockResponse) {
  const filePath = mockResponse.payloadFilePath;
  const { size } = await fs.promises.stat(filePath);

  if (!res.getHeader("content-type")) {
    res.setHeader("content-type", "application/octet-stream");
  }
  res.setHeader("content-length", size);
  res.status(mockResponse.status);

  await new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    fileStream.on("error", (error) => {
      if (res.headersSent) {
        res.destroy(error);
        resolve();
        return;
      }
      reject(error);
    });
    res.on("close", () => {
      fileStream.destroy();
      resolve();
    });
    fileStream.pipe(res);
  });
}

async function respondWithMock(req, res, mockResponse, globalDelayMs = 0, caseInsensitiveFilters = true) {
  const effectiveDelayMs = resolveMockDelayMs(mockResponse, globalDelayMs);
  if (effectiveDelayMs > 0) {
    await sleep(effectiveDelayMs);
  }

  const headers = sanitizeMockHeaders(mockResponse.headers);
  Object.entries(headers).forEach(([headerName, value]) => {
    res.setHeader(headerName, value);
  });
  setNoCacheHeaders(res);
  res.setHeader(TECH_HEADER, "mock");

  if (isFileMockResponse(mockResponse)) {
    await sendFileMockResponse(res, mockResponse);
    return;
  }

  if (isTextMockResponse(mockResponse)) {
    // Nessun content-type implicito: la response serve il body così com'è e il content-type lo
    // controlla l'utente con gli header (l'editor aggiunge text/plain esplicito scegliendo "Testo").
    res.status(mockResponse.status).send(mockResponse.body);
    return;
  }

  const payload = buildMockPayload(mockResponse.body, req, caseInsensitiveFilters);
  if (payload.totalCount != null) {
    res.setHeader("X-Total-Count", String(payload.totalCount));
  }
  res.status(mockResponse.status).json(payload.body);
}

// --- CORS opt-in (config.corsEnabled) ---
// Con l'opzione attiva Mockxy possiede la superficie CORS di TUTTO ciò che serve: preflight
// automatici e header Allow-Origin/Allow-Credentials su ogni risposta, comprese quelle proxate
// al backend reale. La policy CORS del backend è scritta per la topologia "browser -> backend
// diretto": su uno staging condiviso può non ammettere l'origin dello sviluppatore, e con il
// browser che parla con Mockxy è la policy di Mockxy a dover valere. Per lo stesso motivo
// l'override vince anche sugli header CORS salvati dentro un mock (tipico dei mock creati da
// una cattura: ereditano la policy del backend originale). Chi vuole osservare la policy CORS
// vera del backend, o controllare gli header a mano, tiene l'opzione spenta (default): allora
// Mockxy non tocca nulla.
//
// Header a eco, mai jolly: l'origin della richiesta viene riflessa (con Vary) e le credenziali
// ammesse, perché `*` viene rifiutato dal browser sulle richieste con cookie (proxy fallback
// autenticato); idem gli header richiesti nel preflight, così i custom header non falliscono.

// Un preflight vero è OPTIONS + Origin + Access-Control-Request-Method: un OPTIONS "semplice"
// (es. scoperta capacità) segue invece il flusso normale (mock esplicito, proxy o miss).
// Origin non vuota: la stessa condizione con cui l'hook applica gli header — un preflight
// riconosciuto qui ma senza hook produrrebbe un 204 privo di Allow-Origin, cioè un blocco.
function isCorsPreflight(req) {
  return (
    req.method === "OPTIONS" &&
    typeof req.headers.origin === "string" &&
    req.headers.origin !== "" &&
    typeof req.headers["access-control-request-method"] === "string"
  );
}

// Applica la policy CORS a eco tramite hook su writeHead: gli header vengono impostati all'atto
// dell'invio, quindi DOPO quelli del mock e dopo quelli copiati dal backend proxato, e vincono su
// entrambi (una policy `*` o per un'altra origin deve cedere all'eco — jolly + credenziali è
// rifiutato dal browser). Espone anche gli header propri del motore (paginazione e provenienza),
// altrimenti invisibili al JS cross-origin, unendoli agli Expose-Headers già presenti.
function applyCorsResponseHeaders(req, res) {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") {
    return;
  }
  const originalWriteHead = res.writeHead;
  res.writeHead = function corsWriteHead(...args) {
    this.setHeader("Access-Control-Allow-Origin", origin);
    this.setHeader("Access-Control-Allow-Credentials", "true");
    const exposedHeaders = new Set(
      String(this.getHeader("Access-Control-Expose-Headers") || "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    );
    exposedHeaders.add("X-Total-Count");
    exposedHeaders.add(TECH_HEADER);
    this.setHeader("Access-Control-Expose-Headers", [...exposedHeaders].join(", "));
    this.vary("Origin");
    return originalWriteHead.apply(this, args);
  };
}

// Risposta automatica a un preflight senza mock OPTIONS esplicito (il mock, quando c'è, vince).
// Allow-Origin, Allow-Credentials e Vary arrivano dall'hook su writeHead (applyCorsResponseHeaders,
// installato in testa al dispatcher quando l'opzione è attiva): qui solo gli header del preflight.
function respondWithCorsPreflight(req, res) {
  res.setHeader(TECH_HEADER, "cors-preflight");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
  const requestedHeaders = req.headers["access-control-request-headers"];
  if (typeof requestedHeaders === "string" && requestedHeaders !== "") {
    res.setHeader("Access-Control-Allow-Headers", requestedHeaders);
  }
  // Cache breve del preflight: meno round-trip senza incollare a lungo una policy che può cambiare.
  res.setHeader("Access-Control-Max-Age", "600");
  res.status(204).end();
}

function createApp({
  registry,
  config,
  logger,
  proxyHandler = forwardToBackend,
  proxyMiddlewareRegistry,
  reloadRuntime,
  requestMonitor,
  serverState = new ServerStateStore(),
  monitorDump,
  sequenceStates,
}) {
  const app = express();
  app.disable("x-powered-by");

  // Accessor lazy per i file dati JSON: passato al contesto di handler (qui) e middleware (proxy).
  const dataFileReader = createDataFileReader(config?.filesDir);

  if (config?.adminApiEnabled !== false) {
    app.use("/_admin/api", createAdminHostGuard(config), createAdminApiRouter({ config, reloadRuntime, requestMonitor, serverState, monitorDump, sequenceStates }));
  } else {
    app.use("/_admin/api", sendAdminApiDisabled);
  }

  // Interfaccia compilata servita solo quando configurata (es. app desktop Electron): sotto un
  // prefisso dedicato per non oscurare i path dei mock, e prima del logging così le richieste
  // dell'interfaccia non finiscono nel monitor del traffico.
  if (config?.uiDistDir) {
    if (fs.existsSync(config.uiDistDir)) {
      const indexHtmlPath = path.join(config.uiDistDir, "index.html");
      const uiRouter = express.Router();
      uiRouter.use(express.static(config.uiDistDir));
      // Fallback SPA: una route lato client (es. /storico) ricaricata a mano deve tornare index.html.
      uiRouter.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        res.sendFile(indexHtmlPath, (error) => {
          if (error) {
            next(error);
          }
        });
      });
      app.use("/_admin/ui", uiRouter);
      logger.info("Admin UI static serving enabled.", { uiDistDir: config.uiDistDir });
    } else {
      logger.warn(
        "UI_DIST_DIR is set but the directory does not exist; the admin UI will not be served.",
        { uiDistDir: config.uiDistDir }
      );
    }
  }

  app.use((req, res, next) => {
    const start = Date.now();
    // Deciso all'ingresso e riusato a fine richiesta, per coerenza per-richiesta anche se il toggle cambia nel mezzo.
    const monitoring = serverState.isMonitoring();
    const candidate = isMonitoringCandidate(req.path);
    const requestCapture = monitoring && candidate ? startRequestCapture(req) : null;
    const responseCapture = monitoring && candidate ? startResponseCapture(res) : null;
    req._responseMode = "proxy";

    logger.info("Request received.", {
      method: req.method,
      path: req.path,
    });

    res.on("finish", () => {
      const sourceHeader = res.getHeader(TECH_HEADER);
      const completedMode = typeof sourceHeader === "string" && sourceHeader !== ""
        ? sourceHeader
        : req._responseMode;

      logger.info("Request completed.", {
        method: req.method,
        path: req.path,
        mode: completedMode,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });

      // I preflight risolti dal gestore CORS automatico sono plumbing del browser, non traffico
      // API: nel monitor sarebbero solo rumore (uno per ogni scrittura cross-origin).
      if (monitoring && requestMonitor != null && requestCapture != null && candidate && completedMode !== "cors-preflight") {
        requestMonitor.recordRequest({
          req,
          res,
          startedAt: start,
          completedAt: Date.now(),
          source: completedMode,
          capture: requestCapture,
          responseCapture,
        });
      }
    });

    next();
  });

  app.use(async (req, res) => {
    const corsEnabled = config.corsEnabled === true;

    // L'hook su writeHead copre OGNI ramo che segue (mock, handler, miss, 501 e proxy): con
    // l'opzione attiva la policy CORS in uscita è sempre quella di Mockxy — vedi il commento
    // in testa alla sezione CORS.
    if (corsEnabled) {
      applyCorsResponseHeaders(req, res);
    }

    // Server off o "proxy all": nessun mock/handler/middleware, ogni richiesta va dritta al backend.
    if (!serverState.usesMocks()) {
      req._responseMode = "proxy";
      if (!config.backendUrl) {
        req._responseMode = "backend-unconfigured";
        respondWithBackendNotConfigured(req, res);
        return;
      }
      const passthroughDelayMs = resolveProxyDelayMs(config);
      if (passthroughDelayMs > 0) {
        // La cattura del monitor ha già messo req in flowing mode: senza pausa i chunk del body
        // verrebbero emessi (e persi) durante l'attesa, prima che il proxy agganci req.pipe.
        // Il pipe del proxy riprende il flusso da solo.
        req.pause();
        await sleep(passthroughDelayMs);
      }
      // Registry middleware omesso (null): in passthrough nessun proxy middleware deve trasformare la response.
      await proxyHandler(req, res, config, logger, null);
      return;
    }

    const decision = registry.matchRequest(req.method, req.path, req.originalUrl || req.url);

    // Preflight automatico: intercetta anche prima del proxy fallback, così la policy del
    // preflight è sempre quella del motore (coerente con le risposte mockate che seguiranno) e
    // non quella del backend reale. Un mock/handler OPTIONS esplicito ha già matchato e vince.
    if (corsEnabled && decision.mode !== "mock" && decision.mode !== "handler" && isCorsPreflight(req)) {
      req._responseMode = "cors-preflight";
      respondWithCorsPreflight(req, res);
      return;
    }

    if (decision.mode === "mock") {
      req._responseMode = "mock";
      req._matchedRoutePath = decision.routePath;
      // Endpoint con sequenza: quale step ha risposto (indice/totale, variante) finisce nella
      // voce del monitor — senza, la progressione di una sequenza sarebbe invisibile.
      req._sequenceStep = decision.sequenceStep;
      await respondWithMock(req, res, decision.response, config.globalDelayMs, config.caseInsensitiveFilters);
      return;
    }

    if (decision.mode === "handler") {
      req._responseMode = "handler";
      req._matchedRoutePath = decision.routePath;
      req._sequenceStep = decision.sequenceStep;
      await respondWithHandler(req, res, decision, logger, config.requestTimeoutMs, dataFileReader);
      return;
    }

    req._responseMode = "proxy";
    if (!isProxyFallbackEnabled(config)) {
      req._responseMode = "mock-only-miss";
      req._matchedRoutePath = decision.routePath;
      respondWithMockOnlyMiss(req, res, decision);
      return;
    }

    if (!config.backendUrl) {
      req._responseMode = "backend-unconfigured";
      req._matchedRoutePath = decision.routePath;
      respondWithBackendNotConfigured(req, res);
      return;
    }

    const proxyDelayMs = resolveProxyDelayMs(config);
    if (proxyDelayMs > 0) {
      // Vedi il ramo passthrough: la pausa evita di perdere il body mentre si attende il delay.
      req.pause();
      await sleep(proxyDelayMs);
    }
    await proxyHandler(req, res, config, logger, proxyMiddlewareRegistry);
  });

  app.use((error, _req, res, _next) => {
    logger.error("Unhandled application error.", { error: error.message });
    if (!res.headersSent) {
      const status = error.status || error.statusCode || 500;
      setNoCacheHeaders(res);
      res.status(status).json({
        error: status >= 500 ? "Internal Server Error" : "Bad Request",
        message: error.message,
        details: error.details,
      });
    }
  });

  return app;
}

module.exports = {
  createApp,
  respondWithHandler,
  respondWithMock,
  resolveMockDelayMs,
  resolveProxyDelayMs,
  isProxyFallbackEnabled,
  respondWithMockOnlyMiss,
  respondWithBackendNotConfigured,
  buildMockPayload,
  parsePaginationValues,
  readPagination,
  readPaginationFromUrl,
  resolvePagination,
  resolvePaginableCollection,
};
