const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Margine sulle scritture di una mutazione: con filesystem a risoluzione grossolana (FAT: 2
// secondi) l'mtime di un file scritto può risultare anteriore all'inizio della mutazione.
const WRITE_MTIME_MARGIN_MS = 2000;

// Revisione informativa del catalogo (piano agent/API, §13 C2): cambia quando cambia il contenuto
// dei file del workspace dei mock (endpoint, collezioni e ordine, tutte le varianti anche
// inattive, sorgenti e asset), quando un file compare o scompare, o quando non si riesce a
// leggerlo. Per ogni file conserva firma dei metadati (mtime, dimensione) e impronta del
// contenuto: una scansione rilegge solo i file nuovi, con firma diversa o scritti da una
// mutazione API. Una modifica esterna che lascia identici mtime e dimensione resta invisibile
// finché il file non viene riletto: è il limite dichiarato del contratto.
class CatalogRevisionTracker {
  constructor({ mocksDir }) {
    this.mocksDir = mocksDir;
    this.revision = 1;
    this.files = new Map();
    this.fingerprint = null;
    this.tail = Promise.resolve();
  }

  // Scansiona il workspace. `writtenSince` (ms epoch) forza la rilettura dei file modificati da
  // quell'istante: una mutazione API invalida così i propri file anche a firma invariata.
  // Le scansioni sono serializzate; il primo risultato è la revisione 1.
  refresh({ writtenSince } = {}) {
    const run = this.tail.then(() => this.scan(writtenSince));
    this.tail = run.catch(() => {});
    return run;
  }

  // La revisione dopo le scansioni già avviate, senza avviarne una: chi legge dopo la risposta
  // di una mutazione vede la revisione che la include (la scansione della mutazione parte prima
  // che la richiesta successiva venga elaborata).
  settled() {
    return this.tail.then(() => this.revision);
  }

  async scan(writtenSince) {
    const forceSince = writtenSince == null ? null : writtenSince - WRITE_MTIME_MARGIN_MS;
    const entries = [];
    const files = new Map();
    for (const item of await listWorkspaceFiles(this.mocksDir)) {
      if (item.error != null) {
        entries.push(`${item.relativePath}\0error:${item.error}`);
        continue;
      }
      const cached = this.files.get(item.filePath);
      const unchanged = cached != null
        && cached.mtimeMs === item.mtimeMs
        && cached.size === item.size
        && (forceSince == null || item.mtimeMs < forceSince);
      const digest = unchanged ? cached.digest : await digestFile(item.filePath);
      files.set(item.filePath, { mtimeMs: item.mtimeMs, size: item.size, digest });
      entries.push(`${item.relativePath}\0${digest}`);
    }
    entries.sort();
    const fingerprint = crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
    if (this.fingerprint != null && fingerprint !== this.fingerprint) {
      this.revision += 1;
    }
    this.fingerprint = fingerprint;
    this.files = files;
    return this.revision;
  }
}

// Tutti i file regolari sotto la cartella dei mock, file nascosti compresi (.collections.json),
// esclusi i node_modules. Una cartella illeggibile diventa una voce d'errore.
async function listWorkspaceFiles(rootDir) {
  const items = [];
  const visit = async (dir) => {
    let dirents;
    try {
      dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") {
        items.push({ relativePath: relativeTo(rootDir, dir), error: error.code || "EREAD" });
      }
      return;
    }
    for (const dirent of dirents) {
      const entryPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (dirent.name !== "node_modules") {
          await visit(entryPath);
        }
        continue;
      }
      if (!dirent.isFile() && !dirent.isSymbolicLink()) {
        continue;
      }
      try {
        const stats = await fs.promises.stat(entryPath);
        if (stats.isFile()) {
          items.push({ filePath: entryPath, relativePath: relativeTo(rootDir, entryPath), mtimeMs: stats.mtimeMs, size: stats.size });
        }
      } catch (error) {
        items.push({ relativePath: relativeTo(rootDir, entryPath), error: error.code || "EREAD" });
      }
    }
  };
  await visit(rootDir);
  return items;
}

async function digestFile(filePath) {
  try {
    return crypto.createHash("sha256").update(await fs.promises.readFile(filePath)).digest("hex");
  } catch (error) {
    return `error:${error.code || "EREAD"}`;
  }
}

function relativeTo(rootDir, target) {
  return path.relative(rootDir, target).split(path.sep).join("/") || ".";
}

module.exports = {
  CatalogRevisionTracker,
};
