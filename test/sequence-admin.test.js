const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { SharedStateStore } = require("../src/mocks/shared-state");
const { encodeMockId } = require("../src/admin/mock-ids");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { SequenceStateStore } = require("../src/mocks/sequence-state");
const { HandlerStateStore } = require("../src/mocks/handler-state");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

describe("sequence response admin API", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("sequence-admin-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  const MOCK_ID = encodeMockId("operazioni/GET.endpoint.json");
  const SEQUENCE_PAYLOAD = {
    steps: [
      { response: "001.response.json", times: 2 },
      { response: "002.response.json" },
    ],
    onEnd: "stay",
  };

  async function writeEndpointWithVariants({ withSequence = false, selectedResponseFile } = {}) {
    const endpointDir = path.join(mocksDir, "operazioni");
    const responseDir = path.join(endpointDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    const variants = {
      "001.response.json": {
        type: "mock",
        title: "Processing",
        status: 202,
        headers: {},
        delayMs: 0,
        body: { status: "processing" },
      },
      "002.response.json": {
        type: "mock",
        title: "Completed",
        status: 200,
        headers: {},
        delayMs: 0,
        body: { status: "completed" },
      },
    };
    if (withSequence) {
      variants["003.response.json"] = {
        type: "sequence",
        title: "Polling",
        ...SEQUENCE_PAYLOAD,
      };
    }
    for (const [fileName, content] of Object.entries(variants)) {
      await fs.promises.writeFile(path.join(responseDir, fileName), `${JSON.stringify(content, null, 2)}\n`, "utf8");
    }
    const endpoint = {
      method: "GET",
      path: "/api/operazioni",
      description: "",
      enabled: true,
      responseFiles: Object.keys(variants),
      selectedResponseFile: selectedResponseFile || (withSequence ? "003.response.json" : "001.response.json"),
    };
    await fs.promises.writeFile(
      path.join(endpointDir, "GET.endpoint.json"),
      `${JSON.stringify(endpoint, null, 2)}\n`,
      "utf8"
    );
    return { endpointDir, responseDir };
  }

  async function readEndpointFromDisk(endpointDir = path.join(mocksDir, "operazioni"), method = "GET") {
    return JSON.parse(await fs.promises.readFile(path.join(endpointDir, `${method}.endpoint.json`), "utf8"));
  }

  async function readResponseFromDisk(fileName, responseDir = path.join(mocksDir, "operazioni", "GET.responses")) {
    return JSON.parse(await fs.promises.readFile(path.join(responseDir, fileName), "utf8"));
  }

  async function buildApp({ overrideReloadResult, skipReloadRounds = 0 } = {}) {
    const sequenceStates = new SequenceStateStore();
    const handlerStates = new HandlerStateStore();
    // `skipReloadRounds` modella l'aggregazione del motore: le chiamate arrivate mentre un giro
    // e' in corso vengono servite dal giro SUCCESSIVO (vedi createReloadHandler), quindi due
    // mutazioni ravvicinate possono condividere una sola riconciliazione. Saltare il giro della
    // prima mutazione riproduce esattamente quella condizione, in modo deterministico.
    let roundsToSkip = skipReloadRounds;
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
    const sharedStates = new SharedStateStore();
    const reloadRuntime = async () => {
      if (roundsToSkip > 0) {
        roundsToSkip -= 1;
        return { applied: true, loadErrors: [], fatalError: null };
      }
      const next = await load();
      const changedSequenceKeys = registry.setRouteGroups(next.routeGroups);
      proxyMiddlewareRegistry.setRouteGroups(next.proxyMiddlewareRouteGroups);
      for (const key of changedSequenceKeys) {
        handlerStates.reset(key);
      }
      if (typeof overrideReloadResult === "function") {
        return overrideReloadResult(next);
      }
      return { applied: true, loadErrors: next.loadErrors, fatalError: null };
    };

    const app = createApp({
      registry,
      config: { mocksDir, requestTimeoutMs: 5000, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry,
      reloadRuntime,
      requestMonitor: new RequestMonitorStore(),
      sequenceStates,
      handlerStates,
      sharedStates,
    });
    return { app, sequenceStates, handlerStates, sharedStates };
  }

  test("crea e seleziona una response sequence, poi il runtime la serve", async () => {
    await writeEndpointWithVariants();
    const { app } = await buildApp();

    const created = await request(app)
      .post(`/_admin/api/mocks/${MOCK_ID}/responses`)
      .send({ type: "sequence", title: "Polling", ...SEQUENCE_PAYLOAD });

    expect(created.status).toBe(201);
    const endpoint = await readEndpointFromDisk();
    expect(endpoint).not.toHaveProperty("sequence");
    expect(endpoint.selectedResponseFile).toBe("003.response.json");
    expect(await readResponseFromDisk("003.response.json")).toEqual({
      type: "sequence",
      title: "Polling",
      ...SEQUENCE_PAYLOAD,
    });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "completed" });

    const catalog = await request(app).get("/_admin/api/mocks");
    expect(catalog.body.items.find((item) => item.path === "/api/operazioni").sequenceActive).toBe(true);
  });

  test("dettaglio e state endpoint espongono definizione, filename e cursore", async () => {
    await writeEndpointWithVariants({ withSequence: true });
    const { app } = await buildApp();

    const fresh = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);
    expect(fresh.body.endpoint).not.toHaveProperty("sequence");
    expect(fresh.body.type).toBe("sequence");
    expect(fresh.body.status).toBeNull();
    expect(fresh.body.payloadType).toBe("none");
    expect(fresh.body.sequence).toEqual({
      ...SEQUENCE_PAYLOAD,
      resetAfterMs: null,
    });
    expect(fresh.body.sequenceState).toEqual({
      stepIndex: 0,
      servedInStep: 0,
      stepStartedAt: null,
      lastRequestAt: null,
    });

    await request(app).get("/api/operazioni");
    const state = await request(app).get(`/_admin/api/mocks/${MOCK_ID}/sequence/state`);
    expect(state.status).toBe(200);
    expect(state.body.sequenceFile).toBe("003.response.json");
    expect(state.body.sequenceState.stepIndex).toBe(0);
    expect(state.body.sequenceState.servedInStep).toBe(1);
  });

  test("state e reset rifiutano un endpoint la cui response selezionata non è sequence", async () => {
    await writeEndpointWithVariants();
    const { app } = await buildApp();

    expect((await request(app).get(`/_admin/api/mocks/${MOCK_ID}/sequence/state`)).status).toBe(400);
    expect((await request(app).post(`/_admin/api/mocks/${MOCK_ID}/sequence/reset`).send({})).status).toBe(400);
  });

  test("resetta cursore e memoria handler della sequence selezionata", async () => {
    await writeEndpointWithVariants({ withSequence: true });
    const { app, handlerStates, sharedStates } = await buildApp();
    await request(app).get("/api/operazioni");
    await request(app).get("/api/operazioni");
    handlerStates.enter("GET /api/operazioni").state.n = 7;
    const facade = sharedStates.createRequestFacade();
    const shared = await facade.api.open("sequence-independent", {
      seedKey: "sequence-independent@v1",
      initialize: () => ({ count: 0 }),
    });
    shared.mutate((draft) => { draft.count = 4; });

    const reset = await request(app).post(`/_admin/api/mocks/${MOCK_ID}/sequence/reset`).send({});

    expect(reset.status).toBe(200);
    expect(reset.body.sequenceFile).toBe("003.response.json");
    expect(reset.body.sequenceState.stepIndex).toBe(0);
    const freshHandlerState = handlerStates.enter("GET /api/operazioni");
    expect(freshHandlerState.callCount).toBe(1);
    expect(freshHandlerState.state).toEqual({});
    expect(shared.read()).toEqual({ count: 4 });
    expect((await request(app).get("/api/operazioni")).body).toEqual({ status: "processing" });
  });

  test("il vecchio PUT { sequence } viene rifiutato senza modificare l'endpoint", async () => {
    await writeEndpointWithVariants();
    const before = await readEndpointFromDisk();
    const { app } = await buildApp();

    const result = await request(app).put(`/_admin/api/mocks/${MOCK_ID}`).send({ sequence: SEQUENCE_PAYLOAD });

    expect(result.status).toBe(400);
    expect(result.body.message).toContain("responses/:file");
    expect(await readEndpointFromDisk()).toEqual(before);
  });

  test("modifica per filename e resetta il cursore solo quando cambia lo scenario", async () => {
    await writeEndpointWithVariants({ withSequence: true });
    const { app } = await buildApp();
    await request(app).get("/api/operazioni");

    const titleOnly = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}/responses/003.response.json`)
      .send({ title: "Polling rinominato" });
    expect(titleOnly.status).toBe(200);
    let state = await request(app).get(`/_admin/api/mocks/${MOCK_ID}/sequence/state`);
    expect(state.body.sequenceState.servedInStep).toBe(1);

    const changed = await request(app)
      .put(`/_admin/api/mocks/${MOCK_ID}/responses/003.response.json`)
      .send({ steps: [{ response: "001.response.json", times: 1 }, { response: "002.response.json" }] });
    expect(changed.status).toBe(200);
    state = await request(app).get(`/_admin/api/mocks/${MOCK_ID}/sequence/state`);
    expect(state.body.sequenceState).toMatchObject({ stepIndex: 0, servedInStep: 0 });
  });

  test("create rifiuta un grafo con step middleware prima del successo", async () => {
    const { responseDir } = await writeEndpointWithVariants();
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

    const result = await request(app).post(`/_admin/api/mocks/${MOCK_ID}/responses`).send({
      type: "sequence",
      title: "Invalida",
      steps: [{ response: "001.response.json", times: 1 }, { response: "003.response.json" }],
    });

    expect(result.status).toBe(400);
    expect(result.body.message).toContain("mock or handler");
    expect((await readEndpointFromDisk()).responseFiles).toHaveLength(3);
    expect(fs.existsSync(path.join(responseDir, "004.response.json"))).toBe(false);
  });

  test("la cancellazione di una response referenziata restituisce 409 con referencedBy", async () => {
    await writeEndpointWithVariants({ withSequence: true });
    const { app } = await buildApp();

    const result = await request(app).delete(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`);

    expect(result.status).toBe(409);
    expect(result.body.details).toEqual({ referencedBy: ["003.response.json"] });
    expect((await readEndpointFromDisk()).responseFiles).toContain("001.response.json");
  });

  test("una sequence auto-referenziante scritta a mano resta cancellabile", async () => {
    // L'admin API non produce mai un auto-riferimento, ma il file si può scrivere a mano: i
    // riferimenti della sequence spariscono insieme al file, quindi non devono bloccarla.
    const { responseDir } = await writeEndpointWithVariants({
      withSequence: true,
      selectedResponseFile: "001.response.json",
    });
    await fs.promises.writeFile(
      path.join(responseDir, "003.response.json"),
      `${JSON.stringify(
        {
          type: "sequence",
          title: "Auto",
          steps: [{ response: "001.response.json", times: 1 }, { response: "003.response.json" }],
          onEnd: "stay",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    const { app } = await buildApp();

    const result = await request(app).delete(`/_admin/api/mocks/${MOCK_ID}/responses/003.response.json`);

    expect(result.status).toBe(200);
    expect((await readEndpointFromDisk()).responseFiles).toEqual(["001.response.json", "002.response.json"]);
    expect(fs.existsSync(path.join(responseDir, "003.response.json"))).toBe(false);
  });

  test("una variante corrotta viene saltata dall'indice dei riferimenti, non fatta esplodere", async () => {
    // Una variante illeggibile non dichiara riferimenti validi: la guardia della delete deve
    // continuare a rispondere sui riferimenti REALI, non fallire sul parsing della vicina rotta.
    const { responseDir } = await writeEndpointWithVariants({ withSequence: true });
    await fs.promises.writeFile(path.join(responseDir, "004.response.json"), "{ invalid json", "utf8");
    const endpoint = await readEndpointFromDisk();
    endpoint.responseFiles.push("004.response.json");
    await fs.promises.writeFile(
      path.join(mocksDir, "operazioni", "GET.endpoint.json"),
      `${JSON.stringify(endpoint, null, 2)}\n`,
      "utf8"
    );
    const { app } = await buildApp();

    const result = await request(app).delete(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`);

    expect(result.status).toBe(409);
    expect(result.body.details).toEqual({ referencedBy: ["003.response.json"] });
  });

  test("uscire da una sequence e rientrarci azzera lo scenario anche se i reload vengono aggregati", async () => {
    // La riconciliazione confronta due scansioni: se i due cambi di selezione finiscono nello
    // stesso giro, vede la stessa firma da entrambi i lati e conclude che nulla e' cambiato. Ad
    // accorgersene puo' essere solo la mutazione, che sa di aver attraversato lo stato intermedio.
    await writeEndpointWithVariants({ withSequence: true });
    const { app } = await buildApp({ skipReloadRounds: 1 });

    await request(app).get("/api/operazioni");
    const served = await request(app).get(`/_admin/api/mocks/${MOCK_ID}/sequence/state`);
    expect(served.body.sequenceState).toMatchObject({ stepIndex: 0, servedInStep: 1 });

    // Esce dalla sequence e ci rientra: per il disco la selezione finale e' quella di partenza.
    await request(app).put(`/_admin/api/mocks/${MOCK_ID}`).send({ selectedResponseFile: "001.response.json" });
    await request(app).put(`/_admin/api/mocks/${MOCK_ID}`).send({ selectedResponseFile: "003.response.json" });

    const state = await request(app).get(`/_admin/api/mocks/${MOCK_ID}/sequence/state`);
    expect(state.status).toBe(200);
    expect(state.body.sequenceState).toMatchObject({ stepIndex: 0, servedInStep: 0 });
  });

  test("riselezionare la stessa variante è un no-op e conserva il cursore", async () => {
    await writeEndpointWithVariants({ withSequence: true });
    const { app } = await buildApp();

    await request(app).get("/api/operazioni");
    await request(app).put(`/_admin/api/mocks/${MOCK_ID}`).send({ selectedResponseFile: "003.response.json" });

    const state = await request(app).get(`/_admin/api/mocks/${MOCK_ID}/sequence/state`);
    expect(state.body.sequenceState).toMatchObject({ stepIndex: 0, servedInStep: 1 });
  });

  test("clona una sequence come nuova variante con una nuova identità", async () => {
    await writeEndpointWithVariants({ withSequence: true });
    const { app } = await buildApp();

    const cloned = await request(app)
      .post(`/_admin/api/mocks/${MOCK_ID}/responses`)
      .send({ title: "Polling clone" });

    expect(cloned.status).toBe(201);
    expect((await readEndpointFromDisk()).selectedResponseFile).toBe("004.response.json");
    expect(await readResponseFromDisk("004.response.json")).toEqual({
      type: "sequence",
      title: "Polling clone",
      ...SEQUENCE_PAYLOAD,
    });
  });

  test("la copia parziale di un endpoint sequence include la chiusura minima degli step", async () => {
    await writeEndpointWithVariants({ withSequence: true });
    const { app } = await buildApp();

    const copied = await request(app).post(`/_admin/api/mocks/${MOCK_ID}/copy`).send({
      method: "POST",
      path: "/api/operazioni-copia",
      copyResponses: false,
    });

    expect(copied.status).toBe(201);
    const targetDir = path.join(mocksDir, "api", "operazioni-copia");
    const endpoint = await readEndpointFromDisk(targetDir, "POST");
    expect(endpoint.responseFiles).toEqual([
      "001.response.json",
      "002.response.json",
      "003.response.json",
    ]);
    expect(endpoint.selectedResponseFile).toBe("003.response.json");
  });

  test("un loadError dell'endpoint mutato causa rollback anche se il reload è applicato", async () => {
    const { responseDir } = await writeEndpointWithVariants();
    const endpointPath = path.join(mocksDir, "operazioni", "GET.endpoint.json");
    const before = await readEndpointFromDisk();
    const { app } = await buildApp({
      overrideReloadResult: () => ({
        applied: true,
        loadErrors: [{ filePath: endpointPath, message: "graph not loadable" }],
        fatalError: null,
      }),
    });

    const result = await request(app)
      .post(`/_admin/api/mocks/${MOCK_ID}/responses`)
      .send({ type: "sequence", title: "Polling", ...SEQUENCE_PAYLOAD });

    expect(result.status).toBe(400);
    expect(result.body.message).toContain("graph not loadable");
    expect(await readEndpointFromDisk()).toEqual(before);
    expect(fs.existsSync(path.join(responseDir, "003.response.json"))).toBe(false);
  });
});
