const crypto = require("crypto");

// Identità di un avvio del runtime (piano agent/API, §13 C2): un UUID nuovo a ogni avvio e
// l'istante UTC in cui è nato. È distinta dall'identità del workspace: due runtime possono
// servire lo stesso workspace con runtimeId diversi.
function createRuntimeIdentity() {
  return Object.freeze({
    runtimeId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
  });
}

module.exports = {
  createRuntimeIdentity,
};
