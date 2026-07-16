const request = require("supertest");
const { createApp } = require("../src/app");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { HandlerStateStore } = require("../src/mocks/handler-state");
const { createNoopLogger, createTempDir, removeDir, writeHandler } = require("./helpers");

describe("HandlerStateStore (memoria per-endpoint degli handler)", () => {
  test("enter: stato condiviso e contatore progressivo, firstRequestAt della prima chiamata", () => {
    let currentMs = 5000;
    const store = new HandlerStateStore({ now: () => currentMs });

    const first = store.enter("GET /contatore");
    expect(first).toEqual({ state: {}, callCount: 1, firstRequestAt: 5000 });
    first.state.visto = true;

    currentMs = 9000;
    const second = store.enter("GET /contatore");
    expect(second.callCount).toBe(2);
    expect(second.firstRequestAt).toBe(5000); // resta quello della prima chiamata
    expect(second.state).toEqual({ visto: true }); // stesso oggetto, mutazioni visibili
  });

  test("endpoint diversi hanno memorie indipendenti", () => {
    const store = new HandlerStateStore();
    store.enter("GET /a").state.x = 1;
    expect(store.enter("GET /b").state).toEqual({});
  });

  test("reset: memoria e contatori ripartono da zero", () => {
    let currentMs = 1000;
    const store = new HandlerStateStore({ now: () => currentMs });
    store.enter("GET /a").state.x = 1;
    store.enter("GET /a");

    currentMs = 2000;
    store.reset("GET /a");
    expect(store.enter("GET /a")).toEqual({ state: {}, callCount: 1, firstRequestAt: 2000 });
  });
});

// Integrazione: il contesto degli handler espone state/callCount/firstRequestAt persistenti
// tra le richieste dello stesso endpoint.
describe("handler state nel serving", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("handler-state-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  function counterHandlerSource(routePath) {
    return `module.exports = {
  path: "${routePath}",
  resolveResponse({ state, callCount, firstRequestAt }) {
    state.visite = (state.visite || 0) + 1;
    return {
      status: 200,
      jsonBody: {
        callCount,
        visite: state.visite,
        elapsedNonNegative: Date.now() - firstRequestAt >= 0,
      },
    };
  },
};
`;
  }

  async function buildApp(handlerStates) {
    const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, loadErrors } =
      await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toEqual([]);
    const routeGroups = mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups });
    return createApp({
      registry: new MockRegistry(routeGroups),
      config: { requestTimeoutMs: 5000, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups),
      requestMonitor: new RequestMonitorStore(),
      handlerStates,
    });
  }

  test("state persiste tra le chiamate e callCount avanza; firstRequestAt è della prima", async () => {
    await writeHandler({ mocksDir, folder: "operazioni", method: "GET", source: counterHandlerSource("/operazioni") });
    const app = await buildApp(new HandlerStateStore());

    const first = await request(app).get("/operazioni");
    expect(first.body).toEqual({ callCount: 1, visite: 1, elapsedNonNegative: true });
    const second = await request(app).get("/operazioni");
    expect(second.body).toEqual({ callCount: 2, visite: 2, elapsedNonNegative: true });
  });

  test("endpoint diversi non condividono la memoria", async () => {
    await writeHandler({ mocksDir, folder: "uno", method: "GET", source: counterHandlerSource("/uno") });
    await writeHandler({ mocksDir, folder: "due", method: "GET", source: counterHandlerSource("/due") });
    const app = await buildApp(new HandlerStateStore());

    await request(app).get("/uno");
    const uno = await request(app).get("/uno");
    const due = await request(app).get("/due");
    expect(uno.body.visite).toBe(2);
    expect(due.body.visite).toBe(1);
  });

  test("senza store (usi legacy) i campi ci sono comunque, effimeri per richiesta", async () => {
    await writeHandler({ mocksDir, folder: "effimero", method: "GET", source: counterHandlerSource("/effimero") });
    const app = await buildApp(undefined);

    expect((await request(app).get("/effimero")).body).toEqual({ callCount: 1, visite: 1, elapsedNonNegative: true });
    expect((await request(app).get("/effimero")).body).toEqual({ callCount: 1, visite: 1, elapsedNonNegative: true });
  });
});
