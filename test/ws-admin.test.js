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
const { WsConnectionStore } = require("../src/mocks/ws-connections");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Admin API delle varianti ws: lettura senza degradare, aggiornamento di copione/regole,
// creazione, push manuale e stato della console (transcript bidirezionale).
describe("ws admin API", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("ws-admin-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  const MOCK_ID = encodeMockId("canale/GET.endpoint.json");

  async function writeWsEndpoint(wsOverrides = {}) {
    const endpointDir = path.join(mocksDir, "canale");
    const responseDir = path.join(endpointDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(endpointDir, "GET.endpoint.json"),
      `${JSON.stringify({
        method: "GET",
        path: "/api/canale",
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
        type: "ws",
        title: "Canale live",
        script: [{ afterMs: 0, data: { n: 1 } }],
        onEnd: "keep-open",
        rules: [{ match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] }],
        presets: [{ label: "Promo", data: { tipo: "promo" } }],
        ...wsOverrides,
      }, null, 2)}\n`,
      "utf8"
    );
  }

  async function readResponseFromDisk() {
    return JSON.parse(await fs.promises.readFile(path.join(mocksDir, "canale", "GET.responses", "001.response.json"), "utf8"));
  }

  async function buildApp() {
    const wsConnections = new WsConnectionStore();
    const load = async () => {
      const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, sseRouteGroups, wsRouteGroups } =
        await loadEndpointRouteGroups(mocksDir);
      return {
        routeGroups: mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups, sseRouteGroups, wsRouteGroups }),
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
      wsConnections,
    });
    return { app, wsConnections };
  }

  test("catalogo e dettaglio leggono la variante ws senza degradare", async () => {
    await writeWsEndpoint();
    const { app } = await buildApp();

    const catalog = await request(app).get("/_admin/api/mocks");
    expect(catalog.body.loadErrors ?? []).toEqual([]);
    const item = catalog.body.items.find((entry) => entry.path === "/api/canale");
    expect(item.type).toBe("ws");
    expect(item.status).toBeNull();

    const detail = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);
    expect(detail.status).toBe(200);
    expect(detail.body.ws).toEqual({
      script: [{ afterMs: 0, data: { n: 1 } }],
      onEnd: "keep-open",
      closeCode: null,
      closeReason: null,
      rules: [{ match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] }],
      presets: [{ label: "Promo", data: { tipo: "promo" } }],
    });
    expect(detail.body.responses[0].type).toBe("ws");
  });

  test("PUT della response aggiorna copione e regole (validati) conservando il resto", async () => {
    await writeWsEndpoint();
    const { app } = await buildApp();

    const put = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`)
      .send({
        script: [{ afterMs: 100, data: "tick" }],
        rules: [{ match: { contains: "aiuto" }, reply: [{ afterMs: 0, data: "arrivo" }] }],
      });
    expect(put.status).toBe(200);

    const onDisk = await readResponseFromDisk();
    expect(onDisk.script).toEqual([{ afterMs: 100, data: "tick" }]);
    expect(onDisk.rules).toEqual([{ match: { contains: "aiuto" }, reply: [{ afterMs: 0, data: "arrivo" }] }]);
    // Il resto della variante non richiesto nel payload resta com'era.
    expect(onDisk.onEnd).toBe("keep-open");
    expect(onDisk.presets).toEqual([{ label: "Promo", data: { tipo: "promo" } }]);
    expect(onDisk.title).toBe("Canale live");
  });

  test("un PUT invalido risponde 400 senza toccare il file", async () => {
    await writeWsEndpoint();
    const { app } = await buildApp();

    const put = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`)
      .send({ rules: [{ match: {}, reply: [] }] });
    expect(put.status).toBe(400);

    const onDisk = await readResponseFromDisk();
    expect(onDisk.script).toEqual([{ afterMs: 0, data: { n: 1 } }]);
  });

  test("POST responses same-type: clona la selezionata (regole incluse) col merge del payload", async () => {
    await writeWsEndpoint();
    const { app } = await buildApp();

    const created = await request(app)
      .post(`/_admin/api/mocks/${MOCK_ID}/responses`)
      .send({
        type: "ws",
        title: "Chiusura",
        script: [{ afterMs: 0, data: "bye" }],
        onEnd: "close",
        closeCode: 4000,
        closeReason: "fine",
      });
    expect(created.status).toBe(201);

    const files = await fs.promises.readdir(path.join(mocksDir, "canale", "GET.responses"));
    expect(files).toHaveLength(2);
    const newFile = files.find((name) => name !== "001.response.json");
    const onDisk = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "canale", "GET.responses", newFile), "utf8")
    );
    expect(onDisk).toMatchObject({
      type: "ws",
      title: "Chiusura",
      onEnd: "close",
      closeCode: 4000,
      closeReason: "fine",
    });
    // Convenzione clone: ciò che il payload non porta arriva dalla variante selezionata.
    expect(onDisk.rules).toEqual([{ match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] }]);
    expect(onDisk.presets).toEqual([{ label: "Promo", data: { tipo: "promo" } }]);
  });

  test("POST responses tipo diverso: variante ws di default, senza eredità dalla selezionata", async () => {
    // Endpoint con variante selezionata di tipo mock: creare una ws prende il percorso "nuova tipizzata".
    const endpointDir = path.join(mocksDir, "altro");
    const responseDir = path.join(endpointDir, "POST.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(endpointDir, "POST.endpoint.json"),
      `${JSON.stringify({
        method: "POST",
        path: "/api/altro",
        description: "",
        enabled: true,
        responseFiles: ["001.response.json"],
        selectedResponseFile: "001.response.json",
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      `${JSON.stringify({ type: "mock", status: 200, headers: {}, delayMs: 0, body: {} }, null, 2)}\n`,
      "utf8"
    );
    const { app } = await buildApp();
    const altroId = encodeMockId("altro/POST.endpoint.json");

    const created = await request(app)
      .post(`/_admin/api/mocks/${altroId}/responses`)
      .send({ type: "ws", title: "Canale nuovo" });
    expect(created.status).toBe(201);

    const files = await fs.promises.readdir(responseDir);
    const newFile = files.find((name) => name !== "001.response.json");
    const onDisk = JSON.parse(await fs.promises.readFile(path.join(responseDir, newFile), "utf8"));
    expect(onDisk).toEqual({ type: "ws", title: "Canale nuovo", script: [], onEnd: "keep-open" });
  });

  test("push manuale: broadcast alle connessioni registrate e transcript aggiornato", async () => {
    await writeWsEndpoint();
    const { app, wsConnections } = await buildApp();
    const sent = [];
    wsConnections.register("GET /api/canale", { send: (text) => sent.push(text), close: () => {} });

    const push = await request(app)
      .post(`/_admin/api/mocks/${MOCK_ID}/ws/push`)
      .send({ data: { tipo: "promo" } });
    expect(push.status).toBe(200);
    expect(push.body).toEqual({ delivered: 1, connections: 1 });
    expect(sent).toEqual(['{"tipo":"promo"}']);

    const state = await request(app).get(`/_admin/api/mocks/${MOCK_ID}/ws/connections`);
    expect(state.status).toBe(200);
    expect(state.body.connections).toHaveLength(1);
    expect(state.body.transcript).toHaveLength(1);
    expect(state.body.transcript[0]).toMatchObject({ direction: "out", origin: "manual", data: { tipo: "promo" } });
  });

  test("push senza data o su variante non ws: 400", async () => {
    await writeWsEndpoint();
    const { app } = await buildApp();

    const missingData = await request(app).post(`/_admin/api/mocks/${MOCK_ID}/ws/push`).send({});
    expect(missingData.status).toBe(400);

    // La variante selezionata diventa mock: la console ws non ha più senso su questo endpoint.
    await fs.promises.writeFile(
      path.join(mocksDir, "canale", "GET.responses", "001.response.json"),
      `${JSON.stringify({ type: "mock", status: 200, headers: {}, delayMs: 0, body: {} }, null, 2)}\n`,
      "utf8"
    );
    const wrongType = await request(app).post(`/_admin/api/mocks/${MOCK_ID}/ws/push`).send({ data: "x" });
    expect(wrongType.status).toBe(400);
  });

  test("una variante ws non può essere step di una sequenza (PUT { sequence } → 400)", async () => {
    await writeWsEndpoint();
    const endpointPath = path.join(mocksDir, "canale", "GET.endpoint.json");
    const endpoint = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
    endpoint.responseFiles.push("002.response.json");
    await fs.promises.writeFile(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, "utf8");
    await fs.promises.writeFile(
      path.join(mocksDir, "canale", "GET.responses", "002.response.json"),
      `${JSON.stringify({ type: "mock", status: 200, headers: {}, delayMs: 0, body: {} }, null, 2)}\n`,
      "utf8"
    );
    const { app } = await buildApp();

    const put = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}`)
      .send({
        sequence: {
          steps: [
            { response: "001.response.json", times: 1 },
            { response: "002.response.json" },
          ],
        },
      });
    expect(put.status).toBe(400);
    expect(put.body.message).toMatch(/mock or handler/);
  });
});
