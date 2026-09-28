const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ENDPOINT_SUFFIX = ".endpoint.json";
const RESPONSE_SUFFIX = ".response.json";
const RESPONSES_DIR_SUFFIX = ".responses";
const COLLECTIONS_FILE = ".collections.json";

// Revisione informativa del catalogo (piano agent/API, §13 C2). Il perimetro sono i file del
// catalogo e le loro dipendenze dirette, come le vede il loader: `.collections.json`, ogni
// `*.endpoint.json`, tutte le varianti che elenca (anche inattive) e, per ciascuna, il sorgente
// (`sourceFile`) e l'asset (`file`) che referenzia. Altri file sotto la cartella dei mock non
// contano. Conta anche un file che compare, scompare o non si riesce a leggere.
//
// Per ogni file conserva firma dei metadati (mtime, dimensione), impronta del contenuto e
// riferimenti: una scansione rilegge soltanto i file nuovi, con firma diversa o invalidati
// esplicitamente. Una modifica esterna che lascia identici mtime e dimensione resta invisibile
// finché il file non viene riletto davvero (una scrittura API, una GET di dettaglio): è il limite
// dichiarato del contratto.
//
// Le scansioni sono serializzate fra loro; le osservazioni delle letture (GET di dettaglio) no:
// non attendono le scansioni pendenti. Ogni lettura di un file prende un numero da un orologio
// logico, e per ogni file vince la lettura iniziata per ultima: una scansione partita prima non
// sovrascrive un'osservazione più recente.
class CatalogRevisionTracker {
  constructor({ mocksDir }) {
    this.mocksDir = path.resolve(mocksDir);
    this.revision = 1;
    this.files = new Map();
    // Voci del perimetro che non sono file letti: riferimenti mancanti, errori, non-file.
    this.structure = [];
    this.fingerprint = null;
    this.clock = 0;
    this.tail = Promise.resolve();
  }

  // Scansiona il perimetro; i percorsi in `invalidate` si rileggono anche a firma invariata.
  // Il primo risultato è la revisione 1.
  refresh({ invalidate } = {}) {
    return this.enqueue(() => this.scan(new Set([...(invalidate || [])].map((filePath) => path.resolve(filePath)))));
  }

  // Registra i contenuti effettivi dei file indicati, appena letti da una GET di dettaglio,
  // senza attendere le scansioni pendenti: un file cambiato o comparso muove subito la revisione.
  // Se cambia la struttura (un file nuovo, riferimenti diversi) accoda una scansione, senza
  // attenderla.
  async observeFiles(filePaths) {
    const observations = [];
    for (const filePath of new Set(filePaths.map((candidate) => path.resolve(candidate)))) {
      let stats;
      try {
        stats = await fs.promises.stat(filePath);
      } catch {
        continue;
      }
      if (!stats.isFile()) {
        continue;
      }
      const kind = this.files.get(filePath)?.kind ?? inferKind(filePath);
      // Il numero si prende subito prima di leggere ciascun file: è l'ordine di quella lettura.
      const seq = this.tick();
      const read = await readDigest(filePath, kind);
      if (!read.digest.startsWith("error:")) {
        observations.push({ filePath, kind, mtimeMs: stats.mtimeMs, size: stats.size, ...read, seq });
      }
    }

    // Applicazione sincrona: nessuna scansione può concludersi a metà.
    let structureChanged = false;
    for (const observation of observations) {
      const current = this.files.get(observation.filePath);
      if (current != null && current.seq > observation.seq) {
        continue;
      }
      if (current == null || !sameReferences(current.references, observation.references)) {
        structureChanged = true;
      }
      this.files.set(observation.filePath, observation);
    }
    this.publish();
    if (structureChanged) {
      this.refresh().catch(() => {});
    }
    return this.revision;
  }

  // Le scansioni sono serializzate: ognuna parte dalla cache lasciata dalla precedente.
  enqueue(task) {
    const run = this.tail.then(task);
    this.tail = run.catch(() => {});
    return run;
  }

  tick() {
    this.clock += 1;
    return this.clock;
  }

  async scan(invalidated) {
    const startedAt = this.clock;
    const scanned = new Map();
    const structure = [];
    const visited = new Set();

    const visit = async (filePath, kind) => {
      if (visited.has(filePath)) {
        return;
      }
      visited.add(filePath);
      const relativePath = this.relative(filePath);
      let stats;
      try {
        stats = await fs.promises.stat(filePath);
      } catch (error) {
        // Un riferimento a un file assente è uno stato del catalogo; un file radice sparito no.
        if (kind !== "root" || error.code !== "ENOENT") {
          structure.push(`${relativePath}\0${error.code === "ENOENT" ? "missing" : `error:${error.code || "EREAD"}`}`);
        }
        return;
      }
      if (!stats.isFile()) {
        structure.push(`${relativePath}\0not-a-file`);
        return;
      }
      const cached = this.files.get(filePath);
      const reusable = cached != null
        && cached.kind === kind
        && cached.mtimeMs === stats.mtimeMs
        && cached.size === stats.size
        && !invalidated.has(filePath);
      let entry = cached;
      if (!reusable) {
        const seq = this.tick();
        entry = { kind, mtimeMs: stats.mtimeMs, size: stats.size, ...(await readDigest(filePath, kind)), seq };
      }
      scanned.set(filePath, entry);
      for (const reference of entry.references) {
        await visit(reference.filePath, reference.kind);
      }
    };

    for (const root of await this.listRoots(structure)) {
      await visit(root, root.endsWith(ENDPOINT_SUFFIX) ? "endpoint" : "root");
    }

    // Per ogni file vince la lettura più recente; un file osservato durante la scansione e non
    // visitato resta, finché la prossima scansione non lo ricolloca nel perimetro.
    const files = new Map();
    for (const [filePath, entry] of scanned) {
      const current = this.files.get(filePath);
      files.set(filePath, current != null && current.seq > entry.seq ? current : entry);
    }
    for (const [filePath, current] of this.files) {
      if (!files.has(filePath) && current.seq > startedAt) {
        files.set(filePath, current);
      }
    }
    this.files = files;
    this.structure = structure;
    return this.publish();
  }

  // Ricalcola l'impronta del perimetro e avanza la revisione se è cambiata.
  publish() {
    const entries = [...this.structure];
    for (const [filePath, entry] of this.files) {
      entries.push(`${this.relative(filePath)}\0${entry.digest}`);
    }
    entries.sort();
    const fingerprint = crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
    if (this.fingerprint != null && fingerprint !== this.fingerprint) {
      this.revision += 1;
    }
    this.fingerprint = fingerprint;
    return this.revision;
  }

  // `.collections.json` e i file endpoint in tutte le sottocartelle, come il loader. Una cartella
  // illeggibile diventa una voce d'errore: potrebbe nascondere endpoint.
  async listRoots(structure) {
    const roots = [path.join(this.mocksDir, COLLECTIONS_FILE)];
    const walk = async (dir) => {
      let dirents;
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (error.code !== "ENOENT") {
          structure.push(`${this.relative(dir)}/\0error:${error.code || "EREAD"}`);
        }
        return;
      }
      for (const dirent of dirents) {
        const entryPath = path.join(dir, dirent.name);
        if (dirent.isDirectory()) {
          await walk(entryPath);
        } else if (dirent.isFile() && dirent.name.endsWith(ENDPOINT_SUFFIX)) {
          roots.push(entryPath);
        }
      }
    };
    await walk(this.mocksDir);
    return roots;
  }

  relative(filePath) {
    return path.relative(this.mocksDir, filePath).split(path.sep).join("/") || ".";
  }
}

function inferKind(filePath) {
  if (filePath.endsWith(ENDPOINT_SUFFIX)) {
    return "endpoint";
  }
  return filePath.endsWith(RESPONSE_SUFFIX) ? "response" : "dependency";
}

function sameReferences(left, right) {
  return left.length === right.length
    && left.every((reference, index) => reference.filePath === right[index].filePath && reference.kind === right[index].kind);
}

// Impronta del contenuto e riferimenti diretti: le varianti (`response`) elencate da un endpoint,
// il sorgente e l'asset (`dependency`) di una variante. Un JSON illeggibile non ha riferimenti.
async function readDigest(filePath, kind = "dependency") {
  let content;
  try {
    content = await fs.promises.readFile(filePath);
  } catch (error) {
    return { digest: `error:${error.code || "EREAD"}`, references: [] };
  }
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  return { digest, references: referencesOf(filePath, kind, content) };
}

function referencesOf(filePath, kind, content) {
  if (kind !== "endpoint" && kind !== "response") {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch {
    return [];
  }
  if (kind === "endpoint") {
    const method = path.basename(filePath).slice(0, -ENDPOINT_SUFFIX.length).toUpperCase();
    const responsesDir = path.join(path.dirname(filePath), `${method}${RESPONSES_DIR_SUFFIX}`);
    const responseFiles = Array.isArray(parsed?.responseFiles) ? parsed.responseFiles : [];
    return responseFiles
      .filter((name) => typeof name === "string" && name !== "" && name === path.basename(name))
      .map((name) => ({ filePath: path.join(responsesDir, name), kind: "response" }));
  }
  const responsesDir = path.dirname(filePath);
  return [parsed?.sourceFile, parsed?.file]
    .filter((name) => typeof name === "string" && name.trim() !== "")
    .map((name) => path.resolve(responsesDir, name))
    .filter((target) => target.startsWith(`${responsesDir}${path.sep}`))
    .map((target) => ({ filePath: target, kind: "dependency" }));
}

module.exports = {
  CatalogRevisionTracker,
};
