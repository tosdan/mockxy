const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DUMP_FILE_PATTERN = /^dump-[A-Za-z0-9._-]+\.ndjson$/;
const DEFAULT_PAGE_LIMIT = 300;

// Vero solo per i nomi di file di dump leciti (niente slash, niente "..", solo il pattern atteso):
// guardia anti path-traversal per le rotte che accettano un nome file.
function isSafeDumpFileName(name) {
  return (
    typeof name === "string" &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..") &&
    DUMP_FILE_PATTERN.test(name)
  );
}

// Elenca i file di dump (ordine cronologico per nome, che porta il timestamp di sessione).
async function listDumpFiles(dumpDir) {
  if (!dumpDir) {
    return [];
  }
  let names;
  try {
    names = await fs.promises.readdir(dumpDir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  names = names.filter(isSafeDumpFileName).sort();
  const files = [];
  for (const name of names) {
    const stat = await fs.promises.stat(path.join(dumpDir, name));
    files.push({ name, size: stat.size, mtime: stat.mtimeMs });
  }
  return files;
}

// Parsa una riga NDJSON; ritorna null per righe vuote o corrotte (es. ultima riga troncata da un crash).
function parseLine(line) {
  if (line.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Scorre le righe di un file in streaming (mai il file intero in RAM) invocando
// onLine(rigaGrezza, indice); un ritorno false da onLine interrompe la lettura.
// L'errore dello stream va intercettato a mano: senza listener diventerebbe un
// evento 'error' non gestito (crash), e l'iteratore di readline non lo propaga
// in modo affidabile su tutte le versioni di Node.
async function scanFileLines(filePath, onLine) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let streamError = null;
  stream.on("error", (error) => {
    streamError = error;
    rl.close();
  });
  try {
    let index = 0;
    for await (const line of rl) {
      if (onLine(line, index) === false) {
        break;
      }
      index += 1;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  if (streamError) {
    throw streamError;
  }
}

// Chiave stabile di una entry nel dump: `<file>#<indiceRigaGrezza>`. Stabile perché i file sono append-only.
function dumpKeyFor(fileName, lineIndex) {
  return `${fileName}#${lineIndex}`;
}

// Scompone una chiave dump validando il nome file (anti path-traversal) e l'indice riga.
function parseDumpKey(key) {
  const hashIndex = String(key).lastIndexOf("#");
  if (hashIndex < 0) {
    return null;
  }
  const fileName = String(key).slice(0, hashIndex);
  const lineIndex = Number(String(key).slice(hashIndex + 1));
  if (!isSafeDumpFileName(fileName) || !Number.isInteger(lineIndex) || lineIndex < 0) {
    return null;
  }
  return { fileName, lineIndex };
}

/**
 * Lettura paginata a cursore in avanti su tutti i file di dump, in ordine cronologico.
 * `cursor` = { fileIndex, lineIndex }; ogni item riceve `dumpKey`. Niente totale: si carica finché `done`.
 * La lettura è in streaming e si ferma a pagina piena: il file non viene mai caricato intero in RAM.
 */
async function readDumpPage(dumpDir, cursor, limit) {
  const files = await listDumpFiles(dumpDir);
  const names = files.map((file) => file.name);
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_PAGE_LIMIT;

  let fileIndex = cursor && Number.isInteger(cursor.fileIndex) && cursor.fileIndex >= 0 ? cursor.fileIndex : 0;
  let lineIndex = cursor && Number.isInteger(cursor.lineIndex) && cursor.lineIndex >= 0 ? cursor.lineIndex : 0;

  const items = [];
  while (fileIndex < names.length && items.length < max) {
    const name = names[fileIndex];
    const startLine = lineIndex;
    let pageFull = false;
    await scanFileLines(path.join(dumpDir, name), (line, index) => {
      if (index < startLine) {
        return;
      }
      const entry = parseLine(line);
      if (entry != null) {
        items.push({ ...entry, dumpKey: dumpKeyFor(name, index) });
      }
      lineIndex = index + 1;
      if (items.length >= max) {
        pageFull = true;
        return false;
      }
    });
    if (!pageFull) {
      fileIndex += 1;
      lineIndex = 0;
    }
  }

  const done = fileIndex >= names.length;
  return { items, nextCursor: done ? null : { fileIndex, lineIndex }, done };
}

// Tutte le entry di un singolo file di dump (per il criterio "tutto il file" del batch).
async function readDumpFileEntries(dumpDir, fileName) {
  if (!isSafeDumpFileName(fileName)) {
    return [];
  }
  const entries = [];
  try {
    await scanFileLines(path.join(dumpDir, fileName), (line, index) => {
      const entry = parseLine(line);
      if (entry != null) {
        entries.push({ ...entry, dumpKey: dumpKeyFor(fileName, index) });
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return entries;
}

// Risolve un insieme di chiavi dump nelle relative entry (per il criterio "insieme di id" del batch).
async function readDumpEntriesByKeys(dumpDir, keys) {
  const byFile = new Map();
  for (const key of keys || []) {
    const parsed = parseDumpKey(key);
    if (!parsed) {
      continue;
    }
    if (!byFile.has(parsed.fileName)) {
      byFile.set(parsed.fileName, new Set());
    }
    byFile.get(parsed.fileName).add(parsed.lineIndex);
  }

  const result = [];
  for (const [fileName, lineSet] of byFile) {
    const lastWantedIndex = Math.max(...lineSet);
    try {
      await scanFileLines(path.join(dumpDir, fileName), (line, index) => {
        if (lineSet.has(index)) {
          const entry = parseLine(line);
          if (entry != null) {
            result.push({ ...entry, dumpKey: dumpKeyFor(fileName, index) });
          }
        }
        if (index >= lastWantedIndex) {
          return false;
        }
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return result;
}

// Elimina un file di dump (con guardia sul nome).
async function deleteDumpFile(dumpDir, fileName) {
  if (!isSafeDumpFileName(fileName)) {
    const error = new Error("Invalid dump file name.");
    error.status = 400;
    throw error;
  }
  await fs.promises.rm(path.join(dumpDir, fileName), { force: true });
}

module.exports = {
  isSafeDumpFileName,
  parseDumpKey,
  listDumpFiles,
  readDumpPage,
  readDumpFileEntries,
  readDumpEntriesByKeys,
  deleteDumpFile,
};
