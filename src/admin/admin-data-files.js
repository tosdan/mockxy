const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("../utils/fs-atomic");
const { DATA_FILE_EXTENSION, normalizeDataFileName, listDataFileNames } = require("../mocks/data-files");
const {
  buildDataFileUsageIndex,
  collectReferencingSources,
  rewriteDataReferences,
} = require("../mocks/data-file-usage");
const { createAdminError } = require("./admin-errors");
const { commitWithRollback, readBackup, validateReloadedEndpoints } = require("./admin-fs");
const { resolveAdminFilePath } = require("./mock-ids");

// Risolve un nome richiesto dall'API nel nome canonico (lowercase, senza estensione) o fallisce
// con un 400 esplicito. La normalizzazione è la stessa dell'accessor data(): l'API accetta
// maiuscole e suffisso .json di troppo, ma sul disco esiste solo la forma canonica.
function requireCanonicalName(name, label = "name") {
  const normalized = normalizeDataFileName(name);
  if (normalized == null || normalized === "") {
    throw createAdminError(
      400,
      `Invalid data file ${label}: allowed characters are lowercase letters, digits, '.', '_', '-' (uppercase input is normalized).`
    );
  }
  return normalized;
}

function requireFilesDir(filesDir) {
  if (filesDir == null) {
    throw createAdminError(500, "The data files folder is not configured (filesDir).");
  }
  return filesDir;
}

function dataFilePath(filesDir, canonicalName) {
  return path.resolve(filesDir, `${canonicalName}${DATA_FILE_EXTENSION}`);
}

// Metadati di un file dati esistente (nome canonico, dimensione, ultima modifica).
async function statDataFile(filesDir, canonicalName) {
  const stats = await fs.promises.stat(dataFilePath(filesDir, canonicalName));
  return {
    name: canonicalName,
    fileName: `${canonicalName}${DATA_FILE_EXTENSION}`,
    sizeBytes: stats.size,
    updatedAt: stats.mtime.toISOString(),
  };
}

// Elenco dei file dati con i metadati e, per ciascuno, gli endpoint che lo referenziano via data()
// (`usedBy`). L'indice inverso si ricava scandendo i sorgenti in mocksDir: è best-effort sui
// riferimenti letterali, quindi `usedBy` vuoto significa "nessun riferimento diretto trovato", non
// "sicuramente inutilizzato". Senza mocksDir l'elenco resta senza `usedBy`.
async function listAdminDataFiles(filesDir, mocksDir) {
  requireFilesDir(filesDir);
  const names = await listDataFileNames(filesDir);
  const usageIndex = buildDataFileUsageIndex(mocksDir);
  const items = await Promise.all(
    names.map(async (name) => ({
      ...(await statDataFile(filesDir, name)),
      usedBy: usageIndex.get(name) ?? [],
    }))
  );
  return { items };
}

async function readAdminDataFile(filesDir, name) {
  requireFilesDir(filesDir);
  const canonical = requireCanonicalName(name);

  let content;
  try {
    content = await fs.promises.readFile(dataFilePath(filesDir, canonical), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw createAdminError(404, `No data file named '${canonical}${DATA_FILE_EXTENSION}'.`);
    }
    throw error;
  }

  const meta = await statDataFile(filesDir, canonical);
  return { ...meta, content };
}

// Upload/replace: valida che i byte siano JSON prima di toccare il disco, poi scrive in modo
// atomico (temp + rename). La cartella nasce pigramente al primo upload. Restituisce anche
// `created` per distinguere 201 da 200 nella rotta.
async function putAdminDataFile(filesDir, name, bodyBuffer) {
  requireFilesDir(filesDir);
  const canonical = requireCanonicalName(name);

  if (!Buffer.isBuffer(bodyBuffer) || bodyBuffer.length === 0) {
    throw createAdminError(400, "The request body must contain the JSON file bytes.");
  }

  const text = bodyBuffer.toString("utf8");
  try {
    JSON.parse(text);
  } catch (error) {
    throw createAdminError(400, `The uploaded content is not valid JSON (${error.message}).`);
  }

  await fs.promises.mkdir(filesDir, { recursive: true });
  const filePath = dataFilePath(filesDir, canonical);
  const created = !fs.existsSync(filePath);
  await writeFileAtomic(filePath, text);

  return { detail: await statDataFile(filesDir, canonical), created };
}

// Calcola le riscritture dei riferimenti letterali data('vecchio') → data('nuovo') senza toccare
// il disco. Best-effort: i riferimenti dinamici restano invariati.
function planReferenceRewrites(mocksDir, fromCanonical, toCanonical) {
  const sources = collectReferencingSources(mocksDir, fromCanonical);
  const rewrites = [];
  for (const { sourcePath, source, endpoint } of sources) {
    const { source: nextSource, count } = rewriteDataReferences(source, fromCanonical, toCanonical);
    if (count > 0) {
      rewrites.push({ sourcePath, nextSource, count, endpoint });
    }
  }
  return {
    rewrites,
    referencesRewritten: rewrites.reduce((total, rewrite) => total + rewrite.count, 0),
    referencingEndpoints: sources.map(({ endpoint, type }) => ({ ...endpoint, type })),
  };
}

function isEndpointEnabled(endpointPath) {
  try {
    return JSON.parse(fs.readFileSync(endpointPath, "utf8")).enabled === true;
  } catch {
    return false;
  }
}

// Rinomina normalizzando a lowercase; il target già esistente è un conflitto (409). La rinomina
// nella sola forma (maiuscole → minuscole dello stesso nome canonico) è un no-op riuscito.
// Con { rewriteReferences: true } aggiorna anche le occorrenze data('vecchio') nei sorgenti degli
// handler/middleware (richiede mocksDir). File dati e sorgenti riscritti sono un solo gruppo:
// scritture, reload e verifica degli endpoint coinvolti; su errore tornano tutti com'erano.
async function renameAdminDataFile(filesDir, mocksDir, name, nextName, options = {}) {
  requireFilesDir(filesDir);
  const canonical = requireCanonicalName(name);
  const nextCanonical = requireCanonicalName(nextName, "target name");

  const sourcePath = dataFilePath(filesDir, canonical);
  if (!fs.existsSync(sourcePath)) {
    throw createAdminError(404, `No data file named '${canonical}${DATA_FILE_EXTENSION}'.`);
  }

  if (nextCanonical === canonical) {
    return { ...(await statDataFile(filesDir, canonical)), referencesRewritten: 0, referencingEndpoints: [] };
  }

  const targetPath = dataFilePath(filesDir, nextCanonical);
  if (fs.existsSync(targetPath)) {
    throw createAdminError(409, `A data file named '${nextCanonical}${DATA_FILE_EXTENSION}' already exists.`);
  }

  const plan = options.rewriteReferences
    ? planReferenceRewrites(mocksDir, canonical, nextCanonical)
    : { rewrites: [], referencesRewritten: 0, referencingEndpoints: [] };

  if (plan.rewrites.length === 0) {
    // Nessun sorgente da toccare: i file dati non si caricano col runtime, niente reload.
    await fs.promises.rename(sourcePath, targetPath);
  } else {
    const backups = [await readBackup(sourcePath), await readBackup(targetPath)];
    for (const { sourcePath: rewrittenPath } of plan.rewrites) {
      backups.push(await readBackup(rewrittenPath));
    }
    const endpointPaths = [...new Set(plan.rewrites.map(({ endpoint }) => resolveAdminFilePath(mocksDir, endpoint.id)))];

    await commitWithRollback({
      backups,
      reloadRuntime: options.reloadRuntime,
      rejectionLabel: "Data file rename rejected",
      commit: async () => {
        for (const { sourcePath: rewrittenPath, nextSource } of plan.rewrites) {
          await writeFileAtomic(rewrittenPath, nextSource);
        }
        await fs.promises.rename(sourcePath, targetPath);
      },
      // Gli handler riscritti devono ricaricarsi senza errori e restare serviti se abilitati.
      validateReloadResult: (reloadResult) =>
        validateReloadedEndpoints(reloadResult, {
          checked: endpointPaths,
          installed: endpointPaths.filter(isEndpointEnabled),
          baseDir: mocksDir,
        }),
    });
  }

  return {
    ...(await statDataFile(filesDir, nextCanonical)),
    referencesRewritten: plan.referencesRewritten,
    referencingEndpoints: plan.referencingEndpoints,
  };
}

async function deleteAdminDataFile(filesDir, name) {
  requireFilesDir(filesDir);
  const canonical = requireCanonicalName(name);

  try {
    await fs.promises.unlink(dataFilePath(filesDir, canonical));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw createAdminError(404, `No data file named '${canonical}${DATA_FILE_EXTENSION}'.`);
    }
    throw error;
  }
}

module.exports = {
  listAdminDataFiles,
  readAdminDataFile,
  putAdminDataFile,
  renameAdminDataFile,
  deleteAdminDataFile,
};
