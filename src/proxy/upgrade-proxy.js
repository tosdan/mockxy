const http = require("http");
const https = require("https");
const { isProxyFallbackEnabled } = require("../app");
const { sanitizeRequestHeaders, serializeError } = require("./proxy");
const { readStreamToBuffer } = require("../utils/http-body-utils");

// Cap prudenziale sul body di una risposta upstream NON-101 (es. un 401 all'handshake): sono
// pagine d'errore, non payload — oltre il cap si chiude e basta.
const MAX_REFUSAL_BODY_BYTES = 64 * 1024;

/**
 * Passthrough puro delle richieste di upgrade (WebSocket e simili) verso il backend.
 *
 * Le richieste di upgrade non passano da Express: Node le smista sull'evento `upgrade` del
 * server HTTP. Qui non c'entrano mock, handler o middleware — i mock sono HTTP, e chi mocka le
 * API HTTP ma usa WebSocket per il resto (notifiche, live update) non deve trovarsele rotte.
 * Policy: sempre e solo tunnel verso il backend; l'admin non ha upgrade; niente backend o
 * modalità solo-mock → risposta HTTP onesta sul socket. Il tunnel, stabilito il 101, è
 * agnostico rispetto al protocollo: byte da una parte, byte dall'altra, senza idle timeout
 * (le WebSocket vivono a lungo; il timeout protegge solo l'handshake).
 */

// Risposta HTTP minimale scritta sul socket grezzo (siamo prima dell'upgrade: niente res).
function writeSocketResponse(socket, status, reason, message) {
  const body = JSON.stringify({ error: reason, message });
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n` +
      "content-type: application/json\r\n" +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      "connection: close\r\n" +
      "\r\n" +
      body
  );
}

// Serializza i rawHeaders (coppie nome/valore) in righe HTTP, preservando case e duplicati.
function rawHeaderLines(rawHeaders, skipNames = new Set()) {
  const lines = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (skipNames.has(rawHeaders[index].toLowerCase())) {
      continue;
    }
    lines.push(`${rawHeaders[index]}: ${rawHeaders[index + 1]}`);
  }
  return lines;
}

// Incolla i due socket dopo il 101: byte in entrambe le direzioni, distruzione incrociata.
function bridgeSockets(clientSocket, upstreamSocket) {
  clientSocket.setTimeout(0);
  upstreamSocket.setTimeout(0);
  clientSocket.on("error", () => upstreamSocket.destroy());
  upstreamSocket.on("error", () => clientSocket.destroy());
  clientSocket.on("close", () => upstreamSocket.destroy());
  upstreamSocket.on("close", () => clientSocket.destroy());
  clientSocket.pipe(upstreamSocket);
  upstreamSocket.pipe(clientSocket);
}

function createUpgradeHandler({ config, serverState, logger }) {
  // I socket passati in upgrade si staccano dal tracking del server: server.close/
  // closeAllConnections non li chiude, quindi lo shutdown resterebbe appeso su un tunnel
  // attivo. Li teniamo qui per poterli distruggere esplicitamente allo spegnimento.
  const activeClientSockets = new Set();

  const handler = (req, socket, head) => {
    activeClientSockets.add(socket);
    socket.on("close", () => activeClientSockets.delete(socket));
    // Un client che sparisce a metà handshake non deve far crashare il processo.
    socket.on("error", () => {});

    const requestPath = String(req.url || "");
    if (requestPath.startsWith("/_admin")) {
      writeSocketResponse(socket, 404, "Not Found", "The admin API has no upgrade endpoints.");
      return;
    }
    if (!config.backendUrl) {
      writeSocketResponse(socket, 501, "Backend Not Configured", "Upgrade requests are proxied to BACKEND_URL, which is not set.");
      return;
    }
    if (serverState.usesMocks() && !isProxyFallbackEnabled(config)) {
      writeSocketResponse(socket, 404, "Mock Only", "Proxy fallback is disabled: upgrade requests are not forwarded to the backend.");
      return;
    }

    const targetUrl = new URL(requestPath, config.backendUrl);
    const client = targetUrl.protocol === "https:" ? https : http;
    // La sanitizzazione toglie gli hop-by-hop (Connection/Upgrade inclusi): per la tratta verso
    // il backend vanno ricreati, perché l'upgrade è proprio una negoziazione per-tratta.
    const headers = sanitizeRequestHeaders(req.headers, targetUrl.host);
    headers.connection = "Upgrade";
    headers.upgrade = req.headers.upgrade;

    const upstreamReq = client.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers,
    });

    const logContext = {
      requestPath,
      backendUrl: config.backendUrl,
      upgrade: req.headers.upgrade,
    };

    // Il timeout protegge solo l'handshake: a tunnel stabilito viene rimosso (bridgeSockets).
    upstreamReq.setTimeout(config.requestTimeoutMs, () => {
      upstreamReq.destroy(new Error("upstream_timeout"));
    });

    // A tunnel stabilito la risposta HTTP al client non è più un'opzione: scrivere un 502 nel
    // socket inietterebbe byte HTTP in mezzo ai frame. Da lì in poi, su errore si chiude e basta.
    let tunnelEstablished = false;

    upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      tunnelEstablished = true;
      logger.info("Upgrade tunneled to the backend.", logContext);
      socket.write(
        `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage || "Switching Protocols"}\r\n` +
          rawHeaderLines(upstreamRes.rawHeaders).map((line) => `${line}\r\n`).join("") +
          "\r\n"
      );
      if (upstreamHead && upstreamHead.length > 0) {
        socket.write(upstreamHead);
      }
      if (head && head.length > 0) {
        upstreamSocket.write(head);
      }
      bridgeSockets(socket, upstreamSocket);
    });

    // Il backend ha rifiutato l'upgrade con una risposta normale (es. 401): la si inoltra com'è.
    // Il body viene bufferizzato per riscrivere content-length (il pipe decodifica il chunking,
    // quindi i rawHeaders di trasporto non sarebbero più veritieri).
    upstreamReq.on("response", async (upstreamRes) => {
      try {
        const bodyBuffer = await readStreamToBuffer(upstreamRes, { maxBytes: MAX_REFUSAL_BODY_BYTES });
        const headerLines = rawHeaderLines(
          upstreamRes.rawHeaders,
          new Set(["transfer-encoding", "content-length", "connection", "keep-alive"])
        );
        socket.write(
          `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage || ""}\r\n` +
            headerLines.map((line) => `${line}\r\n`).join("") +
            `content-length: ${bodyBuffer.length}\r\nconnection: close\r\n\r\n`
        );
        socket.end(bodyBuffer);
      } catch (_error) {
        socket.destroy();
      }
    });

    upstreamReq.on("error", (error) => {
      logger.warn("Upgrade tunnel failed.", { ...logContext, ...serializeError(error) });
      if (tunnelEstablished) {
        socket.destroy();
        return;
      }
      writeSocketResponse(socket, 502, "Bad Gateway", "The backend refused or dropped the upgrade connection.");
    });

    socket.on("close", () => {
      upstreamReq.destroy();
    });

    upstreamReq.end();
  };

  // Distrugge i tunnel attivi: chiude il lato client, che a cascata distrugge il lato upstream
  // (vedi bridgeSockets). Usato dallo shutdown per non restare appeso su connessioni lunghe.
  handler.closeConnections = () => {
    for (const socket of activeClientSockets) {
      socket.destroy();
    }
    activeClientSockets.clear();
  };

  return handler;
}

module.exports = { createUpgradeHandler };
