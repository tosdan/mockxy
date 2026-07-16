// Connessioni WebSocket mockate vive e transcript bidirezionale (vedi
// docs/progetto/DESIGN-WEBSOCKET.md).
//
// Come SseConnectionStore: per endpoint ("METHOD path"), le connessioni aperte e uno storico
// breve — qui però nei DUE versi: i messaggi usciti (copione/regola/manuale) e quelli arrivati
// dal client ("received"). Stato runtime in-memory ed effimero; le connessioni si chiudono
// esplicitamente a ogni ricarica a caldo e allo shutdown (riconnessione = il copione riparte).

const TRANSCRIPT_LIMIT = 100;

// Payload sul filo: il JSON viene serializzato, il testo passa com'è (frame di testo).
function wsWirePayload(data) {
  return typeof data === "string" ? data : JSON.stringify(data);
}

class WsConnectionStore {
  constructor({ now = () => Date.now() } = {}) {
    this.endpoints = new Map();
    this.nextConnectionId = 1;
    this.now = now;
  }

  entryFor(key) {
    let entry = this.endpoints.get(key);
    if (entry == null) {
      entry = { connections: new Map(), transcript: [] };
      this.endpoints.set(key, entry);
    }
    return entry;
  }

  /**
   * Registra una connessione appena aperta. `connection` deve esporre `send(text)` e
   * `close()`; lo store aggiunge id e startedAt. Chi registra chiama `unregister` alla chiusura.
   */
  register(key, connection) {
    const entry = this.entryFor(key);
    const id = this.nextConnectionId;
    this.nextConnectionId += 1;
    const tracked = {
      id,
      startedAt: this.now(),
      messagesSent: 0,
      messagesReceived: 0,
      scriptIndex: 0,
      ...connection,
    };
    entry.connections.set(id, tracked);
    return tracked;
  }

  unregister(key, connectionId) {
    this.endpoints.get(key)?.connections.delete(connectionId);
  }

  /**
   * Registra una voce di transcript. `direction`: "out" | "in"; `origin`: "script" | "rule" |
   * "manual" | "received". `data` resta nella forma dichiarata (JSON o stringa): è la console
   * a formattarla.
   */
  record(key, { direction, origin, connectionId, data }) {
    const entry = this.entryFor(key);
    entry.transcript.push({ at: this.now(), direction, origin, connectionId, data });
    if (entry.transcript.length > TRANSCRIPT_LIMIT) {
      entry.transcript.splice(0, entry.transcript.length - TRANSCRIPT_LIMIT);
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
      messagesSent: connection.messagesSent,
      messagesReceived: connection.messagesReceived,
      scriptIndex: connection.scriptIndex,
      scriptLength: connection.scriptLength ?? 0,
    }));
  }

  /** Transcript bidirezionale (più recente in coda). */
  listTranscript(key) {
    return [...(this.endpoints.get(key)?.transcript ?? [])];
  }

  /**
   * Push manuale: invia `data` a TUTTE le connessioni aperte dell'endpoint (broadcast).
   * Il transcript registra il messaggio una volta sola anche a zero consegne (la regia è
   * avvenuta, anche senza pubblico). Restituisce il numero di consegne.
   */
  push(key, data) {
    const entry = this.entryFor(key);
    const wire = wsWirePayload(data);
    let delivered = 0;
    for (const connection of entry.connections.values()) {
      try {
        connection.send(wire);
        connection.messagesSent += 1;
        delivered += 1;
      } catch {
        /* connessione morente: la pulizia arriva dal suo close */
      }
    }
    this.record(key, { direction: "out", origin: "manual", data });
    return delivered;
  }

  /** Chiude tutte le connessioni (ricarica a caldo, shutdown): il client riconnette da solo. */
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
  WsConnectionStore,
  wsWirePayload,
};
