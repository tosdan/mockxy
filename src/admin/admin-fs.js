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
    await reloadRuntime();
  }
}

// Protocollo transazionale unico delle mutazioni admin: esegue i passi ancora fallibili
// (`commit`, opzionale) e il reload del runtime; su errore ripristina i backup, rifà il
// reload per riallineare il runtime ai file ripristinati, poi propaga gli errori già
// tipizzati (status HTTP presente) e traduce il resto in 400 col label dell'operazione.
async function commitWithRollback({ backups, reloadRuntime, rejectionLabel, commit }) {
  try {
    if (commit != null) {
      await commit();
    }
    await runReload(reloadRuntime);
  } catch (error) {
    await restoreBackup(backups);
    await runReload(reloadRuntime);
    if (error.status != null) {
      throw error;
    }
    throw createAdminError(400, `${rejectionLabel}: ${error.message}`);
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
  resolvePayloadPath,
  listFiles,
  readJsonFile,
  restoreBackup,
  readBackup,
  readDirectoryBackup,
  runReload,
  commitWithRollback,
  removeEmptyDirectory,
};
