const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { encodeMockId } = require("../src/admin/mock-ids");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { SequenceStateStore } = require("../src/mocks/sequence-state");
const { HandlerStateStore } = require("../src/mocks/handler-state");
const { SharedStateStore } = require("../src/mocks/shared-state");
const {
  createNoopLogger,
  createTempDir,
  removeDir,
  writeHandler,
  writeMock,
} = require("./helpers");

describe("shared runtime state Admin API", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("shared-state-admin-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  async function buildApp() {
    const initial = await loadEndpointRouteGroups(mocksDir);
    expect(initial.loadErrors).toEqual([]);
    const sequenceStates = new SequenceStateStore();
    const handlerStates = new HandlerStateStore();
    const sharedStates = new SharedStateStore();
    const registry = new MockRegistry(mergeLocalRouteGroups(initial), sequenceStates);
    const proxyMiddlewareRegistry = new ProxyMiddlewareRegistry(initial.proxyMiddlewareRouteGroups);
    const reloadRuntime = jest.fn(async () => {
      const next = await loadEndpointRouteGroups(mocksDir);
      registry.setRouteGroups(mergeLocalRouteGroups(next));
      proxyMiddlewareRegistry.setRouteGroups(next.proxyMiddlewareRouteGroups);
      return { applied: true, loadErrors: next.loadErrors, fatalError: null };
    });
    const monitorDump = {
      flush: jest.fn(async () => 0),
      getStatus: () => ({ enabled: false }),
    };
    const app = createApp({
      registry,
      config: {
        mocksDir,
        requestTimeoutMs: 5000,
        proxyFallbackEnabled: false,
        adminApiEnabled: true,
        host: "127.0.0.1",
      },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry,
      reloadRuntime,
      requestMonitor: new RequestMonitorStore(),
      monitorDump,
      sequenceStates,
      handlerStates,
      sharedStates,
    });
    return {
      app,
      sharedStates,
      sequenceStates,
      handlerStates,
      reloadRuntime,
      monitorDump,
    };
  }

  test("lista metadati e limiti senza esporre valori", async () => {
    const { app, sharedStates } = await buildApp();
    const facade = sharedStates.createRequestFacade({
      method: "GET",
      path: "/api/items",
      responseFile: "001.response.json",
    });
    const state = await facade.api.open("items", {
      seedKey: "items@v1",
      initialize: () => ({ secret: "never-return-this", items: [] }),
    });
    state.mutate((draft) => draft.items.push({ id: 1 }));

    const response = await request(app).get("/_admin/api/runtime/shared-state");
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({
        name: "items",
        seedKey: "items@v1",
        status: "ready",
        version: 2,
        initializedBy: {
          method: "GET",
          path: "/api/items",
          responseFile: "001.response.json",
        },
      }),
    ]);
    expect(response.body.limits).toEqual({
      maxEntries: 256,
      maxEntryBytes: 3 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024,
      maxDepth: 100,
    });
    expect(JSON.stringify(response.body)).not.toContain("never-return-this");
  });

  test("reset per nome è canonico/idempotente e il reset globale conta tutte le generazioni", async () => {
    const { app, sharedStates } = await buildApp();
    const facade = sharedStates.createRequestFacade();
    await facade.api.open("Items", { seedKey: "items@v1", initialize: () => [] });

    const first = await request(app)
      .post("/_admin/api/runtime/shared-state/ITEMS/reset")
      .send({});
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ name: "items", reset: true });
    const second = await request(app)
      .post("/_admin/api/runtime/shared-state/items/reset")
      .send({});
    expect(second.body).toEqual({ name: "items", reset: false });

    await facade.api.open("one", { seedKey: "one@v1", initialize: () => 1 });
    await facade.api.open("two", { seedKey: "two@v1", initialize: () => 2 });
    const globalReset = await request(app)
      .post("/_admin/api/runtime/shared-state/reset")
      .send({});
    expect(globalReset.status).toBe(200);
    expect(globalReset.body).toEqual({ resetCount: 2 });
    expect(sharedStates.listMetadata().items).toEqual([]);
  });

  test("il reset shared non modifica cursori sequence né memoria handler locale", async () => {
    const { app, sharedStates, sequenceStates, handlerStates } = await buildApp();
    const facade = sharedStates.createRequestFacade();
    await facade.api.open("items", { seedKey: "items@v1", initialize: () => [] });
    const sequence = {
      steps: [
        { response: "001.response.json", times: 1 },
        { response: "002.response.json" },
      ],
      onEnd: "stay",
      resetAfterMs: null,
    };
    sequenceStates.resolveStep("GET /sequence", "900.response.json", sequence);
    const localState = handlerStates.enter("GET /sequence");
    localState.state.marker = "preserved";

    expect((await request(app)
      .post("/_admin/api/runtime/shared-state/reset")
      .send({})).status).toBe(200);

    expect(sequenceStates.getState("GET /sequence", "900.response.json", sequence).stepIndex)
      .toBe(1);
    expect(handlerStates.entries.get("GET /sequence")).toMatchObject({
      callCount: 1,
      state: { marker: "preserved" },
    });
  });

  test("nome reset non valido è 400 e non modifica le altre risorse", async () => {
    const { app, sharedStates } = await buildApp();
    const facade = sharedStates.createRequestFacade();
    await facade.api.open("items", { seedKey: "items@v1", initialize: () => [] });
    const response = await request(app)
      .post("/_admin/api/runtime/shared-state/../reset")
      .send({});
    // Express normalizes literal '..' in a URL; an encoded slash-free invalid name is stable.
    const encoded = await request(app)
      .post("/_admin/api/runtime/shared-state/%20/reset")
      .send({});
    expect([response.status, encoded.status]).toContain(400);
    expect(sharedStates.listMetadata().items.map((item) => item.name)).toEqual(["items"]);
  });

  test.each([
    "/_admin/api/runtime/shared-state/items/reset",
    "/_admin/api/runtime/shared-state/reset",
    "/_admin/api/monitoring/dump/flush",
    `/_admin/api/mocks/${encodeMockId("missing/GET.endpoint.json")}/sequence/reset`,
  ])("le mutazioni senza parametri rifiutano media type e body ambigui: %s", async (url) => {
    const { app } = await buildApp();

    expect((await request(app).post(url)).status).toBe(415);
    expect((await request(app).post(url).type("text").send("{}")).status).toBe(415);
    expect((await request(app).post(url).set("content-type", "application/vnd.api+json").send("{}")).status)
      .toBe(415);
    expect((await request(app).post(url).set("content-type", "application/json").set("content-length", "0")).status)
      .toBe(400);
    expect((await request(app).post(url).set("content-type", "application/json").send("null")).status)
      .toBe(400);
    expect((await request(app).post(url).send([])).status).toBe(400);
    expect((await request(app).post(url).send({ unexpected: true })).status).toBe(400);
    expect((await request(app).post(url).set("content-type", "application/json").send("{")).status)
      .toBe(400);

    const valid = await request(app)
      .post(url)
      .set("content-type", "application/json; charset=utf-8")
      .send("  { } \n");
    expect(valid.status).not.toBe(415);
    expect(valid.status).not.toBe(400);
  });

  test("dry run copia calcola file e riferimenti shared state senza scrivere né ricaricare", async () => {
    await writeHandler({
      mocksDir,
      folder: "source",
      method: "GET",
      source: `module.exports = {
  path: "/api/source",
  async resolveResponse({ sharedState }) {
    await sharedState.open("Items", { seedKey: "items@v1", initialize: () => [] });
    await sharedState.open('orders.v2', { seedKey: "orders@v2", initialize: () => [] });
    await sharedState.open(dynamicName, { seedKey: "dynamic", initialize: () => [] });
    return { jsonBody: [] };
  },
};`,
    });
    const { app, reloadRuntime } = await buildApp();
    const id = encodeMockId("source/GET.endpoint.json");

    const preview = await request(app)
      .post(`/_admin/api/mocks/${id}/copy?dryRun=true`)
      .send({ method: "POST", path: "/api/copied", copyResponses: false });
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      dryRun: true,
      target: { method: "POST", path: "/api/copied" },
      copyResponses: false,
      responseFiles: ["001.response.json"],
      assetFiles: ["001.handler.js"],
      sharedStateRefs: ["items", "orders.v2"],
      warnings: [{
        code: "SHARED_STATE_REFERENCES_PRESERVED",
        names: ["items", "orders.v2"],
      }],
    });
    expect(reloadRuntime).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(mocksDir, "api", "copied", "POST.endpoint.json"))).toBe(false);

    const committed = await request(app)
      .post(`/_admin/api/mocks/${id}/copy?dryRun=false`)
      .send({ method: "POST", path: "/api/copied", copyResponses: false });
    expect(committed.status).toBe(201);
    expect(reloadRuntime).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(mocksDir, "api", "copied", "POST.endpoint.json"))).toBe(true);
  });

  test("dryRun non valido o ripetuto è 400 e non crea la destinazione", async () => {
    await writeMock({
      mocksDir,
      folder: "source",
      method: "GET",
      routePath: "/source",
      body: {},
    });
    const { app, reloadRuntime } = await buildApp();
    const id = encodeMockId("source/GET.endpoint.json");
    const payload = { method: "POST", path: "/target", copyResponses: false };

    expect((await request(app).post(`/_admin/api/mocks/${id}/copy?dryRun=yes`).send(payload)).status)
      .toBe(400);
    expect((await request(app).post(`/_admin/api/mocks/${id}/copy?dryRun=true&dryRun=false`).send(payload)).status)
      .toBe(400);
    expect(reloadRuntime).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(mocksDir, "target", "POST.endpoint.json"))).toBe(false);
  });
});
