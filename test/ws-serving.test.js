const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { createApp } = require("../src/app");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { WsConnectionStore } = require("../src/mocks/ws-connections");
const { createWsUpgradeDispatcher } = require("../src/mocks/ws-serving");
const { ServerStateStore } = require("../src/server-state");
const { startServer } = require("../src/server");
const { createNoopLogger, createTempDir, removeDir, waitFor } = require("./helpers");

// Serving delle varianti ws: handshake locale sull'upgrade che matcha, copione, regole,
// push manuale, onEnd close e 426 sull'HTTP normale. Client reale (ws) su server reale.
describe("ws serving", () => {
  let mocksDir;
  let server;
  let baseUrl;
  let openClients;

  beforeEach(async () => {
    mocksDir = await createTempDir("ws-serving-");
    openClients = [];
  });

  afterEach(async () => {
    for (const client of openClients) {
      try {
        client.terminate();
      } catch {
        /* già chiuso */
      }
    }
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      });
      server = null;
    }
    await removeDir(mocksDir);
  });

  async function writeWsEndpoint({ folder = "canale", routePath = "/api/canale", ...ws }) {
    const endpointDir = path.join(mocksDir, folder);
    const responseDir = path.join(endpointDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(endpointDir, "GET.endpoint.json"),
      `${JSON.stringify({
        method: "GET",
        path: routePath,
        description: "",
        enabled: true,
        responseFiles: ["001.response.json"],
        selectedResponseFile: "001.response.json",
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      `${JSON.stringify({ type: "ws", title: "Canale", ...ws }, null, 2)}\n`,
      "utf8"
    );
  }

  async function startApp() {
    const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, sseRouteGroups, wsRouteGroups, loadErrors } =
      await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toEqual([]);
    const routeGroups = mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups, sseRouteGroups, wsRouteGroups });
    const registry = new MockRegistry(routeGroups);
    const serverState = new ServerStateStore();
    const wsConnections = new WsConnectionStore();
    const fallbackCalls = [];
    const app = createApp({
      registry,
      config: { requestTimeoutMs: 5000, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups),
      requestMonitor: new RequestMonitorStore(),
      serverState,
      wsConnections,
    });
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    const dispatcher = createWsUpgradeDispatcher({
      registry,
      serverState,
      wsConnections,
      logger: createNoopLogger(),
      fallback: (req, socket) => {
        fallbackCalls.push(String(req.url));
        socket.end("HTTP/1.1 501 Not Implemented\r\nconnection: close\r\n\r\n");
      },
      pingIntervalMs: 60_000,
    });
    server.on("upgrade", dispatcher);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    return { wsConnections, serverState, fallbackCalls };
  }

  function connect(routePath) {
    const client = new WebSocket(`${baseUrl.replace("http", "ws")}${routePath}`);
    openClients.push(client);
    return client;
  }

  function collectMessages(client) {
    const messages = [];
    client.on("message", (raw) => messages.push(raw.toString()));
    return messages;
  }

  test("il copione va in onda sull'upgrade che matcha, con i suoi tempi", async () => {
    await writeWsEndpoint({
      script: [
        { afterMs: 0, data: { tipo: "benvenuto" } },
        { afterMs: 50, data: "secondo" },
      ],
    });
    const { wsConnections } = await startApp();

    const client = connect("/api/canale");
    const messages = collectMessages(client);
    await waitFor(() => messages.length === 2);

    expect(JSON.parse(messages[0])).toEqual({ tipo: "benvenuto" });
    expect(messages[1]).toBe("secondo");
    const connections = wsConnections.listConnections("GET /api/canale");
    expect(connections).toHaveLength(1);
    expect(connections[0].messagesSent).toBe(2);
    expect(connections[0].scriptIndex).toBe(2);
  });

  test("una regola risponde al messaggio che matcha, solo alla connessione che ha parlato", async () => {
    await writeWsEndpoint({
      rules: [{ match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] }],
    });
    const { wsConnections } = await startApp();

    const talker = connect("/api/canale");
    const listener = connect("/api/canale");
    const talkerMessages = collectMessages(talker);
    const listenerMessages = collectMessages(listener);
    await waitFor(() => wsConnections.listConnections("GET /api/canale").length === 2);

    talker.send("ping");
    await waitFor(() => talkerMessages.length === 1);
    expect(talkerMessages[0]).toBe("pong");
    expect(listenerMessages).toEqual([]);

    const transcript = wsConnections.listTranscript("GET /api/canale");
    expect(transcript.map((entry) => `${entry.direction}:${entry.origin}`)).toEqual([
      "in:received",
      "out:rule",
    ]);
  });

  test("un messaggio senza regola resta solo nel transcript (niente eco)", async () => {
    await writeWsEndpoint({
      rules: [{ match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] }],
    });
    const { wsConnections } = await startApp();

    const client = connect("/api/canale");
    const messages = collectMessages(client);
    await waitFor(() => wsConnections.listConnections("GET /api/canale").length === 1);

    client.send("qualcosa di ignoto");
    await waitFor(() => wsConnections.listTranscript("GET /api/canale").length === 1);
    // Nessuna risposta in arrivo: piccola attesa di contrasto prima di asserire il silenzio.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(messages).toEqual([]);
    expect(wsConnections.listTranscript("GET /api/canale")[0]).toMatchObject({
      direction: "in",
      origin: "received",
      data: "qualcosa di ignoto",
    });
  });

  test("il push manuale è broadcast a tutte le connessioni", async () => {
    await writeWsEndpoint({});
    const { wsConnections } = await startApp();

    const first = connect("/api/canale");
    const second = connect("/api/canale");
    const firstMessages = collectMessages(first);
    const secondMessages = collectMessages(second);
    await waitFor(() => wsConnections.listConnections("GET /api/canale").length === 2);

    const delivered = wsConnections.push("GET /api/canale", { tipo: "promo" });
    expect(delivered).toBe(2);
    await waitFor(() => firstMessages.length === 1 && secondMessages.length === 1);
    expect(JSON.parse(firstMessages[0])).toEqual({ tipo: "promo" });
  });

  test("onEnd close chiude dal server con codice e reason dichiarati", async () => {
    await writeWsEndpoint({
      script: [{ afterMs: 0, data: "fine" }],
      onEnd: "close",
      closeCode: 4002,
      closeReason: "lavoro concluso",
    });
    await startApp();

    const client = connect("/api/canale");
    const closed = new Promise((resolve) => {
      client.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    expect(await closed).toEqual({ code: 4002, reason: "lavoro concluso" });
  });

  test("una GET normale sull'endpoint ws risponde 426 Upgrade Required", async () => {
    await writeWsEndpoint({});
    await startApp();

    const response = await fetch(`${baseUrl}/api/canale`);
    expect(response.status).toBe(426);
    expect(response.headers.get("x-mock-source")).toBe("ws");
    expect((await response.json()).error).toBe("Upgrade Required");
  });

  test("un upgrade che non matcha endpoint ws va al passthrough", async () => {
    await writeWsEndpoint({});
    const { fallbackCalls } = await startApp();

    const client = connect("/altra/rotta");
    await new Promise((resolve) => client.on("error", resolve));
    expect(fallbackCalls).toEqual(["/altra/rotta"]);
  });

  test("a server spento anche l'upgrade sull'endpoint ws va al passthrough", async () => {
    await writeWsEndpoint({});
    const { serverState, fallbackCalls } = await startApp();
    serverState.setState({ serverEnabled: false });

    const client = connect("/api/canale");
    await new Promise((resolve) => client.on("error", resolve));
    expect(fallbackCalls).toEqual(["/api/canale"]);
  });

  test("closeAll chiude le connessioni mockate (reload/shutdown)", async () => {
    await writeWsEndpoint({});
    const { wsConnections } = await startApp();

    const client = connect("/api/canale");
    await waitFor(() => wsConnections.listConnections("GET /api/canale").length === 1);
    const closed = new Promise((resolve) => client.on("close", (code) => resolve(code)));

    wsConnections.closeAll();
    expect(await closed).toBe(1001);
    expect(wsConnections.listConnections("GET /api/canale")).toEqual([]);
  });

  // Regressione: il merge dei wsRouteGroups deve avvenire anche al CARICAMENTO INIZIALE del
  // server, non solo al reload — senza, un endpoint ws presente al boot finiva nel passthrough
  // finché una mutazione admin non forzava la ricarica.
  test("un endpoint ws presente al boot è servito senza bisogno di reload", async () => {
    await writeWsEndpoint({ script: [{ afterMs: 0, data: "boot" }] });
    const port = 3000 + Math.floor(Math.random() * 2000);
    const runtime = await startServer({
      configOverrides: {
        port,
        host: "127.0.0.1",
        mocksDir,
        monitorDumpDir: mocksDir,
        devWatch: false,
        adminApiEnabled: false,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });

    try {
      const client = new WebSocket(`ws://127.0.0.1:${port}/api/canale`);
      openClients.push(client);
      const messages = collectMessages(client);
      await waitFor(() => messages.length === 1);
      expect(messages[0]).toBe("boot");
    } finally {
      await runtime.shutdown();
    }
  });
});
