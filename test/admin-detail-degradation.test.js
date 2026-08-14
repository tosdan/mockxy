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
const { HandlerStateStore } = require("../src/mocks/handler-state");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Degradazione del dettaglio admin quando un file del workspace è stato rotto a mano.
// Due garanzie distinte: una variante illeggibile è un DATO dell'elenco (non un errore che
// affonda l'endpoint), e una mutazione già scritta su disco non viene mai riportata come
// fallita solo perché il dettaglio che la descrive non è componibile.
describe("admin detail degradation", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("admin-detail-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  const MOCK_ID = encodeMockId("operazioni/GET.endpoint.json");

  async function writeEndpoint(variants, selectedResponseFile) {
    const endpointDir = path.join(mocksDir, "operazioni");
    const responseDir = path.join(endpointDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    for (const [fileName, content] of Object.entries(variants)) {
      await fs.promises.writeFile(
        path.join(responseDir, fileName),
        typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
        "utf8"
      );
    }
    await fs.promises.writeFile(
      path.join(endpointDir, "GET.endpoint.json"),
      `${JSON.stringify(
        {
          method: "GET",
          path: "/api/operazioni",
          description: "",
          enabled: true,
          responseFiles: Object.keys(variants),
          selectedResponseFile,
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    return { endpointDir, responseDir };
  }

  function mockVariant(title, body) {
    return { type: "mock", title, status: 200, headers: {}, delayMs: 0, body };
  }

  async function readEndpointFromDisk() {
    return JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "operazioni", "GET.endpoint.json"), "utf8")
    );
  }

  async function buildApp() {
    const sequenceStates = new SequenceStateStore();
    const handlerStates = new HandlerStateStore();
    const load = async () => {
      const loaded = await loadEndpointRouteGroups(mocksDir);
      return {
        routeGroups: mergeLocalRouteGroups(loaded),
        proxyMiddlewareRouteGroups: loaded.proxyMiddlewareRouteGroups,
        loadErrors: loaded.loadErrors,
      };
    };
    const initial = await load();
    const registry = new MockRegistry(initial.routeGroups, sequenceStates);
    const proxyMiddlewareRegistry = new ProxyMiddlewareRegistry(initial.proxyMiddlewareRouteGroups);
    const reloadRuntime = async () => {
      const next = await load();
      registry.setRouteGroups(next.routeGroups);
      proxyMiddlewareRegistry.setRouteGroups(next.proxyMiddlewareRouteGroups);
      return { applied: true, loadErrors: next.loadErrors, fatalError: null };
    };

    return createApp({
      registry,
      config: { mocksDir, requestTimeoutMs: 5000, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry,
      reloadRuntime,
      requestMonitor: new RequestMonitorStore(),
      sequenceStates,
      handlerStates,
    });
  }

  test("una variante illeggibile viene elencata col motivo invece di far fallire il dettaglio", async () => {
    await writeEndpoint(
      {
        "001.response.json": mockVariant("Ok", { ok: true }),
        "002.response.json": "{ invalid json",
      },
      "001.response.json"
    );
    const app = await buildApp();

    const detail = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);

    expect(detail.status).toBe(200);
    expect(detail.body.responses).toHaveLength(2);
    expect(detail.body.responses[0]).toMatchObject({ fileName: "001.response.json", type: "mock" });
    expect(detail.body.responses[1]).toMatchObject({ fileName: "002.response.json", invalid: true });
    expect(detail.body.responses[1].error).toContain("Invalid JSON");
    expect(detail.body.responses[1].type).toBeUndefined();
  });

  test("una variante illeggibile non blocca la cancellazione di una variante che non la riguarda", async () => {
    const { responseDir } = await writeEndpoint(
      {
        "001.response.json": mockVariant("Ok", { ok: true }),
        "002.response.json": mockVariant("Altra", { altra: true }),
        "003.response.json": "{ invalid json",
      },
      "001.response.json"
    );
    const app = await buildApp();

    const deleted = await request(app).delete(`/_admin/api/mocks/${MOCK_ID}/responses/002.response.json`);

    expect(deleted.status).toBe(200);
    expect(fs.existsSync(path.join(responseDir, "002.response.json"))).toBe(false);
    expect((await readEndpointFromDisk()).responseFiles).toEqual([
      "001.response.json",
      "003.response.json",
    ]);
    // Il dettaglio restituito descrive lo stato reale: la variante rotta è ancora lì, dichiarata.
    expect(deleted.body.responses.map((response) => response.fileName)).toEqual([
      "001.response.json",
      "003.response.json",
    ]);
    expect(deleted.body.responses[1].invalid).toBe(true);
  });

  // Il dettaglio admin legge cose che il loader runtime non guarda — a partire da
  // .collections.json — quindi può non essere componibile anche quando il reload è perfetto.
  // È lì che la mutazione rischia di essere riportata come fallita pur essendo già su disco.
  async function breakCollectionsMetadata() {
    await fs.promises.writeFile(path.join(mocksDir, ".collections.json"), "{ invalid json", "utf8");
  }

  test("una mutazione riuscita il cui dettaglio non è componibile resta un successo", async () => {
    await writeEndpoint(
      {
        "001.response.json": mockVariant("Ok", { ok: true }),
        "002.response.json": mockVariant("Altra", { altra: true }),
      },
      "002.response.json"
    );
    const app = await buildApp();
    await breakCollectionsMetadata();

    const selected = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}`)
      .send({ selectedResponseFile: "001.response.json" });

    expect(selected.status).toBe(200);
    expect(selected.body.id).toBe(MOCK_ID);
    expect(selected.body.detailUnavailable.message).toContain("Invalid JSON");
    expect(selected.body).not.toHaveProperty("responses");
    // Il punto: la mutazione è avvenuta davvero, quindi non va riportata come fallita.
    expect((await readEndpointFromDisk()).selectedResponseFile).toBe("001.response.json");
  });

  test("anche la cancellazione resta un successo se il dettaglio non si compone", async () => {
    const { responseDir } = await writeEndpoint(
      {
        "001.response.json": mockVariant("Ok", { ok: true }),
        "002.response.json": mockVariant("Altra", { altra: true }),
      },
      "001.response.json"
    );
    const app = await buildApp();
    await breakCollectionsMetadata();

    const deleted = await request(app).delete(`/_admin/api/mocks/${MOCK_ID}/responses/002.response.json`);

    expect(deleted.status).toBe(200);
    expect(deleted.body.detailUnavailable.message).toContain("Invalid JSON");
    expect(fs.existsSync(path.join(responseDir, "002.response.json"))).toBe(false);
    expect((await readEndpointFromDisk()).responseFiles).toEqual(["001.response.json"]);
  });

  test("il dettaglio letto direttamente resta un errore, non un successo dimezzato", async () => {
    // Su GET il dettaglio È la risposta: se non si compone non c'è nulla da restituire, e
    // mascherarlo da 200 nasconderebbe un workspace rotto.
    await writeEndpoint({ "001.response.json": mockVariant("Ok", { ok: true }) }, "001.response.json");
    const app = await buildApp();
    await breakCollectionsMetadata();

    const detail = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);

    expect(detail.status).toBe(400);
    expect(detail.body).not.toHaveProperty("detailUnavailable");
  });
});
