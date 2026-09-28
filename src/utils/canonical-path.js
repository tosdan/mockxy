const fs = require("fs");
const path = require("path");

// Percorso assoluto canonico: symlink risolti e, su Windows, alias corti 8.3 espansi
// (realpathSync.native). Un percorso che non esiste ancora resta quello risolto dalla cwd.
function canonicalPath(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

module.exports = {
  canonicalPath,
};
