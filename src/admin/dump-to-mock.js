const { readDumpFileEntries, readDumpEntriesByKeys } = require("../monitoring/monitor-dump-reader");
const { createAdminError } = require("./admin-errors");
const { createMocksFromCaptures, parseBatchOptions } = require("./capture-to-mock");

// Creazione massiva di mock dalle entry di un dump del monitor. Trasformazione, conflitto ed esiti
// per elemento sono quelli del Monitor (§13 C7); input e conteggi restano quelli storici.

// Senza opzioni la rotta si comporta come prima: endpoint esistenti saltati, nuovi endpoint attivi.
const LEGACY_OPTIONS = { onConflict: "skip", selectAddedVariants: false, newEndpointEnabled: true };

// Conteggi storici (creazioni su disco), più le varianti aggiunte.
function legacyCounts(items) {
  const counts = { created: 0, createdEmpty: 0, skippedExisting: 0, failed: 0, addedVariants: 0 };
  for (const item of items || []) {
    if (item.writeOutcome === "created") {
      counts[item.captureOutcome === "incomplete" ? "createdEmpty" : "created"] += 1;
    } else if (item.writeOutcome === "variant_added") {
      counts.addedVariants += 1;
    } else if (item.writeOutcome === "skipped" && item.captureOutcome !== "unavailable") {
      counts.skippedExisting += 1;
    } else if (item.writeOutcome === "failed") {
      counts.failed += 1;
    }
  }
  return counts;
}

/**
 * Crea mock dalle entry di un dump: `file` (tutto il file, nel suo ordine) oppure `keys` (chiavi
 * `file#riga`, nell'ordine dato; una chiave non più leggibile è una cattura non disponibile).
 * Accetta le stesse opzioni del Monitor, con i default storici.
 */
async function createMocksFromDump(mocksDir, dumpDir, body, reloadRuntime, scenarioStates) {
  const options = parseBatchOptions(body, LEGACY_OPTIONS);
  let captures;
  if (body && typeof body.file === "string") {
    const entries = await readDumpFileEntries(dumpDir, body.file);
    captures = entries.map((entry) => ({ ref: { key: entry.dumpKey ?? null }, entry }));
  } else if (body && Array.isArray(body.keys)) {
    // Una chiave ripetuta è la stessa entry: si elabora una volta, come prima.
    const keys = [...new Set(body.keys)];
    const entries = await readDumpEntriesByKeys(dumpDir, keys);
    const byKey = new Map(entries.map((entry) => [entry.dumpKey, entry]));
    captures = keys.map((key) => ({ ref: { key: typeof key === "string" ? key : null }, entry: byKey.get(key) ?? null }));
  } else {
    throw createAdminError(400, "selection must provide a 'file' or 'keys'.");
  }

  try {
    const result = await createMocksFromCaptures({
      mocksDir,
      captures,
      options,
      source: "dump",
      reloadRuntime,
      scenarioStates,
      rejectionLabel: "Mock creation from dump",
    });
    return { ...legacyCounts(result.items), ...result };
  } catch (error) {
    // Anche il risultato parziale di un batch fallito conserva i conteggi storici.
    if (error?.details?.result != null) {
      error.details.result = { ...legacyCounts(error.details.result.items), ...error.details.result };
    }
    throw error;
  }
}

module.exports = {
  createMocksFromDump,
};
