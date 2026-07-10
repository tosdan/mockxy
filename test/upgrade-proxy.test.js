const http = require("http");
const { startServer } = require("../src/server");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Passthrough delle WebSocket (seguito del #24): l'upgrade attraversa Mockxy come tunnel puro
// verso il backend. Il test non usa una libreria WebSocket: dopo il 101 il tunnel è agnostico,
// quindi basta un backend che accetta l'upgrade a mano e fa eco dei byte.
describe("upgrade proxy (passthrough WebSocket)", () => {
  let mocksDir;
  let backend;
  let runtime;

  beforeEach(async () => {
    mocksDir = await createTempDir("upgrade-proxy-");
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.shutdown();
      runtime = null;
    }
    if (backend) {
      // I socket passati in upgrade si staccano dal tracking del server (come nel prodotto):
      // vanno distrutti a mano, altrimenti backend.close() resta appeso.
      for (const socket of backend.__sockets) {
        socket.destroy();
      }
      await new Promise((resolve) => backend.close(resolve));
      backend = null;
    }
    await removeDir(mocksDir);
  });

  // Traccia i socket di un server http di test così l'afterEach può chiuderli deterministicamente.
  function trackSockets(server) {
    server.__sockets = new Set();
    server.on("connection", (socket) => {
      server.__sockets.add(socket);
      socket.on("close", () => server.__sockets.delete(socket));
    });
    return server;
  }

  // Backend che accetta l'upgrade e fa eco dei byte ricevuti; registra la richiesta di handshake.
  function startEchoBackend(seen) {
    return new Promise((resolve) => {
      const server = trackSockets(http.createServer((_req, res) => {
        res.statusCode = 200;
        res.end("http");
      }));
      server.on("upgrade", (req, socket) => {
        seen.upgradeRequest = { url: req.url, headers: req.headers };
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nx-backend: echo\r\n\r\n"
        );
        socket.on("data", (chunk) => socket.write(chunk));
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
  }

  async function startProxy(configOverrides = {}) {
    runtime = await startServer({
      configOverrides: {
        port: 0,
        host: "127.0.0.1",
        mocksDir,
        monitorDumpDir: mocksDir,
        devWatch: false,
        adminApiEnabled: false,
        ...configOverrides,
      },
      logger: createNoopLogger(),
    });
    if (!runtime.server.listening) {
      await new Promise((resolve) => runtime.server.once("listening", resolve));
    }
    return runtime.server.address().port;
  }

  // Apre una richiesta di upgrade verso il proxy e risolve con l'evento che arriva per primo:
  // { upgraded, res?, socket? } su upgrade, { upgraded: false, res } su risposta normale.
  function requestUpgrade(port, path = "/live") {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path,
        headers: { connection: "Upgrade", upgrade: "websocket", "x-trace": "abc" },
      });
      req.on("upgrade", (res, socket) => resolve({ upgraded: true, res, socket }));
      req.on("response", (res) => resolve({ upgraded: false, res }));
      req.on("error", reject);
      req.end();
    });
  }

  test("handshake ed eco nei due sensi attraverso il tunnel", async () => {
    const seen = {};
    backend = await startEchoBackend(seen);
    const port = await startProxy({ backendUrl: `http://127.0.0.1:${backend.address().port}` });

    const { upgraded, res, socket } = await requestUpgrade(port, "/live?room=1");
    expect(upgraded).toBe(true);
    expect(res.statusCode).toBe(101);
    expect(res.headers["x-backend"]).toBe("echo");

    // L'handshake è arrivato al backend con path e header applicativi intatti,
    // host riscritto sulla tratta upstream.
    expect(seen.upgradeRequest.url).toBe("/live?room=1");
    expect(seen.upgradeRequest.headers["x-trace"]).toBe("abc");
    expect(seen.upgradeRequest.headers.host).toBe(`127.0.0.1:${backend.address().port}`);

    // Eco: i byte attraversano il tunnel in entrambe le direzioni.
    const echoed = new Promise((resolve) => socket.once("data", resolve));
    socket.write("ping-attraverso-il-tunnel");
    expect((await echoed).toString()).toBe("ping-attraverso-il-tunnel");

    socket.destroy();
  });

  test("senza backend configurato l'upgrade riceve un 501 onesto", async () => {
    const port = await startProxy({ backendUrl: "", proxyFallbackEnabled: false });

    const { upgraded, res } = await requestUpgrade(port);
    expect(upgraded).toBe(false);
    expect(res.statusCode).toBe(501);
  });

  test("in modalità solo-mock l'upgrade non viene inoltrato (404)", async () => {
    const seen = {};
    backend = await startEchoBackend(seen);
    const port = await startProxy({
      backendUrl: `http://127.0.0.1:${backend.address().port}`,
      proxyFallbackEnabled: false,
    });

    const { upgraded, res } = await requestUpgrade(port);
    expect(upgraded).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(seen.upgradeRequest).toBeUndefined();
  });

  test("un rifiuto del backend (403) viene inoltrato al client come risposta normale", async () => {
    backend = await new Promise((resolve) => {
      const server = trackSockets(http.createServer());
      server.on("upgrade", (_req, socket) => {
        socket.end(
          "HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\ncontent-length: 2\r\nconnection: close\r\n\r\nno"
        );
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
    const port = await startProxy({ backendUrl: `http://127.0.0.1:${backend.address().port}` });

    const { upgraded, res } = await requestUpgrade(port);
    expect(upgraded).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test("se il backend cade a tunnel stabilito, il client vede la chiusura senza byte HTTP iniettati", async () => {
    const seen = {};
    let backendSocket = null;
    backend = await new Promise((resolve) => {
      const server = trackSockets(http.createServer());
      server.on("upgrade", (req, socket) => {
        seen.upgradeRequest = { url: req.url };
        backendSocket = socket;
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
        );
        socket.on("data", (chunk) => socket.write(chunk));
        socket.on("error", () => {});
      });
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
    const port = await startProxy({ backendUrl: `http://127.0.0.1:${backend.address().port}` });

    const { upgraded, socket } = await requestUpgrade(port);
    expect(upgraded).toBe(true);

    // Tunnel operativo prima del crollo.
    const echoed = new Promise((resolve) => socket.once("data", resolve));
    socket.write("ping");
    expect((await echoed).toString()).toBe("ping");

    // Il backend crolla in modo brusco: al client non deve arrivare un 502 HTTP in mezzo ai
    // frame (corromperebbe il protocollo) — deve solo chiudersi la connessione.
    const received = [];
    socket.on("data", (chunk) => received.push(chunk));
    const clientClosed = new Promise((resolve) => socket.on("close", resolve));
    backendSocket.destroy(new Error("backend crashed"));
    await clientClosed;

    expect(Buffer.concat(received).toString()).not.toContain("HTTP/1.1");
  });

  test("lo shutdown completa anche con un tunnel aperto", async () => {
    const seen = {};
    backend = await startEchoBackend(seen);
    const port = await startProxy({ backendUrl: `http://127.0.0.1:${backend.address().port}` });

    const { upgraded, socket } = await requestUpgrade(port);
    expect(upgraded).toBe(true);

    // Senza chiusura delle connessioni upgradate, questo await resterebbe appeso (timeout test).
    await runtime.shutdown();
    runtime = null;
    socket.destroy();
  }, 10000);
});
