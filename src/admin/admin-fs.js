const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("../utils/fs-atomic");
const { createAdminError } = require("./admin-errors");
const { isInsideDir } = require("./mock-ids");

// Accesso al filesystem condiviso dalle operazioni admin: lettura sicura dentro le cartelle
// del workspace, snapshot di backup per il rollback delle mutazioni e reload del runtime.

function resolvePayloadPath(configDir, payloadFile) {
  if (typeof payloadFile !== "string" || payloadFile.trim() === "") {
    throw createAdminError(400, "Payload file must be a non-empty string.");
  }

  const payloadPath = path.resolve(configDir, payloadFile);
  if (!isInsideDir(configDir, payloadPath)) {
    throw createAdminError(400, "Payload file must stay inside the mock directory.");
  }

  return payloadPath;
}

async function listFiles(rootDir, predicate) {
  const results = [];
  if (!fs.existsSync(rootDir)) {
    return results;
  }

  async function walk(currentDir) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolutePath);
          return;
        }

        if (entry.isFile() && predicate(entry.name)) {
          results.push(absolutePath);
        }
      })
    );
  }

  await walk(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

async function readJsonFile(filePath) {
  const raw = await fs.promises.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw createAdminError(400, `Invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function restoreBackup(backupEntries) {
  await Promise.all(
    backupEntries.map(async (entry) => {
      if (entry.exists) {
        await fs.promises.mkdir(path.dirname(entry.filePath), { recursive: true });
        await writeFileAtomic(entry.filePath, entry.content);
        return;
      }

      await fs.promises.rm(entry.filePath, { force: true });
    })
  );
}

async function readBackup(filePath) {
  if (!fs.existsSync(filePath)) {
    return { filePath, exists: false };
  }

  return {
    filePath,
    exists: true,
    content: await fs.promises.readFile(filePath),
  };
}

// Snapshot ricorsivo di una directory come lista di backup file-per-file, componibile con
// restoreBackup (che ricrea le cartelle mancanti a ogni file ripristinato). Le directory
// vuote non vengono ricordate: nel workspace ogni cartella significativa contiene file.
async function readDirectoryBackup(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return readDirectoryBackup(absolutePath);
      }
      if (entry.isFile()) {
        return [await readBackup(absolutePath)];
      }
      return [];
    })
  );
  return nested.flat();
}

async function runReload(reloadRuntime) {
  if (typeof reloadRuntime === "function") {
    return reloadRuntime();
  }
  return undefined;
}

// Esito del ripristino riportato in details.rollback delle risposte di errore (piano §13, C1).
const ROLLBACK = Object.freeze({ NOT_NEEDED: "not_needed", RESTORED: "restored", FAILED: "failed" });

// Il reload non rigetta mai: risolve con `applied: false` sul fallimento globale. Questo errore
// lo rende esplicito, distinto da un rifiuto sulle risorse della mutazione.
function createRuntimeApplyError(reloadResult) {
  const error = new Error(reloadResult?.fatalError?.message || "Runtime reload failed.");
  error.runtimeApplyFailed = true;
  return error;
}

// Rifiuto della mutazione deciso dopo il reload: errore di caricamento su una risorsa coinvolta,
// oppure un effetto richiesto che il runtime installato non riflette.
function createReloadRejection(message) {
  const error = new Error(message);
  error.reloadRejected = true;
  return error;
}

function relativeLoadErrorPath(filePath, baseDir) {
  if (baseDir == null) {
    return filePath;
  }
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

/**
 * Verifica che il runtime installato rifletta l'effetto richiesto sulle definizioni coinvolte.
 * `checked`: nessun errore di caricamento ammesso; `installed`: devono essere servite; `absent`:
 * non devono esserlo più (eliminazione, disabilitazione). Gli errori di endpoint estranei non
 * contano. Un esito senza `installedConfigFilePaths` (runtime di test) verifica solo gli errori.
 */
function validateReloadedEndpoints(reloadResult, { checked = [], installed = [], absent = [], baseDir } = {}) {
  if (reloadResult == null) {
    return;
  }
  const loadErrorsByPath = new Map(
    (reloadResult.loadErrors || []).map((loadError) => [path.resolve(loadError.filePath), loadError])
  );
  for (const filePath of checked) {
    const loadError = loadErrorsByPath.get(path.resolve(filePath));
    if (loadError != null) {
      throw createReloadRejection(loadError.message);
    }
  }

  const installedPaths = reloadResult.installedConfigFilePaths;
  if (installedPaths == null) {
    return;
  }
  for (const filePath of installed) {
    if (!installedPaths.has(path.resolve(filePath))) {
      throw createReloadRejection(
        `${relativeLoadErrorPath(filePath, baseDir)} is not served after the reload.`
      );
    }
  }
  for (const filePath of absent) {
    if (installedPaths.has(path.resolve(filePath))) {
      throw createReloadRejection(
        `${relativeLoadErrorPath(filePath, baseDir)} is still served after the reload.`
      );
    }
  }
}

/**
 * Chiude un batch con risultati parziali voluti (import OpenAPI, creazione dal traffico): gli
 * elementi scritti restano su disco e il reload finale dice quali sono davvero serviti. Ogni
 * elemento scritto porta `endpointPath` (interno, rimosso qui) e `expectServing`; gli altri sono
 * già `not_applicable`. Un fallimento globale del reload risponde 500 BATCH_RUNTIME_FAILED con
 * il risultato completo in details.result: i file scritti non vengono annullati.
 */
function applyBatchRuntimeOutcome({ reloadResult, result, mocksDir, rejectionLabel }) {
  const toPublicItem = ({ endpointPath: _endpointPath, expectServing: _expectServing, ...item }) => item;

  if (reloadResult?.applied === false) {
    const failedResult = {
      ...result,
      items: result.items.map((item) => toPublicItem(
        item.endpointPath != null && item.expectServing ? { ...item, runtimeOutcome: "not_applied" } : item
      )),
      runtime: { status: "failed", errors: [] },
    };
    throw createAdminError(
      500,
      `${rejectionLabel}: runtime reload failed: ${reloadResult.fatalError?.message || "unknown error"}`,
      { code: "BATCH_RUNTIME_FAILED", result: failedResult }
    );
  }

  const loadErrors = reloadResult?.loadErrors || [];
  const loadErrorsByPath = new Map(loadErrors.map((loadError) => [path.resolve(loadError.filePath), loadError]));
  const installedPaths = reloadResult?.installedConfigFilePaths;
  const items = result.items.map((item) => {
    if (item.endpointPath == null || !item.expectServing) {
      return toPublicItem(item);
    }
    const resolvedPath = path.resolve(item.endpointPath);
    const loadError = loadErrorsByPath.get(resolvedPath);
    // Senza l'elenco delle definizioni installate (runtime di test) conta solo l'errore.
    const served = loadError == null && (installedPaths == null || installedPaths.has(resolvedPath));
    return toPublicItem({
      ...item,
      runtimeOutcome: served ? "applied" : "not_applied",
      error: item.error ?? (loadError?.message || (served ? null : "Not served after the reload.")),
    });
  });

  return {
    ...result,
    items,
    runtime: {
      status: loadErrors.length > 0 ? "degraded" : "applied",
      errors: loadErrors.map((loadError) => ({
        filePath: relativeLoadErrorPath(loadError.filePath, mocksDir),
        message: loadError.message,
      })),
    },
  };
}

// Ripristina i backup e ricarica: il recupero riesce solo se entrambi i passi riescono. Errori
// preesistenti su altri endpoint non lo invalidano: si torna allo stato di prima, com'era.
async function recoverFromFailedMutation(backups, reloadRuntime) {
  try {
    await restoreBackup(backups);
    const reloadResult = await runReload(reloadRuntime);
    if (reloadResult?.applied === false) {
      return { ok: false, error: createRuntimeApplyError(reloadResult) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function withRollbackDetails(error, details) {
  error.details = { ...(error.details || {}), ...details };
  return error;
}

// Traduce il fallimento di una mutazione nel contratto di errore C1: stato HTTP, details.code
// stabile ed esito del ripristino. Il messaggio conserva il label dell'operazione.
function classifyMutationFailure({ error, phase, recovery, rejectionLabel }) {
  if (!recovery.ok) {
    return createAdminError(
      500,
      `${rejectionLabel}: ${error.message}; recovery failed: ${recovery.error.message}`,
      {
        code: "ROLLBACK_FAILED",
        rollback: ROLLBACK.FAILED,
        cause: error.message,
        recoveryError: recovery.error.message,
      }
    );
  }
  if (error.runtimeApplyFailed || (phase === "reload" && error.status == null)) {
    return createAdminError(500, `${rejectionLabel}: runtime reload failed: ${error.message}`, {
      code: "RUNTIME_APPLY_FAILED",
      rollback: ROLLBACK.RESTORED,
    });
  }
  if (error.reloadRejected || (phase === "validate" && error.status == null)) {
    return createAdminError(400, `${rejectionLabel}: ${error.message}`, {
      code: "MUTATION_REJECTED",
      rollback: ROLLBACK.RESTORED,
    });
  }
  if (error.status != null) {
    const code = error.details?.code ?? (error.status === 400 ? "MUTATION_REJECTED" : undefined);
    return withRollbackDetails(error, code == null ? { rollback: ROLLBACK.RESTORED } : { code, rollback: ROLLBACK.RESTORED });
  }
  return createAdminError(500, `${rejectionLabel}: ${error.message}`, {
    code: "MUTATION_FAILED",
    rollback: ROLLBACK.RESTORED,
  });
}

// Protocollo transazionale unico delle mutazioni admin: esegue le scritture (`commit`), il
// reload del runtime e la verifica del suo esito; su qualunque errore ripristina i backup,
// ricarica e verifica anche il ripristino. Il reload non rigetta: un esito `applied: false` è
// un fallimento globale. Senza `validateReloadResult` si verifica solo quello.
async function commitWithRollback({ backups, reloadRuntime, rejectionLabel, commit, validateReloadResult }) {
  // La fase in cui avviene l'errore ne decide la classificazione: scrittura (I/O), reload del
  // runtime (fallimento globale) o verifica del suo esito (rifiuto sulle risorse coinvolte).
  let phase = "commit";
  try {
    if (commit != null) {
      await commit();
    }
    phase = "reload";
    const reloadResult = await runReload(reloadRuntime);
    if (reloadResult?.applied === false) {
      throw createRuntimeApplyError(reloadResult);
    }
    phase = "validate";
    if (validateReloadResult != null) {
      await validateReloadResult(reloadResult);
    }
    return reloadResult;
  } catch (error) {
    const recovery = await recoverFromFailedMutation(backups, reloadRuntime);
    throw classifyMutationFailure({ error, phase, recovery, rejectionLabel });
  }
}

async function removeEmptyDirectory(dirPath, stopDir) {
  if (path.resolve(dirPath) === path.resolve(stopDir)) {
    return;
  }

  const entries = await fs.promises.readdir(dirPath);
  if (entries.length > 0) {
    return;
  }

  await fs.promises.rmdir(dirPath);
  await removeEmptyDirectory(path.dirname(dirPath), stopDir);
}

module.exports = {
  ROLLBACK,
  applyBatchRuntimeOutcome,
  resolvePayloadPath,
  listFiles,
  readJsonFile,
  restoreBackup,
  readBackup,
  readDirectoryBackup,
  runReload,
  commitWithRollback,
  createRuntimeApplyError,
  validateReloadedEndpoints,
  removeEmptyDirectory,
};
