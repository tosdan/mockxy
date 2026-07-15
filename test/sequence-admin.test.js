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
const { SequenceStateStore } = require("../src/mocks/sequence-state");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Admin API delle sequenze: definizione nel PUT /mocks/:id, stato nel dettaglio, reset del
// cursore, flag di catalogo, e conservazione del campo sequence attraverso le altre scritture.
describe("sequence admin API", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("sequence-admin-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  const MOCK_ID = encodeMockId("operazioni/GET.endpoint.json");

  // Endpoint con due varianti mock (processing/completed), senza sequenza: la si imposta via admin.
  async function writeEndpointWithVariants({ sequence } = {}) {
    const endpointDir = path.join(mocksDir, "operazioni");
    const responseDir = path.join(endpointDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    const variants = {
      "001.response.json": { type: "mock", title: "Processing", status: 202, headers: {}, delayMs: 0, body: { status: "processing" } },
      "002.response.json": { type: "mock", title: "Completed", status: 200, headers: {}, delayMs: 0, body: { status: "completed" } },
    };
    for (const [fileName, content] of Object.entries(variants)) {
      await fs.promises.writeFile(path.join(responseDir, fileName), `${JSON.stringify(content, null, 2)}\n`, "utf8");
    }
    const endpoint = {
      method: "GET",
      path: "/api/operazioni",
      description: "",
      enabled: true,
      responseFiles: Object.keys(variants),
      selectedResponseFile: "001.response.json",
    };
    if (sequence != null) {
      endpoint.sequence = sequence;
    }
    await fs.promises.writeFile(
      path.join(endpointDir, "GET.endpoint.json"),
      `${JSON.stringify(endpoint, null, 2)}\n`,
      "utf8"
    );
  }

  async function readEndpointFromDisk() {
    return JSON.parse(await fs.promises.readFile(path.join(mocksDir, "operazioni", "GET.endpoint.json"), "utf8"));
  }

  async function buildApp() {
    const sequenceStates = new SequenceStateStore();
    const load = async () => {
      const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups } =
        await loadEndpointRouteGroups(mocksDir);
      return {
        routeGroups: mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups }),
        proxyMiddlewareRouteGroups,
      };
    };
    const initial = await load();
    const registry = new MockRegistry(initial.routeGroups, sequenceStates);
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
      sequenceStates,
    });
    return { app, sequenceStates };
  }

  const SEQUENCE_PAYLOAD = {
    steps: [
      { response: "001.response.json", times: 2 },
      { response: "002.response.json" },
    ],
  };

  test("PUT sequence: salva la definizione, il serving la usa e il catalogo espone sequenceActive", async () => {
    await writeEndpointWithVariants();
    const { app } = await buildApp();

    const put = await request(app).put(`/_admin/api/mocks/${MOCK_ID}`).send({ sequence: SEQUENCE_PAYLOAD });
    expect(put.status).toBe(200);

    const onDisk = await readEndpointFromDisk();
    expect(onDisk.sequence).toEqual({
      enabled: true,
      steps: SEQUENCE_PAYLOAD.steps,
      onEnd: "stay",
      resetAfterMs: null,
    });

    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "completed" });

    const catalog = await request(app).get("/_admin/api/mocks");
    const item = catalog.body.items.find((entry) => entry.path === "/api/operazioni");
    expect(item.sequenceActive).toBe(true);
  });

  test("GET dettaglio: espone la definizione e lo stato runtime del cursore", async () => {
    await writeEndpointWithVariants({ sequence: SEQUENCE_PAYLOAD });
    const { app } = await buildApp();

    const fresh = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);
    expect(fresh.body.endpoint.sequence.steps).toHaveLength(2);
    expect(fresh.body.sequenceState).toEqual({
      stepIndex: 0,
      servedInStep: 0,
      stepStartedAt: null,
      lastRequestAt: null,
    });

    await request(app).get("/api/operazioni");
    const afterOne = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);
    expect(afterOne.body.sequenceState.stepIndex).toBe(0);
    expect(afterOne.body.sequenceState.servedInStep).toBe(1);
  });

  test("il dettaglio di un endpoint senza sequenza non ha sequenceState", async () => {
    await writeEndpointWithVariants();
    const { app } = await buildApp();
    const detail = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);
    expect(detail.body.sequenceState).toBeUndefined();
    expect(detail.body.sequenceActive).toBe(false);
  });

  test("POST sequence/reset: la sequenza riparte dal primo step", async () => {
    await writeEndpointWithVariants({ sequence: SEQUENCE_PAYLOAD });
    const { app } = await buildApp();

    await request(app).get("/api/operazioni");
    await request(app).get("/api/operazioni");
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "completed" });

    const reset = await request(app).post(`/_admin/api/mocks/${MOCK_ID}/sequence/reset`);
    expect(reset.status).toBe(200);
    expect(reset.body.sequenceState).toEqual({
      stepIndex: 0,
      servedInStep: 0,
      stepStartedAt: null,
      lastRequestAt: null,
    });

    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
  });

  test("il reset su un endpoint senza sequenza risponde 400", async () => {
    await writeEndpointWithVariants();
    const { app } = await buildApp();
    const reset = await request(app).post(`/_admin/api/mocks/${MOCK_ID}/sequence/reset`);
    expect(reset.status).toBe(400);
  });

  test("PUT sequence: null rimuove la sequenza e torna la selezione classica", async () => {
    await writeEndpointWithVariants({ sequence: SEQUENCE_PAYLOAD });
    const { app } = await buildApp();

    const put = await request(app).put(`/_admin/api/mocks/${MOCK_ID}`).send({ sequence: null });
    expect(put.status).toBe(200);

    expect(await readEndpointFromDisk()).not.toHaveProperty("sequence");
    // Selezionata: 001 (processing), servita stabilmente.
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
  });

  test("PUT sequence invalida: 400 senza toccare il file", async () => {
    await writeEndpointWithVariants();
    const { app } = await buildApp();

    const invalid = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}`)
      .send({ sequence: { steps: [{ response: "001.response.json" }] } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain("at least 2 steps");
    expect(await readEndpointFromDisk()).not.toHaveProperty("sequence");
  });

  test("PUT sequence con step middleware: 400 (non supportati in v1)", async () => {
    await writeEndpointWithVariants();
    const responseDir = path.join(mocksDir, "operazioni", "GET.responses");
    await fs.promises.writeFile(
      path.join(responseDir, "003.response.json"),
      `${JSON.stringify({ type: "middleware", title: "", sourceFile: "003.middleware.js" }, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "003.middleware.js"),
      "module.exports = { transformResponse({ body }) { return { body }; } };\n",
      "utf8"
    );
    const endpoint = await readEndpointFromDisk();
    endpoint.responseFiles.push("003.response.json");
    await fs.promises.writeFile(
      path.join(mocksDir, "operazioni", "GET.endpoint.json"),
      `${JSON.stringify(endpoint, null, 2)}\n`,
      "utf8"
    );
    const { app } = await buildApp();

    const put = await request(app).put(`/_admin/api/mocks/${MOCK_ID}`).send({
      sequence: {
        steps: [
          { response: "001.response.json", times: 1 },
          { response: "003.response.json" },
        ],
      },
    });
    expect(put.status).toBe(400);
    expect(put.body.message).toContain("mock or handler");
  });

  test("le altre scritture admin conservano la sequenza (endpoint update non la perde)", async () => {
    await writeEndpointWithVariants({ sequence: SEQUENCE_PAYLOAD });
    const { app } = await buildApp();

    const update = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}/endpoint`)
      .send({ description: "polling di prova" });
    expect(update.status).toBe(200);

    const onDisk = await readEndpointFromDisk();
    expect(onDisk.description).toBe("polling di prova");
    expect(onDisk.sequence).toEqual({
      enabled: true,
      steps: SEQUENCE_PAYLOAD.steps,
      onEnd: "stay",
      resetAfterMs: null,
    });
  });

  test("modificare la definizione della sequenza azzera il cursore (firma cambiata)", async () => {
    await writeEndpointWithVariants({ sequence: SEQUENCE_PAYLOAD });
    const { app } = await buildApp();

    await request(app).get("/api/operazioni");
    await request(app).get("/api/operazioni");
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "completed" });

    const put = await request(app).put(`/_admin/api/mocks/${MOCK_ID}`).send({
      sequence: {
        steps: [
          { response: "001.response.json", times: 1 },
          { response: "002.response.json" },
        ],
      },
    });
    expect(put.status).toBe(200);

    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "completed" });
  });
});
