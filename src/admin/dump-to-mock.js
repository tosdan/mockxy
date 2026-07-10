const { readDumpFileEntries, readDumpEntriesByKeys } = require("../monitoring/monitor-dump-reader");
const { createAdminError } = require("./admin-errors");
const { runReload } = require("./admin-fs");
const { createAdminMock } = require("./endpoint-operations");

// Creazione massiva di mock a partire dalle entry di un dump del monitor.

const DUMP_SKELETON_DESCRIPTION = "[da completare] body non catturato (binario/oltre 156KB)";
const DUMP_UNSAFE_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "date",
]);

// Header della response da copiare nel mock (es. content-type), saltando i calcolati dal server e i mascherati.
function dumpSafeResponseHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (DUMP_UNSAFE_RESPONSE_HEADERS.has(String(name).toLowerCase())) {
      continue;
    }
    const flat = Array.isArray(value) ? value.join(", ") : String(value);
    if (flat === "" || flat === "***") {
      continue;
    }
    out[name] = flat;
  }
  return out;
}

// Motivo per cui il body catturato non è ricostruibile (→ skeleton), o null se è utilizzabile.
function dumpBodyIssue(entry) {
  if (entry.responseBodyTruncated) {
    return "truncated";
  }
  if (/^\[(binary|compressed) payload:/.test(entry.responseBody || "")) {
    return "binary";
  }
  return null;
}

function dumpParseBody(value) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Mappa una entry del dump a un payload createMock (gemello di buildMockRequest del frontend).
function buildMockPayloadFromDumpEntry(entry) {
  const routePath =
    entry.matchedRoutePath && entry.matchedRoutePath !== "n/d" ? entry.matchedRoutePath : entry.path;
  const skeleton = dumpBodyIssue(entry) != null;
  const config = {
    method: String(entry.method || "").toUpperCase(),
    path: routePath,
    status: entry.status,
    disabled: false,
    headers: dumpSafeResponseHeaders(entry.responseHeaders),
    bodyFile: "001.response.json",
    delayMs: 0,
  };
  const payload = { config, body: skeleton ? {} : dumpParseBody(entry.responseBody) };
  if (skeleton) {
    payload.description = DUMP_SKELETON_DESCRIPTION;
  }
  return { payload, skeleton };
}

/**
 * Crea mock in massa dalle entry di un dump, guidata dalla selezione del frontend:
 * `selection.file` (tutto il file) oppure `selection.keys` (insieme di chiavi `file#riga`).
 * Salta gli endpoint già esistenti (409); per body binari/troncati crea uno skeleton (body vuoto,
 * descrizione "da completare"). Un solo reload finale. Ritorna i conteggi.
 */
async function createMocksFromDump(mocksDir, dumpDir, selection, reloadRuntime) {
  let entries;
  if (selection && typeof selection.file === "string") {
    entries = await readDumpFileEntries(dumpDir, selection.file);
  } else if (selection && Array.isArray(selection.keys)) {
    entries = await readDumpEntriesByKeys(dumpDir, selection.keys);
  } else {
    throw createAdminError(400, "selection must provide a 'file' or 'keys'.");
  }

  const noReload = async () => {};
  const counts = { created: 0, createdEmpty: 0, skippedExisting: 0, failed: 0 };

  for (const entry of entries) {
    const { payload, skeleton } = buildMockPayloadFromDumpEntry(entry);
    try {
      // La descrizione "[da completare]" dello skeleton è ora impostata in fase di create
      // (payload.description → buildEndpointFilePayload), senza più un update separato.
      await createAdminMock(mocksDir, payload, noReload);
      counts[skeleton ? "createdEmpty" : "created"] += 1;
    } catch (error) {
      if (error && error.status === 409) {
        counts.skippedExisting += 1;
      } else {
        counts.failed += 1;
      }
    }
  }

  await runReload(reloadRuntime);
  return counts;
}

module.exports = {
  createMocksFromDump,
};
