const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { encodeMockId } = require("../src/admin/mock-ids");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { SseConnectionStore } = require("../src/mocks/sse-connections");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Admin API delle varianti sse: lettura senza degradare, aggiornamento del copione, creazione,
// push manuale e stato della console.
describe("sse admin API", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("sse-admin-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  const MOCK_ID = encodeMockId("feed/GET.endpoint.json");

  async function writeSseEndpoint(sseOverrides = {}) {
    const endpointDir = path.join(mocksDir, "feed");
    const responseDir = path.join(endpointDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(endpointDir, "GET.endpoint.json"),
      `${JSON.stringify({
        method: "GET",
        path: "/api/feed",
        description: "",
        enabled: true,
        responseFiles: ["001.response.json"],
        selectedResponseFile: "001.response.json",
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      `${JSON.stringify({
        type: "sse",
        title: "Feed live",
        script: [{ afterMs: 0, event: "hello", data: { n: 1 } }],
        onEnd: "keep-open",
        presets: [{ label: "Promo", event: "notifica", data: { tipo: "promo" } }],
        ...sseOverrides,
      }, null, 2)}\n`,
      "utf8"
    );
  }

  async function readResponseFromDisk() {
    return JSON.parse(await fs.promises.readFile(path.join(mocksDir, "feed", "GET.responses", "001.response.json"), "utf8"));
  }

  async function buildApp() {
    const sseConnections = new SseConnectionStore();
    const load = async () => {
      const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, sseRouteGroups } =
        await loadEndpointRouteGroups(mocksDir);
      return {
        routeGroups: mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups, sseRouteGroups }),
        proxyMiddlewareRouteGroups,
      };
    };
    const initial = await load();
    const registry = new MockRegistry(initial.routeGroups);
    const proxyMiddlewareRegistry = new ProxyMiddlewareRegistry(initial.proxyMiddlewareRouteGroups);
    const reloadRuntime = async () => {
      const next = await load();
      registry.setRouteGroups(next.routeGroups);
      proxyMiddlewareRegistry.setRouteGroups(next.proxyMiddlewareRouteGroups);
    };
    const app = createApp({
      registry,
      config: { mocksDir, requestTimeoutMs: 5000, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry,
      reloadRuntime,
      requestMonitor: new RequestMonitorStore(),
      sseConnections,
    });
    return { app, sseConnections };
  }

  test("catalogo e dettaglio leggono la variante sse senza degradare", async () => {
    await writeSseEndpoint();
    const { app } = await buildApp();

    const catalog = await request(app).get("/_admin/api/mocks");
    expect(catalog.body.loadErrors ?? []).toEqual([]);
    const item = catalog.body.items.find((entry) => entry.path === "/api/feed");
    expect(item.type).toBe("sse");
    expect(item.status).toBeNull();

    const detail = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);
    expect(detail.status).toBe(200);
    expect(detail.body.sse).toEqual({
      retryMs: null,
      script: [{ afterMs: 0, data: { n: 1 }, event: "hello" }],
      onEnd: "keep-open",
      presets: [{ label: "Promo", data: { tipo: "promo" }, event: "notifica" }],
    });
    expect(detail.body.responses[0].type).toBe("sse");
  });

  test("PUT della response aggiorna il copione (validato) conservando il resto", async () => {
    await writeSseEndpoint();
    const { app } = await buildApp();

    const put = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`)
      .send({ script: [{ afterMs: 100, event: "tick", data: 1 }], onEnd: "close" });
    expect(put.status).toBe(200);

    const onDisk = await readResponseFromDisk();
    expect(onDisk.script).toEqual([{ afterMs: 100, data: 1, event: "tick" }]);
    expect(onDisk.onEnd).toBe("close");
    expect(onDisk.presets).toEqual([{ label: "Promo", data: { tipo: "promo" }, event: "notifica" }]);
    expect(onDisk.title).toBe("Feed live");
  });

  test("PUT con copione invalido: 400 senza toccare il file", async () => {
    await writeSseEndpoint();
    const { app } = await buildApp();

    const put = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`)
      .send({ script: [{ afterMs: -1, data: "x" }] });
    expect(put.status).toBe(400);
    expect(put.body.message).toContain("afterMs");
    expect((await readResponseFromDisk()).script[0].event).toBe("hello");
  });

  test("nuova variante sse su un endpoint sse: clona il copione della selezionata (convenzione same-type)", async () => {
    await writeSseEndpoint();
    const { app } = await buildApp();

    const created = await request(app)
      .post(`/_admin/api/mocks/${MOCK_ID}/responses`)
      .send({ type: "sse", title: "Copia" });
    expect(created.status).toBe(201);

    const second = JSON.parse(await fs.promises.readFile(path.join(mocksDir, "feed", "GET.responses", "002.response.json"), "utf8"));
    expect(second.type).toBe("sse");
    expect(second.title).toBe("Copia");
    expect(second.script).toEqual([{ afterMs: 0, data: { n: 1 }, event: "hello" }]);
  });

  test("nuova variante sse su un endpoint mock: copione vuoto con i default", async () => {
    await writeSseEndpoint(); // per avere il MOCK_ID risolvibile serve comunque l'endpoint feed
    const endpointDir = path.join(mocksDir, "feed", "GET.responses");
    // Rendi la selezionata un mock, così la creazione sse passa dalla via "nuovo tipo" (default).
    await fs.promises.writeFile(
      path.join(endpointDir, "001.response.json"),
      JSON.stringify({ type: "mock", title: "", status: 200, headers: {}, delayMs: 0, body: {} }),
      "utf8"
    );
    const { app } = await buildApp();

    const created = await request(app)
      .post(`/_admin/api/mocks/${MOCK_ID}/responses`)
      .send({ type: "sse", title: "Muto" });
    expect(created.status).toBe(201);

    const second = JSON.parse(await fs.promises.readFile(path.join(endpointDir, "002.response.json"), "utf8"));
    expect(second).toEqual({ type: "sse", title: "Muto", script: [], onEnd: "keep-open" });
  });

  test("push manuale: 400 senza data; con data lo storico registra la regia (anche senza pubblico)", async () => {
    await writeSseEndpoint();
    const { app } = await buildApp();

    const invalid = await request(app).post(`/_admin/api/mocks/${MOCK_ID}/sse/push`).send({ event: "x" });
    expect(invalid.status).toBe(400);

    const push = await request(app)
      .post(`/_admin/api/mocks/${MOCK_ID}/sse/push`)
      .send({ event: "notifica", data: { tipo: "promo" } });
    expect(push.status).toBe(200);
    expect(push.body).toEqual({ delivered: 0, connections: 0 });

    const state = await request(app).get(`/_admin/api/mocks/${MOCK_ID}/sse/connections`);
    expect(state.body.connections).toEqual([]);
    expect(state.body.history).toHaveLength(1);
    expect(state.body.history[0]).toMatchObject({ origin: "manual", event: "notifica", data: { tipo: "promo" } });
  });

  test("push e stato su un endpoint la cui variante selezionata non è sse: 400", async () => {
    const endpointDir = path.join(mocksDir, "classico");
    const responseDir = path.join(endpointDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(endpointDir, "GET.endpoint.json"),
      JSON.stringify({
        method: "GET",
        path: "/api/classico",
        description: "",
        enabled: true,
        responseFiles: ["001.response.json"],
        selectedResponseFile: "001.response.json",
      }),
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      JSON.stringify({ type: "mock", title: "", status: 200, headers: {}, delayMs: 0, body: {} }),
      "utf8"
    );
    const { app } = await buildApp();

    const id = encodeMockId("classico/GET.endpoint.json");
    expect((await request(app).post(`/_admin/api/mocks/${id}/sse/push`).send({ data: "x" })).status).toBe(400);
    expect((await request(app).get(`/_admin/api/mocks/${id}/sse/connections`)).status).toBe(400);
  });
});
