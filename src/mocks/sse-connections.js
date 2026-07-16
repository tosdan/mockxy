// Connessioni SSE vive e regia degli eventi (vedi docs/progetto/DESIGN-SSE.md).
//
// Lo store tiene, per endpoint ("METHOD path"), le connessioni aperte e uno storico breve dei
// messaggi usciti (copione e manuali): è ciò che alimenta la console della UI e il push via
// admin API. Come gli altri stati runtime (cursori delle sequenze, memoria degli handler) è
// in-memory ed effimero; in più qui le connessioni vengono chiuse esplicitamente a ogni
// ricarica a caldo e allo shutdown — il client SSE riconnette da solo, e "riconnessione =
// il copione riparte" è la semantica documentata.

const HISTORY_LIMIT = 100;

// Serializzazione di un messaggio nel wire format SSE: event/id facoltativi, data sempre
// presente (il JSON viene serializzato; il testo multi-linea diventa più righe `data:`).
function formatSseMessage({ event, data, id }) {
  let out = "";
  if (event != null && event !== "") {
    out += `event: ${event}\n`;
  }
  if (id != null && id !== "") {
    out += `id: ${id}\n`;
  }
  const text = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of String(text).split("\n")) {
    out += `data: ${line}\n`;
  }
  return `${out}\n`;
}

class SseConnectionStore {
  constructor({ now = () => Date.now() } = {}) {
    this.endpoints = new Map();
    this.nextConnectionId = 1;
    this.now = now;
  }

  entryFor(key) {
    let entry = this.endpoints.get(key);
    if (entry == null) {
      entry = { connections: new Map(), history: [] };
      this.endpoints.set(key, entry);
    }
    return entry;
  }

  /**
   * Registra una connessione appena aperta. `connection` deve esporre `write(text)` e
   * `close()`; lo store aggiunge id e startedAt. Restituisce l'oggetto arricchito; chi
   * registra deve chiamare `unregister` alla chiusura.
   */
  register(key, connection) {
    const entry = this.entryFor(key);
    const id = this.nextConnectionId;
    this.nextConnectionId += 1;
    const tracked = {
      id,
      startedAt: this.now(),
      eventsSent: 0,
      scriptIndex: 0,
      ...connection,
    };
    entry.connections.set(id, tracked);
    return tracked;
  }

  unregister(key, connectionId) {
    this.endpoints.get(key)?.connections.delete(connectionId);
  }

  /** Registra un messaggio uscito nello storico dell'endpoint (per la console). */
  recordSent(key, message, origin, connectionId) {
    const entry = this.entryFor(key);
    entry.history.push({
      at: this.now(),
      origin,
      connectionId,
      event: message.event,
      id: message.id,
      data: message.data,
    });
    if (entry.history.length > HISTORY_LIMIT) {
      entry.history.splice(0, entry.history.length - HISTORY_LIMIT);
    }
  }

  /** Connessioni aperte dell'endpoint, per la console/admin API. */
  listConnections(key) {
    const entry = this.endpoints.get(key);
    if (entry == null) {
      return [];
    }
    return [...entry.connections.values()].map((connection) => ({
      id: connection.id,
      startedAt: connection.startedAt,
      eventsSent: connection.eventsSent,
      scriptIndex: connection.scriptIndex,
      scriptLength: connection.scriptLength ?? 0,
    }));
  }

  /** Storico dei messaggi usciti (copione e manuali), più recente in coda. */
  listHistory(key) {
    return [...(this.endpoints.get(key)?.history ?? [])];
  }

  /**
   * Push manuale: invia il messaggio a TUTTE le connessioni aperte dell'endpoint (broadcast,
   * vedi design). Restituisce il numero di consegne; lo storico registra il messaggio una
   * volta sola anche a zero consegne (la regia è avvenuta, anche senza pubblico).
   */
  push(key, message) {
    const entry = this.entryFor(key);
    const wire = formatSseMessage(message);
    let delivered = 0;
    for (const connection of entry.connections.values()) {
      try {
        connection.write(wire);
        connection.eventsSent += 1;
        delivered += 1;
      } catch {
        /* connessione morente: la pulizia arriva dal suo close */
      }
    }
    this.recordSent(key, message, "manual");
    return delivered;
  }

  /** Chiude tutte le connessioni (ricarica a caldo, shutdown): il client SSE riconnette da solo. */
  closeAll() {
    for (const entry of this.endpoints.values()) {
      for (const connection of [...entry.connections.values()]) {
        try {
          connection.close();
        } catch {
          /* già chiusa */
        }
      }
      entry.connections.clear();
    }
  }
}

module.exports = {
  SseConnectionStore,
  formatSseMessage,
};
