const fs = require("fs");
const path = require("path");
const { normalizeDataFileName } = require("./data-files");
const { encodeMockId } = require("../admin/mock-ids");

const HANDLER_SUFFIX = ".handler.js";
const MIDDLEWARE_SUFFIX = ".middleware.js";
const ENDPOINT_SUFFIX = ".endpoint.json";
const RESPONSES_SUFFIX = ".responses";

// Cattura i riferimenti data('nome') / data("nome") / data(`nome`) con argomento stringa letterale.
// Gruppi: 1 = prefisso `data( `, 2 = virgoletta, 3 = nome, 4 = suffisso ` )`. Isolare il nome nel
// gruppo 3 permette di riscriverlo (F11) preservando virgolette e spaziatura. Le forme dinamiche
// (variabile, concatenazione, parametro) NON sono rilevabili: l'indice è un minimo garantito.
const DATA_REFERENCE_PATTERN = /(\bdata\s*\(\s*)(['"`])([^'"`]+)\2(\s*\))/g;

function toPosixRelativePath(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

// Nomi canonici (lowercase, senza .json) referenziati da un sorgente, normalizzati come fa data().
function extractDataReferences(source) {
  const names = new Set();
  DATA_REFERENCE_PATTERN.lastIndex = 0;
  let match;
  while ((match = DATA_REFERENCE_PATTERN.exec(source)) !== null) {
    const canonical = normalizeDataFileName(match[3]);
    if (canonical != null && canonical !== "") {
      names.add(canonical);
    }
  }
  return names;
}

// Riscrive nel sorgente i riferimenti letterali al file `fromCanonical` puntandoli a `toCanonical`,
// preservando virgolette e spaziatura (cambia solo il nome dentro le virgolette). Restituisce il
// nuovo sorgente e quante occorrenze ha toccato. I riferimenti dinamici restano invariati.
function rewriteDataReferences(source, fromCanonical, toCanonical) {
  let count = 0;
  const rewritten = source.replace(
    DATA_REFERENCE_PATTERN,
    (whole, prefix, quote, rawName, suffix) => {
      if (normalizeDataFileName(rawName) !== fromCanonical) {
        return whole;
      }
      count += 1;
      return `${prefix}${quote}${toCanonical}${quote}${suffix}`;
    }
  );
  return { source: rewritten, count };
}

// Cammina la cartella dei mock e produce i sorgenti handler/middleware con il loro tipo.
function* walkScriptSources(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkScriptSources(full);
    } else if (entry.name.endsWith(HANDLER_SUFFIX)) {
      yield { sourcePath: full, type: "handler" };
    } else if (entry.name.endsWith(MIDDLEWARE_SUFFIX)) {
      yield { sourcePath: full, type: "middleware" };
    }
  }
}

// Da un sorgente (.../folder/METHOD.responses/NNN.handler.js) risale all'endpoint
// (.../folder/METHOD.endpoint.json), leggendone method e path e calcolandone l'id admin.
// Restituisce null se la struttura non è quella attesa o l'endpoint non è leggibile.
function resolveEndpointOfSource(mocksDir, sourcePath) {
  const responsesDir = path.dirname(sourcePath);
  const responsesName = path.basename(responsesDir);
  if (!responsesName.endsWith(RESPONSES_SUFFIX)) {
    return null;
  }

  const method = responsesName.slice(0, -RESPONSES_SUFFIX.length);
  const endpointPath = path.join(path.dirname(responsesDir), `${method}${ENDPOINT_SUFFIX}`);

  let endpoint;
  try {
    endpoint = JSON.parse(fs.readFileSync(endpointPath, "utf8"));
  } catch {
    return null;
  }

  return {
    id: encodeMockId(toPosixRelativePath(mocksDir, endpointPath)),
    method: endpoint.method,
    path: endpoint.path,
  };
}

/**
 * Indice inverso dei file dati: nome canonico → elenco degli endpoint (handler/middleware) che lo
 * referenziano con data('nome'). Best-effort sul riferimento letterale (vedi DATA_REFERENCE_PATTERN):
 * un file può risultare senza riferimenti pur essendo usato in modo dinamico.
 */
function buildDataFileUsageIndex(mocksDir) {
  const index = new Map();
  if (mocksDir == null) {
    return index;
  }

  for (const { sourcePath, type } of walkScriptSources(mocksDir)) {
    let source;
    try {
      source = fs.readFileSync(sourcePath, "utf8");
    } catch {
      continue;
    }

    const names = extractDataReferences(source);
    if (names.size === 0) {
      continue;
    }

    const endpoint = resolveEndpointOfSource(mocksDir, sourcePath);
    if (endpoint == null) {
      continue;
    }

    for (const name of names) {
      if (!index.has(name)) {
        index.set(name, []);
      }
      const list = index.get(name);
      // Un endpoint con più response che referenziano lo stesso file compare una volta sola.
      if (!list.some((entry) => entry.id === endpoint.id && entry.type === type)) {
        list.push({ id: endpoint.id, method: endpoint.method, path: endpoint.path, type });
      }
    }
  }

  return index;
}

// Raccoglie i sorgenti che referenziano `canonicalName`, con il contenuto e l'endpoint di
// appartenenza. Serve alla rinomina con riscrittura dei riferimenti (F11): il chiamante trasforma
// il contenuto e lo riscrive. Restituisce [] se mocksDir è assente o nessun sorgente lo referenzia.
function collectReferencingSources(mocksDir, canonicalName) {
  const results = [];
  if (mocksDir == null || canonicalName == null) {
    return results;
  }

  for (const { sourcePath, type } of walkScriptSources(mocksDir)) {
    let source;
    try {
      source = fs.readFileSync(sourcePath, "utf8");
    } catch {
      continue;
    }

    if (!extractDataReferences(source).has(canonicalName)) {
      continue;
    }

    const endpoint = resolveEndpointOfSource(mocksDir, sourcePath);
    if (endpoint == null) {
      continue;
    }

    results.push({ sourcePath, source, endpoint, type });
  }

  return results;
}

module.exports = {
  buildDataFileUsageIndex,
  collectReferencingSources,
  extractDataReferences,
  rewriteDataReferences,
};
