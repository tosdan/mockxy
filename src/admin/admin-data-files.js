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

// Rinomina normalizzando a lowercase; il target già esistente è un conflitto (409). La rinomina
// Riscrive i riferimenti letterali data('from') → data('to') nei sorgenti che li contengono, in modo
// atomico e con rollback: se una scrittura fallisce, ripristina i sorgenti già toccati e rilancia,
// così l'operazione o riesce del tutto o non lascia sorgenti a metà. Restituisce quante occorrenze
// ha riscritto e quali endpoint ha toccato. Best-effort: i riferimenti dinamici restano invariati.
async function rewriteReferencesForRename(mocksDir, fromCanonical, toCanonical) {
  const sources = collectReferencingSources(mocksDir, fromCanonical);
  const written = [];

  try {
    for (const { sourcePath, source } of sources) {
      const { source: nextSource, count } = rewriteDataReferences(source, fromCanonical, toCanonical);
      if (count === 0) {
        continue;
      }
      await writeFileAtomic(sourcePath, nextSource);
      written.push({ sourcePath, original: source, count });
    }
  } catch (error) {
    // Ripristina i sorgenti già riscritti prima di propagare l'errore (nessuno stato a metà).
    for (const { sourcePath, original } of written) {
      try {
        await writeFileAtomic(sourcePath, original);
      } catch {
        /* rollback best-effort: un fallimento qui non deve mascherare l'errore originale */
      }
    }
    throw error;
  }

  const referencesRewritten = written.reduce((total, entry) => total + entry.count, 0);
  const referencingEndpoints = sources.map(({ endpoint, type }) => ({ ...endpoint, type }));
  return { referencesRewritten, referencingEndpoints, rollback: written };
}

// Rinomina normalizzando a lowercase; il target già esistente è un conflitto (409). La rinomina
// nella sola forma (maiuscole → minuscole dello stesso nome canonico) è un no-op riuscito.
// Con { rewriteReferences: true } aggiorna anche le occorrenze data('vecchio') nei sorgenti degli
// handler/middleware (richiede mocksDir): prima riscrive i sorgenti (atomico, con rollback), poi
// rinomina il file; se la rinomina fallisce dopo la riscrittura, ripristina i sorgenti.
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

  const rewrite = options.rewriteReferences
    ? await rewriteReferencesForRename(mocksDir, canonical, nextCanonical)
    : { referencesRewritten: 0, referencingEndpoints: [], rollback: [] };

  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (error) {
    // La rinomina del file è fallita dopo la riscrittura dei sorgenti: ripristina i sorgenti.
    for (const { sourcePath: rewrittenPath, original } of rewrite.rollback) {
      try {
        await writeFileAtomic(rewrittenPath, original);
      } catch {
        /* rollback best-effort */
      }
    }
    throw error;
  }

  return {
    ...(await statDataFile(filesDir, nextCanonical)),
    referencesRewritten: rewrite.referencesRewritten,
    referencingEndpoints: rewrite.referencingEndpoints,
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
