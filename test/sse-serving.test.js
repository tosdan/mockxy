const fs = require("fs");
const path = require("path");
const { createApp } = require("../src/app");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { SseConnectionStore } = require("../src/mocks/sse-connections");
const { createNoopLogger, createTempDir, removeDir, waitFor } = require("./helpers");

// Serving delle varianti sse: stream con copione, push manuale, loop, heartbeat e pulizia.
// I test consumano lo stream con fetch su un server reale (supertest non regge stream infiniti).
describe("sse serving", () => {
  let mocksDir;
  let server;
  let baseUrl;
  let openStreams;

  beforeEach(async () => {
    mocksDir = await createTempDir("sse-serving-");
    openStreams = [];
  });

  afterEach(async () => {
    for (const stream of openStreams) {
      stream.abort();
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

  async function writeSseEndpoint({ folder = "feed", routePath = "/api/feed", ...sse }) {
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
      `${JSON.stringify({ type: "sse", title: "Feed", ...sse }, null, 2)}\n`,
      "utf8"
    );
  }

  async function startApp({ sseHeartbeatMs, requestMonitor } = {}) {
    const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, sseRouteGroups, loadErrors } =
      await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toEqual([]);
    const routeGroups = mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups, sseRouteGroups });
    const sseConnections = new SseConnectionStore();
    const app = createApp({
      registry: new MockRegistry(routeGroups),
      config: { requestTimeoutMs: 5000, proxyFallbackEnabled: false, sseHeartbeatMs },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups),
      requestMonitor: requestMonitor || new RequestMonitorStore(),
      sseConnections,
    });
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    return { sseConnections };
  }

  // Apre uno stream SSE e accumula i chunk; readUntil attende che il buffer soddisfi il predicato.
  async function openStream(pathname) {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}${pathname}`, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    const stream = {
      response,
      abort: () => controller.abort(),
      buffer: () => buffer,
      isDone: () => done,
      async readUntil(predicate, timeoutMs = 3000) {
        const deadline = Date.now() + timeoutMs;
        while (!predicate(buffer)) {
          if (done) {
            throw new Error(`stream terminato prima della condizione. Buffer: ${buffer}`);
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            throw new Error(`timeout in attesa dello stream. Buffer: ${buffer}`);
          }
          const chunk = await Promise.race([
            reader.read(),
            new Promise((resolve) => setTimeout(() => resolve("timeout"), remaining)),
          ]);
          if (chunk === "timeout") {
            continue;
          }
          if (chunk.done) {
            done = true;
            break;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        return buffer;
      },
      async readToEnd(timeoutMs = 3000) {
        await this.readUntil(() => done, timeoutMs).catch((error) => {
          if (!done) throw error;
        });
        return buffer;
      },
    };
    openStreams.push(stream);
    return stream;
  }

  test("copione con onEnd close: eventi nell'ordine con i campi SSE, poi il server chiude", async () => {
    await writeSseEndpoint({
      retryMs: 3000,
      script: [
        { afterMs: 0, event: "progress", data: { percent: 10 } },
        { afterMs: 20, data: "quasi\nfatto" },
        { afterMs: 20, event: "done", id: "fine", data: { percent: 100 } },
      ],
      onEnd: "close",
    });
    await startApp();

    const stream = await openStream("/api/feed");
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.response.headers.get("x-mock-source")).toBe("sse");

    const body = await stream.readToEnd();
    expect(body).toContain("retry: 3000\n\n");
    expect(body).toContain('event: progress\ndata: {"percent":10}\n\n');
    // Testo multi-linea → più righe data:
    expect(body).toContain("data: quasi\ndata: fatto\n\n");
    expect(body).toContain('event: done\nid: fine\ndata: {"percent":100}\n\n');
    expect(body.indexOf("progress")).toBeLessThan(body.indexOf("done"));
  });

  test("keep-open: la connessione resta viva, il push manuale la raggiunge, la console la vede", async () => {
    await writeSseEndpoint({
      script: [{ afterMs: 0, event: "hello", data: { n: 1 } }],
      onEnd: "keep-open",
    });
    const { sseConnections } = await startApp();

    const stream = await openStream("/api/feed");
    await stream.readUntil((b) => b.includes("event: hello"));

    const connections = sseConnections.listConnections("GET /api/feed");
    expect(connections).toHaveLength(1);
    expect(connections[0].scriptLength).toBe(1);

    const delivered = sseConnections.push("GET /api/feed", { event: "notifica", data: { tipo: "promo" } });
    expect(delivered).toBe(1);
    await stream.readUntil((b) => b.includes('event: notifica\ndata: {"tipo":"promo"}'));

    // Lo storico distingue copione e regia manuale.
    const history = sseConnections.listHistory("GET /api/feed");
    expect(history.map((h) => h.origin)).toEqual(["script", "manual"]);

    // Alla disconnessione del client la connessione sparisce dalla console.
    stream.abort();
    await waitFor(() => sseConnections.listConnections("GET /api/feed").length === 0);
  });

  test("onEnd loop: il copione ricomincia dal primo evento", async () => {
    await writeSseEndpoint({
      script: [
        { afterMs: 10, event: "tick", data: 1 },
        { afterMs: 10, event: "tock", data: 2 },
      ],
      onEnd: "loop",
    });
    await startApp();

    const stream = await openStream("/api/feed");
    await stream.readUntil((b) => (b.match(/event: tick/g) || []).length >= 2);
    const body = stream.buffer();
    expect((body.match(/event: tock/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  test("heartbeat: nei silenzi arrivano commenti ping (invisibili come eventi)", async () => {
    await writeSseEndpoint({ script: [], onEnd: "keep-open" });
    await startApp({ sseHeartbeatMs: 30 });

    const stream = await openStream("/api/feed");
    await stream.readUntil((b) => (b.match(/: ping/g) || []).length >= 2);
    expect(stream.buffer()).not.toContain("event:");
  });

  test("due client hanno ciascuno il proprio copione dall'inizio", async () => {
    await writeSseEndpoint({
      script: [{ afterMs: 30, event: "solo", data: "primo" }],
      onEnd: "keep-open",
    });
    const { sseConnections } = await startApp();

    const first = await openStream("/api/feed");
    await first.readUntil((b) => b.includes("event: solo"));
    // Il secondo client arriva DOPO che il primo ha già ricevuto l'evento: lo riceve comunque.
    const second = await openStream("/api/feed");
    await second.readUntil((b) => b.includes("event: solo"));
    expect(sseConnections.listConnections("GET /api/feed")).toHaveLength(2);
  });

  test("la voce del monitor nasce alla chiusura della connessione (anche dal client)", async () => {
    await writeSseEndpoint({
      script: [{ afterMs: 0, event: "hello", data: 1 }],
      onEnd: "keep-open",
    });
    const requestMonitor = new RequestMonitorStore();
    await startApp({ requestMonitor });

    const stream = await openStream("/api/feed");
    await stream.readUntil((b) => b.includes("event: hello"));
    expect(requestMonitor.listEntries()).toHaveLength(0);

    stream.abort();
    await waitFor(() => requestMonitor.listEntries().length === 1);
    const entry = requestMonitor.listEntries()[0];
    expect(entry.source).toBe("sse");
    expect(entry.matchedRoutePath).toBe("/api/feed");
  });
});
