const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ENDPOINT_SUFFIX = ".endpoint.json";
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
class CatalogRevisionTracker {
  constructor({ mocksDir }) {
    this.mocksDir = path.resolve(mocksDir);
    this.revision = 1;
    this.files = new Map();
    this.fingerprint = null;
    this.tail = Promise.resolve();
  }

  // Scansiona il perimetro; i percorsi in `invalidate` si rileggono anche a firma invariata.
  // Il primo risultato è la revisione 1.
  refresh({ invalidate } = {}) {
    return this.enqueue(() => this.scan(new Set([...(invalidate || [])].map((filePath) => path.resolve(filePath)))));
  }

  // Confronta con la cache i contenuti effettivi dei file indicati (per esempio quelli appena
  // letti da una GET di dettaglio): se uno è cambiato, o è comparso, la scansione lo rilegge.
  verify(filePaths) {
    return this.enqueue(async () => {
      const changed = [];
      for (const filePath of filePaths.map((candidate) => path.resolve(candidate))) {
        const cached = this.files.get(filePath);
        if (cached == null) {
          if (await isFile(filePath)) {
            changed.push(filePath);
          }
          continue;
        }
        if ((await readDigest(filePath, cached.kind)).digest !== cached.digest) {
          changed.push(filePath);
        }
      }
      return changed.length > 0 ? this.scan(new Set(changed)) : this.revision;
    });
  }

  // Le scansioni sono serializzate: ognuna parte dalla cache lasciata dalla precedente.
  enqueue(task) {
    const run = this.tail.then(task);
    this.tail = run.catch(() => {});
    return run;
  }

  async scan(invalidated) {
    const files = new Map();
    const entries = [];
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
          entries.push(`${relativePath}\0${error.code === "ENOENT" ? "missing" : `error:${error.code || "EREAD"}`}`);
        }
        return;
      }
      if (!stats.isFile()) {
        entries.push(`${relativePath}\0not-a-file`);
        return;
      }
      const cached = this.files.get(filePath);
      const reusable = cached != null
        && cached.kind === kind
        && cached.mtimeMs === stats.mtimeMs
        && cached.size === stats.size
        && !invalidated.has(filePath);
      const entry = reusable
        ? cached
        : { kind, mtimeMs: stats.mtimeMs, size: stats.size, ...(await readDigest(filePath, kind)) };
      files.set(filePath, entry);
      entries.push(`${relativePath}\0${entry.digest}`);
      for (const reference of entry.references) {
        await visit(reference.filePath, reference.kind);
      }
    };

    for (const root of await this.listRoots(entries)) {
      await visit(root, root.endsWith(ENDPOINT_SUFFIX) ? "endpoint" : "root");
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

  // `.collections.json` e i file endpoint in tutte le sottocartelle, come il loader. Una cartella
  // illeggibile diventa una voce d'errore: potrebbe nascondere endpoint.
  async listRoots(entries) {
    const roots = [path.join(this.mocksDir, COLLECTIONS_FILE)];
    const walk = async (dir) => {
      let dirents;
      try {
        dirents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (error.code !== "ENOENT") {
          entries.push(`${this.relative(dir)}/\0error:${error.code || "EREAD"}`);
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

async function isFile(filePath) {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

module.exports = {
  CatalogRevisionTracker,
};
