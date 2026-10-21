const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DUMP_FILE_PATTERN = /^dump-[A-Za-z0-9._-]+\.ndjson$/;
const DEFAULT_PAGE_LIMIT = 300;
// Righe lette al massimo per chiamata quando un filtro scarta voci: una ricerca rara non deve
// scorrere l'intero archivio in una risposta sola. La pagina torna anche incompleta, col cursore
// da cui ripartire, e il client continua.
const MAX_SCANNED_LINES = 20000;
// Provenienze servite da una response locale: le altre ("dal backend reale") sono proxy,
// middleware e miss. Stessa partizione del filtro "Backend reale" del Monitor. Anche "ws": la
// richiesta a un endpoint WebSocket la serve l'endpoint (426 senza upgrade), non il backend.
const LOCAL_SOURCES = new Set(["mock", "handler", "sse", "ws"]);

/**
 * Filtri dello storico, gli stessi del Monitor: testo contenuto nell'URL o nel metodo (senza
 * distinguere maiuscole), metodo esatto, classi di status (2 = 2xx...) e provenienza, dove
 * "real-backend" vale per tutto cio' che non e' uscito da una response locale. In AND.
 */
function matchesDumpFilters(entry, filters) {
  if (!filters) {
    return true;
  }
  if (filters.q && !`${entry.originalUrl ?? entry.path} ${entry.method}`.toLowerCase().includes(filters.q)) {
    return false;
  }
  if (filters.method && entry.method !== filters.method) {
    return false;
  }
  if (filters.source === "real-backend") {
    if (LOCAL_SOURCES.has(entry.source)) {
      return false;
    }
  } else if (filters.source && entry.source !== filters.source) {
    return false;
  }
  if (filters.statusClasses && filters.statusClasses.size > 0 && !filters.statusClasses.has(Math.floor(entry.status / 100))) {
    return false;
  }
  return true;
}

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

// Il numero di rotazione in fondo al nome: `dump-STAMP-002.ndjson` (il primo file non ce l'ha).
const ROTATION_SUFFIX = /^(.*)-(\d{3,})\.ndjson$/;

/**
 * Ordine cronologico dei file di dump. Il nome porta il timestamp della sessione (ISO, in ordine anche
 * come testo) e, dalla seconda rotazione, il numero del file: `dump-STAMP.ndjson`, poi
 * `dump-STAMP-002.ndjson`, `-003`... In ordine alfabetico il trattino viene prima del punto, e il
 * primo file finirebbe dopo i suoi successori: si confrontano la sessione e poi il numero, che per
 * il primo file vale 1. Cosi' un file ruotato si aggiunge sempre in fondo, e gli indici dei file
 * gia' elencati, che i cursori di lettura si portano dietro, non cambiano.
 */
function compareDumpFileNames(a, b) {
  const order = (name) => {
    const match = ROTATION_SUFFIX.exec(name);
    return match ? { session: match[1], seq: Number(match[2]) } : { session: name.slice(0, -".ndjson".length), seq: 1 };
  };
  const left = order(a);
  const right = order(b);
  if (left.session !== right.session) {
    return left.session < right.session ? -1 : 1;
  }
  return left.seq - right.seq;
}

// Elenca i file di dump in ordine cronologico (compareDumpFileNames).
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
  names = names.filter(isSafeDumpFileName).sort(compareDumpFileNames);
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

/**
 * Come scanFileLines, ma parte da un byte del file (l'inizio di una riga) e passa a onLine anche
 * il byte subito dopo la riga, a capo compreso: e' il punto da cui una lettura successiva riprende
 * senza ripercorrere le righe gia' lette. `startIndex` e' l'indice della prima riga letta.
 * onLine(rigaGrezza, indice, byteDopoLaRiga); un ritorno false interrompe la lettura. Come
 * readline, toglie un \r finale e passa anche un'ultima riga senza a capo.
 */
async function scanFileLinesFrom(filePath, startByte, startIndex, onLine) {
  const stream = fs.createReadStream(filePath, { start: startByte });
  // `base` e' il byte del file da cui comincia `buffer`.
  let base = startByte;
  let rest = Buffer.alloc(0);
  let index = startIndex;
  const emit = (buffer, from, to, endByte) => {
    const end = to > from && buffer[to - 1] === 0x0d ? to - 1 : to;
    const keepGoing = onLine(buffer.toString("utf8", from, end), index, endByte) !== false;
    index += 1;
    return keepGoing;
  };
  try {
    for await (const chunk of stream) {
      const buffer = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
      let lineStart = 0;
      let newline = buffer.indexOf(0x0a, lineStart);
      while (newline !== -1) {
        if (!emit(buffer, lineStart, newline, base + newline + 1)) {
          return;
        }
        lineStart = newline + 1;
        newline = buffer.indexOf(0x0a, lineStart);
      }
      rest = buffer.subarray(lineStart);
      base += lineStart;
    }
    if (rest.length > 0) {
      emit(rest, 0, rest.length, base + rest.length);
    }
  } finally {
    stream.destroy();
  }
}

// Vero se `byteOffset` e' l'inizio di una riga del file: 0, oppure subito dopo un a capo.
async function isLineStart(filePath, byteOffset) {
  if (byteOffset === 0) {
    return true;
  }
  let handle;
  try {
    handle = await fs.promises.open(filePath, "r");
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(1), 0, 1, byteOffset - 1);
    return bytesRead === 1 && buffer[0] === 0x0a;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/**
 * Righe del file nei primi `endByte` byte, contate come le conta la lettura in avanti: ogni a capo
 * chiude una riga, e anche un'ultima riga senza a capo conta. In streaming, a blocchi.
 */
async function countLines(filePath, endByte) {
  if (endByte <= 0) {
    return 0;
  }
  const stream = fs.createReadStream(filePath, { start: 0, end: endByte - 1 });
  let count = 0;
  let last = 0x0a;
  try {
    for await (const chunk of stream) {
      let at = chunk.indexOf(0x0a);
      while (at !== -1) {
        count += 1;
        at = chunk.indexOf(0x0a, at + 1);
      }
      last = chunk[chunk.length - 1];
    }
  } finally {
    stream.destroy();
  }
  return last === 0x0a ? count : count + 1;
}

const BACKWARD_CHUNK_BYTES = 64 * 1024;

/**
 * Scorre all'indietro le righe che finiscono entro `endByte`, dall'ultima alla prima.
 * `lineCount` e' quante righe ci sono prima di `endByte` (countLines): l'ultima ha indice
 * lineCount - 1, come nella lettura in avanti. onLine(rigaGrezza, indice, byteDiInizio); un
 * ritorno false interrompe. Come readline, toglie un \r finale.
 */
async function scanFileLinesBackward(filePath, endByte, lineCount, onLine) {
  if (endByte <= 0) {
    return;
  }
  const handle = await fs.promises.open(filePath, "r");
  try {
    let pos = endByte;
    let index = lineCount - 1;
    // `rest` e' la parte gia' letta dopo `pos` e non ancora emessa: finisce dove finisce una riga.
    let rest = Buffer.alloc(0);
    let trimmedTail = false;
    while (pos > 0) {
      const size = Math.min(BACKWARD_CHUNK_BYTES, pos);
      pos -= size;
      const chunk = Buffer.alloc(size);
      await handle.read(chunk, 0, size, pos);
      let data = rest.length > 0 ? Buffer.concat([chunk, rest]) : chunk;
      // L'a capo che chiude l'ultima riga non separa due righe: si toglie una volta sola.
      if (!trimmedTail) {
        trimmedTail = true;
        if (data[data.length - 1] === 0x0a) {
          data = data.subarray(0, data.length - 1);
        }
      }
      let end = data.length;
      let newline = data.lastIndexOf(0x0a, end - 1);
      while (newline !== -1) {
        const lineEnd = end > newline + 1 && data[end - 1] === 0x0d ? end - 1 : end;
        if (onLine(data.toString("utf8", newline + 1, lineEnd), index, pos + newline + 1) === false) {
          return;
        }
        index -= 1;
        end = newline;
        newline = end > 0 ? data.lastIndexOf(0x0a, end - 1) : -1;
      }
      rest = data.subarray(0, end);
    }
    // Quel che resta e' la prima riga del file (anche vuota).
    if (index >= 0) {
      const lineEnd = rest.length > 0 && rest[rest.length - 1] === 0x0d ? rest.length - 1 : rest.length;
      onLine(rest.toString("utf8", 0, lineEnd), index, 0);
    }
  } finally {
    await handle.close();
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
 * `cursor` = { fileIndex, lineIndex, byteOffset }; ogni item riceve `dumpKey`. Niente totale: si
 * carica finché `done`. La lettura è in streaming e si ferma a pagina piena: il file non viene mai
 * caricato intero in RAM.
 *
 * `byteOffset` e' il byte da cui riprendere nel file: con lui la lettura parte da li', senza
 * ripercorrere le righe gia' lette, e il tetto `maxScannedLines` limita davvero il lavoro della
 * chiamata. Senza (un client che non lo rimanda), o se non cade all'inizio di una riga, si riparte
 * dall'inizio del file contando le righe fino a `lineIndex`, come prima: il cursore restituito
 * porta comunque il byte, e dalla pagina dopo la ripresa e' diretta.
 */
async function readDumpPage(dumpDir, cursor, limit, filters, maxScannedLines = MAX_SCANNED_LINES, order = "asc") {
  if (order === "desc") {
    return readDumpPageNewestFirst(dumpDir, cursor, limit, filters, maxScannedLines);
  }
  const files = await listDumpFiles(dumpDir);
  const names = files.map((file) => file.name);
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_PAGE_LIMIT;

  let fileIndex = cursor && Number.isInteger(cursor.fileIndex) && cursor.fileIndex >= 0 ? cursor.fileIndex : 0;
  let lineIndex = cursor && Number.isInteger(cursor.lineIndex) && cursor.lineIndex >= 0 ? cursor.lineIndex : 0;
  let byteOffset = cursor && Number.isInteger(cursor.byteOffset) && cursor.byteOffset >= 0 ? cursor.byteOffset : null;
  if (lineIndex === 0) {
    byteOffset = 0;
  }

  const items = [];
  let scanned = 0;
  while (fileIndex < names.length && items.length < max && scanned < maxScannedLines) {
    const name = names[fileIndex];
    const filePath = path.join(dumpDir, name);
    const direct = byteOffset != null && (await isLineStart(filePath, byteOffset));
    // Ripresa diretta dal byte; altrimenti dall'inizio del file, saltando le prime `lineIndex` righe.
    const skipBelow = direct ? 0 : lineIndex;
    let pageFull = false;
    await scanFileLinesFrom(filePath, direct ? byteOffset : 0, direct ? lineIndex : 0, (line, index, endByte) => {
      if (index < skipBelow) {
        return;
      }
      const entry = parseLine(line);
      if (entry != null && matchesDumpFilters(entry, filters)) {
        items.push({ ...entry, dumpKey: dumpKeyFor(name, index) });
      }
      lineIndex = index + 1;
      byteOffset = endByte;
      scanned += 1;
      if (items.length >= max || scanned >= maxScannedLines) {
        pageFull = true;
        return false;
      }
    });
    if (!pageFull) {
      fileIndex += 1;
      lineIndex = 0;
      byteOffset = 0;
    }
  }

  const done = fileIndex >= names.length;
  return { items, nextCursor: done ? null : { fileIndex, lineIndex, byteOffset }, done };
}

/**
 * Come readDumpPage, ma dalla voce piu' recente: i file dall'ultimo al primo, e in ogni file le
 * righe dalla fine. Le chiavi sono le stesse della lettura in avanti.
 *
 * Il cursore ha la stessa forma, letta al contrario: `byteOffset` e' dove finisce la parte ancora
 * da leggere del file (l'inizio dell'ultima riga restituita) e `lineIndex` quante righe ci sono
 * prima. Senza cursore si parte dalla fine dell'ultimo file, contandone le righe una volta; le
 * righe aggiunte dopo la prima pagina non entrano, la lettura resta quella di quel momento. Se il
 * byte non cade all'inizio di una riga, si ricava dal conteggio delle righe, come in avanti.
 */
async function readDumpPageNewestFirst(dumpDir, cursor, limit, filters, maxScannedLines) {
  const files = await listDumpFiles(dumpDir);
  const names = files.map((file) => file.name);
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_PAGE_LIMIT;

  const fromCursor = cursor && Number.isInteger(cursor.fileIndex) && cursor.fileIndex >= 0;
  let fileIndex = fromCursor ? Math.min(cursor.fileIndex, names.length - 1) : names.length - 1;
  // Righe prima del punto di ripresa, e il byte che ci corrisponde; null = da ricavare.
  let lineIndex = fromCursor && cursor.fileIndex < names.length && Number.isInteger(cursor.lineIndex) && cursor.lineIndex >= 0 ? cursor.lineIndex : null;
  let byteOffset = lineIndex != null && Number.isInteger(cursor.byteOffset) && cursor.byteOffset >= 0 ? cursor.byteOffset : null;

  const items = [];
  let scanned = 0;
  while (fileIndex >= 0 && items.length < max && scanned < maxScannedLines) {
    const name = names[fileIndex];
    const filePath = path.join(dumpDir, name);
    if (lineIndex == null) {
      ({ lineIndex, byteOffset } = await endOfFile(filePath, files[fileIndex].size));
    } else if (byteOffset == null || byteOffset > files[fileIndex].size || !(await isLineStart(filePath, byteOffset))) {
      byteOffset = await lineStartByte(filePath, lineIndex);
    }
    let pageFull = false;
    await scanFileLinesBackward(filePath, byteOffset, lineIndex, (line, index, startByte) => {
      const entry = parseLine(line);
      if (entry != null && matchesDumpFilters(entry, filters)) {
        items.push({ ...entry, dumpKey: dumpKeyFor(name, index) });
      }
      lineIndex = index;
      byteOffset = startByte;
      scanned += 1;
      if (items.length >= max || scanned >= maxScannedLines) {
        pageFull = true;
        return false;
      }
    });
    if (!pageFull || lineIndex === 0) {
      fileIndex -= 1;
      lineIndex = null;
      byteOffset = null;
    }
  }

  const done = fileIndex < 0;
  if (!done && lineIndex == null) {
    // La pagina si e' chiusa passando a un file piu' vecchio: si riprende dalla sua fine.
    ({ lineIndex, byteOffset } = await endOfFile(path.join(dumpDir, names[fileIndex]), files[fileIndex].size));
  }
  return { items, nextCursor: done ? null : { fileIndex, lineIndex, byteOffset }, done };
}

// Il punto di ripresa alla fine di un file: tutte le sue righe stanno prima.
async function endOfFile(filePath, size) {
  return { lineIndex: await countLines(filePath, size), byteOffset: size };
}

// Byte d'inizio della riga `lineIndex` (0 = inizio file), contando le righe dall'inizio.
async function lineStartByte(filePath, lineIndex) {
  if (lineIndex <= 0) {
    return 0;
  }
  let start = 0;
  await scanFileLinesFrom(filePath, 0, 0, (_line, index, endByte) => {
    start = endByte;
    return index + 1 < lineIndex;
  });
  return start;
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
  compareDumpFileNames,
  parseDumpKey,
  listDumpFiles,
  readDumpPage,
  readDumpFileEntries,
  readDumpEntriesByKeys,
  deleteDumpFile,
};
