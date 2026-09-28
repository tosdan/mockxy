const fs = require("fs");
const path = require("path");

// Percorso assoluto canonico: symlink risolti e, su Windows, alias corti 8.3 espansi
// (realpathSync.native). Per un percorso che non esiste ancora si canonicalizza l'antenato
// esistente più profondo e si riaggiunge la parte mancante: la stessa collocazione, raggiunta da
// un symlink o direttamente, dà lo stesso risultato prima e dopo la creazione della cartella.
function canonicalPath(target) {
  const resolved = path.resolve(target);
  const missing = [];
  let current = resolved;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

module.exports = {
  canonicalPath,
};
