const { finalizeBatch } = require("./admin-fs");
const { createAdminError } = require("./admin-errors");
const { resolveAdminFilePath } = require("./mock-ids");
const { listAdminMocks } = require("./mock-catalog");
const { createAdminMock, createAdminResponse } = require("./endpoint-operations");
const { TECH_HEADER } = require("../proxy/proxy");

// Creazione di mock dal traffico catturato (piano agent/API, §10 S7 e §13 C7): una sola
// trasformazione, usata dal Monitor e dallo Storico, e un solo motore del batch.

// Marcatore letterale condiviso con la GUI: la ricerca "[da completare]" nel catalogo trova ogni
// bozza incompleta, in qualunque lingua dell'interfaccia.
const INCOMPLETE_MARKER = "[da completare]";
const INCOMPLETE_DESCRIPTION = `${INCOMPLETE_MARKER} body non catturato (binario/oltre 156KB)`;

// Header che il server calcola o che descrivono il trasporto del body originale: nel mock
// sarebbero incompatibili col body ricostruito. Più l'header tecnico con cui Mockxy dichiara chi
// ha risposto (`x-mock-source`): catturato da una risposta del backend direbbe "backend" anche nel
// mock, e il serving lo sostituisce comunque con il proprio.
const EXCLUDED_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "date",
  TECH_HEADER,
]);

const CONFLICT_STRATEGIES = new Set(["skip", "add-variant"]);

// Header della risposta da copiare nel mock: esclusi quelli di trasporto e i valori vuoti o
// mascherati (`***`: un valore mascherato non si ripristina). I valori multipli si filtrano uno
// per uno, poi si uniscono con ", ": due cookie mascherati non diventano "***, ***".
function captureResponseHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (EXCLUDED_RESPONSE_HEADERS.has(String(name).toLowerCase())) {
      continue;
    }
    const values = (Array.isArray(value) ? value : [value]).map(String).filter((item) => item !== "" && item !== "***");
    if (values.length === 0) {
      continue;
    }
    out[name] = values.join(", ");
  }
  return out;
}

// Perché il body catturato non si può ricostruire fedelmente, o null se si può.
function captureBodyIssue(entry) {
  if (entry.responseBodyTruncated) {
    return "truncated";
  }
  if (/^\[(binary|compressed) payload:/.test(entry.responseBody || "")) {
    return "binary";
  }
  return null;
}

// Body vuoto → oggetto vuoto; JSON valido → valore; altro testo → stringa.
function parseCapturedBody(value) {
  if (value == null || value === "") {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * La risposta catturata come mock: percorso della rotta che l'ha servita (`matchedRoutePath`, se
 * presente e diverso da `n/d`) altrimenti il path richiesto, metodo maiuscolo, stesso status,
 * nessun ritardo. Un body troncato o non testuale non si spaccia per fedele: diventa un oggetto
 * vuoto e la bozza è marcata incompleta. Nessuna inferenza di route parametriche.
 */
function buildMockFromCapture(entry) {
  const issue = captureBodyIssue(entry);
  return {
    method: String(entry.method || "").toUpperCase(),
    path: entry.matchedRoutePath && entry.matchedRoutePath !== "n/d" ? entry.matchedRoutePath : entry.path,
    status: entry.status,
    headers: captureResponseHeaders(entry.responseHeaders),
    delayMs: 0,
    body: issue == null ? parseCapturedBody(entry.responseBody) : {},
    incomplete: issue != null,
    issue,
  };
}

// Titolo di una variante aggiunta a un endpoint esistente: provenienza e ora di cattura (UTC),
// parole uguali in italiano e in inglese; il marcatore se la cattura è incompleta.
function variantTitle(entry, source, incomplete) {
  const time = typeof entry.timestamp === "string" ? entry.timestamp.slice(11, 19) : "";
  return `${incomplete ? `${INCOMPLETE_MARKER} ` : ""}${source}${time ? ` · ${time}` : ""}`;
}

// Opzioni del batch: `onConflict` e `newEndpointEnabled` sono obbligatorie nella rotta del
// Monitor (nessuna attivazione implicita); lo Storico passa i suoi default storici. Un default
// vale solo per il campo omesso: un valore presente, `null` compreso, deve avere il tipo giusto.
function parseBatchOptions(body, defaults = {}) {
  const option = (name, fallback) => (body != null && Object.prototype.hasOwnProperty.call(body, name) ? body[name] : fallback);
  const onConflict = option("onConflict", defaults.onConflict);
  if (!CONFLICT_STRATEGIES.has(onConflict)) {
    throw createAdminError(400, "onConflict must be \"skip\" or \"add-variant\".");
  }
  const selectAddedVariants = option("selectAddedVariants", defaults.selectAddedVariants ?? false);
  if (typeof selectAddedVariants !== "boolean") {
    throw createAdminError(400, "selectAddedVariants must be a boolean.");
  }
  const newEndpointEnabled = option("newEndpointEnabled", defaults.newEndpointEnabled);
  if (typeof newEndpointEnabled !== "boolean") {
    throw createAdminError(400, "newEndpointEnabled must be a boolean: state whether new endpoints are served.");
  }
  return { onConflict, selectAddedVariants, newEndpointEnabled };
}

// Più elementi dello stesso batch possono selezionare una variante sullo stesso endpoint: resta
// servita solo l'ultima. Le selezioni precedenti non si dichiarano applicate: niente verifica sul
// runtime e l'avviso SUPERSEDED con la variante che le ha sostituite.
function markSupersededSelections(items) {
  const lastSelection = new Map();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.selects !== true) continue;
    const later = lastSelection.get(item.id);
    if (later == null) {
      lastSelection.set(item.id, item.responseFile);
      continue;
    }
    delete item.endpointPath;
    delete item.expectServing;
    item.runtimeOutcome = "not_applicable";
    item.warnings = [...item.warnings, { code: "SUPERSEDED", by: later }];
  }
  for (const item of items) delete item.selects;
}

function identityKey(method, routePath) {
  return `${method} ${routePath}`;
}

// Destinazioni già nel catalogo per metodo e percorso esatti, con lo stato di abilitazione.
async function readDestinations(mocksDir) {
  const destinations = new Map();
  for (const item of await listAdminMocks(mocksDir)) {
    const key = identityKey(item.method, item.path);
    if (!destinations.has(key)) destinations.set(key, []);
    destinations.get(key).push({ id: item.id, enabled: item.disabled !== true });
  }
  return destinations;
}

/**
 * Crea mock dalle catture, nell'ordine dato. Ogni elemento è `{ ref, entry }`: `ref` identifica
 * la cattura nella risposta (`requestId` per il Monitor, `key` per lo Storico), `entry` è la voce
 * catturata o null se non è più disponibile. Il conflitto è sull'identità metodo/percorso della
 * destinazione, catalogo ed elementi precedenti del batch compresi: `skip` lo salta,
 * `add-variant` aggiunge una variante (selezionata solo con `selectAddedVariants`) conservando
 * l'abilitazione. Più destinazioni equivalenti sono un errore dell'elemento, non una scelta. Un
 * nuovo endpoint nasce con la variante selezionata e abilitato solo con `newEndpointEnabled`. Un
 * solo reload finale; un ripristino fallito ferma il batch, come negli altri batch (§13 C1).
 */
async function createMocksFromCaptures({ mocksDir, captures, options, source, reloadRuntime, scenarioStates, rejectionLabel }) {
  const destinations = await readDestinations(mocksDir);
  const noReload = async () => {};
  const items = [];
  let interruption = null;
  let processed = 0;

  for (const { ref, entry } of captures) {
    if (interruption != null) {
      break;
    }
    processed += 1;
    if (entry == null) {
      items.push({
        ...ref,
        method: null,
        path: null,
        id: null,
        responseFile: null,
        writeOutcome: "skipped",
        runtimeOutcome: "not_applicable",
        captureOutcome: "unavailable",
        warnings: [],
        error: null,
      });
      continue;
    }

    const mock = buildMockFromCapture(entry);
    const base = {
      ...ref,
      method: mock.method,
      path: mock.path,
      captureOutcome: mock.incomplete ? "incomplete" : "complete",
      warnings: mock.incomplete ? [{ code: "INCOMPLETE_CAPTURE", reason: mock.issue }] : [],
    };
    const key = identityKey(mock.method, mock.path);
    const found = destinations.get(key) || [];

    try {
      if (found.length > 1) {
        items.push({
          ...base,
          id: null,
          responseFile: null,
          candidates: found.map((destination) => destination.id),
          writeOutcome: "failed",
          runtimeOutcome: "not_applicable",
          error: `${found.length} endpoints declare ${mock.method} ${mock.path}: the destination is ambiguous.`,
        });
        continue;
      }

      if (found.length === 1) {
        const [destination] = found;
        if (options.onConflict === "skip") {
          items.push({ ...base, id: destination.id, responseFile: null, writeOutcome: "skipped", runtimeOutcome: "not_applicable", error: null });
          continue;
        }
        const created = await createAdminResponse(mocksDir, destination.id, {
          type: "mock",
          title: variantTitle(entry, source, mock.incomplete),
          status: mock.status,
          headers: mock.headers,
          delayMs: mock.delayMs,
          body: mock.body,
          // Una variante nuova parte dalla selezionata: senza questo erediterebbe il templating.
          templated: false,
          select: options.selectAddedVariants,
        }, noReload, scenarioStates);
        const served = options.selectAddedVariants && destination.enabled;
        items.push({
          ...base,
          id: destination.id,
          responseFile: created.createdResponseFile,
          writeOutcome: "variant_added",
          runtimeOutcome: served ? "not_applied" : "not_applicable",
          error: null,
          selects: options.selectAddedVariants,
          ...(served ? { endpointPath: resolveAdminFilePath(mocksDir, destination.id), expectServing: true } : {}),
        });
        continue;
      }

      const detail = await createAdminMock(mocksDir, {
        config: {
          method: mock.method,
          path: mock.path,
          status: mock.status,
          disabled: !options.newEndpointEnabled,
          headers: mock.headers,
          bodyFile: "001.response.json",
          delayMs: mock.delayMs,
        },
        body: mock.body,
        ...(mock.incomplete ? { description: INCOMPLETE_DESCRIPTION } : {}),
      }, noReload);
      destinations.set(key, [{ id: detail.id, enabled: options.newEndpointEnabled }]);
      items.push({
        ...base,
        id: detail.id,
        responseFile: "001.response.json",
        writeOutcome: "created",
        runtimeOutcome: options.newEndpointEnabled ? "not_applied" : "not_applicable",
        error: null,
        selects: true,
        ...(options.newEndpointEnabled ? { endpointPath: resolveAdminFilePath(mocksDir, detail.id), expectServing: true } : {}),
      });
    } catch (error) {
      // Un file endpoint nella cartella derivata dal percorso che non dichiara questa identità
      // (il catalogo non lo elenca come tale) non è una destinazione: l'elemento fallisce.
      const collision = error?.status === 409 && error.details?.existingMockId != null;
      items.push({
        ...base,
        id: collision ? error.details.existingMockId : null,
        responseFile: null,
        writeOutcome: "failed",
        runtimeOutcome: "not_applicable",
        error: collision
          ? `An endpoint file already exists in the folder derived from ${mock.path}, but it does not serve ${mock.method} ${mock.path}.`
          : error.message,
      });
      if (error?.details?.code === "ROLLBACK_FAILED") {
        interruption = error;
      }
    }
  }

  markSupersededSelections(items);
  return finalizeBatch({
    reloadRuntime,
    mocksDir,
    rejectionLabel,
    interruption,
    processed,
    total: captures.length,
    result: { items },
  });
}

// Riepilogo degli esiti per elemento del batch del Monitor.
function countCaptureOutcomes(items) {
  const counts = { created: 0, addedVariants: 0, skipped: 0, unavailable: 0, failed: 0, incomplete: 0 };
  for (const item of items || []) {
    if (item.captureOutcome === "unavailable") counts.unavailable += 1;
    else if (item.writeOutcome === "created") counts.created += 1;
    else if (item.writeOutcome === "variant_added") counts.addedVariants += 1;
    else if (item.writeOutcome === "skipped") counts.skipped += 1;
    else if (item.writeOutcome === "failed") counts.failed += 1;
    if (item.captureOutcome === "incomplete" && (item.writeOutcome === "created" || item.writeOutcome === "variant_added")) {
      counts.incomplete += 1;
    }
  }
  return counts;
}

// Batch del Monitor: la risposta porta il runtime delle voci e i conteggi, e un risultato parziale
// in details.result (BATCH_RUNTIME_FAILED, ROLLBACK_FAILED) ha la stessa forma della 201.
async function createMocksFromMonitor({ runtimeId, ...params }) {
  const withCounts = (result) => ({ runtimeId, counts: countCaptureOutcomes(result.items), ...result });
  try {
    return withCounts(await createMocksFromCaptures({ ...params, source: "monitor" }));
  } catch (error) {
    if (error?.details?.result != null) {
      error.details.result = withCounts(error.details.result);
    }
    throw error;
  }
}

module.exports = {
  EXCLUDED_RESPONSE_HEADERS,
  INCOMPLETE_DESCRIPTION,
  INCOMPLETE_MARKER,
  buildMockFromCapture,
  captureResponseHeaders,
  countCaptureOutcomes,
  createMocksFromCaptures,
  createMocksFromMonitor,
  parseBatchOptions,
};
