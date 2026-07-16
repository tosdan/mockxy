const zlib = require("zlib");

// Cap per la cattura del body (request e response) nel monitor: oltre questa soglia la preview è troncata.
const MAX_CAPTURED_BODY_BYTES = 156 * 1024;
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
// the raw compressed bytes. Returns undefined when the encoding is unsupported or the (possibly
// truncated) compressed stream cannot be inflated.
function decompressCapturedBody(bodyBuffer, contentEncoding) {
  try {
    switch (String(contentEncoding).toLowerCase().trim()) {
      case "gzip":
        return zlib.gunzipSync(bodyBuffer);
      case "deflate":
        return zlib.inflateSync(bodyBuffer);
      case "br":
        return zlib.brotliDecompressSync(bodyBuffer);
      default:
        return undefined;
    }
  } catch (_error) {
    return undefined;
  }
}

// Formats the captured request body into a readable preview for the monitoring UI.
function formatRequestBody(bodyBuffer, headers, truncated) {
  if (!bodyBuffer || bodyBuffer.length === 0) {
    return undefined;
  }

  let readableBuffer = bodyBuffer;
  const contentEncoding = headers?.["content-encoding"] || headers?.["Content-Encoding"];
  if (contentEncoding && String(contentEncoding).toLowerCase() !== "identity") {
    const decompressedBuffer = decompressCapturedBody(bodyBuffer, contentEncoding);
    // Una preview troncata contiene solo i primi byte dello stream compresso: la decompressione
    // fallisce (stream incompleto) e si ricade sul placeholder, che a valle diventa uno skeleton.
    if (decompressedBuffer == null) {
      return `[compressed payload: ${bodyBuffer.length} bytes${truncated ? ", preview truncated" : ""}]`;
    }
    readableBuffer = decompressedBuffer;
  }

  const contentType = headers?.["content-type"] || headers?.["Content-Type"];
  if (!isTextualContentType(contentType)) {
    const suffix = truncated ? ", preview truncated" : "";
    return `[binary payload: ${readableBuffer.length} bytes${suffix}]`;
  }

  const bodyText = readableBuffer.toString("utf8");
  try {
    return `${JSON.stringify(JSON.parse(bodyText), null, 2)}${truncated ? "\n/* preview truncated */" : ""}`;
  } catch (_error) {
    return truncated ? `${bodyText}\n/* preview truncated */` : bodyText;
  }
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
function startResponseCapture(res) {
  const chunks = [];
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

    if (capturedBytes >= MAX_CAPTURED_BODY_BYTES) {
      truncated = true;
      return;
    }

    const remainingBytes = MAX_CAPTURED_BODY_BYTES - capturedBytes;
    if (buffer.length > remainingBytes) {
      chunks.push(buffer.subarray(0, remainingBytes));
      capturedBytes += remainingBytes;
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
function createRequestMonitorEntry({
  id,
  req,
  res,
  startedAt,
  completedAt,
  source,
  capture,
  responseCapture,
}) {
  const captureSnapshot = capture?.snapshot();
  const requestHeaders = sanitizeHeaders(req.headers);
  const requestBody = formatRequestBody(
    captureSnapshot?.bodyBuffer,
    requestHeaders,
    captureSnapshot?.truncated === true,
  );
  const responseSnapshot = responseCapture?.snapshot();
  const responseHeaders = sanitizeHeaders(typeof res.getHeaders === "function" ? res.getHeaders() : {});
  const responseBody = formatRequestBody(
    responseSnapshot?.bodyBuffer,
    responseHeaders,
    responseSnapshot?.truncated === true,
  );

  return {
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
    middlewareRoutePath: req._proxyMiddlewareMeta?.routePath,
    middlewareFilePath: req._proxyMiddlewareMeta?.filePath,
    requestHeaders,
    requestBody,
    requestBodyBytes: captureSnapshot?.totalBytes || 0,
    requestBodyTruncated: captureSnapshot?.truncated === true,
    responseHeaders,
    responseBody,
    responseBodyBytes: responseSnapshot?.totalBytes || 0,
    responseBodyTruncated: responseSnapshot?.truncated === true,
  };
}

// Keeps a bounded in-memory request history and notifies live subscribers.
class RequestMonitorStore {
  constructor(limit = DEFAULT_MONITOR_LIMIT, logger = undefined) {
    this.limit = limit;
    this.logger = logger;
    this.entries = [];
    this.subscribers = new Set();
    this.nextId = 1;
  }

  // Returns the newest entries first so the UI can render recent traffic immediately.
  listEntries() {
    return [...this.entries];
  }

  // Stores a new entry, enforces the retention cap and broadcasts it to active SSE clients.
  recordRequest(params) {
    const entry = createRequestMonitorEntry({
      id: this.nextId,
      ...params,
    });

    this.nextId += 1;
    this.entries.unshift(entry);
    if (this.entries.length > this.limit) {
      this.entries.length = this.limit;
    }

    this.broadcast({ type: "request", item: entry });
    return entry;
  }

  // Removes every stored entry and informs connected clients so their view can reset immediately.
  clear() {
    this.entries = [];
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
  RequestMonitorStore,
  createRequestMonitorEntry,
  isMonitoringCandidate,
  sanitizeHeaders,
  startRequestCapture,
  startResponseCapture,
};