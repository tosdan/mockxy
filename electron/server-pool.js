// Pool di motori di Mockxy: tiene avviati più server insieme, uno per workspace, ognuno
// sulla sua porta (caso d'uso: due git worktree con due frontend). È generico e testabile: la
// funzione `launch`, che avvia davvero un motore per un dato workspace, viene iniettata dal
// processo principale (così questo modulo non dipende da Electron).

function createServerPool({ launch }) {
  // root del workspace -> { root, runtime, port, url }
  const servers = new Map();

  function has(root) {
    return servers.has(root);
  }

  function get(root) {
    return servers.get(root);
  }

  // Elenco dei workspace aperti, senza il runtime (serializzabile, per menu/IPC).
  function list() {
    return [...servers.values()].map(({ runtime, ...rest }) => rest);
  }

  // Avvia il motore per un workspace, o restituisce quello già attivo (niente doppioni).
  async function open(root) {
    const existing = servers.get(root);
    if (existing) {
      return existing;
    }
    const started = await launch(root); // { runtime, port, url }
    const entry = { root, ...started };
    servers.set(root, entry);
    return entry;
  }

  // Spegne il motore di un workspace e lo toglie dal pool.
  async function close(root) {
    const entry = servers.get(root);
    if (!entry) {
      return false;
    }
    servers.delete(root);
    if (entry.runtime && typeof entry.runtime.shutdown === "function") {
      await entry.runtime.shutdown();
    }
    return true;
  }

  async function closeAll() {
    for (const root of [...servers.keys()]) {
      await close(root);
    }
  }

  return { has, get, list, open, close, closeAll };
}

module.exports = { createServerPool };
