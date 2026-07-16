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
const { createMemoryLogger, createNoopLogger, createTempDir, removeDir, writeMock } = require("./helpers");

// Templating dei mock statici nel serving reale: placeholder risolti da params/query/headers/
// body, filtro dei tipi, header templati, ordine template→paginazione, opt-in.
describe("mock templating nel serving", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("mock-templating-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  async function buildApp({ logger } = {}) {
    const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups, loadErrors } =
      await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toEqual([]);
    const routeGroups = mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups });
    return createApp({
      registry: new MockRegistry(routeGroups),
      config: { requestTimeoutMs: 5000, proxyFallbackEnabled: false },
      logger: logger || createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups),
      requestMonitor: new RequestMonitorStore(),
    });
  }

  test("il caso simbolo: ripete il path param nella risposta, tipizzato", async () => {
    await writeMock({
      mocksDir,
      folder: "utenti",
      method: "GET",
      routePath: "/api/utenti/:id",
      templated: true,
      body: {
        id: "{{params.id | number}}",
        nome: "Utente {{params.id}}",
        ruolo: "{{query.ruolo}}",
      },
    });
    const app = await buildApp();

    const res = await request(app).get("/api/utenti/42?ruolo=admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 42, nome: "Utente 42", ruolo: "admin" });
  });

  test("senza opt-in i placeholder restano letterali (nessuna sorpresa sui mock esistenti)", async () => {
    await writeMock({
      mocksDir,
      folder: "letterale",
      method: "GET",
      routePath: "/api/letterale/:id",
      body: { esempio: "{{params.id}}" },
    });
    const app = await buildApp();

    const res = await request(app).get("/api/letterale/9");
    expect(res.body).toEqual({ esempio: "{{params.id}}" });
  });

  test("header templati (es. Location col param) e header della richiesta come sorgente", async () => {
    await writeMock({
      mocksDir,
      folder: "creazione",
      method: "POST",
      routePath: "/api/risorse/:id",
      status: 201,
      templated: true,
      headers: { location: "/api/risorse/{{params.id}}", "x-tenant-echo": "{{headers.x-tenant}}" },
      body: { creato: true },
    });
    const app = await buildApp();

    const res = await request(app).post("/api/risorse/7").set("x-tenant", "acme");
    expect(res.status).toBe(201);
    expect(res.headers["location"]).toBe("/api/risorse/7");
    expect(res.headers["x-tenant-echo"]).toBe("acme");
  });

  test("body JSON della richiesta come sorgente (bufferizzato solo quando referenziato)", async () => {
    await writeMock({
      mocksDir,
      folder: "eco",
      method: "POST",
      routePath: "/api/eco",
      templated: true,
      body: { email: "{{body.utente.email}}", extra: "{{body.extra | json}}" },
    });
    const app = await buildApp();

    const res = await request(app)
      .post("/api/eco")
      .set("content-type", "application/json")
      .send({ utente: { email: "ada@example.com" }, extra: { a: 1 } });
    expect(res.body).toEqual({ email: "ada@example.com", extra: { a: 1 } });
  });

  test("body testuale templato (resta testo)", async () => {
    await writeMock({
      mocksDir,
      folder: "csv",
      method: "GET",
      routePath: "/api/csv/:id",
      templated: true,
      headers: { "content-type": "text/csv" },
      body: "id,nome\n{{params.id}},Utente {{params.id}}",
    });
    const app = await buildApp();

    const res = await request(app).get("/api/csv/3");
    expect(res.text).toBe("id,nome\n3,Utente 3");
  });

  test("il template si applica PRIMA di paginazione e filtri automatici", async () => {
    await writeMock({
      mocksDir,
      folder: "lista",
      method: "GET",
      routePath: "/api/lista/:gruppo",
      templated: true,
      body: [
        { id: 1, gruppo: "{{params.gruppo}}" },
        { id: 2, gruppo: "{{params.gruppo}}" },
        { id: 3, gruppo: "{{params.gruppo}}" },
      ],
    });
    const app = await buildApp();

    const res = await request(app).get("/api/lista/rossi?page=0&size=2");
    expect(res.headers["x-total-count"]).toBe("3");
    expect(res.body).toEqual([
      { id: 1, gruppo: "rossi" },
      { id: 2, gruppo: "rossi" },
    ]);
  });

  test("placeholder non risolto: risposta servita comunque, warning nel log", async () => {
    await writeMock({
      mocksDir,
      folder: "typo",
      method: "GET",
      routePath: "/api/typo",
      templated: true,
      body: { valore: "{{query.assente}}" },
    });
    const logger = createMemoryLogger();
    const app = await buildApp({ logger });

    const res = await request(app).get("/api/typo");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valore: "" });
    const warning = logger.entries.warn.find((e) => e.message === "Mock template placeholder did not resolve.");
    expect(warning).toBeDefined();
    expect(warning.fields.placeholder).toBe("query.assente");
  });

  test("templated su un payload file: endpoint degradato al load", async () => {
    await writeMock({
      mocksDir,
      folder: "binario",
      method: "GET",
      routePath: "/api/binario",
      templated: true,
      fileContent: Buffer.from("contenuto"),
    });

    const result = await loadEndpointRouteGroups(mocksDir);
    expect(result.mockRouteGroups).toHaveLength(0);
    expect(result.loadErrors).toHaveLength(1);
    expect(result.loadErrors[0].message).toContain("templated is not supported on file payloads");
  });

  test("templated non booleano: endpoint degradato al load", async () => {
    await writeMock({
      mocksDir,
      folder: "malformato",
      method: "GET",
      routePath: "/api/malformato",
      templated: "sì",
      body: { ok: true },
    });

    const result = await loadEndpointRouteGroups(mocksDir);
    expect(result.loadErrors).toHaveLength(1);
    expect(result.loadErrors[0].message).toContain("templated must be a boolean");
  });

  describe("admin API", () => {
    const MOCK_ID = encodeMockId("utenti/GET.endpoint.json");

    async function buildAdminApp() {
      const load = async () => {
        const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups, sequenceRouteGroups } =
          await loadEndpointRouteGroups(mocksDir);
        return {
          routeGroups: mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups, sequenceRouteGroups }),
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
      return createApp({
        registry,
        config: { mocksDir, requestTimeoutMs: 5000, proxyFallbackEnabled: false },
        logger: createNoopLogger(),
        proxyMiddlewareRegistry,
        reloadRuntime,
        requestMonitor: new RequestMonitorStore(),
      });
    }

    async function readResponseFromDisk() {
      return JSON.parse(
        await fs.promises.readFile(path.join(mocksDir, "utenti", "GET.responses", "001.response.json"), "utf8"),
      );
    }

    test("accendere templated dalla PUT della response: persistito, servito, esposto nel dettaglio", async () => {
      await writeMock({
        mocksDir,
        folder: "utenti",
        method: "GET",
        routePath: "/api/utenti/:id",
        body: { id: "{{params.id | number}}" },
      });
      const app = await buildAdminApp();

      // Prima dell'opt-in il placeholder resta letterale.
      expect((await request(app).get("/api/utenti/5")).body).toEqual({ id: "{{params.id | number}}" });

      const put = await request(app)
        .put(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`)
        .send({ templated: true });
      expect(put.status).toBe(200);

      expect((await readResponseFromDisk()).templated).toBe(true);
      expect((await request(app).get("/api/utenti/5")).body).toEqual({ id: 5 });

      const detail = await request(app).get(`/_admin/api/mocks/${MOCK_ID}`);
      expect(detail.body.config.templated).toBe(true);
      expect(detail.body.responses[0].templated).toBe(true);
    });

    test("le altre scritture conservano templated (aggiornare il body non lo spegne)", async () => {
      await writeMock({
        mocksDir,
        folder: "utenti",
        method: "GET",
        routePath: "/api/utenti/:id",
        templated: true,
        body: { id: "{{params.id | number}}" },
      });
      const app = await buildAdminApp();

      const put = await request(app)
        .put(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`)
        .send({ body: { id: "{{params.id | number}}", nuovo: true } });
      expect(put.status).toBe(200);

      expect((await readResponseFromDisk()).templated).toBe(true);
      expect((await request(app).get("/api/utenti/8")).body).toEqual({ id: 8, nuovo: true });
    });

    test("templated non booleano nella PUT: 400 senza toccare il file", async () => {
      await writeMock({
        mocksDir,
        folder: "utenti",
        method: "GET",
        routePath: "/api/utenti/:id",
        body: { ok: true },
      });
      const app = await buildAdminApp();

      const put = await request(app)
        .put(`/_admin/api/mocks/${MOCK_ID}/responses/001.response.json`)
        .send({ templated: "sì" });
      expect(put.status).toBe(400);
      expect((await readResponseFromDisk())).not.toHaveProperty("templated");
    });
  });
});
