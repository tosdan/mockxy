const http = require("http");
const https = require("https");
const zlib = require("zlib");
const { promisify } = require("util");
const { setNoCacheHeaders } = require("../utils/cache");
const { createDataFileReader } = require("../mocks/data-files");
const { isValidHttpStatus } = require("../utils/http-body-utils");
const { runWithTimeout } = require("../utils/run-with-timeout");

const TECH_HEADER = "x-mock-source";

// Classifies upstream failures into stable categories for logs and diagnostics.
function classifyUpstreamError(error) {
  if (!error) {
    return "unknown";
  }

  if (error.message === "upstream_timeout") {
    return "timeout";
  }

  if (error.message === "client_aborted") {
    return "client_aborted";
  }

  switch (error.code) {
    case "ECONNREFUSED":
      return "connection_refused";
    case "ECONNRESET":
      return "connection_reset";
    case "ENOTFOUND":
      return "dns_not_found";
    case "EAI_AGAIN":
      return "dns_lookup_timeout";
    case "ETIMEDOUT":
      return "socket_timeout";
    default:
      return "network_error";
  }
}

// Builds a stable context payload for proxy-related logs.
function getUpstreamContext(req, targetUrl, config) {
  return {
    method: req.method,
    requestPath: req.originalUrl || req.url,
    backendUrl: config.backendUrl,
    upstreamProtocol: targetUrl.protocol,
    upstreamHost: targetUrl.hostname,
    upstreamPort: targetUrl.port || (targetUrl.protocol === "https:" ? "443" : "80"),
    upstreamPath: `${targetUrl.pathname}${targetUrl.search}`,
    requestTimeoutMs: config.requestTimeoutMs,
  };
}

// Serializes runtime errors into a structured payload safe for logs.
function serializeError(error) {
  if (!error) {
    return {};
  }

  const details = {
    error: error.message,
    errorName: error.name,
    errorType: classifyUpstreamError(error),
  };

  if (error.code) {
    details.errorCode = error.code;
  }

  if (error.stack) {
    details.errorStack = error.stack;
  }

  if (error.cause instanceof Error) {
    details.errorCause = error.cause.message;
  }

  return details;
}

// Header hop-by-hop (RFC 7230 §6.1 + il legacy proxy-connection): descrivono la singola
// connessione TCP e un proxy non deve mai inoltrarli, in nessuna direzione — ogni tratta
// (client↔Mockxy, Mockxy↔backend) negozia i propri. Vanno rimossi anche gli header nominati
// dentro il valore di "Connection" (es. "Connection: close, x-custom").
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Nomi di header elencati nel valore di "Connection", normalizzati in minuscolo.
function connectionNamedHeaders(headers) {
  const connectionValue = getHeaderValue(headers, "connection");
  if (typeof connectionValue !== "string") {
    return [];
  }
  return connectionValue
    .split(",")
    .map((headerName) => headerName.trim().toLowerCase())
    .filter(Boolean);
}

function isHopByHopHeader(headerName, connectionNamed) {
  const normalizedName = headerName.toLowerCase();
  return HOP_BY_HOP_HEADERS.has(normalizedName) || connectionNamed.includes(normalizedName);
}

// Rewrites request headers for the upstream target host and can disable compression when a middleware needs to inspect the response.
function sanitizeRequestHeaders(headers, host, preferIdentityEncoding = false) {
  const connectionNamed = connectionNamedHeaders(headers);
  const result = {};
  for (const [headerName, value] of Object.entries(headers || {})) {
    if (!isHopByHopHeader(headerName, connectionNamed)) {
      result[headerName] = value;
    }
  }
  result.host = host;

  if (preferIdentityEncoding) {
    result["accept-encoding"] = "identity";
  }

  return result;
}

// --- Adattamento dei Set-Cookie proxati (config.adaptProxyCookies) ---
// Un Set-Cookie del backend è scritto per i browser che gli parlano direttamente: legato al suo
// dominio (Domain), spesso vincolato a https (Secure) e ai flussi cross-site (SameSite=None).
// Con Mockxy in mezzo il browser registra il cookie come emesso dall'host di Mockxy, su http:
// quegli attributi lo farebbero scartare in silenzio e la sessione non si stabilirebbe mai.
// L'adattamento rimuove Domain (il cookie diventa host-only sull'host di Mockxy), Secure e
// SameSite=None (rimosso Secure, None verrebbe rifiutato; si ricade sul default Lax, adeguato
// ai flussi same-site di sviluppo). Nome e valore del cookie non vengono mai toccati.
function adaptProxyCookie(cookieValue) {
  const [nameValue, ...attributes] = String(cookieValue).split(";");
  const keptAttributes = attributes.filter((attribute) => {
    // Tollerante su maiuscole e spazi attorno all'uguale ("Domain = x", "SameSite = None"):
    // formati sciatti ma visti in giro, e un attributo non riconosciuto qui passerebbe intero.
    const normalized = attribute.trim().toLowerCase();
    return normalized !== "secure" &&
      !/^samesite\s*=\s*none$/.test(normalized) &&
      !/^domain\s*=/.test(normalized);
  });
  return [nameValue, ...keptAttributes].join(";");
}

// Hook su setHeader (stile dell'hook CORS su writeHead in app.js): intercetta i Set-Cookie in
// uscita qualunque percorso del proxy li scriva — passthrough in streaming o risposta
// bufferizzata dei middleware — senza dover passare la config lungo la catena.
function installProxyCookieAdapter(res) {
  const originalSetHeader = res.setHeader;
  res.setHeader = function adaptingSetHeader(name, value) {
    if (String(name).toLowerCase() === "set-cookie") {
      const adapted = Array.isArray(value) ? value.map(adaptProxyCookie) : adaptProxyCookie(value);
      return originalSetHeader.call(this, name, adapted);
    }
    return originalSetHeader.call(this, name, value);
  };
}

// --- Riscrittura dei Location proxati (config.rewriteProxyRedirects) ---
// Un redirect assoluto verso il backend ("Location: https://staging.example/login") farebbe
// uscire il browser da Mockxy: le richieste successive parlerebbero direttamente col backend,
// perdendo proxy, cookie adattati e policy CORS. Quando l'origin del Location coincide con
// quella del backend configurato, schema+host+porta vengono sostituiti con l'host con cui il
// client ha raggiunto Mockxy (header Host, schema http: Mockxy non fa TLS), preservando path,
// query e fragment. I Location relativi sono già corretti e passano intatti; quelli verso host
// TERZI (SSO esterni, CDN) pure: riscriverli romperebbe flussi legittimi.
function rewriteProxyLocation(locationValue, backendOrigin, requestHost) {
  let target;
  try {
    target = new URL(String(locationValue));
  } catch {
    // Relativo o malformato: intatto.
    return locationValue;
  }
  if (target.origin !== backendOrigin) {
    return locationValue;
  }
  return `http://${requestHost}${target.pathname}${target.search}${target.hash}`;
}

// Hook su setHeader, come l'adattamento dei cookie: intercetta i Location in uscita qualunque
// percorso del proxy li scriva. Se backendUrl o Host non sono interpretabili non installa nulla.
function installProxyRedirectRewriter(req, res, backendUrl) {
  let backendOrigin;
  try {
    backendOrigin = new URL(backendUrl).origin;
  } catch {
    return;
  }
  const requestHost = req.headers.host;
  if (typeof requestHost !== "string" || requestHost === "") {
    return;
  }
  const originalSetHeader = res.setHeader;
  res.setHeader = function rewritingSetHeader(name, value) {
    if (String(name).toLowerCase() === "location" && typeof value === "string") {
      return originalSetHeader.call(this, name, rewriteProxyLocation(value, backendOrigin, requestHost));
    }
    return originalSetHeader.call(this, name, value);
  };
}

// Copies upstream response headers to the downstream response while preserving arrays like
// set-cookie. Gli hop-by-hop non passano: connection/keep-alive appartengono alla tratta
// upstream, e transfer-encoding lo decide Node per la risposta al client.
function copyUpstreamHeaders(upstreamHeaders, response) {
  const connectionNamed = connectionNamedHeaders(upstreamHeaders);
  for (const [headerName, value] of Object.entries(upstreamHeaders)) {
    if (value === undefined || isHopByHopHeader(headerName, connectionNamed)) {
      continue;
    }
    response.setHeader(headerName, value);
  }
}

// Clones headers into a mutable plain object so middleware can apply deterministic mutations.
function cloneHeaders(headers) {
  return { ...(headers || {}) };
}

// Reads a single header ignoring original casing.
function getHeaderValue(headers, headerName) {
  const targetName = String(headerName).toLowerCase();

  for (const [currentHeaderName, value] of Object.entries(headers || {})) {
    if (currentHeaderName.toLowerCase() === targetName) {
      return value;
    }
  }

  return undefined;
}

// Removes a header from a header object without depending on the stored casing.
function removeHeader(headers, headerName) {
  const targetName = String(headerName).toLowerCase();

  Object.keys(headers).forEach((currentHeaderName) => {
    if (currentHeaderName.toLowerCase() === targetName) {
      delete headers[currentHeaderName];
    }
  });
}

// Drops response metadata that becomes stale when a middleware changes the response body.
function stripBodyDependentHeaders(headers) {
  removeHeader(headers, "content-length");
  removeHeader(headers, "content-encoding");
  removeHeader(headers, "transfer-encoding");
  removeHeader(headers, "etag");
}

// Returns true when the upstream body is encoded and therefore cannot be safely remapped locally.
function hasEncodedBody(headers) {
  const contentEncoding = getHeaderValue(headers, "content-encoding");
  if (contentEncoding == null) {
    return false;
  }

  return String(contentEncoding).toLowerCase() !== "identity";
}

// Returns true when the response declares a JSON payload we can parse for middleware transformations.
function isJsonContentType(headers) {
  const contentType = getHeaderValue(headers, "content-type");
  if (contentType == null) {
    return false;
  }

  const normalizedContentType = String(contentType).toLowerCase().split(";")[0].trim();
  return normalizedContentType === "application/json" || normalizedContentType.endsWith("+json");
}

// Returns true for content types that can be exposed to middleware as UTF-8 text.
function isTextContentType(headers) {
  const contentType = getHeaderValue(headers, "content-type");
  if (contentType == null) {
    return false;
  }

  const normalizedContentType = String(contentType).toLowerCase();
  return normalizedContentType.startsWith("text/")
    || normalizedContentType.includes("application/json")
    || normalizedContentType.includes("application/xml")
    || normalizedContentType.includes("application/javascript")
    || normalizedContentType.includes("application/x-www-form-urlencoded");
}

// Cap sul buffering delle risposte per i middleware: oltre questa soglia la trasformazione
// non è fattibile in RAM e la risposta viene inoltrata al client così com'è (passthrough).
const MAX_MIDDLEWARE_BODY_BYTES = 10 * 1024 * 1024;

// Buffers the upstream response body up to maxBytes so a middleware can inspect and transform
// it. Oltre il limite lo stream viene messo in pausa e si restituisce il prefisso letto con
// truncated=true: il chiamante può inoltrarlo al client e riprendere il resto in streaming
// (il pipe riattiva il flusso), senza mai tenere in RAM payload di dimensione arbitraria.
function readStreamToBuffer(stream, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };
    const settle = (finish, value) => {
      if (!settled) {
        settled = true;
        cleanup();
        finish(value);
      }
    };

    const onData = (chunk) => {
      const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(normalizedChunk);
      totalBytes += normalizedChunk.length;
      if (totalBytes > maxBytes) {
        stream.pause();
        settle(resolve, { bodyBuffer: Buffer.concat(chunks), truncated: true });
      }
    };
    const onEnd = () => settle(resolve, { bodyBuffer: Buffer.concat(chunks), truncated: false });
    const onError = (error) => settle(reject, error);

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

// Inoltra la risposta upstream al client senza trasformazione: status e header originali,
// eventuale prefisso già bufferizzato e il resto in streaming.
function streamUpstreamPassthrough(res, upstreamRes, bufferedPrefix) {
  return new Promise((resolve) => {
    res.statusCode = upstreamRes.statusCode || 502;
    copyUpstreamHeaders(upstreamRes.headers, res);
    setNoCacheHeaders(res);
    res.setHeader(TECH_HEADER, "backend");
    if (bufferedPrefix != null && bufferedPrefix.length > 0) {
      res.write(bufferedPrefix);
    }
    upstreamRes.pipe(res);
    upstreamRes.on("end", resolve);
    upstreamRes.on("error", () => resolve());
  });
}

// Cap sull'output decompresso: un payload compresso piccolo può gonfiarsi enormemente (bomba
// di decompressione). Oltre il tetto zlib interrompe da solo (maxOutputLength) e il body resta
// visibile al middleware solo in forma compressa (bodyText/jsonBody assenti).
const MAX_DECODED_BODY_BYTES = 50 * 1024 * 1024;

const gunzipAsync = promisify(zlib.gunzip);
const inflateAsync = promisify(zlib.inflate);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);

// Decodes common upstream content encodings so buffered middleware can inspect textual payloads.
// Versioni async di zlib (threadpool): la decompressione di payload fino a 10MB non deve
// bloccare l'event loop mentre il server serve altre richieste.
async function decodeEncodedBody(bodyBuffer, headers) {
  const contentEncoding = getHeaderValue(headers, "content-encoding");
  if (contentEncoding == null) {
    return bodyBuffer;
  }

  const normalizedContentEncoding = String(contentEncoding).toLowerCase().trim();
  switch (normalizedContentEncoding) {
    case "identity":
      return bodyBuffer;
    case "gzip":
      return gunzipAsync(bodyBuffer, { maxOutputLength: MAX_DECODED_BODY_BYTES });
    case "deflate":
      return inflateAsync(bodyBuffer, { maxOutputLength: MAX_DECODED_BODY_BYTES });
    case "br":
      return brotliDecompressAsync(bodyBuffer, { maxOutputLength: MAX_DECODED_BODY_BYTES });
    default:
      return undefined;
  }
}

// Returns a UTF-8 safe view of the upstream payload when its content encoding is supported.
async function getReadableBodyBuffer(bodyBuffer, headers) {
  if (bodyBuffer.length === 0) {
    return bodyBuffer;
  }

  try {
    return await decodeEncodedBody(bodyBuffer, headers);
  } catch (_error) {
    return undefined;
  }
}

// Parses a buffered upstream JSON body when the content type or payload shape allows it.
function parseJsonBody(readableBodyBuffer, headers) {
  if (readableBodyBuffer == null || readableBodyBuffer.length === 0) {
    return undefined;
  }

  try {
    const decodedBody = readableBodyBuffer.toString("utf8");
    const parsedBody = JSON.parse(decodedBody);

    if (isJsonContentType(headers)) {
      return parsedBody;
    }

    const bodyLooksLikeStructuredJson = /^[\s\r\n]*[\[{]/.test(decodedBody);
    if (!bodyLooksLikeStructuredJson) {
      return undefined;
    }

    return parsedBody;
  } catch (_error) {
    return undefined;
  }
}

// Exposes a buffered upstream text body only for formats that are safe to decode as UTF-8.
function readTextBody(readableBodyBuffer, headers) {
  if (readableBodyBuffer == null || readableBodyBuffer.length === 0 || !isTextContentType(headers)) {
    return undefined;
  }

  return readableBodyBuffer.toString("utf8");
}

// Creates the middleware input snapshot from the upstream response and its buffered payload.
async function buildBufferedUpstreamResponse(upstreamRes, bodyBuffer) {
  const headers = cloneHeaders(upstreamRes.headers);
  const readableBodyBuffer = await getReadableBodyBuffer(bodyBuffer, headers);

  return {
    status: upstreamRes.statusCode || 502,
    headers,
    bodyBuffer,
    bodyText: readTextBody(readableBodyBuffer, headers),
    jsonBody: parseJsonBody(readableBodyBuffer, headers),
  };
}

// Validates and normalizes the optional list of headers removed by a proxy middleware.
function normalizeRemovedHeaders(removeHeaders) {
  if (removeHeaders == null) {
    return [];
  }

  if (!Array.isArray(removeHeaders)) {
    throw new Error("transformResponse must return removeHeaders as an array when provided");
  }

  return removeHeaders.map((headerName) => String(headerName));
}

// Merges middleware header overrides on top of upstream headers after applying explicit removals.
function mergeResponseHeaders(baseHeaders, headers, removeHeaders) {
  const mergedHeaders = cloneHeaders(baseHeaders);

  if (headers == null) {
    normalizeRemovedHeaders(removeHeaders).forEach((headerName) => {
      removeHeader(mergedHeaders, headerName);
    });
    return mergedHeaders;
  }

  const isObjectHeaders = typeof headers === "object" && !Array.isArray(headers);
  if (!isObjectHeaders) {
    throw new Error("transformResponse must return headers as an object when provided");
  }

  for (const [headerName, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    mergedHeaders[headerName] = value;
  }

  normalizeRemovedHeaders(removeHeaders).forEach((headerName) => {
    removeHeader(mergedHeaders, headerName);
  });

  return mergedHeaders;
}

// Validates the middleware result and converts it into a downstream response payload.
function resolveProxyMiddlewareResponse(upstreamResponse, transformResult) {
  if (transformResult == null) {
    return {
      status: upstreamResponse.status,
      headers: cloneHeaders(upstreamResponse.headers),
      body: upstreamResponse.bodyBuffer,
    };
  }

  const isObjectResult = typeof transformResult === "object" && !Array.isArray(transformResult);
  if (!isObjectResult) {
    throw new Error("transformResponse must return an object or undefined");
  }

  const responseStatus =
    transformResult.status == null ? upstreamResponse.status : Number(transformResult.status);
  if (!isValidHttpStatus(responseStatus)) {
    throw new Error("transformResponse must return a valid HTTP status when provided");
  }

  const hasBody = Object.prototype.hasOwnProperty.call(transformResult, "body");
  const hasJsonBody = Object.prototype.hasOwnProperty.call(transformResult, "jsonBody");
  if (hasBody && hasJsonBody) {
    throw new Error("transformResponse cannot return both body and jsonBody");
  }

  const headers = mergeResponseHeaders(
    upstreamResponse.headers,
    transformResult.headers,
    transformResult.removeHeaders
  );

  if (hasJsonBody) {
    stripBodyDependentHeaders(headers);
    headers["content-type"] = "application/json; charset=utf-8";
    return {
      status: responseStatus,
      headers,
      body: transformResult.jsonBody,
    };
  }

  if (hasBody) {
    const isSupportedBody = Buffer.isBuffer(transformResult.body)
      || typeof transformResult.body === "string";
    if (!isSupportedBody) {
      throw new Error("transformResponse body must be a Buffer or a string");
    }

    stripBodyDependentHeaders(headers);
    return {
      status: responseStatus,
      headers,
      body: transformResult.body,
    };
  }

  return {
    status: responseStatus,
    headers,
    body: upstreamResponse.bodyBuffer,
  };
}

// Sends a generated proxy error payload for connectivity or buffering failures.
function sendBadGatewayResponse(res, source = "backend") {
  setNoCacheHeaders(res);
  res.setHeader(TECH_HEADER, source);
  res.status(502).json({
    error: "Bad Gateway",
    message: "Unable to reach upstream backend.",
  });
}

// Writes a fully materialized downstream response after a proxy middleware has been applied.
function sendBufferedResponse(res, responsePayload, source = "middleware") {
  copyUpstreamHeaders(responsePayload.headers, res);
  setNoCacheHeaders(res);
  res.setHeader(TECH_HEADER, source);
  res.status(responsePayload.status).send(responsePayload.body);
}

// Logs proxy middleware failures with route and file metadata so broken transformations are traceable.
function logProxyMiddlewareFailure(logger, message, upstreamContext, middlewareConfig, error) {
  logger.error(message, {
    ...upstreamContext,
    middlewarePath: middlewareConfig.path,
    middlewareFilePath: middlewareConfig.sourceFilePath || middlewareConfig.configFilePath,
    ...serializeError(error),
  });
}

// Buffers and transforms the upstream response for routes that declare a proxy middleware.
async function handleBufferedProxyResponse(
  req,
  res,
  targetUrl,
  upstreamRes,
  upstreamContext,
  middlewareConfig,
  logger,
  requestTimeoutMs,
  dataFileReader
) {
  // Bypass anticipato: uno stream dichiarato (SSE) non termina mai e un payload che già si
  // annuncia oltre il cap non è trasformabile in RAM — in entrambi i casi bufferizzare
  // appenderebbe la richiesta o gonfierebbe la memoria, quindi si inoltra senza middleware.
  const contentTypeHeader = getHeaderValue(upstreamRes.headers, "content-type");
  const isEventStream = contentTypeHeader != null
    && String(contentTypeHeader).toLowerCase().includes("text/event-stream");
  const declaredLength = Number(getHeaderValue(upstreamRes.headers, "content-length"));
  const declaredOverLimit = Number.isFinite(declaredLength) && declaredLength > MAX_MIDDLEWARE_BODY_BYTES;

  if (isEventStream || declaredOverLimit) {
    logger.warn("Proxy middleware bypassed: streaming or oversized upstream response.", {
      ...upstreamContext,
      middlewarePath: middlewareConfig.path,
      middlewareFilePath: middlewareConfig.sourceFilePath || middlewareConfig.configFilePath,
      contentType: contentTypeHeader,
      reason: isEventStream ? "event_stream" : "content_length_over_limit",
    });
    await streamUpstreamPassthrough(res, upstreamRes);
    return;
  }

  let upstreamResponse;

  try {
    const { bodyBuffer, truncated } = await readStreamToBuffer(upstreamRes, MAX_MIDDLEWARE_BODY_BYTES);
    if (truncated) {
      logger.warn("Proxy middleware bypassed: upstream response exceeds the buffer limit. Forwarding it unmodified.", {
        ...upstreamContext,
        middlewarePath: middlewareConfig.path,
        middlewareFilePath: middlewareConfig.sourceFilePath || middlewareConfig.configFilePath,
        maxBytes: MAX_MIDDLEWARE_BODY_BYTES,
      });
      await streamUpstreamPassthrough(res, upstreamRes, bodyBuffer);
      return;
    }
    upstreamResponse = await buildBufferedUpstreamResponse(upstreamRes, bodyBuffer);
  } catch (error) {
    logProxyFailure(logger, "Error while buffering upstream response.", {
      ...upstreamContext,
      upstreamStatus: upstreamRes.statusCode || 502,
    }, error);

    if (!shouldSkipErrorResponse(res, error)) {
      sendBadGatewayResponse(res);
    }
    return;
  }

  try {
    // A questo punto la risposta upstream è già stata letta per intero: nessun timeout di
    // rete può più intervenire, quindi la corsa col timer è l'unica difesa contro un
    // transformResponse che non risolve mai.
    const transformedResponse = await runWithTimeout(
      () => middlewareConfig.transformResponse({
        req,
        targetUrl: targetUrl.toString(),
        status: upstreamResponse.status,
        headers: cloneHeaders(upstreamResponse.headers),
        bodyBuffer: Buffer.from(upstreamResponse.bodyBuffer),
        bodyText: upstreamResponse.bodyText,
        jsonBody: upstreamResponse.jsonBody,
        data: dataFileReader || createDataFileReader(undefined),
      }),
      requestTimeoutMs,
      {
        code: "MIDDLEWARE_TIMEOUT",
        message: `Proxy middleware transformResponse timed out after ${requestTimeoutMs}ms.`,
      }
    );

    sendBufferedResponse(
      res,
      resolveProxyMiddlewareResponse(upstreamResponse, transformedResponse)
    );
  } catch (error) {
    logProxyMiddlewareFailure(
      logger,
      "Proxy middleware failed. Returning unmodified upstream response.",
      upstreamContext,
      middlewareConfig,
      error
    );

    if (!res.headersSent && !res.destroyed) {
      sendBufferedResponse(res, {
        status: upstreamResponse.status,
        headers: cloneHeaders(upstreamResponse.headers),
        body: upstreamResponse.bodyBuffer,
      });
    }
  }
}

// Reports proxy failures using warn for client disconnects and error for upstream issues.
function logProxyFailure(logger, message, upstreamContext, error) {
  const logLevel = classifyUpstreamError(error) === "client_aborted" ? "warn" : "error";
  logger[logLevel](message, {
    ...upstreamContext,
    ...serializeError(error),
  });
}

// Returns true when the downstream connection cannot receive a generated error response.
function shouldSkipErrorResponse(res, error) {
  return res.headersSent || res.destroyed || classifyUpstreamError(error) === "client_aborted";
}

// Destroys an upstream stream only when it is still open.
function destroyStream(stream, error) {
  if (!stream || stream.destroyed) {
    return;
  }

  stream.destroy(error);
}

// Proxies unmatched requests to the configured backend while handling timeouts and client aborts.
function forwardToBackend(req, res, config, logger, proxyMiddlewareRegistry) {
  return new Promise((resolve) => {
    if (config.adaptProxyCookies !== false) {
      installProxyCookieAdapter(res);
    }
    if (config.rewriteProxyRedirects !== false) {
      installProxyRedirectRewriter(req, res, config.backendUrl);
    }
    const targetUrl = new URL(req.originalUrl || req.url, config.backendUrl);
    const client = targetUrl.protocol === "https:" ? https : http;
    const upstreamContext = getUpstreamContext(req, targetUrl, config);
    const middlewareDecision = proxyMiddlewareRegistry?.matchRequest(
      req.method,
      req.path,
      req.originalUrl || req.url
    ) || {
      matched: false,
    };
    req._proxyMiddlewareMeta = middlewareDecision.matched
      ? {
        routePath: middlewareDecision.routePath,
        filePath: middlewareDecision.middleware?.sourceFilePath || middlewareDecision.middleware?.configFilePath,
      }
      : undefined;
    const options = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: sanitizeRequestHeaders(req.headers, targetUrl.host, middlewareDecision.matched),
    };

    let settled = false;
    let upstreamRes = null;
    const finalize = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    const upstreamReq = client.request(options, (nextUpstreamRes) => {
      upstreamRes = nextUpstreamRes;

      // La risposta è iniziata: da qui in poi il ritmo lo decide il backend (una SSE può tacere
      // per minuti, un download può rallentare). Il timeout di inattività ha già fatto il suo
      // lavoro — proteggere connessione, invio della richiesta e attesa degli header — e non
      // deve troncare gli stream lunghi; un upstream morto a metà si manifesta con error/close,
      // e il client può sempre abortire (il close di res distrugge la tratta upstream).
      upstreamReq.setTimeout(0);

      if (middlewareDecision.matched) {
        handleBufferedProxyResponse(
          req,
          res,
          targetUrl,
          upstreamRes,
          upstreamContext,
          middlewareDecision.middleware,
          logger,
          config.requestTimeoutMs,
          createDataFileReader(config.filesDir)
        )
          .catch((error) => {
            logProxyMiddlewareFailure(
              logger,
              "Proxy middleware failed unexpectedly. Returning 502.",
              upstreamContext,
              middlewareDecision.middleware,
              error
            );

            if (!shouldSkipErrorResponse(res, error)) {
              sendBadGatewayResponse(res, "middleware");
            }
          })
          .finally(finalize);
        return;
      }

      res.statusCode = upstreamRes.statusCode || 502;
      copyUpstreamHeaders(upstreamRes.headers, res);
      setNoCacheHeaders(res);
      res.setHeader(TECH_HEADER, "backend");
      upstreamRes.pipe(res);
      upstreamRes.on("end", finalize);
      upstreamRes.on("error", (error) => {
        logProxyFailure(logger, "Error while receiving upstream response.", {
          ...upstreamContext,
          upstreamStatus: upstreamRes.statusCode || 502,
        }, error);
        // Header già inviati: il troncamento deve restare visibile al client — chiudere il
        // socket senza terminatore pulito fa fallire la richiesta lato client, mentre un end()
        // farebbe sembrare la risposta completata correttamente.
        if (!res.destroyed && !res.writableEnded) {
          res.destroy(error);
        }
        finalize();
      });
    });

    upstreamReq.setTimeout(config.requestTimeoutMs, () => {
      upstreamReq.destroy(new Error("upstream_timeout"));
    });

    upstreamReq.on("error", (error) => {
      if (!shouldSkipErrorResponse(res, error)) {
        sendBadGatewayResponse(res);
      } else if (!res.destroyed && !res.writableEnded) {
        // A header già inviati non c'è più uno status da mandare: la chiusura sporca è l'unico
        // segnale di troncamento che il client può percepire (end() lo maschererebbe da
        // risposta completata).
        res.destroy(error);
      }

      logProxyFailure(logger, "Proxy request failed.", upstreamContext, error);
      finalize();
    });

    req.on("aborted", () => {
      destroyStream(upstreamReq, new Error("client_aborted"));
    });

    res.on("close", () => {
      if (res.writableEnded) {
        return;
      }

      destroyStream(upstreamRes, new Error("client_aborted"));
      destroyStream(upstreamReq, new Error("client_aborted"));
      finalize();
    });

    req.pipe(upstreamReq);
  });
}

module.exports = {
  buildBufferedUpstreamResponse,
  classifyUpstreamError,
  cloneHeaders,
  copyUpstreamHeaders,
  destroyStream,
  forwardToBackend,
  getUpstreamContext,
  handleBufferedProxyResponse,
  logProxyFailure,
  logProxyMiddlewareFailure,
  MAX_MIDDLEWARE_BODY_BYTES,
  resolveProxyMiddlewareResponse,
  sanitizeRequestHeaders,
  sendBadGatewayResponse,
  serializeError,
  shouldSkipErrorResponse,
  TECH_HEADER,
};
