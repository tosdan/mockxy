const crypto = require("crypto");
const { canonicalPath } = require("./utils/canonical-path");

// Versione del pacchetto che confeziona il motore. Nel pacchetto desktop è quella dell'app,
// allineata al motore dalla procedura di rilascio.
const ENGINE_VERSION = require("../package.json").version;

// Identità della collocazione del workspace (piano agent/API, §13 C2): hash dei percorsi
// canonici di mocksDir e filesDir, in quest'ordine. Non dipende da radice desktop, porta o
// avvio, e non viaggia con i file: due runtime sullo stesso workspace hanno lo stesso id.
function describeWorkspace({ mocksDir, filesDir, workspaceRoot } = {}) {
  const canonicalMocksDir = mocksDir ? canonicalPath(mocksDir) : null;
  const canonicalFilesDir = filesDir ? canonicalPath(filesDir) : null;
  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from(JSON.stringify([canonicalMocksDir, canonicalFilesDir]), "utf8"))
    .digest("hex");
  return {
    id: `workspace-v1:${digest}`,
    root: workspaceRoot ? canonicalPath(workspaceRoot) : null,
    mocksDir: canonicalMocksDir,
    filesDir: canonicalFilesDir,
  };
}

// Revisione di uno stato osservabile, dedotta dalla sua impronta: cambia solo quando lo stato
// cambia davvero. Va osservata dopo ogni scrittura (così anche un andata e ritorno fra due
// letture conta) e a ogni lettura (così conta anche un cambiamento interno).
class ObservedRevision {
  constructor(readFingerprint) {
    this.readFingerprint = readFingerprint;
    this.value = 1;
    this.last = readFingerprint();
  }

  observe() {
    const current = this.readFingerprint();
    if (current !== this.last) {
      this.value += 1;
      this.last = current;
    }
    return this.value;
  }
}

module.exports = {
  ENGINE_VERSION,
  ObservedRevision,
  describeWorkspace,
};
