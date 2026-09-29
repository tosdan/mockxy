const { createAdminError } = require("../admin/admin-errors");

// Lettura interrogabile del Monitor (piano agent/API, §13 C5). La vista storica di
// GET /monitoring/requests senza query ({items}, più recente prima) e lo stream SSE restano come
// sono; questa modalità si chiede con `view=page` e restituisce pagine in ordine crescente con un
// cursore che dichiara runtime, generazione e perdita (`gap`). Il Monitor resta un buffer in
// memoria: per la cattura durevole esiste il dump.

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 250;
const PAGE_PARAMETERS = new Set(["view", "limit", "fields", "method", "path", "status", "source", "since", "runtimeId", "generation"]);
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// Il sommario non porta body né header: identità, esito e diagnostica essenziale della voce.
const SUMMARY_FIELDS = ["id", "timestamp", "method", "path", "originalUrl", "status", "latencyMs", "source"];
const NULLABLE_SUMMARY_FIELDS = ["matchedRoutePath", "sequenceStep", "sharedStateError"];

function invalidQuery(parameter, message) {
  return createAdminError(400, message, { code: "INVALID_QUERY", parameter });
}

// Un parametro ripetuto arriva come array: è ambiguo e va rifiutato, non ridotto al primo valore.
function single(query, name) {
  const value = query[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw invalidQuery(name, `${name} must be given once, as a plain value.`);
  }
  return value;
}

function parseBoundedInteger(query, name, min, max) {
  const raw = single(query, name);
  if (raw === undefined) {
    return undefined;
  }
  const value = DECIMAL.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw invalidQuery(name, `${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

/**
 * Valida la query di GET /monitoring/requests. Senza query la rotta resta la vista storica
 * (`null`); ogni parametro richiede `view=page`, e un parametro sconosciuto è un 400: prima veniva
 * ignorato in silenzio, e un filtro scritto male sembrava un Monitor vuoto.
 */
function parseMonitorPageQuery(query) {
  const names = Object.keys(query || {});
  if (names.length === 0) {
    return null;
  }
  const unknown = names.find((name) => !PAGE_PARAMETERS.has(name));
  if (unknown !== undefined) {
    throw invalidQuery(unknown, `Unknown query parameter: ${unknown}.`);
  }
  if (single(query, "view") !== "page") {
    throw invalidQuery("view", "Query parameters require view=page.");
  }

  const limit = parseBoundedInteger(query, "limit", 1, MAX_PAGE_LIMIT) ?? DEFAULT_PAGE_LIMIT;

  const fields = single(query, "fields") ?? "summary";
  if (fields !== "summary" && fields !== "full") {
    throw invalidQuery("fields", "fields must be summary or full.");
  }

  const filters = {};
  const method = single(query, "method");
  if (method !== undefined) {
    // Un token HTTP (RFC 9110): il Monitor registra qualunque metodo accettato dal server, anche
    // M-SEARCH o PROPFIND, non soltanto quelli che un mock può dichiarare.
    if (!HTTP_TOKEN.test(method)) {
      throw invalidQuery("method", "method must be an HTTP method token.");
    }
    filters.method = method.toUpperCase();
  }
  const requestPath = single(query, "path");
  if (requestPath !== undefined) {
    if (!requestPath.startsWith("/") || requestPath.includes("?")) {
      throw invalidQuery("path", "path must start with / and carry no query string.");
    }
    filters.path = requestPath;
  }
  const status = parseBoundedInteger(query, "status", 100, 599);
  if (status !== undefined) {
    filters.status = status;
  }
  const source = single(query, "source");
  if (source !== undefined) {
    if (source === "") {
      throw invalidQuery("source", "source must not be empty.");
    }
    filters.source = source;
  }

  const rawSince = single(query, "since");
  let since = null;
  if (rawSince === "latest") {
    since = "latest";
  } else if (rawSince !== undefined) {
    const value = DECIMAL.test(rawSince) ? Number(rawSince) : NaN;
    if (!Number.isSafeInteger(value)) {
      throw invalidQuery("since", "since must be a non-negative decimal id or latest.");
    }
    since = value;
  }

  const runtimeId = single(query, "runtimeId");
  const generation = parseBoundedInteger(query, "generation", 1, Number.MAX_SAFE_INTEGER);
  if (typeof since === "number") {
    if (runtimeId === undefined || runtimeId === "") {
      throw invalidQuery("runtimeId", "runtimeId is required with a numeric since.");
    }
    if (generation === undefined) {
      throw invalidQuery("generation", "generation is required with a numeric since.");
    }
  } else if (runtimeId !== undefined || generation !== undefined) {
    const parameter = runtimeId !== undefined ? "runtimeId" : "generation";
    throw invalidQuery(parameter, `${parameter} is only allowed with a numeric since.`);
  }

  return { limit, fields, filters, since, runtimeId, generation };
}

function matchesFilters(entry, filters) {
  return (filters.method === undefined || entry.method === filters.method)
    && (filters.path === undefined || entry.path === filters.path)
    && (filters.status === undefined || entry.status === filters.status)
    && (filters.source === undefined || entry.source === filters.source);
}

function summarizeEntry(entry) {
  const summary = {};
  for (const field of SUMMARY_FIELDS) {
    summary[field] = entry[field];
  }
  for (const field of NULLABLE_SUMMARY_FIELDS) {
    summary[field] = entry[field] ?? null;
  }
  return summary;
}

/**
 * Una pagina del Monitor da uno snapshot del buffer (`store.snapshot()`: voci in ordine crescente,
 * generazione e ultimo ID assegnato H). Fino a `limit` corrispondenze successive al cursore; se ne
 * restano altre nello snapshot `hasMore` e il cursore è l'ultimo ID restituito, altrimenti H, anche
 * senza corrispondenze: il traffico successivo appartiene alla pagina seguente. Con un cursore di
 * un altro runtime, di un'altra generazione (clear) o già espulso la risposta dichiara il gap e
 * riparte dal primo elemento disponibile: "nessun elemento" non significa "nessuna richiesta".
 */
function readMonitorPage(store, runtimeId, request) {
  const { entries, generation, highWatermark } = store.snapshot();
  const oldest = entries.length > 0 ? Number(entries[0].id) : null;
  const newest = entries.length > 0 ? Number(entries[entries.length - 1].id) : null;

  let after = null;
  let gapReason = null;
  if (request.since === "latest") {
    after = highWatermark;
  } else if (typeof request.since === "number") {
    if (request.runtimeId !== runtimeId) {
      gapReason = "runtime_changed";
    } else if (request.generation !== generation) {
      gapReason = "cleared";
    } else if (request.since > highWatermark) {
      throw createAdminError(400, "since is ahead of the last id assigned in this runtime and generation.", {
        code: "CURSOR_AHEAD",
        since: String(request.since),
        highWatermark: String(highWatermark),
      });
    } else if (oldest != null ? request.since < oldest - 1 : request.since < highWatermark) {
      // Gli ID sono contigui: fra il cursore e il primo disponibile qualcosa è stato espulso. Il
      // gap è conservativo, anche quando le voci perse non corrispondevano al filtro.
      gapReason = "evicted";
    } else {
      after = request.since;
    }
  }

  const matches = [];
  let hasMore = false;
  if (request.since !== "latest") {
    for (const entry of entries) {
      if (after != null && Number(entry.id) <= after) continue;
      if (!matchesFilters(entry, request.filters)) continue;
      if (matches.length === request.limit) {
        hasMore = true;
        break;
      }
      matches.push(entry);
    }
  }

  return {
    items: matches.map((entry) => (request.fields === "full" ? entry : summarizeEntry(entry))),
    cursor: {
      runtimeId,
      generation,
      since: String(hasMore ? matches[matches.length - 1].id : highWatermark),
    },
    hasMore,
    gap: gapReason != null,
    gapReason,
    available: {
      oldestId: oldest == null ? null : String(oldest),
      newestId: newest == null ? null : String(newest),
      highWatermark: String(highWatermark),
    },
  };
}

/**
 * Una voce per ID (GET /monitoring/requests/:id): richiede il runtime a cui l'ID appartiene, perché
 * gli ID ripartono a ogni avvio. 409 RUNTIME_CHANGED se il runtime è un altro, 404
 * REQUEST_NOT_AVAILABLE se la voce è stata espulsa, cancellata o non è mai esistita.
 */
function readMonitorEntry(store, runtimeId, id, query) {
  const names = Object.keys(query || {});
  const unknown = names.find((name) => name !== "runtimeId");
  if (unknown !== undefined) {
    throw invalidQuery(unknown, `Unknown query parameter: ${unknown}.`);
  }
  const requestedRuntime = single(query, "runtimeId");
  if (requestedRuntime === undefined || requestedRuntime === "") {
    throw invalidQuery("runtimeId", "runtimeId is required.");
  }
  if (!DECIMAL.test(id) || !Number.isSafeInteger(Number(id))) {
    throw createAdminError(400, "The request id must be a decimal id.", { code: "INVALID_QUERY", parameter: "id" });
  }
  if (requestedRuntime !== runtimeId) {
    throw createAdminError(409, "The runtime restarted: this request id belongs to another runtime.", {
      code: "RUNTIME_CHANGED",
      runtimeId,
    });
  }
  const item = store.getEntry(id);
  if (item == null) {
    throw createAdminError(404, "The request is no longer available: evicted, cleared or never recorded.", {
      code: "REQUEST_NOT_AVAILABLE",
      id,
    });
  }
  return { runtimeId, item };
}

module.exports = {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  parseMonitorPageQuery,
  readMonitorEntry,
  readMonitorPage,
};
