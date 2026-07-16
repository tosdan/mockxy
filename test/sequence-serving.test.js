const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { SequenceStateStore } = require("../src/mocks/sequence-state");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Serving delle sequenze di varianti: gli step vengono scelti a request-time dal cursore
// (SequenceStateStore) e serviti secondo la loro natura (mock o handler).
describe("sequence serving", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("sequence-serving-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  // Scrive un endpoint con più varianti e (opzionale) una sequenza. `responses` mappa
  // nome file → contenuto della variante; gli asset (sorgenti handler) vanno in `assets`.
  async function writeSequenceEndpoint({
    folder,
    method = "GET",
    routePath,
    responses,
    assets = {},
    sequence,
    selectedResponseFile,
  }) {
    const endpointDir = path.join(mocksDir, folder);
    const responseDir = path.join(endpointDir, `${method}.responses`);
    await fs.promises.mkdir(responseDir, { recursive: true });

    const responseFiles = Object.keys(responses);
    for (const [fileName, content] of Object.entries(responses)) {
      await fs.promises.writeFile(path.join(responseDir, fileName), `${JSON.stringify(content, null, 2)}\n`, "utf8");
    }
    for (const [fileName, source] of Object.entries(assets)) {
      await fs.promises.writeFile(path.join(responseDir, fileName), source, "utf8");
    }

    const endpoint = {
      method,
      path: routePath,
      description: "",
      enabled: true,
      responseFiles,
      selectedResponseFile: selectedResponseFile || responseFiles[0],
    };
    if (sequence != null) {
      endpoint.sequence = sequence;
    }
    await fs.promises.writeFile(
      path.join(endpointDir, `${method}.endpoint.json`),
      `${JSON.stringify(endpoint, null, 2)}\n`,
      "utf8"
    );
  }

  function mockResponse(body, status = 200) {
    return { type: "mock", title: "", status, headers: {}, delayMs: 0, body };
  }

  async function buildApp({ sequenceStates, requestMonitor } = {}) {
    const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, loadErrors } =
      await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toEqual([]);
    const routeGroups = mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups });
    const registry = new MockRegistry(routeGroups, sequenceStates || new SequenceStateStore());
    return createApp({
      registry,
      config: { requestTimeoutMs: 5000, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups),
      requestMonitor: requestMonitor || new RequestMonitorStore(),
    });
  }

  test("caso polling: N risposte processing, poi completed per sempre (stay)", async () => {
    await writeSequenceEndpoint({
      folder: "operazioni",
      routePath: "/api/operazioni/:id",
      responses: {
        "001.response.json": mockResponse({ status: "processing" }, 202),
        "002.response.json": mockResponse({ status: "completed" }),
      },
      sequence: {
        steps: [
          { response: "001.response.json", times: 2 },
          { response: "002.response.json" },
        ],
      },
    });
    const app = await buildApp();

    const first = await request(app).get("/api/operazioni/42");
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ status: "processing" });

    const second = await request(app).get("/api/operazioni/42");
    expect(second.body).toEqual({ status: "processing" });

    for (let i = 0; i < 3; i += 1) {
      const done = await request(app).get("/api/operazioni/42");
      expect(done.status).toBe(200);
      expect(done.body).toEqual({ status: "completed" });
    }
  });

  test("uno step può essere un handler: risponde con la sua logica e i suoi param", async () => {
    await writeSequenceEndpoint({
      folder: "misto",
      routePath: "/api/misto/:id",
      responses: {
        "001.response.json": mockResponse({ status: "processing" }),
        "002.response.json": { type: "handler", title: "", sourceFile: "002.handler.js" },
      },
      assets: {
        "002.handler.js": `module.exports = {
  resolveResponse({ params }) {
    return { status: 200, jsonBody: { status: "completed", id: params.id } };
  },
};
`,
      },
      sequence: {
        steps: [
          { response: "001.response.json", times: 1 },
          { response: "002.response.json" },
        ],
      },
    });
    const app = await buildApp();

    expect((await request(app).get("/api/misto/7")).body).toEqual({ status: "processing" });
    const done = await request(app).get("/api/misto/7");
    expect(done.headers["x-mock-source"]).toBe("handler");
    expect(done.body).toEqual({ status: "completed", id: "7" });
  });

  test("step forMs: si avanza a tempo, misurato dalla prima richiesta dello step", async () => {
    let currentMs = 1000;
    const sequenceStates = new SequenceStateStore({ now: () => currentMs });
    await writeSequenceEndpoint({
      folder: "tempo",
      routePath: "/api/tempo",
      responses: {
        "001.response.json": mockResponse({ status: "processing" }),
        "002.response.json": mockResponse({ status: "completed" }),
      },
      sequence: {
        steps: [
          { response: "001.response.json", forMs: 15000 },
          { response: "002.response.json" },
        ],
      },
    });
    const app = await buildApp({ sequenceStates });

    expect((await request(app).get("/api/tempo")).body).toEqual({ status: "processing" });
    currentMs += 14999;
    expect((await request(app).get("/api/tempo")).body).toEqual({ status: "processing" });
    currentMs += 1;
    expect((await request(app).get("/api/tempo")).body).toEqual({ status: "completed" });
  });

  test("reset del cursore: la sequenza riparte dal primo step", async () => {
    const sequenceStates = new SequenceStateStore();
    await writeSequenceEndpoint({
      folder: "reset",
      routePath: "/api/reset",
      responses: {
        "001.response.json": mockResponse({ step: 1 }),
        "002.response.json": mockResponse({ step: 2 }),
      },
      sequence: {
        steps: [
          { response: "001.response.json", times: 1 },
          { response: "002.response.json" },
        ],
      },
    });
    const app = await buildApp({ sequenceStates });

    expect((await request(app).get("/api/reset")).body).toEqual({ step: 1 });
    expect((await request(app).get("/api/reset")).body).toEqual({ step: 2 });

    sequenceStates.reset("GET /api/reset");
    expect((await request(app).get("/api/reset")).body).toEqual({ step: 1 });
  });

  test("sequenza spenta (enabled false): vale la selezione classica", async () => {
    await writeSequenceEndpoint({
      folder: "spenta",
      routePath: "/api/spenta",
      responses: {
        "001.response.json": mockResponse({ variante: "selezionata" }),
        "002.response.json": mockResponse({ variante: "altra" }),
      },
      sequence: {
        enabled: false,
        steps: [
          { response: "002.response.json", times: 1 },
          { response: "001.response.json" },
        ],
      },
      selectedResponseFile: "001.response.json",
    });
    const app = await buildApp();

    expect((await request(app).get("/api/spenta")).body).toEqual({ variante: "selezionata" });
    expect((await request(app).get("/api/spenta")).body).toEqual({ variante: "selezionata" });
  });

  test("uno step middleware degrada l'endpoint al load (non supportato in v1)", async () => {
    await writeSequenceEndpoint({
      folder: "mw",
      routePath: "/api/mw",
      responses: {
        "001.response.json": mockResponse({ ok: true }),
        "002.response.json": { type: "middleware", title: "", sourceFile: "002.middleware.js" },
      },
      assets: {
        "002.middleware.js": `module.exports = {
  transformResponse({ body }) {
    return { body };
  },
};
`,
      },
      sequence: {
        steps: [
          { response: "001.response.json", times: 1 },
          { response: "002.response.json" },
        ],
      },
    });

    const result = await loadEndpointRouteGroups(mocksDir);
    expect(result.sequenceRouteGroups).toHaveLength(0);
    expect(result.loadErrors).toHaveLength(1);
    expect(result.loadErrors[0].message).toContain("sequence steps must reference mock or handler responses");
  });

  test("uno step con variante mancante su disco degrada l'endpoint al load", async () => {
    await writeSequenceEndpoint({
      folder: "orfano",
      routePath: "/api/orfano",
      responses: {
        "001.response.json": mockResponse({ ok: true }),
        "002.response.json": mockResponse({ ok: false }),
      },
      sequence: {
        steps: [
          { response: "002.response.json", times: 1 },
          { response: "001.response.json" },
        ],
      },
    });
    await fs.promises.rm(path.join(mocksDir, "orfano", "GET.responses", "002.response.json"));

    const result = await loadEndpointRouteGroups(mocksDir);
    expect(result.loadErrors).toHaveLength(1);
    expect(result.loadErrors[0].message).toContain("sequence step response");
  });

  test("il monitor registra lo step servito (indice, totale, variante); assente senza sequenza", async () => {
    await writeSequenceEndpoint({
      folder: "monitorato",
      routePath: "/api/monitorato",
      responses: {
        "001.response.json": { type: "mock", title: "Processing", status: 202, headers: {}, delayMs: 0, body: {} },
        "002.response.json": { type: "mock", title: "Completed", status: 200, headers: {}, delayMs: 0, body: {} },
      },
      sequence: {
        steps: [
          { response: "001.response.json", times: 1 },
          { response: "002.response.json" },
        ],
      },
    });
    await writeSequenceEndpoint({
      folder: "classico",
      routePath: "/api/classico",
      responses: {
        "001.response.json": mockResponse({ ok: true }),
        "002.response.json": mockResponse({ ok: false }),
      },
    });
    const requestMonitor = new RequestMonitorStore();
    const app = await buildApp({ requestMonitor });

    await request(app).get("/api/monitorato");
    await request(app).get("/api/monitorato");
    await request(app).get("/api/classico");

    // listEntries: più recenti prima.
    const [classico, second, first] = requestMonitor.listEntries();
    expect(first.sequenceStep).toEqual({
      index: 0,
      count: 2,
      responseFile: "001.response.json",
      responseTitle: "Processing",
    });
    expect(second.sequenceStep).toEqual({
      index: 1,
      count: 2,
      responseFile: "002.response.json",
      responseTitle: "Completed",
    });
    expect(classico.sequenceStep).toBeUndefined();
  });

  test("le risposte mock degli step conservano paginazione e filtri automatici", async () => {
    await writeSequenceEndpoint({
      folder: "lista",
      routePath: "/api/lista",
      responses: {
        "001.response.json": mockResponse([{ id: 1 }, { id: 2 }, { id: 3 }]),
        "002.response.json": mockResponse([]),
      },
      sequence: {
        steps: [
          { response: "001.response.json", times: 1 },
          { response: "002.response.json" },
        ],
      },
    });
    const app = await buildApp();

    const paged = await request(app).get("/api/lista?page=0&size=2");
    expect(paged.headers["x-total-count"]).toBe("3");
    expect(paged.body).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
