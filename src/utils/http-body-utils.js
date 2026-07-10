// Valid HTTP response status: an integer in the standard 100-599 range. Single source for every
// backend validation site; the UI keeps its own copy (status-combobox.ts, different bundle) —
// keep the two aligned if the rule ever changes.
function isValidHttpStatus(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599;
}

// Clones headers into a mutable plain object so local runtime code can mutate them safely.
function cloneHeaders(headers) {
  return { ...(headers || {}) };
}

// Reads a single header value ignoring the original casing.
function getHeaderValue(headers, headerName) {
  const targetName = String(headerName).toLowerCase();

  for (const [currentHeaderName, value] of Object.entries(headers || {})) {
    if (currentHeaderName.toLowerCase() === targetName) {
      return value;
    }
  }

  return undefined;
}

// Removes a header regardless of the original casing used to store it.
function removeHeader(headers, headerName) {
  const targetName = String(headerName).toLowerCase();

  Object.keys(headers || {}).forEach((currentHeaderName) => {
    if (currentHeaderName.toLowerCase() === targetName) {
      delete headers[currentHeaderName];
    }
  });
}

// Drops response metadata that becomes stale when the response body is rebuilt locally.
function stripBodyDependentHeaders(headers) {
  removeHeader(headers, "content-length");
  removeHeader(headers, "content-encoding");
  removeHeader(headers, "transfer-encoding");
  removeHeader(headers, "etag");
}

// Returns true for content types that can be exposed as UTF-8 text.
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
    || normalizedContentType.includes("application/x-www-form-urlencoded")
    || normalizedContentType.includes("application/graphql");
}

// Returns true when a payload declares a JSON media type.
function isJsonContentType(headers) {
  const contentType = getHeaderValue(headers, "content-type");
  if (contentType == null) {
    return false;
  }

  const normalizedContentType = String(contentType).toLowerCase().split(";")[0].trim();
  return normalizedContentType === "application/json" || normalizedContentType.endsWith("+json");
}

// Buffers a readable stream and optionally rejects when the payload exceeds a configured limit.
function readStreamToBuffer(stream, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : Infinity;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
      stream.off("aborted", onAborted);
    };

    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk) => {
      const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += normalizedChunk.length;

      if (totalBytes > maxBytes) {
        const error = new Error(`Request body exceeds the configured limit of ${maxBytes} bytes.`);
        error.code = "BODY_TOO_LARGE";
        error.maxBytes = maxBytes;
        fail(error);
        return;
      }

      chunks.push(normalizedChunk);
    };

    const onEnd = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onError = (error) => {
      fail(error);
    };

    const onAborted = () => {
      const error = new Error("client_aborted");
      error.code = "CLIENT_ABORTED";
      fail(error);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    stream.on("aborted", onAborted);
  });
}

// Parses a buffered JSON body when the content type or payload shape allows it.
function parseJsonBody(bodyBuffer, headers) {
  if (!bodyBuffer || bodyBuffer.length === 0) {
    return undefined;
  }

  try {
    const decodedBody = bodyBuffer.toString("utf8");
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

// Exposes a buffered body as UTF-8 text only for formats that are safe to decode.
function readTextBody(bodyBuffer, headers) {
  if (!bodyBuffer || bodyBuffer.length === 0 || !isTextContentType(headers)) {
    return undefined;
  }

  return bodyBuffer.toString("utf8");
}

module.exports = {
  cloneHeaders,
  getHeaderValue,
  isJsonContentType,
  isTextContentType,
  isValidHttpStatus,
  parseJsonBody,
  readStreamToBuffer,
  readTextBody,
  removeHeader,
  stripBodyDependentHeaders,
};