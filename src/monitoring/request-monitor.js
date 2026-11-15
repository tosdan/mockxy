const zlib = require("zlib");

// Cap dell'ANTEPRIMA del body (request e response): è quello che la voce porta con sé, verso
// l'interfaccia (SSE) e nei dump su disco, quindi resta piccolo. Oltre, la preview è troncata.
const MAX_CAPTURED_BODY_BYTES = 156 * 1024;
// Cap della risposta COMPLETA conservata per creare un mock da una voce con l'anteprima
// troncata: resta in memoria accanto al buffer del Monitor, non viaggia e non va nei dump.
// Configurabile (MONITOR_CAPTURE_MAX_BODY_BYTES); 0 = nessuna conservazione.
const DEFAULT_CAPTURE_MAX_BODY_BYTES = 5 * 1024 * 1024;
// Tetto sul totale delle risposte complete conservate: superato, si lasciano andare le più
// vecchie (la voce resta, con la sua anteprima).
const DEFAULT_RETAINED_BODIES_BUDGET_BYTES = 64 * 1024 * 1024;
const DEFAULT_MONITOR_LIMIT = 250;
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
]);

// Returns true when the request belongs to the internal admin API and should not pollute the monitor feed.
function isMonitoringCandidate(requestPath) {
  return !String(requestPath || "").startsWith("/_admin/api");
}

// Masks secret-bearing header values while preserving basic shape for diagnostics.
function maskHeaderValue(headerName, headerValue) {
  if (!SENSITIVE_HEADERS.has(String(headerName).toLowerCase())) {
    return headerValue;
  }

  if (Array.isArray(headerValue)) {
    return headerValue.map(() => "***");
  }

  return "***";
}

// Creates a JSON-safe clone of the request headers and redacts the sensitive ones.
function sanitizeHeaders(headers) {
  const result = {};

  Object.entries(headers || {}).forEach(([headerName, headerValue]) => {
    if (headerValue == null) {
      return;
    }

    result[headerName] = maskHeaderValue(headerName, headerValue);
  });

  return result;
}

// Returns true when the content type can be shown as readable UTF-8 text in the monitor.
function isTextualContentType(contentType) {
  if (contentType == null) {
    return false;
  }

  const normalizedContentType = String(contentType).toLowerCase();
  return normalizedContentType.startsWith("text/")
    || normalizedContentType.includes("application/json")
    || normalizedContentType.includes("application/xml")
    || normalizedContentType.includes("application/javascript")
    || normalizedContentType.includes("application/x-www-form-urlencoded")
    || normalizedContentType.includes("application/graphql");
}

// Inflates a supported content-encoding so the monitor can preview the readable payload instead of
// the raw compressed bytes. Returns undefined when the encoding is unsupported, the (possibly
// truncated) compressed stream cannot be inflated, or the output would exceed `maxOutputBytes`:
// pochi KB compressi possono gonfiarsi a centinaia di MB, e la cattura è passiva, non deve
// poter esaurire la memoria del server.
function decompressCapturedBody(bodyBuffer, contentEncoding, maxOutputBytes) {
  const options = { maxOutputLength: Math.max(1, maxOutputBytes) };
  try {
    switch (String(contentEncoding).toLowerCase().trim()) {
      case "gzip":
        return zlib.gunzipSync(bodyBuffer, options);
      case "deflate":
        return zlib.inflateSync(bodyBuffer, options);
      case "br":
        return zlib.brotliDecompressSync(bodyBuffer, options);
      default:
        return undefined;
    }
  } catch (_error) {
    return undefined;
  }
}

// Testo leggibile di un body completo: JSON riformattato, altrimenti com'è.
function formatReadableText(readableBuffer) {
  const bodyText = readableBuffer.toString("utf8");
  try {
    return JSON.stringify(JSON.parse(bodyText), null, 2);
  } catch (_error) {
    return bodyText;
  }
}

/**
 * Dal body catturato a ciò che la voce mostra. Restituisce:
 * - `preview`: il testo per l'interfaccia, al più MAX_CAPTURED_BODY_BYTES di contenuto leggibile
 *   (un segnaposto per i payload binari o non decompressi);
 * - `truncated`: l'anteprima non è il body intero;
 * - `fullBody`: presente solo quando l'anteprima è troncata ma il body, testuale, è stato
 *   catturato per intero: è il contenuto leggibile (già decompresso) da cui si può creare un mock.
 *
 * `captureTruncated` dice che la cattura stessa si è fermata prima della fine (body oltre il
 * cap di cattura): di quel body esistono solo i primi byte.
 */
function describeCapturedBody(bodyBuffer, headers, captureTruncated, maxReadableBytes = MAX_CAPTURED_BODY_BYTES) {
  if (!bodyBuffer || bodyBuffer.length === 0) {
    return { preview: undefined, truncated: captureTruncated };
  }

  let readableBuffer = bodyBuffer;
  const contentEncoding = headers?.["content-encoding"] || headers?.["Content-Encoding"];
  if (contentEncoding && String(contentEncoding).toLowerCase() !== "identity") {
    const decompressedBuffer = decompressCapturedBody(
      bodyBuffer,
      contentEncoding,
      Math.max(maxReadableBytes, MAX_CAPTURED_BODY_BYTES)
    );
    // Una cattura troncata contiene solo i primi byte dello stream compresso: la decompressione
    // fallisce (stream incompleto) e si ricade sul placeholder, che a valle diventa uno skeleton.
    // Lo stesso per un contenuto che decompresso supera il cap.
    if (decompressedBuffer == null) {
      return {
        preview: `[compressed payload: ${bodyBuffer.length} bytes${captureTruncated ? ", preview truncated" : ""}]`,
        truncated: captureTruncated,
      };
    }
    readableBuffer = decompressedBuffer;
  }

  const contentType = headers?.["content-type"] || headers?.["Content-Type"];
  if (!isTextualContentType(contentType)) {
    const suffix = captureTruncated ? ", preview truncated" : "";
    return { preview: `[binary payload: ${readableBuffer.length} bytes${suffix}]`, truncated: captureTruncated };
  }

  if (!captureTruncated && readableBuffer.length <= MAX_CAPTURED_BODY_BYTES) {
    return { preview: formatReadableText(readableBuffer), truncated: false };
  }

  // Oltre il cap dell'anteprima: i primi byte così come sono (un JSON tagliato non si riformatta).
  const head = readableBuffer.subarray(0, MAX_CAPTURED_BODY_BYTES).toString("utf8");
  return {
    preview: `${head}\n/* preview truncated */`,
    truncated: true,
    ...(captureTruncated ? {} : { fullBody: readableBuffer }),
  };
}

// Starts a passive request body capture without interfering with downstream route handlers or proxy piping.
function startRequestCapture(req) {
  if (!isMonitoringCandidate(req?.path)) {
    return undefined;
  }

  const chunks = [];
  let capturedBytes = 0;
  let totalBytes = 0;
  let truncated = false;

  req.on("data", (chunk) => {
    const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += normalizedChunk.length;

    if (capturedBytes >= MAX_CAPTURED_BODY_BYTES) {
      truncated = true;
      return;
    }

    const remainingBytes = MAX_CAPTURED_BODY_BYTES - capturedBytes;
    if (normalizedChunk.length > remainingBytes) {
      chunks.push(normalizedChunk.subarray(0, remainingBytes));
      capturedBytes += remainingBytes;
      truncated = true;
      return;
    }

    chunks.push(normalizedChunk);
    capturedBytes += normalizedChunk.length;
  });

  return {
    // Builds a stable snapshot at response completion time.
    snapshot() {
      return {
        bodyBuffer: Buffer.concat(chunks),
        totalBytes,
        truncated,
      };
    },
  };
}

// Passively buffers the OUTGOING response body by teeing res.write/res.end, without changing what is sent.
// Fino a `maxBytes` (il cap di cattura) la risposta viene tenuta intera, per poterne fare un
// mock; appena lo supera si tengono solo i primi byte dell'anteprima e il resto si lascia andare.
function startResponseCapture(res, maxBytes = MAX_CAPTURED_BODY_BYTES) {
  const captureLimit = Math.max(MAX_CAPTURED_BODY_BYTES, Number.isFinite(maxBytes) ? maxBytes : 0);
  let chunks = [];
  let capturedBytes = 0;
  let totalBytes = 0;
  let truncated = false;

  const append = (chunk, encoding) => {
    if (chunk == null || chunk.length === 0) {
      return;
    }

    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8");
    totalBytes += buffer.length;

    if (truncated) {
      return;
    }

    if (capturedBytes + buffer.length > captureLimit) {
      // Oltre il cap di cattura: della risposta resta l'anteprima, come copia propria (un
      // subarray terrebbe in vita i chunk interi).
      const head = Buffer.concat([...chunks, buffer]).subarray(0, MAX_CAPTURED_BODY_BYTES);
      chunks = [Buffer.from(head)];
      capturedBytes = chunks[0].length;
      truncated = true;
      return;
    }

    chunks.push(buffer);
    capturedBytes += buffer.length;
  };

  const originalWrite = res.write;
  const originalEnd = res.end;

  res.write = function patchedWrite(chunk, encoding, callback) {
    append(chunk, encoding);
    return originalWrite.call(this, chunk, encoding, callback);
  };

  res.end = function patchedEnd(chunk, encoding, callback) {
    if (typeof chunk !== "function") {
      append(chunk, encoding);
    }
    return originalEnd.call(this, chunk, encoding, callback);
  };

  return {
    snapshot() {
      return {
        bodyBuffer: Buffer.concat(chunks),
        totalBytes,
        truncated,
      };
    },
  };
}

// Builds the serializable monitoring payload shown by the admin UI.
function createRequestMonitorEntry(params) {
  return buildMonitorEntry(params).entry;
}

// La voce più, a parte, la risposta completa da conservare (se c'è): quella non è serializzabile
// insieme alla voce, per dimensione.
function buildMonitorEntry({
  id,
  req,
  res,
  startedAt,
  completedAt,
  source,
  capture,
  responseCapture,
  captureMaxBodyBytes = 0,
}) {
  const captureSnapshot = capture?.snapshot();
  const requestHeaders = sanitizeHeaders(req.headers);
  const requestBody = describeCapturedBody(
    captureSnapshot?.bodyBuffer,
    requestHeaders,
    captureSnapshot?.truncated === true,
  );
  const responseSnapshot = responseCapture?.snapshot();
  const responseHeaders = sanitizeHeaders(typeof res.getHeaders === "function" ? res.getHeaders() : {});
  const responseBody = describeCapturedBody(
    responseSnapshot?.bodyBuffer,
    responseHeaders,
    responseSnapshot?.truncated === true,
    captureMaxBodyBytes,
  );
  // La risposta completa viaggia fuori dalla voce: la conserva lo store, entro il suo tetto.
  const retainedResponseBody = captureMaxBodyBytes > 0 ? responseBody.fullBody : undefined;

  const entry = {
    id: String(id),
    timestamp: new Date(startedAt).toISOString(),
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl || req.url,
    status: res.statusCode,
    latencyMs: Math.max(0, completedAt - startedAt),
    source,
    matchedRoutePath: req._matchedRoutePath,
    // Endpoint con sequenza: step servito ({ index, count, responseFile, responseTitle }),
    // altrimenti assente. La progressione della sequenza si legge da qui.
    sequenceStep: req._sequenceStep,
    // Internal shared-state diagnostics are copied explicitly; the public mock response remains
    // sanitized while the administrative monitor can identify the resource and seed contract.
    sharedStateError: req._sharedStateError,
    middlewareRoutePath: req._proxyMiddlewareMeta?.routePath,
    middlewareFilePath: req._proxyMiddlewareMeta?.filePath,
    requestHeaders,
    requestBody: requestBody.preview,
    requestBodyBytes: captureSnapshot?.totalBytes || 0,
    requestBodyTruncated: requestBody.truncated === true,
    responseHeaders,
    responseBody: responseBody.preview,
    responseBodyBytes: responseSnapshot?.totalBytes || 0,
    responseBodyTruncated: responseBody.truncated === true,
    // L'anteprima è troncata ma la risposta completa è conservata: un mock creato da questa
    // voce nasce completo. Torna false se la risposta viene lasciata andare per fare posto.
    responseBodyRetained: retainedResponseBody != null,
  };
  return { entry, retainedResponseBody };
}

// Limite in byte da configurazione: intero non negativo, altrimenti il default.
function normalizeByteLimit(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

// Keeps a bounded in-memory request history and notifies live subscribers.
class RequestMonitorStore {
  constructor(limit = DEFAULT_MONITOR_LIMIT, logger = undefined, options = {}) {
    this.limit = limit;
    this.logger = logger;
    // Cap della risposta completa conservata per voce, e tetto sul loro totale (mai sotto il
    // cap: almeno una risposta deve poterci stare).
    this.captureMaxBodyBytes = normalizeByteLimit(options.captureMaxBodyBytes, DEFAULT_CAPTURE_MAX_BODY_BYTES);
    this.retainedBudgetBytes = Math.max(
      normalizeByteLimit(options.retainedBudgetBytes, DEFAULT_RETAINED_BODIES_BUDGET_BYTES),
      this.captureMaxBodyBytes
    );
    // Risposte complete delle voci con l'anteprima troncata, dalla più vecchia: id → Buffer.
    this.retainedBodies = new Map();
    this.retainedBytes = 0;
    this.entries = [];
    this.subscribers = new Set();
    this.nextId = 1;
    // Cresce a ogni clear, anche a buffer vuoto (§13 C5): un cursore della generazione precedente
    // riconosce la cancellazione. Il clear non riutilizza gli ID.
    this.generation = 1;
  }

  // Returns the newest entries first so the UI can render recent traffic immediately.
  listEntries() {
    return [...this.entries];
  }

  // Istantanea coerente per una pagina: voci in ordine crescente di ID (contigui), generazione e
  // ultimo ID assegnato (0 prima della prima richiesta).
  snapshot() {
    return {
      entries: [...this.entries].reverse(),
      generation: this.generation,
      highWatermark: this.nextId - 1,
    };
  }

  // Una voce ancora nel buffer, per ID decimale; undefined se espulsa, cancellata o mai registrata.
  getEntry(id) {
    return this.entries.find((entry) => entry.id === String(id));
  }

  // La voce da cui creare un mock: quando la risposta completa è conservata, il body è quello
  // intero e non l'anteprima. Una copia: la voce nel buffer resta com'è.
  getCaptureEntry(id) {
    const entry = this.getEntry(id);
    const retainedBody = entry == null ? undefined : this.retainedBodies.get(entry.id);
    if (retainedBody == null) {
      return entry;
    }
    return { ...entry, responseBody: formatReadableText(retainedBody), responseBodyTruncated: false };
  }

  // Stores a new entry, enforces the retention cap and broadcasts it to active SSE clients.
  recordRequest(params) {
    const { entry, retainedResponseBody } = buildMonitorEntry({
      id: this.nextId,
      captureMaxBodyBytes: this.captureMaxBodyBytes,
      ...params,
    });

    this.nextId += 1;
    this.entries.unshift(entry);
    if (retainedResponseBody != null) {
      this.retainedBodies.set(entry.id, retainedResponseBody);
      this.retainedBytes += retainedResponseBody.length;
    }
    if (this.entries.length > this.limit) {
      for (const evicted of this.entries.slice(this.limit)) {
        this._releaseRetainedBody(evicted.id);
      }
      this.entries.length = this.limit;
    }
    this._enforceRetainedBudget(entry.id);

    this.broadcast({ type: "request", item: entry });
    return entry;
  }

  _releaseRetainedBody(id) {
    const body = this.retainedBodies.get(id);
    if (body != null) {
      this.retainedBodies.delete(id);
      this.retainedBytes -= body.length;
    }
  }

  // Oltre il tetto si lasciano andare le risposte complete più vecchie, mai quella appena
  // registrata. La voce resta nel buffer con la sua anteprima, e lo dichiara.
  _enforceRetainedBudget(newestId) {
    for (const id of this.retainedBodies.keys()) {
      if (this.retainedBytes <= this.retainedBudgetBytes || id === newestId) {
        break;
      }
      this._releaseRetainedBody(id);
      const entry = this.getEntry(id);
      if (entry != null) {
        entry.responseBodyRetained = false;
      }
    }
  }

  // Removes every stored entry and informs connected clients so their view can reset immediately.
  clear() {
    this.entries = [];
    this.retainedBodies.clear();
    this.retainedBytes = 0;
    this.generation += 1;
    this.broadcast({ type: "clear" });
  }

  // Registers a subscriber callback that will receive structured monitoring events.
  subscribe(listener) {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  // Fan-outs the same event payload to every connected SSE response writer. Broadcast runs inside
  // response event handlers: a throwing subscriber would become an uncaughtException and kill the
  // process, so failures are logged and never propagated.
  broadcast(event) {
    this.subscribers.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        this.logger?.error("Monitor subscriber failed while receiving an event.", {
          eventType: event?.type,
          error: error?.message,
        });
      }
    });
  }
}

module.exports = {
  DEFAULT_CAPTURE_MAX_BODY_BYTES,
  MAX_CAPTURED_BODY_BYTES,
  RequestMonitorStore,
  createRequestMonitorEntry,
  isMonitoringCandidate,
  sanitizeHeaders,
  startRequestCapture,
  startResponseCapture,
};
