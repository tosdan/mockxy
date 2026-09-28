// Identità dello stream servito da un endpoint (piano agent/API, §13 C3). La chiave delle
// connessioni resta method/path; la firma deriva dalla definizione normalizzata realmente
// installata e comprende solo ciò che governa copione, regole e chiusura: per SSE `retryMs`,
// `script`, `onEnd`; per WS `script`, `rules`, `onEnd`, `closeCode`, `closeReason`. Restano fuori
// filename, titolo, descrizione e preset della console. La normalizzazione rende già equivalenti
// i default omessi ed espliciti, e i messaggi hanno un ordine di chiavi fisso: la serializzazione
// della definizione basta a confrontarle.
function streamSignatureOf(entry) {
  if (entry?.type === "sse") {
    return JSON.stringify(["sse", entry.retryMs ?? null, entry.script, entry.onEnd]);
  }
  if (entry?.type === "ws") {
    return JSON.stringify(["ws", entry.script, entry.rules, entry.onEnd, entry.closeCode ?? null, entry.closeReason ?? null]);
  }
  return null;
}

// Firme degli stream installati, per chiave method/path.
function collectStreamSignatures(routeGroups) {
  const signatures = new Map();
  for (const group of routeGroups || []) {
    for (const entry of group.methods.values()) {
      const signature = streamSignatureOf(entry);
      if (signature != null) {
        signatures.set(`${entry.method} ${entry.path}`, signature);
      }
    }
  }
  return signatures;
}

// Dopo un reload chiude soltanto le connessioni il cui stream non è più lo stesso: firma o tipo
// cambiati, endpoint eliminato o disabilitato, chiave cambiata. Una stessa firma con un altro
// filename, i soli metadati, una variante inattiva, un endpoint estraneo o l'eco identica del
// watcher conservano le connessioni, senza riavviare copione o timer.
function reconcileStreamConnections({ previous, next, stores }) {
  for (const store of stores) {
    if (store == null) {
      continue;
    }
    for (const key of store.openKeys()) {
      const before = previous.get(key);
      if (before == null || before !== next.get(key)) {
        store.closeKey(key);
      }
    }
  }
}

module.exports = {
  collectStreamSignatures,
  reconcileStreamConnections,
  streamSignatureOf,
};
