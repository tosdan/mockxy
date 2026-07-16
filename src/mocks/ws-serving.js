// Serving delle varianti `ws` (vedi docs/progetto/DESIGN-WEBSOCKET.md): l'upgrade che matcha
// un endpoint abilitato con variante selezionata di tipo ws viene gestito QUI (handshake
// locale via `ws`, copione, regole, console); tutto il resto prosegue sul passthrough
// esistente (upgrade-proxy.js), che non viene toccato.

const { WebSocketServer } = require("ws");
const { matchWsRule } = require("./ws-config");
const { wsWirePayload } = require("./ws-connections");

const WS_PING_INTERVAL_MS = 30_000;

/**
 * Crea il dispatcher dell'evento `upgrade`: consulta il registry e serve localmente le
 * varianti ws, delegando ogni altro caso a `fallback` (il tunnel verso il backend).
 * Le connessioni mockate vivono in `wsConnections` (console, push, chiusura a reload).
 */
function createWsUpgradeDispatcher({ registry, serverState, wsConnections, logger, fallback, pingIntervalMs }) {
  // noServer: l'handshake parte solo su nostra decisione, il server HTTP resta di Node.
  const wss = new WebSocketServer({ noServer: true });
  const effectivePingIntervalMs = pingIntervalMs ?? WS_PING_INTERVAL_MS;

  const dispatcher = (req, socket, head) => {
    // A server spento (o proxy totale) i mock non esistono: tutto al passthrough, come per l'HTTP.
    if (serverState.usesMocks()) {
      const requestPath = String(req.url || "");
      const pathname = requestPath.split("?")[0];
      const decision = registry.matchRequest(req.method || "GET", pathname, requestPath);
      if (decision.mode === "ws") {
        wss.handleUpgrade(req, socket, head, (client) => {
          serveWsConnection({ client, decision, wsConnections, logger, pingIntervalMs: effectivePingIntervalMs });
        });
        return;
      }
    }
    fallback(req, socket, head);
  };

  dispatcher.close = () => wss.close();
  return dispatcher;
}

/**
 * Una connessione mockata: registra nello store, manda in onda il copione (afterMs relativi,
 * onEnd keep-open/close/loop), valuta le regole sui messaggi in ingresso (prima che matcha
 * vince, nessun eco di default) e tiene viva la connessione col ping. La pulizia passa tutta
 * dal 'close' del socket, qualunque sia la causa (client, reload, shutdown).
 */
function serveWsConnection({ client, decision, wsConnections, logger, pingIntervalMs = WS_PING_INTERVAL_MS }) {
  const ws = decision.ws;
  const key = `${ws.method} ${ws.path}`;
  const timers = new Set();

  const connection = wsConnections.register(key, {
    scriptLength: ws.script.length,
    send: (text) => client.send(text),
    close: () => client.close(1001, "mockxy reload"),
  });

  const sendMessage = (entry, origin) => {
    client.send(wsWirePayload(entry.data));
    connection.messagesSent += 1;
    wsConnections.record(key, { direction: "out", origin, connectionId: connection.id, data: entry.data });
  };

  // Una scaletta con afterMs relativi (copione o reply di una regola): ogni voce arma il
  // timer della successiva. onDone facoltativo a scaletta esaurita.
  const playEntries = (entries, origin, onDone) => {
    let index = 0;
    const playNext = () => {
      if (index >= entries.length) {
        onDone?.();
        return;
      }
      const entry = entries[index];
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (client.readyState !== client.OPEN) {
          return;
        }
        sendMessage(entry, origin);
        index += 1;
        if (origin === "script") {
          connection.scriptIndex = index;
        }
        playNext();
      }, entry.afterMs);
      timers.add(timer);
    };
    playNext();
  };

  const playScript = () => {
    playEntries(ws.script, "script", () => {
      if (ws.onEnd === "close") {
        client.close(ws.closeCode ?? 1000, ws.closeReason ?? "");
        return;
      }
      if (ws.onEnd === "loop") {
        // La validazione garantisce almeno un afterMs > 0: il giro non può stringersi a zero.
        connection.scriptIndex = 0;
        playScript();
      }
      // keep-open: si resta in ascolto (ping + regole + push manuali).
    });
  };
  playScript();

  client.on("message", (raw, isBinary) => {
    // MVP: frame di testo. Un binario viene registrato come tale e non valuta le regole.
    const text = isBinary ? "[binary frame]" : raw.toString();
    connection.messagesReceived += 1;
    wsConnections.record(key, { direction: "in", origin: "received", connectionId: connection.id, data: text });
    if (isBinary) {
      return;
    }
    const rule = matchWsRule(ws.rules, text);
    if (rule != null) {
      playEntries(rule.reply, "rule");
    }
    // Nessuna regola: solo transcript — niente eco di default (design, questione 3).
  });

  // Ping di protocollo nei silenzi: i pong sono gestiti da `ws`, qui non chiudiamo sul
  // mancato pong (permissivo, vedi design): il mock non deve staccare un client in debug.
  const pingTimer = setInterval(() => {
    if (client.readyState === client.OPEN) {
      client.ping();
    }
  }, pingIntervalMs);

  client.on("error", (error) => {
    logger?.warn?.("Mocked WebSocket connection error.", { key, error: error.message });
  });

  client.on("close", () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
    clearInterval(pingTimer);
    wsConnections.unregister(key, connection.id);
  });
}

module.exports = {
  createWsUpgradeDispatcher,
  serveWsConnection,
  WS_PING_INTERVAL_MS,
};
