const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const request = require("supertest");
const { createApp } = require("../src/app");
const { encodeMockId } = require("../src/admin/mock-ids");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { MonitorDumpWriter } = require("../src/monitoring/monitor-dump");
const {
  createNoopLogger,
  createTempDir,
  removeDir,
  startBackendServer,
  stopBackendServer,
  waitFor,
  writeHandler,
  writeMock,
  writeProxyMiddleware,
} = require("./helpers");

describe("admin API", () => {
  let mocksDir;
  let backend;
  let monitorDumpDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("admin-api-");
    monitorDumpDir = await createTempDir("admin-dump-");
    backend = await startBackendServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ backend: true }));
    });
  });

  afterEach(async () => {
    if (backend) {
      await stopBackendServer(backend.server);
      backend = null;
    }
    if (mocksDir) {
      await removeDir(mocksDir);
      mocksDir = null;
    }
    if (monitorDumpDir) {
      await removeDir(monitorDumpDir);
      monitorDumpDir = null;
    }
  });

  async function buildApp(configOverrides = {}) {
    const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups } =
      await loadEndpointRouteGroups(mocksDir);
    const routeGroups = mergeLocalRouteGroups({
      mockRouteGroups,
      handlerRouteGroups,
    });
    const registry = new MockRegistry(routeGroups);
    const proxyMiddlewareRegistry = new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups);
    const reloadRuntime = async () => {
      const {
        mockRouteGroups: nextMockRouteGroups,
        handlerRouteGroups: nextHandlerRouteGroups,
        proxyMiddlewareRouteGroups: nextProxyMiddlewareRouteGroups,
      } = await loadEndpointRouteGroups(mocksDir);
      const nextRouteGroups = mergeLocalRouteGroups({
        mockRouteGroups: nextMockRouteGroups,
        handlerRouteGroups: nextHandlerRouteGroups,
      });
      registry.setRouteGroups(nextRouteGroups);
      proxyMiddlewareRegistry.setRouteGroups(nextProxyMiddlewareRouteGroups);
    };

    const requestMonitor = new RequestMonitorStore();
    const monitorDump = new MonitorDumpWriter({ dumpDir: monitorDumpDir, intervalMs: 999999, threshold: 1000 });
    return createApp({
      registry,
      config: {
        backendUrl: backend.url,
        requestTimeoutMs: 15000,
        mocksDir,
        monitorDumpDir,
        adminApiEnabled: true,
        proxyFallbackEnabled: true,
        ...configOverrides,
      },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry,
      reloadRuntime,
      requestMonitor,
      monitorDump,
    });
  }

  describe("monitor dump", () => {
    test("stato di default: disabilitato", async () => {
      const app = await buildApp();
      const res = await request(app).get("/_admin/api/monitoring/dump");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ enabled: false });
    });

    test("abilita, aggiorna config e disabilita", async () => {
      const app = await buildApp();
      const on = await request(app)
        .patch("/_admin/api/monitoring/dump")
        .send({ enabled: true, intervalMs: 5000, threshold: 50 });
      expect(on.status).toBe(200);
      expect(on.body).toMatchObject({ enabled: true, intervalMs: 5000, threshold: 50 });

      const off = await request(app).patch("/_admin/api/monitoring/dump").send({ enabled: false });
      expect(off.body).toMatchObject({ enabled: false });
    });

    test("patch rifiuta tipi non validi", async () => {
      const app = await buildApp();
      const res = await request(app).patch("/_admin/api/monitoring/dump").send({ enabled: "si" });
      expect(res.status).toBe(400);
    });

    test("flush manuale ritorna il conteggio", async () => {
      const app = await buildApp();
      await request(app).patch("/_admin/api/monitoring/dump").send({ enabled: true });
      const res = await request(app).post("/_admin/api/monitoring/dump/flush");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ flushed: 0 });
      await request(app).patch("/_admin/api/monitoring/dump").send({ enabled: false });
    });

    test("elenca i file e legge a cursore attraverso più file", async () => {
      const ndjson = (n, off) =>
        `${Array.from({ length: n }, (_, i) => JSON.stringify({ id: String(off + i), method: "GET", path: `/a/${off + i}`, status: 200 })).join("\n")}\n`;
      await fs.promises.writeFile(path.join(monitorDumpDir, "dump-2026-01-01T00-00-00-000Z.ndjson"), ndjson(2, 0), "utf8");
      await fs.promises.writeFile(path.join(monitorDumpDir, "dump-2026-01-01T00-01-00-000Z.ndjson"), ndjson(2, 100), "utf8");
      const app = await buildApp();

      const list = await request(app).get("/_admin/api/monitoring/dumps");
      expect(list.status).toBe(200);
      expect(list.body.files).toHaveLength(2);

      const page1 = await request(app).get("/_admin/api/monitoring/dumps/read").query({ limit: 3 });
      expect(page1.body.items).toHaveLength(3);
      expect(page1.body.done).toBe(false);

      const page2 = await request(app).get("/_admin/api/monitoring/dumps/read").query(page1.body.nextCursor);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.done).toBe(true);
    });

    test("elimina un file di dump", async () => {
      await fs.promises.writeFile(path.join(monitorDumpDir, "dump-del.ndjson"), "{}\n", "utf8");
      const app = await buildApp();
      const del = await request(app).delete("/_admin/api/monitoring/dumps/dump-del.ndjson");
      expect(del.status).toBe(204);
      const list = await request(app).get("/_admin/api/monitoring/dumps");
      expect(list.body.files.find((f) => f.name === "dump-del.ndjson")).toBeUndefined();
    });

    test("respinge nomi file non sicuri sull'eliminazione", async () => {
      const app = await buildApp();
      const res = await request(app).delete("/_admin/api/monitoring/dumps/notdump.txt");
      expect(res.status).toBe(400);
    });

    test("create-mocks: crea dal file, skeleton per binari, salta esistenti", async () => {
      const entries = [
        { id: "1", method: "GET", path: "/api/a", matchedRoutePath: "/api/a", status: 200, responseHeaders: { "content-type": "application/json", "content-length": "9" }, responseBody: '{"ok":true}' },
        { id: "2", method: "GET", path: "/api/bin", matchedRoutePath: "/api/bin", status: 200, responseHeaders: { "content-type": "application/pdf" }, responseBody: "[binary payload: 999 bytes]" },
        { id: "3", method: "GET", path: "/api/a", matchedRoutePath: "/api/a", status: 200, responseHeaders: {}, responseBody: '{"dup":1}' },
      ];
      const ndjson = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
      await fs.promises.writeFile(path.join(monitorDumpDir, "dump-batch.ndjson"), ndjson, "utf8");
      const app = await buildApp();

      const res = await request(app)
        .post("/_admin/api/monitoring/dumps/create-mocks")
        .send({ file: "dump-batch.ndjson" });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ created: 1, createdEmpty: 1, skippedExisting: 1, failed: 0 });

      const mocks = await request(app).get("/_admin/api/mocks");
      const paths = mocks.body.items.map((i) => i.path);
      expect(paths).toContain("/api/a");
      expect(paths).toContain("/api/bin");

      // Lo skeleton riceve la descrizione "[da completare]" già in fase di create (single-call, niente update separato).
      const binItem = mocks.body.items.find((i) => i.path === "/api/bin");
      const binDetail = await request(app).get(`/_admin/api/mocks/${binItem.id}`);
      expect(binDetail.body.endpoint.description).toBe("[da completare] body non catturato (binario/oltre 156KB)");
    });

    test("create-mocks: selezione mancante → 400", async () => {
      const app = await buildApp();
      const res = await request(app).post("/_admin/api/monitoring/dumps/create-mocks").send({});
      expect([400, 500]).toContain(res.status);
    });
  });

  describe("server/proxy runtime toggle", () => {
    test("exposes the default active state", async () => {
      const app = await buildApp();
      const res = await request(app).get("/_admin/api/server");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ serverEnabled: true, proxyAll: false });
    });

    test("patches the toggles and keeps them within the running app", async () => {
      const app = await buildApp();

      const enabledProxy = await request(app).patch("/_admin/api/server").send({ proxyAll: true });
      expect(enabledProxy.status).toBe(200);
      expect(enabledProxy.body).toEqual({ serverEnabled: true, proxyAll: true });

      const turnedOff = await request(app).patch("/_admin/api/server").send({ serverEnabled: false });
      expect(turnedOff.body).toEqual({ serverEnabled: false, proxyAll: true });

      const current = await request(app).get("/_admin/api/server");
      expect(current.body).toEqual({ serverEnabled: false, proxyAll: true });
    });

    test("rejects non-boolean toggle values", async () => {
      const app = await buildApp();
      const res = await request(app).patch("/_admin/api/server").send({ serverEnabled: "on" });
      expect(res.status).toBe(400);
    });

    test("proxy all forwards a request that a mock would otherwise serve", async () => {
      await writeMock({ mocksDir, folder: "users", method: "GET", routePath: "/users", body: { mocked: true } });
      const app = await buildApp();

      const fromMock = await request(app).get("/users");
      expect(fromMock.body).toEqual({ mocked: true });
      expect(fromMock.headers["x-mock-source"]).toBe("mock");

      await request(app).patch("/_admin/api/server").send({ proxyAll: true });

      const fromBackend = await request(app).get("/users");
      expect(fromBackend.body).toEqual({ backend: true });
      expect(fromBackend.headers["x-mock-source"]).toBe("backend");
    });

    test("server off also forwards every request to the backend", async () => {
      await writeMock({ mocksDir, folder: "users", method: "GET", routePath: "/users", body: { mocked: true } });
      const app = await buildApp();

      await request(app).patch("/_admin/api/server").send({ serverEnabled: false });

      const res = await request(app).get("/users");
      expect(res.body).toEqual({ backend: true });
      expect(res.headers["x-mock-source"]).toBe("backend");
    });

    test("monitor keeps recording under proxy all but stops when the server is off", async () => {
      const app = await buildApp();

      await request(app).patch("/_admin/api/server").send({ proxyAll: true });
      await request(app).get("/watched");
      await waitFor(async () => (await request(app).get("/_admin/api/monitoring/requests")).body.items.length > 0);

      await request(app).delete("/_admin/api/monitoring/requests");
      await request(app).patch("/_admin/api/server").send({ serverEnabled: false });
      await request(app).get("/ignored");
      // Lascia eventuali (inattesi) handler 'finish' la possibilita' di registrare prima di verificare il vuoto.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const monitored = await request(app).get("/_admin/api/monitoring/requests");
      expect(monitored.body.items.length).toBe(0);
    });
  });

  describe("monitor response capture", () => {
    test("captures the response status, headers and body of a mock", async () => {
      await writeMock({ mocksDir, folder: "users", method: "GET", routePath: "/users", body: { mocked: true } });
      const app = await buildApp();

      await request(app).get("/users");
      await waitFor(async () => (await request(app).get("/_admin/api/monitoring/requests")).body.items.length > 0);

      const entry = (await request(app).get("/_admin/api/monitoring/requests")).body.items[0];
      expect(entry.status).toBe(200);
      expect(entry.source).toBe("mock");
      expect(entry.responseHeaders["x-mock-source"]).toBe("mock");
      expect(JSON.parse(entry.responseBody)).toEqual({ mocked: true });
    });

    test("captures the proxied response body without altering what the client receives", async () => {
      const app = await buildApp();

      const clientResponse = await request(app).get("/anything");
      expect(clientResponse.body).toEqual({ backend: true });

      await waitFor(async () => (await request(app).get("/_admin/api/monitoring/requests")).body.items.length > 0);
      const entry = (await request(app).get("/_admin/api/monitoring/requests")).body.items[0];
      expect(entry.source).toBe("backend");
      expect(JSON.parse(entry.responseBody)).toEqual({ backend: true });
    });

    test("decomprime una response gzip proxata sia nel monitor sia nel dump su disco", async () => {
      await stopBackendServer(backend.server);
      backend = await startBackendServer((_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("content-encoding", "gzip");
        res.end(zlib.gzipSync(Buffer.from(JSON.stringify({ backend: true, gz: "ok" }), "utf8")));
      });
      const app = await buildApp();
      await request(app).patch("/_admin/api/monitoring/dump").send({ enabled: true });

      // Il client riceve i byte gzip intatti (supertest li decomprime): la cattura non altera la response.
      const clientResponse = await request(app).get("/anything");
      expect(clientResponse.body).toEqual({ backend: true, gz: "ok" });

      await waitFor(async () => (await request(app).get("/_admin/api/monitoring/requests")).body.items.length > 0);
      const entry = (await request(app).get("/_admin/api/monitoring/requests")).body.items[0];
      expect(entry.responseHeaders["content-encoding"]).toBe("gzip");
      expect(JSON.parse(entry.responseBody)).toEqual({ backend: true, gz: "ok" });

      await request(app).post("/_admin/api/monitoring/dump/flush");
      const dump = await request(app).get("/_admin/api/monitoring/dumps/read");
      const dumpedEntry = dump.body.items.find((item) => item.path === "/anything");
      expect(dumpedEntry).toBeDefined();
      expect(JSON.parse(dumpedEntry.responseBody)).toEqual({ backend: true, gz: "ok" });
    });
  });

  describe("serializzazione dello stato delle collection", () => {
    test("creazioni concorrenti non si perdono aggiornamenti (#28)", async () => {
      const app = await buildApp();
      const labels = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

      // Cinque mutazioni in volo insieme: senza serializzazione leggono tutte lo stato vuoto
      // e l'ultima scrittura cancella le altre (lost update).
      const responses = await Promise.all(
        labels.map((label) => request(app).post("/_admin/api/mocks/collections").send({ label }))
      );
      for (const response of responses) {
        expect(response.status).toBe(201);
      }

      const list = await request(app).get("/_admin/api/mocks");
      const storedLabels = list.body.collections.map((collection) => collection.label);
      for (const label of labels) {
        expect(storedLabels).toContain(label);
      }
    });
  });

  describe("guardia DNS-rebinding sull'header Host", () => {
    test("con bind loopback rifiuta un Host estraneo sull'admin API, ma non sui mock", async () => {
      await writeMock({ mocksDir, folder: "open", method: "GET", routePath: "/open", body: { ok: true } });
      const app = await buildApp({ host: "127.0.0.1" });

      // Admin API con Host da rebinding: 403.
      const rejected = await request(app)
        .get("/_admin/api/mocks")
        .set("Host", "evil.example.com:3000");
      expect(rejected.status).toBe(403);
      expect(rejected.body.message).toContain("DNS rebinding");

      // Admin API con Host legittimi (con o senza porta): ok.
      for (const legitHost of ["127.0.0.1:3000", "localhost:4207", "localhost"]) {
        const allowed = await request(app).get("/_admin/api/mocks").set("Host", legitHost);
        expect(allowed.status).toBe(200);
      }

      // I mock non sono filtrati: devono poter essere consumati con qualunque Host.
      const mock = await request(app).get("/open").set("Host", "evil.example.com:3000");
      expect(mock.status).toBe(200);
      expect(mock.body).toEqual({ ok: true });
    });

    test("gli host extra configurati sono ammessi, e attivano la guardia anche su bind di rete", async () => {
      const app = await buildApp({ host: "0.0.0.0", adminAllowedHosts: ["mockxy.intranet"] });

      const allowed = await request(app)
        .get("/_admin/api/mocks")
        .set("Host", "mockxy.intranet:3000");
      expect(allowed.status).toBe(200);

      const rejected = await request(app)
        .get("/_admin/api/mocks")
        .set("Host", "evil.example.com:3000");
      expect(rejected.status).toBe(403);
    });

    test("su bind di rete senza allowlist la guardia non interviene", async () => {
      const app = await buildApp({ host: "0.0.0.0" });

      const response = await request(app)
        .get("/_admin/api/mocks")
        .set("Host", "192.168.1.50:3000");
      expect(response.status).toBe(200);
    });
  });

  describe("OpenAPI import", () => {
    const document = JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/users": { get: { tags: ["Users"], responses: { "200": { content: { "application/json": { example: [{ id: 1 }] } } } } } },
        "/users/{id}": { get: { tags: ["Users"], responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } } } },
        "/health": { get: { responses: { "200": { content: { "application/json": { schema: { type: "object" } } } } } } },
      },
    });

    test("dry-run returns the plan without creating anything", async () => {
      const app = await buildApp();

      const res = await request(app)
        .post("/_admin/api/mocks/import/openapi?dryRun=true")
        .set("Content-Type", "application/yaml")
        .send(document);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 3, create: 3, skip: 0 });
      expect(res.body.items).toHaveLength(3);
      expect(res.body.items[0]).toMatchObject({ method: "GET", action: "create" });
      expect(res.body.items[0].body).toBeUndefined(); // anteprima senza body

      const list = await request(app).get("/_admin/api/mocks");
      expect(list.body.items).toHaveLength(0);
    });

    test("imports endpoints grouped by tag, serves them, and skips existing on re-import", async () => {
      const app = await buildApp();

      const first = await request(app)
        .post("/_admin/api/mocks/import/openapi")
        .set("Content-Type", "application/json")
        .send(document);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ created: 3, skipped: 0 });

      const list = await request(app).get("/_admin/api/mocks");
      expect(list.body.items).toHaveLength(3);
      expect(list.body.collections.some((collection) => collection.label === "Users")).toBe(true);

      const served = await request(app).get("/users");
      expect(served.status).toBe(200);
      expect(served.body).toEqual([{ id: 1 }]);
      expect(served.headers["x-mock-source"]).toBe("mock");

      const second = await request(app)
        .post("/_admin/api/mocks/import/openapi")
        .set("Content-Type", "application/yaml")
        .send(document);
      expect(second.body).toMatchObject({ created: 0, skipped: 3 });
    });

    test("rifiuta text/plain con 415 (guardia CSRF) senza creare nulla", async () => {
      const app = await buildApp();

      // text/plain è un content-type da "simple request": una POST cross-origin partirebbe
      // dal browser senza preflight CORS. L'endpoint deve rifiutarlo esplicitamente.
      const res = await request(app)
        .post("/_admin/api/mocks/import/openapi")
        .set("Content-Type", "text/plain")
        .send(document);

      expect(res.status).toBe(415);
      expect(res.body.message).toContain("CSRF");

      const list = await request(app).get("/_admin/api/mocks");
      expect(list.body.items).toHaveLength(0);
    });
  });

  test("lists mock responses and proxy middleware definitions including disabled mocks", async () => {
    await writeMock({
      mocksDir,
      folder: "enabled",
      method: "GET",
      routePath: "/enabled",
      body: { ok: true },
    });
    await writeMock({
      mocksDir,
      folder: "disabled",
      method: "POST",
      routePath: "/disabled",
      enabled: false,
      status: 204,
      body: { disabled: true },
    });
    await writeProxyMiddleware({
      mocksDir,
      folder: "middleware",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/middleware",
  disabled: true,
  async transformResponse() {
    return undefined;
  }
};
`,
    });
    await writeHandler({
      mocksDir,
      folder: "handler",
      method: "POST",
      source: `module.exports = {
  method: "POST",
  path: "/handler",
  disabled: false,
  async resolveResponse() {
    return {
      jsonBody: {
        ok: true
      }
    };
  }
};
`,
    });

    const app = await buildApp();
    const response = await request(app).get("/_admin/api/mocks");

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mock",
          method: "GET",
          path: "/enabled",
          disabled: false,
          payloadType: "json",
        }),
        expect.objectContaining({
          type: "mock",
          method: "POST",
          path: "/disabled",
          disabled: true,
          payloadType: "json",
        }),
        expect.objectContaining({
          type: "middleware",
          method: "GET",
          path: "/middleware",
          disabled: true,
        }),
        expect.objectContaining({
          type: "handler",
          method: "POST",
          path: "/handler",
          disabled: false,
        }),
      ])
    );
  });

  test("creates a persisted collection and exposes it in the admin catalog", async () => {
    const app = await buildApp();

    const createResponse = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({
        label: "Archiviati",
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual({
      id: "collection-archiviati",
      label: "Archiviati",
      itemCount: 0,
    });
    expect(fs.existsSync(path.join(mocksDir, ".collections.json"))).toBe(true);

    const listResponse = await request(app).get("/_admin/api/mocks");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.collections).toEqual([
      {
        id: "collection-archiviati",
        label: "Archiviati",
        itemCount: 0,
      },
    ]);
  });

  test("assigns a definition to a persisted collection without moving files", async () => {
    await writeMock({
      mocksDir,
      folder: "source-folder",
      method: "GET",
      routePath: "/collection-assigned",
      body: { assigned: true },
    });

    const app = await buildApp();
    const mockId = encodeMockId("source-folder/GET.endpoint.json");

    const createCollectionResponse = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({
        label: "Archiviati",
      });

    const assignResponse = await request(app)
      .put(`/_admin/api/mocks/${mockId}/collection`)
      .send({
        collectionId: createCollectionResponse.body.id,
      });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body).toEqual(
      expect.objectContaining({
        id: mockId,
        configFilePath: "source-folder/GET.endpoint.json",
        collectionId: "collection-archiviati",
      })
    );
    expect(fs.existsSync(path.join(mocksDir, "source-folder", "GET.endpoint.json"))).toBe(true);
    expect(fs.existsSync(path.join(mocksDir, "source-folder", "GET.responses/001.response.json"))).toBe(true);

    const listResponse = await request(app).get("/_admin/api/mocks");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mockId,
          configFilePath: "source-folder/GET.endpoint.json",
          collectionId: "collection-archiviati",
        }),
      ])
    );
    expect(listResponse.body.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collection-archiviati",
          label: "Archiviati",
          itemCount: 1,
        }),
      ])
    );

    const detailResponse = await request(app).get(`/_admin/api/mocks/${mockId}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body).toEqual(
      expect.objectContaining({
        id: mockId,
        collectionId: "collection-archiviati",
      })
    );
  });

  test("reorders persisted collections and returns them in the requested order", async () => {
    const app = await buildApp();

    const archivedCollection = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({
        label: "Archiviati",
      });
    const reviewCollection = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({
        label: "Da rivedere",
      });

    const reorderResponse = await request(app)
      .patch("/_admin/api/mocks/collections/order")
      .send({
        collectionIds: [reviewCollection.body.id, archivedCollection.body.id],
      });

    expect(reorderResponse.status).toBe(200);
    expect(reorderResponse.body.map((collection) => collection.id)).toEqual([
      reviewCollection.body.id,
      archivedCollection.body.id,
    ]);

    const listResponse = await request(app).get("/_admin/api/mocks");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.collections.map((collection) => collection.id)).toEqual([
      reviewCollection.body.id,
      archivedCollection.body.id,
    ]);

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );

    expect(collectionsMetadata.childOrder.root).toEqual([
      reviewCollection.body.id,
      archivedCollection.body.id,
    ]);
  });

  test("reorders items inside a collection and persists the manual order", async () => {
    await writeMock({
      mocksDir,
      folder: "alpha",
      method: "GET",
      routePath: "/alpha",
      body: { alpha: true },
    });
    await writeMock({
      mocksDir,
      folder: "beta",
      method: "GET",
      routePath: "/beta",
      body: { beta: true },
    });
    await writeMock({
      mocksDir,
      folder: "gamma",
      method: "GET",
      routePath: "/gamma",
      body: { gamma: true },
    });

    const app = await buildApp();
    const collectionResponse = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({
        label: "Archiviati",
      });
    const alphaId = encodeMockId("alpha/GET.endpoint.json");
    const betaId = encodeMockId("beta/GET.endpoint.json");
    const gammaId = encodeMockId("gamma/GET.endpoint.json");

    await request(app)
      .put(`/_admin/api/mocks/${alphaId}/collection`)
      .send({
        collectionId: collectionResponse.body.id,
      });
    await request(app)
      .put(`/_admin/api/mocks/${betaId}/collection`)
      .send({
        collectionId: collectionResponse.body.id,
      });
    await request(app)
      .put(`/_admin/api/mocks/${gammaId}/collection`)
      .send({
        collectionId: collectionResponse.body.id,
      });

    const reorderResponse = await request(app)
      .patch(`/_admin/api/mocks/collections/${collectionResponse.body.id}/items/order`)
      .send({
        itemIds: [gammaId, alphaId, betaId],
      });

    expect(reorderResponse.status).toBe(200);

    const listResponse = await request(app).get("/_admin/api/mocks");
    const archivedIds = listResponse.body.items
      .filter((item) => item.collectionId === collectionResponse.body.id)
      .map((item) => item.id);

    expect(listResponse.status).toBe(200);
    expect(archivedIds).toEqual([gammaId, alphaId, betaId]);

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );

    expect(collectionsMetadata.childOrder[collectionResponse.body.id]).toEqual([
      "gamma/GET.endpoint.json",
      "alpha/GET.endpoint.json",
      "beta/GET.endpoint.json",
    ]);
  });

  test("creates a nested collection under an existing parent", async () => {
    const app = await buildApp();

    const parentResponse = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Archiviati" });
    const childResponse = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "2024", parentId: parentResponse.body.id });

    expect(childResponse.status).toBe(201);
    expect(childResponse.body).toEqual({
      id: "collection-2024",
      label: "2024",
      itemCount: 0,
      parentId: parentResponse.body.id,
    });

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );
    expect(collectionsMetadata.collections).toEqual([
      { id: parentResponse.body.id, label: "Archiviati" },
      { id: "collection-2024", label: "2024", parentId: parentResponse.body.id },
    ]);
  });

  test("rejects a nested collection when the parent does not exist", async () => {
    const app = await buildApp();

    const response = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Orfana", parentId: "collection-missing" });

    expect(response.status).toBe(404);
  });

  test("allows the same label in different parents but rejects duplicates among siblings", async () => {
    const app = await buildApp();

    const firstParent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Primo" });
    const secondParent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Secondo" });

    const firstChild = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "2024", parentId: firstParent.body.id });
    const secondChild = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "2024", parentId: secondParent.body.id });

    expect(firstChild.status).toBe(201);
    expect(secondChild.status).toBe(201);

    const duplicateSibling = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "2024", parentId: firstParent.body.id });

    expect(duplicateSibling.status).toBe(409);
  });

  test("reparents a collection under a new parent and persists parentId", async () => {
    const app = await buildApp();

    const firstParent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Primo" });
    const secondParent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Secondo" });
    const child = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Figlia", parentId: firstParent.body.id });

    const reparentResponse = await request(app)
      .patch(`/_admin/api/mocks/collections/${child.body.id}/parent`)
      .send({ parentId: secondParent.body.id });

    expect(reparentResponse.status).toBe(200);
    expect(reparentResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: child.body.id, parentId: secondParent.body.id }),
      ])
    );

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );
    const persistedChild = collectionsMetadata.collections.find(
      (collection) => collection.id === child.body.id
    );
    expect(persistedChild.parentId).toBe(secondParent.body.id);
  });

  test("moves a nested collection back to the top level", async () => {
    const app = await buildApp();

    const parent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Parent" });
    const child = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Child", parentId: parent.body.id });

    const reparentResponse = await request(app)
      .patch(`/_admin/api/mocks/collections/${child.body.id}/parent`)
      .send({ parentId: null });

    expect(reparentResponse.status).toBe(200);

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );
    const persistedChild = collectionsMetadata.collections.find(
      (collection) => collection.id === child.body.id
    );
    expect(persistedChild.parentId).toBeUndefined();
  });

  test("rejects reparenting a collection under one of its own descendants", async () => {
    const app = await buildApp();

    const root = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Root" });
    const child = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Child", parentId: root.body.id });

    const cycleResponse = await request(app)
      .patch(`/_admin/api/mocks/collections/${root.body.id}/parent`)
      .send({ parentId: child.body.id });

    expect(cycleResponse.status).toBe(400);
  });

  test("rejects reparenting a collection under itself", async () => {
    const app = await buildApp();

    const collection = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Solo" });

    const selfResponse = await request(app)
      .patch(`/_admin/api/mocks/collections/${collection.body.id}/parent`)
      .send({ parentId: collection.body.id });

    expect(selfResponse.status).toBe(400);
  });

  test("reorders only the sibling collections of a given parent", async () => {
    const app = await buildApp();

    const parent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Parent" });
    const firstChild = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Alpha", parentId: parent.body.id });
    const secondChild = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Beta", parentId: parent.body.id });

    const reorderResponse = await request(app)
      .patch("/_admin/api/mocks/collections/order")
      .send({
        parentId: parent.body.id,
        collectionIds: [secondChild.body.id, firstChild.body.id],
      });

    expect(reorderResponse.status).toBe(200);

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );
    expect(collectionsMetadata.childOrder[parent.body.id]).toEqual([
      secondChild.body.id,
      firstChild.body.id,
    ]);
  });

  test("creates a new sub-collection at the top of its parent's children", async () => {
    await writeMock({ mocksDir, folder: "existing", method: "GET", routePath: "/existing", body: { a: 1 } });

    const app = await buildApp();
    const parent = await request(app).post("/_admin/api/mocks/collections").send({ label: "Parent" });

    // An endpoint already lives in the parent collection.
    const existingId = encodeMockId("existing/GET.endpoint.json");
    await request(app).put(`/_admin/api/mocks/${existingId}/collection`).send({ collectionId: parent.body.id });

    // Each new sub-collection is prepended above the existing children (newest first, above the endpoint).
    const firstChild = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Alpha", parentId: parent.body.id });
    const secondChild = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Beta", parentId: parent.body.id });

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );
    expect(collectionsMetadata.childOrder[parent.body.id]).toEqual([
      secondChild.body.id,
      firstChild.body.id,
      "existing/GET.endpoint.json",
    ]);

    const listResponse = await request(app).get("/_admin/api/mocks");
    expect(listResponse.body.childOrder[parent.body.id]).toEqual([
      secondChild.body.id,
      firstChild.body.id,
      existingId,
    ]);
  });

  test("keeps newly created top-level collections at the end of the root order", async () => {
    const app = await buildApp();

    const first = await request(app).post("/_admin/api/mocks/collections").send({ label: "First" });
    const second = await request(app).post("/_admin/api/mocks/collections").send({ label: "Second" });

    const listResponse = await request(app).get("/_admin/api/mocks");
    expect(listResponse.body.childOrder.root).toEqual([first.body.id, second.body.id]);
  });

  test("interleaves a sub-collection between two endpoints via the children order endpoint", async () => {
    await writeMock({ mocksDir, folder: "first", method: "GET", routePath: "/first", body: { a: 1 } });
    await writeMock({ mocksDir, folder: "second", method: "GET", routePath: "/second", body: { b: 2 } });

    const app = await buildApp();
    const parent = await request(app).post("/_admin/api/mocks/collections").send({ label: "Parent" });
    const child = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Child", parentId: parent.body.id });

    const firstId = encodeMockId("first/GET.endpoint.json");
    const secondId = encodeMockId("second/GET.endpoint.json");
    await request(app).put(`/_admin/api/mocks/${firstId}/collection`).send({ collectionId: parent.body.id });
    await request(app).put(`/_admin/api/mocks/${secondId}/collection`).send({ collectionId: parent.body.id });

    // Parent holds [first, second, child] (endpoints first, then sub-collection); move the child between them.
    const reorderResponse = await request(app)
      .patch(`/_admin/api/mocks/collections/${parent.body.id}/children/order`)
      .send({ childRefs: [firstId, child.body.id, secondId] });

    expect(reorderResponse.status).toBe(200);

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );
    expect(collectionsMetadata.childOrder[parent.body.id]).toEqual([
      "first/GET.endpoint.json",
      child.body.id,
      "second/GET.endpoint.json",
    ]);

    const listResponse = await request(app).get("/_admin/api/mocks");
    expect(listResponse.body.childOrder[parent.body.id]).toEqual([firstId, child.body.id, secondId]);
  });

  describe("risoluzione richiesta concreta → mock (GET /mocks/resolve)", () => {
    test("risolve path esatti, dinamici e query dichiarate con la specificità del serving", async () => {
      await writeMock({ mocksDir, folder: "users", method: "GET", routePath: "/users", body: {} });
      await writeMock({ mocksDir, folder: "users/{id}", method: "GET", routePath: "/users/:id", body: {} });
      await writeMock({
        mocksDir,
        folder: "users/^page-1",
        method: "GET",
        routePath: "/users?page=1",
        body: {},
      });

      const app = await buildApp();

      // Path concreto con parametro → la rotta dinamica.
      const dynamicResolved = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "get", path: "/users/42" });
      expect(dynamicResolved.status).toBe(200);
      expect(dynamicResolved.body.mock.path).toBe("/users/:id");
      expect(dynamicResolved.body.mock.id).toBe(encodeMockId("users/{id}/GET.endpoint.json"));

      // Path esatto senza query → la rotta esatta, non la dinamica.
      const exactResolved = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "GET", path: "/users" });
      expect(exactResolved.body.mock.path).toBe("/users");

      // La query dichiarata è più specifica della gemella senza query.
      const queryResolved = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "GET", path: "/users?page=1" });
      expect(queryResolved.body.mock.path).toBe("/users?page=1");

      // Una query diversa scivola sulla gemella senza query (che accetta qualunque query).
      const otherQueryResolved = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "GET", path: "/users?page=2" });
      expect(otherQueryResolved.body.mock.path).toBe("/users");
    });

    test("un metodo assente sulla rotta che matcha non ripiega su rotte meno specifiche", async () => {
      await writeMock({ mocksDir, folder: "orders/{id}", method: "POST", routePath: "/orders/:id", body: {} });
      await writeMock({ mocksDir, folder: "orders-catchall", method: "GET", routePath: "/orders/recent", body: {} });

      const app = await buildApp();

      // GET /orders/7: matcha /orders/:id che però definisce solo POST → nessun mock,
      // esattamente come il serving (method_not_mocked, nessun fallback).
      const response = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "GET", path: "/orders/7" });
      expect(response.status).toBe(200);
      expect(response.body.mock).toBeNull();
    });

    test("risolve anche gli endpoint disabilitati, segnalandoli come tali", async () => {
      await writeMock({
        mocksDir,
        folder: "spento",
        method: "GET",
        routePath: "/spento",
        enabled: false,
        body: {},
      });

      const app = await buildApp();

      const response = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "GET", path: "/spento" });
      expect(response.body.mock.disabled).toBe(true);
      expect(response.body.mock.id).toBe(encodeMockId("spento/GET.endpoint.json"));
    });

    test("nessun match → mock null; parametri invalidi → 400", async () => {
      const app = await buildApp();

      const noMatch = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "GET", path: "/inesistente" });
      expect(noMatch.status).toBe(200);
      expect(noMatch.body.mock).toBeNull();

      const badMethod = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "FETCH", path: "/x" });
      expect(badMethod.status).toBe(400);

      const badPath = await request(app)
        .get("/_admin/api/mocks/resolve")
        .query({ method: "GET", path: "senza-slash" });
      expect(badPath.status).toBe(400);
    });
  });

  test("ricreare un endpoint esistente dà 409 con l'id, e la response si aggiunge come variante", async () => {
    const app = await buildApp();

    const firstCreate = await request(app)
      .post("/_admin/api/mocks")
      .send({
        config: { method: "GET", path: "/duplicato", status: 200, headers: {} },
        body: { version: 1 },
      });
    expect(firstCreate.status).toBe(201);

    // Stessa rotta e metodo: il 409 porta l'id dell'endpoint esistente nei details,
    // così il chiamante (es. il monitor) può proporre l'aggiunta come variante.
    const conflict = await request(app)
      .post("/_admin/api/mocks")
      .send({
        config: { method: "GET", path: "/duplicato", status: 201, headers: {} },
        body: { version: 2 },
      });
    expect(conflict.status).toBe(409);
    expect(conflict.body.details.existingMockId).toBe(firstCreate.body.id);

    // La response catturata diventa una nuova variante dell'endpoint esistente, selezionata.
    const added = await request(app)
      .post(`/_admin/api/mocks/${conflict.body.details.existingMockId}/responses`)
      .send({ type: "mock", title: "dal monitor", status: 201, headers: {}, body: { version: 2 } });
    expect(added.status).toBe(201);
    expect(added.body.responses).toHaveLength(2);
    expect(added.body.selectedResponseFile).toBe("002.response.json");

    const served = await request(app).get("/duplicato");
    expect(served.status).toBe(201);
    expect(served.body).toEqual({ version: 2 });
  });

  test("deleting an unsorted endpoint prunes its ref from the persisted child order", async () => {
    await writeMock({ mocksDir, folder: "keep", method: "GET", routePath: "/keep", body: {} });
    await writeMock({ mocksDir, folder: "drop", method: "GET", routePath: "/drop", body: {} });

    const app = await buildApp();
    const keepId = encodeMockId("keep/GET.endpoint.json");
    const dropId = encodeMockId("drop/GET.endpoint.json");

    // Il riordino degli unsorted persiste il childOrder SENZA creare membership:
    // il ref dell'endpoint vive solo nel childOrder di .collections.json.
    const reorderResponse = await request(app)
      .patch("/_admin/api/mocks/collections/unsorted/children/order")
      .send({ childRefs: [dropId, keepId] });
    expect(reorderResponse.status).toBe(200);

    const metadataPath = path.join(mocksDir, ".collections.json");
    const beforeDelete = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
    expect(beforeDelete.childOrder.unsorted).toEqual(["drop/GET.endpoint.json", "keep/GET.endpoint.json"]);
    expect(beforeDelete.memberships).toEqual({});

    const deleteResponse = await request(app).delete(`/_admin/api/mocks/${dropId}`);
    expect(deleteResponse.status).toBe(204);

    const afterDelete = JSON.parse(await fs.promises.readFile(metadataPath, "utf8"));
    expect(afterDelete.childOrder.unsorted).toEqual(["keep/GET.endpoint.json"]);
  });

  test("rejects a children order that does not cover the parent's children exactly", async () => {
    await writeMock({ mocksDir, folder: "only", method: "GET", routePath: "/only", body: { a: 1 } });

    const app = await buildApp();
    const parent = await request(app).post("/_admin/api/mocks/collections").send({ label: "Parent" });
    const onlyId = encodeMockId("only/GET.endpoint.json");
    await request(app).put(`/_admin/api/mocks/${onlyId}/collection`).send({ collectionId: parent.body.id });

    const response = await request(app)
      .patch(`/_admin/api/mocks/collections/${parent.body.id}/children/order`)
      .send({ childRefs: [] });

    expect(response.status).toBe(400);
  });

  test("migrates the legacy itemOrder + collections order into childOrder", async () => {
    await writeMock({ mocksDir, folder: "ep-a", method: "GET", routePath: "/ep-a", body: {} });
    await writeMock({ mocksDir, folder: "ep-b", method: "GET", routePath: "/ep-b", body: {} });

    const legacyState = {
      collections: [
        { id: "collection-parent", label: "Parent" },
        { id: "collection-child", label: "Child", parentId: "collection-parent" },
      ],
      memberships: {
        "ep-a/GET.endpoint.json": "collection-parent",
        "ep-b/GET.endpoint.json": "collection-parent",
      },
      itemOrder: {
        "collection-parent": ["ep-b/GET.endpoint.json", "ep-a/GET.endpoint.json"],
      },
    };
    await fs.promises.writeFile(
      path.join(mocksDir, ".collections.json"),
      `${JSON.stringify(legacyState, null, 2)}\n`,
      "utf8"
    );

    const app = await buildApp();
    const listResponse = await request(app).get("/_admin/api/mocks");

    expect(listResponse.status).toBe(200);
    // Derived child order keeps the legacy endpoint order first, then appends the sub-collection.
    expect(listResponse.body.childOrder["collection-parent"]).toEqual([
      encodeMockId("ep-b/GET.endpoint.json"),
      encodeMockId("ep-a/GET.endpoint.json"),
      "collection-child",
    ]);
    expect(listResponse.body.childOrder.root).toEqual(["collection-parent"]);
  });

  test("reorders and reparents collections while endpoint definitions stay classified as mock", async () => {
    // Regression: with at least one *.endpoint.json on disk, the reorder/reparent handlers
    // re-listed through the legacy scanner, which compiled the endpoint JSON as a middleware
    // script and returned 400 "Invalid middleware ...: Unexpected token ':'".
    await writeMock({
      mocksDir,
      folder: "be/anni-di-imposta",
      method: "GET",
      routePath: "/be/anni-di-imposta",
      body: { years: [] },
    });

    const app = await buildApp();

    const firstParent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Primo" });
    const secondParent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Secondo" });
    const child = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Figlia", parentId: firstParent.body.id });

    const reparentResponse = await request(app)
      .patch(`/_admin/api/mocks/collections/${child.body.id}/parent`)
      .send({ parentId: secondParent.body.id });

    expect(reparentResponse.status).toBe(200);
    expect(reparentResponse.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: child.body.id, parentId: secondParent.body.id }),
      ])
    );

    const reorderResponse = await request(app)
      .patch("/_admin/api/mocks/collections/order")
      .send({ collectionIds: [secondParent.body.id, firstParent.body.id] });

    expect(reorderResponse.status).toBe(200);
    const topLevelOrder = reorderResponse.body
      .filter((collection) => collection.parentId == null)
      .map((collection) => collection.id);
    expect(topLevelOrder).toEqual([secondParent.body.id, firstParent.body.id]);

    const listResponse = await request(app).get("/_admin/api/mocks");

    expect(listResponse.status).toBe(200);
    const endpointItem = listResponse.body.items.find(
      (item) => item.id === encodeMockId("be/anni-di-imposta/GET.endpoint.json")
    );
    expect(endpointItem).toEqual(
      expect.objectContaining({ type: "mock", method: "GET", path: "/be/anni-di-imposta" })
    );
  });

  test("deletes a collection subtree and moves its definitions to unsorted", async () => {
    await writeMock({
      mocksDir,
      folder: "parent-item",
      method: "GET",
      routePath: "/parent-item",
      body: { parent: true },
    });
    await writeMock({
      mocksDir,
      folder: "child-item",
      method: "GET",
      routePath: "/child-item",
      body: { child: true },
    });
    await writeMock({
      mocksDir,
      folder: "outside-item",
      method: "GET",
      routePath: "/outside-item",
      body: { outside: true },
    });

    const app = await buildApp();
    const parent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Parent" });
    const child = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Child", parentId: parent.body.id });
    const outside = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Outside" });
    const parentItemId = encodeMockId("parent-item/GET.endpoint.json");
    const childItemId = encodeMockId("child-item/GET.endpoint.json");
    const outsideItemId = encodeMockId("outside-item/GET.endpoint.json");

    await request(app)
      .put(`/_admin/api/mocks/${parentItemId}/collection`)
      .send({ collectionId: parent.body.id });
    await request(app)
      .put(`/_admin/api/mocks/${childItemId}/collection`)
      .send({ collectionId: child.body.id });
    await request(app)
      .put(`/_admin/api/mocks/${outsideItemId}/collection`)
      .send({ collectionId: outside.body.id });

    const deleteResponse = await request(app).delete(`/_admin/api/mocks/collections/${parent.body.id}`);

    expect(deleteResponse.status).toBe(204);

    const listResponse = await request(app).get("/_admin/api/mocks");
    expect(listResponse.body.collections).toEqual([
      expect.objectContaining({ id: outside.body.id, itemCount: 1 }),
    ]);
    const parentItem = listResponse.body.items.find((item) => item.id === parentItemId);
    const childItem = listResponse.body.items.find((item) => item.id === childItemId);
    const outsideItem = listResponse.body.items.find((item) => item.id === outsideItemId);
    expect(parentItem.collectionId).toBeUndefined();
    expect(childItem.collectionId).toBeUndefined();
    expect(outsideItem.collectionId).toBe(outside.body.id);

    const collectionsMetadata = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")
    );
    expect(collectionsMetadata.collections).toEqual([
      { id: outside.body.id, label: "Outside" },
    ]);
    expect(collectionsMetadata.memberships).toEqual({
      "outside-item/GET.endpoint.json": outside.body.id,
    });
    expect(collectionsMetadata.childOrder.unsorted).toEqual([
      "parent-item/GET.endpoint.json",
      "child-item/GET.endpoint.json",
    ]);
  });

  test("mass updates endpoint enabled state for a collection subtree", async () => {
    await writeMock({
      mocksDir,
      folder: "parent-toggle",
      method: "GET",
      routePath: "/parent-toggle",
      body: { parent: true },
    });
    await writeMock({
      mocksDir,
      folder: "child-toggle",
      method: "GET",
      routePath: "/child-toggle",
      body: { child: true },
    });
    await writeMock({
      mocksDir,
      folder: "outside-toggle",
      method: "GET",
      routePath: "/outside-toggle",
      body: { outside: true },
    });

    const app = await buildApp();
    const parent = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Bulk parent" });
    const child = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Bulk child", parentId: parent.body.id });
    const outside = await request(app)
      .post("/_admin/api/mocks/collections")
      .send({ label: "Bulk outside" });
    const parentItemId = encodeMockId("parent-toggle/GET.endpoint.json");
    const childItemId = encodeMockId("child-toggle/GET.endpoint.json");
    const outsideItemId = encodeMockId("outside-toggle/GET.endpoint.json");

    await request(app)
      .put(`/_admin/api/mocks/${parentItemId}/collection`)
      .send({ collectionId: parent.body.id });
    await request(app)
      .put(`/_admin/api/mocks/${childItemId}/collection`)
      .send({ collectionId: child.body.id });
    await request(app)
      .put(`/_admin/api/mocks/${outsideItemId}/collection`)
      .send({ collectionId: outside.body.id });

    const updateResponse = await request(app)
      .patch(`/_admin/api/mocks/collections/${parent.body.id}/enabled`)
      .send({ enabled: false });

    expect(updateResponse.status).toBe(200);
    const itemsById = new Map(updateResponse.body.items.map((item) => [item.id, item]));
    expect(itemsById.get(parentItemId).disabled).toBe(true);
    expect(itemsById.get(childItemId).disabled).toBe(true);
    expect(itemsById.get(outsideItemId).disabled).toBe(false);
    expect(updateResponse.body.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: parent.body.id, itemCount: 1 }),
        expect.objectContaining({ id: child.body.id, itemCount: 1 }),
        expect.objectContaining({ id: outside.body.id, itemCount: 1 }),
      ])
    );

    const parentEndpoint = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "parent-toggle", "GET.endpoint.json"), "utf8")
    );
    const childEndpoint = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "child-toggle", "GET.endpoint.json"), "utf8")
    );
    const outsideEndpoint = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "outside-toggle", "GET.endpoint.json"), "utf8")
    );
    expect(parentEndpoint.enabled).toBe(false);
    expect(childEndpoint.enabled).toBe(false);
    expect(outsideEndpoint.enabled).toBe(true);
  });

  test("returns handler source as a read-only admin detail", async () => {
    await writeHandler({
      mocksDir,
      folder: "details-handler",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/details-handler/:id",
  async resolveResponse({ params }) {
    return {
      jsonBody: {
        id: params.id
      }
    };
  }
};
`,
    });

    const app = await buildApp();
    const handlerId = encodeMockId("details-handler/GET.endpoint.json");
    const response = await request(app).get(`/_admin/api/mocks/${handlerId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        type: "handler",
        editable: true,
        method: "GET",
        path: "/details-handler/:id",
        source: expect.stringContaining("resolveResponse"),
      })
    );
    expect(response.body.responses).toEqual([
      expect.objectContaining({
        fileName: "001.response.json",
        sourceFile: "001.handler.js",
        type: "handler",
      }),
    ]);
  });

  test("returns absolute definition and payload paths for a mock detail", async () => {
    await writeMock({
      mocksDir,
      folder: "details-mock",
      method: "GET",
      routePath: "/details-mock",
      body: { ok: true },
    });

    const app = await buildApp();
    const mockId = encodeMockId("details-mock/GET.endpoint.json");
    const response = await request(app).get(`/_admin/api/mocks/${mockId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        type: "mock",
        editable: true,
        definitionFilePath: path.join(mocksDir, "details-mock", "GET.endpoint.json"),
        payloadFilePath: path.join(mocksDir, "details-mock", "GET.responses/001.response.json"),
      })
    );
  });

  test("updates the selected response file and reloads the runtime", async () => {
    await writeMock({
      mocksDir,
      folder: "multi-response",
      method: "GET",
      routePath: "/multi-response",
      body: { version: 1 },
    });

    const endpointPath = path.join(mocksDir, "multi-response", "GET.endpoint.json");
    const responseDir = path.join(mocksDir, "multi-response", "GET.responses");
    const endpoint = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
    endpoint.responseFiles = ["001.response.json", "002.response.json"];
    await fs.promises.writeFile(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, "utf8");
    await fs.promises.writeFile(
      path.join(responseDir, "002.response.json"),
      JSON.stringify(
        {
          type: "mock",
          title: "Seconda",
          status: 202,
          headers: {
            "content-type": "application/json",
          },
          delayMs: 0,
          body: { version: 2 },
        },
        null,
        2
      ),
      "utf8"
    );

    const app = await buildApp();
    const mockId = encodeMockId("multi-response/GET.endpoint.json");
    const firstRuntimeResponse = await request(app).get("/multi-response");

    expect(firstRuntimeResponse.status).toBe(200);
    expect(firstRuntimeResponse.body).toEqual({ version: 1 });

    const updateResponse = await request(app)
      .put(`/_admin/api/mocks/${mockId}`)
      .send({
        selectedResponseFile: "002.response.json",
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.selectedResponseFile).toBe("002.response.json");
    expect(updateResponse.body.responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: "001.response.json", selected: false }),
        expect.objectContaining({ fileName: "002.response.json", selected: true }),
      ])
    );

    const secondRuntimeResponse = await request(app).get("/multi-response");
    expect(secondRuntimeResponse.status).toBe(202);
    expect(secondRuntimeResponse.body).toEqual({ version: 2 });
  });

  test("creates a new response file from the selected response and reloads the runtime", async () => {
    await writeMock({
      mocksDir,
      folder: "created-response",
      method: "GET",
      routePath: "/created-response",
      status: 201,
      headers: {
        "content-type": "application/json",
      },
      body: { version: 1 },
    });

    const app = await buildApp();
    const mockId = encodeMockId("created-response/GET.endpoint.json");
    const createResponse = await request(app)
      .post(`/_admin/api/mocks/${mockId}/responses`)
      .send({});

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.selectedResponseFile).toBe("002.response.json");
    expect(createResponse.body.responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fileName: "001.response.json", selected: false }),
        expect.objectContaining({ fileName: "002.response.json", selected: true }),
      ])
    );

    const endpoint = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "created-response", "GET.endpoint.json"), "utf8")
    );
    const response = JSON.parse(
      await fs.promises.readFile(
        path.join(mocksDir, "created-response", "GET.responses", "002.response.json"),
        "utf8"
      )
    );
    expect(endpoint.responseFiles).toEqual(["001.response.json", "002.response.json"]);
    expect(endpoint.selectedResponseFile).toBe("002.response.json");
    expect(response).toEqual(
      expect.objectContaining({
        type: "mock",
        title: "",
        status: 201,
        body: { version: 1 },
      })
    );

    const runtimeResponse = await request(app).get("/created-response");
    expect(runtimeResponse.status).toBe(201);
    expect(runtimeResponse.body).toEqual({ version: 1 });
  });

  test("creates a new mock response from edited dialog values", async () => {
    await writeMock({
      mocksDir,
      folder: "created-edited-response",
      method: "GET",
      routePath: "/created-edited-response",
      status: 200,
      headers: {
        "content-type": "application/json",
      },
      body: { version: 1 },
    });

    const app = await buildApp();
    const mockId = encodeMockId("created-edited-response/GET.endpoint.json");
    const createResponse = await request(app)
      .post(`/_admin/api/mocks/${mockId}/responses`)
      .send({
        type: "mock",
        title: "Created copy",
        status: 409,
        headers: {
          "content-type": "application/json",
          "x-created": "yes",
        },
        delayMs: 0,
        body: { version: 2 },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.selectedResponseFile).toBe("002.response.json");

    const response = JSON.parse(
      await fs.promises.readFile(
        path.join(mocksDir, "created-edited-response", "GET.responses", "002.response.json"),
        "utf8"
      )
    );
    expect(response).toEqual({
      type: "mock",
      title: "Created copy",
      status: 409,
      headers: {
        "content-type": "application/json",
        "x-created": "yes",
      },
      delayMs: 0,
      body: { version: 2 },
    });

    const runtimeResponse = await request(app).get("/created-edited-response");
    expect(runtimeResponse.status).toBe(409);
    expect(runtimeResponse.body).toEqual({ version: 2 });
    expect(runtimeResponse.headers["x-created"]).toBe("yes");
  });

  test("creates a new handler response from edited source", async () => {
    await writeHandler({
      mocksDir,
      folder: "created-handler-response",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/created-handler-response",
  async resolveResponse() {
    return { status: 200, jsonBody: { version: 1 } };
  }
};
`,
    });

    const app = await buildApp();
    const mockId = encodeMockId("created-handler-response/GET.endpoint.json");
    const createResponse = await request(app)
      .post(`/_admin/api/mocks/${mockId}/responses`)
      .send({
        type: "handler",
        title: "Handler copy",
        source: `module.exports = {
  async resolveResponse() {
    return { status: 202, jsonBody: { version: 2 } };
  }
};
`,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.selectedResponseFile).toBe("002.response.json");

    const response = JSON.parse(
      await fs.promises.readFile(
        path.join(mocksDir, "created-handler-response", "GET.responses", "002.response.json"),
        "utf8"
      )
    );
    const source = await fs.promises.readFile(
      path.join(mocksDir, "created-handler-response", "GET.responses", "002.handler.js"),
      "utf8"
    );
    expect(response).toEqual({
      type: "handler",
      title: "Handler copy",
      sourceFile: "002.handler.js",
    });
    expect(source).toContain("version: 2");

    const runtimeResponse = await request(app).get("/created-handler-response");
    expect(runtimeResponse.status).toBe(202);
    expect(runtimeResponse.body).toEqual({ version: 2 });
    expect(runtimeResponse.headers["x-mock-source"]).toBe("handler");
  });

  test("an endpoint can hold mixed response types: add a handler response to a mock endpoint and switch", async () => {
    await writeMock({
      mocksDir,
      folder: "mixed-type",
      method: "GET",
      routePath: "/mixed-type",
      body: { mocked: true },
    });

    const app = await buildApp();
    const mockId = encodeMockId("mixed-type/GET.endpoint.json");

    const fromMock = await request(app).get("/mixed-type");
    expect(fromMock.body).toEqual({ mocked: true });
    expect(fromMock.headers["x-mock-source"]).toBe("mock");

    const created = await request(app)
      .post(`/_admin/api/mocks/${mockId}/responses`)
      .send({
        type: "handler",
        title: "Dynamic",
        source: `module.exports = {
  async resolveResponse() {
    return { status: 201, jsonBody: { dynamic: true } };
  }
};
`,
      });
    expect(created.status).toBe(201);
    expect(created.body.selectedResponseFile).toBe("002.response.json");

    const mockResponse = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "mixed-type", "GET.responses", "001.response.json"), "utf8")
    );
    const handlerResponse = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "mixed-type", "GET.responses", "002.response.json"), "utf8")
    );
    expect(mockResponse.type).toBe("mock");
    expect(handlerResponse).toEqual({ type: "handler", title: "Dynamic", sourceFile: "002.handler.js" });
    expect(fs.existsSync(path.join(mocksDir, "mixed-type", "GET.responses", "002.handler.js"))).toBe(true);

    const fromHandler = await request(app).get("/mixed-type");
    expect(fromHandler.status).toBe(201);
    expect(fromHandler.body).toEqual({ dynamic: true });
    expect(fromHandler.headers["x-mock-source"]).toBe("handler");

    const switched = await request(app)
      .put(`/_admin/api/mocks/${mockId}`)
      .send({ selectedResponseFile: "001.response.json" });
    expect(switched.status).toBe(200);

    const backToMock = await request(app).get("/mixed-type");
    expect(backToMock.body).toEqual({ mocked: true });
    expect(backToMock.headers["x-mock-source"]).toBe("mock");
  });

  test("adds a script response of a new type seeding the template when no source is provided", async () => {
    await writeMock({ mocksDir, folder: "seed-mw", method: "GET", routePath: "/seed-mw", body: { ok: true } });
    const app = await buildApp();
    const mockId = encodeMockId("seed-mw/GET.endpoint.json");

    const created = await request(app)
      .post(`/_admin/api/mocks/${mockId}/responses`)
      .send({ type: "middleware" });
    expect(created.status).toBe(201);

    const source = await fs.promises.readFile(
      path.join(mocksDir, "seed-mw", "GET.responses", "002.middleware.js"),
      "utf8"
    );
    expect(source).toContain("transformResponse");
  });

  test("uploads a file to make a response file-backed, serves it, and switches back to JSON", async () => {
    await writeMock({ mocksDir, folder: "filed", method: "GET", routePath: "/filed", body: { json: true } });
    const app = await buildApp();
    const mockId = encodeMockId("filed/GET.endpoint.json");
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);

    const uploaded = await request(app)
      .put(`/_admin/api/mocks/${mockId}/responses/001.response.json/file`)
      .query({ filename: "logo.png", contentType: "image/png" })
      .set("Content-Type", "application/octet-stream")
      .send(bytes);
    expect(uploaded.status).toBe(200);

    const meta = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "filed", "GET.responses", "001.response.json"), "utf8")
    );
    expect(meta.file).toBe("001.file.png");
    expect(meta.body).toBeUndefined();
    expect(meta.headers["content-type"]).toBe("image/png");
    const onDisk = await fs.promises.readFile(path.join(mocksDir, "filed", "GET.responses", "001.file.png"));
    expect(Buffer.compare(onDisk, bytes)).toBe(0);

    const served = await request(app).get("/filed");
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(Number(served.headers["content-length"])).toBe(bytes.length);

    const backToJson = await request(app)
      .put(`/_admin/api/mocks/${mockId}/responses/001.response.json`)
      .send({ type: "mock", status: 200, headers: {}, delayMs: 0, body: { back: true } });
    expect(backToJson.status).toBe(200);

    const meta2 = JSON.parse(
      await fs.promises.readFile(path.join(mocksDir, "filed", "GET.responses", "001.response.json"), "utf8")
    );
    expect(meta2.body).toEqual({ back: true });
    expect(meta2.file).toBeUndefined();
    expect(fs.existsSync(path.join(mocksDir, "filed", "GET.responses", "001.file.png"))).toBe(false);

    const servedJson = await request(app).get("/filed");
    expect(servedJson.body).toEqual({ back: true });
  });

  test("deleting the selected response selects the immediately preceding one", async () => {
    await writeMock({ mocksDir, folder: "pred", method: "GET", routePath: "/pred", body: { v: 1 } });
    const app = await buildApp();
    const id = encodeMockId("pred/GET.endpoint.json");

    await request(app).post(`/_admin/api/mocks/${id}/responses`).send({}); // 002
    await request(app).post(`/_admin/api/mocks/${id}/responses`).send({}); // 003

    // seleziona 002 e cancellala → resta selezionata la precedente (001)
    await request(app).put(`/_admin/api/mocks/${id}`).send({ selectedResponseFile: "002.response.json" });
    const afterMid = await request(app).delete(`/_admin/api/mocks/${id}/responses/002.response.json`);
    expect(afterMid.status).toBe(200);
    expect(afterMid.body.selectedResponseFile).toBe("001.response.json");

    // ora [001, 003] con 001 selezionata; cancellando la prima resta la nuova prima (003)
    const afterFirst = await request(app).delete(`/_admin/api/mocks/${id}/responses/001.response.json`);
    expect(afterFirst.body.selectedResponseFile).toBe("003.response.json");
  });

  test("updates only endpoint metadata without rewriting the selected response", async () => {
    await writeMock({
      mocksDir,
      folder: "endpoint-metadata",
      method: "GET",
      routePath: "/endpoint-metadata",
      status: 201,
      headers: {
        "content-type": "application/json",
      },
      body: { version: 1 },
    });

    const endpointPath = path.join(mocksDir, "endpoint-metadata", "GET.endpoint.json");
    const responsePath = path.join(mocksDir, "endpoint-metadata", "GET.responses", "001.response.json");
    const responseBefore = await fs.promises.readFile(responsePath, "utf8");

    const app = await buildApp();
    const mockId = encodeMockId("endpoint-metadata/GET.endpoint.json");
    const updateResponse = await request(app)
      .put(`/_admin/api/mocks/${mockId}/endpoint`)
      .send({
        description: "Endpoint aggiornato",
        enabled: false,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.endpoint).toEqual(
      expect.objectContaining({
        method: "GET",
        path: "/endpoint-metadata",
        description: "Endpoint aggiornato",
        enabled: false,
        selectedResponseFile: "001.response.json",
      })
    );
    expect(await fs.promises.readFile(responsePath, "utf8")).toBe(responseBefore);

    const endpoint = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
    expect(endpoint.description).toBe("Endpoint aggiornato");
    expect(endpoint.enabled).toBe(false);

    const runtimeResponse = await request(app).get("/endpoint-metadata");
    expect(runtimeResponse.status).toBe(200);
    expect(runtimeResponse.headers["x-mock-source"]).toBe("backend");
  });

  test("rejects response fields when updating endpoint metadata", async () => {
    await writeMock({
      mocksDir,
      folder: "endpoint-rejects-response-fields",
      method: "GET",
      routePath: "/endpoint-rejects-response-fields",
      body: { ok: true },
    });

    const app = await buildApp();
    const mockId = encodeMockId("endpoint-rejects-response-fields/GET.endpoint.json");
    const updateResponse = await request(app)
      .put(`/_admin/api/mocks/${mockId}/endpoint`)
      .send({
        description: "",
        enabled: true,
        status: 204,
      });

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.body.message).toBe("Only endpoint.description and endpoint.enabled can be updated.");
  });

  test("updates only the selected response file and reloads the runtime", async () => {
    await writeMock({
      mocksDir,
      folder: "updated-response",
      method: "GET",
      routePath: "/updated-response",
      status: 200,
      headers: {
        "content-type": "application/json",
      },
      body: { version: 1 },
    });

    const app = await buildApp();
    const mockId = encodeMockId("updated-response/GET.endpoint.json");
    const updateResponse = await request(app)
      .put(`/_admin/api/mocks/${mockId}/responses/001.response.json`)
      .send({
        type: "mock",
        title: "Aggiornata",
        status: 203,
        headers: {
          "content-type": "application/json",
          "x-response": "updated",
        },
        delayMs: 0,
        body: { version: 9 },
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.selectedResponseFile).toBe("001.response.json");
    expect(updateResponse.body.response).toEqual(
      expect.objectContaining({
        type: "mock",
        title: "Aggiornata",
        status: 203,
        body: { version: 9 },
      })
    );

    const responseFile = JSON.parse(
      await fs.promises.readFile(
        path.join(mocksDir, "updated-response", "GET.responses", "001.response.json"),
        "utf8"
      )
    );
    expect(responseFile).toEqual(
      expect.not.objectContaining({
        method: expect.anything(),
        path: expect.anything(),
      })
    );

    const runtimeResponse = await request(app).get("/updated-response");
    expect(runtimeResponse.status).toBe(203);
    expect(runtimeResponse.headers["x-response"]).toBe("updated");
    expect(runtimeResponse.body).toEqual({ version: 9 });
  });

  test("deletes the selected response file without deleting the endpoint", async () => {
    await writeMock({
      mocksDir,
      folder: "deleted-response",
      method: "GET",
      routePath: "/deleted-response",
      status: 200,
      headers: {
        "content-type": "application/json",
      },
      body: { version: 1 },
    });

    const endpointPath = path.join(mocksDir, "deleted-response", "GET.endpoint.json");
    const responseDir = path.join(mocksDir, "deleted-response", "GET.responses");
    const endpoint = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
    endpoint.responseFiles = ["001.response.json", "002.response.json"];
    endpoint.selectedResponseFile = "002.response.json";
    await fs.promises.writeFile(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, "utf8");
    await fs.promises.writeFile(
      path.join(responseDir, "002.response.json"),
      JSON.stringify(
        {
          type: "mock",
          title: "Da eliminare",
          status: 202,
          headers: {
            "content-type": "application/json",
          },
          delayMs: 0,
          body: { version: 2 },
        },
        null,
        2
      ),
      "utf8"
    );

    const app = await buildApp();
    const mockId = encodeMockId("deleted-response/GET.endpoint.json");
    const selectedRuntimeResponse = await request(app).get("/deleted-response");
    expect(selectedRuntimeResponse.status).toBe(202);
    expect(selectedRuntimeResponse.body).toEqual({ version: 2 });

    const deleteResponse = await request(app)
      .delete(`/_admin/api/mocks/${mockId}/responses/002.response.json`);

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.selectedResponseFile).toBe("001.response.json");
    expect(deleteResponse.body.responses).toEqual([
      expect.objectContaining({
        fileName: "001.response.json",
        selected: true,
      }),
    ]);
    expect(fs.existsSync(endpointPath)).toBe(true);
    expect(fs.existsSync(path.join(responseDir, "002.response.json"))).toBe(false);

    const nextEndpoint = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
    expect(nextEndpoint.responseFiles).toEqual(["001.response.json"]);
    expect(nextEndpoint.selectedResponseFile).toBe("001.response.json");

    const fallbackRuntimeResponse = await request(app).get("/deleted-response");
    expect(fallbackRuntimeResponse.status).toBe(200);
    expect(fallbackRuntimeResponse.body).toEqual({ version: 1 });
  });

  test("rejects deletion of the last response file", async () => {
    await writeMock({
      mocksDir,
      folder: "last-response",
      method: "GET",
      routePath: "/last-response",
      body: { ok: true },
    });

    const app = await buildApp();
    const mockId = encodeMockId("last-response/GET.endpoint.json");
    const deleteResponse = await request(app)
      .delete(`/_admin/api/mocks/${mockId}/responses/001.response.json`);

    expect(deleteResponse.status).toBe(400);
    expect(deleteResponse.body.message).toBe("Cannot delete the last response of an endpoint.");
    expect(fs.existsSync(path.join(mocksDir, "last-response", "GET.endpoint.json"))).toBe(true);
    expect(fs.existsSync(path.join(mocksDir, "last-response", "GET.responses", "001.response.json"))).toBe(true);
  });

  test("creates, updates and deletes handler definitions with runtime reload", async () => {
    const app = await buildApp();

    const createResponse = await request(app)
      .post("/_admin/api/mocks")
      .send({
        type: "handler",
        definition: {
          method: "POST",
          path: "/created-handler/:id",
          disabled: false,
        },
        source: `module.exports = {
  async resolveResponse({ params, jsonBody }) {
    return {
      status: 201,
      jsonBody: {
        id: params.id,
        version: 1,
        payload: jsonBody
      }
    };
  }
};
`,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual(
      expect.objectContaining({
        type: "handler",
        editable: true,
        method: "POST",
        path: "/created-handler/:id",
        configFilePath: "created-handler/{id}/POST.endpoint.json",
      })
    );

    const firstHandlerResponse = await request(app)
      .post("/created-handler/55")
      .send({ amount: 125 });
    expect(firstHandlerResponse.status).toBe(201);
    expect(firstHandlerResponse.body).toEqual({
      id: "55",
      version: 1,
      payload: { amount: 125 },
    });
    expect(firstHandlerResponse.headers["x-mock-source"]).toBe("handler");

    const updateResponse = await request(app)
      .put(`/_admin/api/mocks/${createResponse.body.id}`)
      .send({
        type: "handler",
        definition: {
          method: "POST",
          path: "/created-handler/:id",
          disabled: false,
        },
        source: `module.exports = {
  async resolveResponse({ params, query }) {
    return {
      status: 202,
      jsonBody: {
        id: params.id,
        version: 2,
        mode: query.mode
      }
    };
  }
};
`,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.source).toContain("version: 2");

    const updatedHandlerResponse = await request(app).post("/created-handler/55?mode=preview");
    expect(updatedHandlerResponse.status).toBe(202);
    expect(updatedHandlerResponse.body).toEqual({
      id: "55",
      version: 2,
      mode: "preview",
    });
    expect(updatedHandlerResponse.headers["x-mock-source"]).toBe("handler");

    const deleteResponse = await request(app).delete(`/_admin/api/mocks/${createResponse.body.id}`);
    expect(deleteResponse.status).toBe(204);

    const backendResponse = await request(app).post("/created-handler/55");
    expect(backendResponse.status).toBe(200);
    expect(backendResponse.body).toEqual({ backend: true });
    expect(backendResponse.headers["x-mock-source"]).toBe("backend");
  });

  test("creates, updates and deletes middleware definitions with runtime reload", async () => {
    const app = await buildApp();

    const createResponse = await request(app)
      .post("/_admin/api/mocks")
      .send({
        type: "middleware",
        definition: {
          method: "GET",
          path: "/created-middleware/:id",
          disabled: false,
        },
        source: `module.exports = {
  async transformResponse({ status, jsonBody }) {
    return {
      status,
      jsonBody: {
        ...jsonBody,
        version: 1
      }
    };
  }
};
`,
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toEqual(
      expect.objectContaining({
        type: "middleware",
        editable: true,
        method: "GET",
        path: "/created-middleware/:id",
        configFilePath: "created-middleware/{id}/GET.endpoint.json",
      })
    );

    const firstMiddlewareResponse = await request(app).get("/created-middleware/55");
    expect(firstMiddlewareResponse.status).toBe(200);
    expect(firstMiddlewareResponse.body).toEqual({
      backend: true,
      version: 1,
    });
    expect(firstMiddlewareResponse.headers["x-mock-source"]).toBe("middleware");

    const updateResponse = await request(app)
      .put(`/_admin/api/mocks/${createResponse.body.id}`)
      .send({
        type: "middleware",
        definition: {
          method: "GET",
          path: "/created-middleware/:id",
          disabled: false,
        },
        source: `module.exports = {
  async transformResponse({ status, jsonBody }) {
    return {
      status: status + 1,
      jsonBody: {
        ...jsonBody,
        version: 2
      }
    };
  }
};
`,
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.source).toContain("version: 2");

    const updatedMiddlewareResponse = await request(app).get("/created-middleware/55");
    expect(updatedMiddlewareResponse.status).toBe(201);
    expect(updatedMiddlewareResponse.body).toEqual({
      backend: true,
      version: 2,
    });
    expect(updatedMiddlewareResponse.headers["x-mock-source"]).toBe("middleware");

    const deleteResponse = await request(app).delete(`/_admin/api/mocks/${createResponse.body.id}`);
    expect(deleteResponse.status).toBe(204);

    const backendResponse = await request(app).get("/created-middleware/55");
    expect(backendResponse.status).toBe(200);
    expect(backendResponse.body).toEqual({ backend: true });
    expect(backendResponse.headers["x-mock-source"]).toBe("backend");
  });

  test("rejects middleware updates when the source exports endpoint metadata", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "mismatch-middleware",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/mismatch-middleware",
  disabled: false,
  async transformResponse() {
    return undefined;
  }
};
`,
    });

    const app = await buildApp();
    const middlewareId = encodeMockId("mismatch-middleware/GET.endpoint.json");
    const response = await request(app)
      .put(`/_admin/api/mocks/${middlewareId}`)
      .send({
        type: "middleware",
        definition: {
          method: "GET",
          path: "/mismatch-middleware",
          disabled: false,
        },
        source: `module.exports = {
  method: "GET",
  path: "/different-middleware-path",
  disabled: false,
  async transformResponse() {
    return undefined;
  }
};
`,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Source metadata method, path and disabled must live in the endpoint file."
    );
  });

  test("rejects handler updates when the source exports endpoint metadata", async () => {
    await writeHandler({
      mocksDir,
      folder: "mismatch-handler",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/mismatch-handler",
  disabled: false,
  async resolveResponse() {
    return {
      jsonBody: {
        ok: true
      }
    };
  }
};
`,
    });

    const app = await buildApp();
    const handlerId = encodeMockId("mismatch-handler/GET.endpoint.json");
    const response = await request(app)
      .put(`/_admin/api/mocks/${handlerId}`)
      .send({
        type: "handler",
        definition: {
          method: "GET",
          path: "/mismatch-handler",
          disabled: false,
        },
        source: `module.exports = {
  method: "GET",
  path: "/different-path",
  disabled: false,
  async resolveResponse() {
    return {
      jsonBody: {
        ok: false
      }
    };
  }
};
`,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Source metadata method, path and disabled must live in the endpoint file."
    );
  });

  test("does not proxy admin API requests when the admin API is disabled", async () => {
    const app = await buildApp({ adminApiEnabled: false });

    const response = await request(app).get("/_admin/api/mocks");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Admin API disabled");
    expect(response.headers["x-mock-source"]).toBeUndefined();
  });

  test("creates, updates and deletes JSON mock responses with runtime reload", async () => {
    const app = await buildApp();

    const createResponse = await request(app)
      .post("/_admin/api/mocks")
      .send({
        config: {
          method: "GET",
          path: "/created",
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
        body: { version: 1 },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.id).toEqual(expect.any(String));
    expect(createResponse.body.configFilePath).toBe("created/GET.endpoint.json");

    const firstMockResponse = await request(app).get("/created");
    expect(firstMockResponse.status).toBe(200);
    expect(firstMockResponse.body).toEqual({ version: 1 });
    expect(firstMockResponse.headers["x-mock-source"]).toBe("mock");

    const updateResponse = await request(app)
      .put(`/_admin/api/mocks/${createResponse.body.id}`)
      .send({
        config: {
          method: "GET",
          path: "/created",
          status: 202,
          disabled: false,
          headers: {
            "content-type": "application/json",
          },
          bodyFile: "GET.responses/001.response.json",
          delayMs: 0,
        },
        body: { version: 2 },
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.body).toEqual({ version: 2 });

    const updatedMockResponse = await request(app).get("/created");
    expect(updatedMockResponse.status).toBe(202);
    expect(updatedMockResponse.body).toEqual({ version: 2 });
    expect(updatedMockResponse.headers["x-mock-source"]).toBe("mock");

    const endpointFilePath = path.join(mocksDir, "created", "GET.endpoint.json");
    const responseDirPath = path.join(mocksDir, "created", "GET.responses");
    expect(fs.existsSync(endpointFilePath)).toBe(true);
    expect(fs.existsSync(responseDirPath)).toBe(true);

    const deleteResponse = await request(app).delete(`/_admin/api/mocks/${createResponse.body.id}`);
    expect(deleteResponse.status).toBe(204);
    expect(fs.existsSync(endpointFilePath)).toBe(false);
    expect(fs.existsSync(responseDirPath)).toBe(false);

    const backendResponse = await request(app).get("/created");
    expect(backendResponse.status).toBe(200);
    expect(backendResponse.body).toEqual({ backend: true });
    expect(backendResponse.headers["x-mock-source"]).toBe("backend");
  });

  test("accepts array header values on mock create and rejects arrays with non-string entries", async () => {
    const app = await buildApp();

    const createResponse = await request(app)
      .post("/_admin/api/mocks")
      .send({
        config: {
          method: "GET",
          path: "/multi-header",
          status: 200,
          headers: { "x-multi": ["first", "second"] },
        },
        body: { ok: true },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.config.headers["x-multi"]).toEqual(["first", "second"]);

    const invalidResponse = await request(app)
      .post("/_admin/api/mocks")
      .send({
        config: {
          method: "GET",
          path: "/multi-header-invalid",
          status: 200,
          headers: { "x-multi": [1, 2] },
        },
        body: { ok: true },
      });

    expect(invalidResponse.status).toBe(400);
  });

  test("rejects updates that change an existing endpoint path", async () => {
    await writeMock({
      mocksDir,
      folder: "immutable-path",
      method: "GET",
      routePath: "/immutable-path",
      body: { ok: true },
    });

    const app = await buildApp();
    const mockId = encodeMockId("immutable-path/GET.endpoint.json");

    const updateResponse = await request(app)
      .put(`/_admin/api/mocks/${mockId}`)
      .send({
        config: {
          method: "GET",
          path: "/changed-path",
          status: 200,
          disabled: false,
          headers: {
            "content-type": "application/json",
          },
          bodyFile: "001.response.json",
          delayMs: 0,
        },
        body: { ok: false },
      });

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.body.message).toBe("Endpoint path cannot be changed after creation.");

    const originalResponse = await request(app).get("/immutable-path");
    expect(originalResponse.status).toBe(200);
    expect(originalResponse.body).toEqual({ ok: true });

    const changedResponse = await request(app).get("/changed-path");
    expect(changedResponse.status).toBe(200);
    expect(changedResponse.body).toEqual({ backend: true });
  });

  test("derives nested folders from the mock path including dynamic params", async () => {
    const app = await buildApp();

    const createResponse = await request(app)
      .post("/_admin/api/mocks")
      .send({
        config: {
          method: "GET",
          path: "/be/causali-tributo/:idCausale/configurazione-campi",
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
        body: { nested: true },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.configFilePath).toBe(
      "be/causali-tributo/{idCausale}/configurazione-campi/GET.endpoint.json"
    );
    expect(
      fs.existsSync(
        path.join(
          mocksDir,
          "be",
          "causali-tributo",
          "{idCausale}",
          "configurazione-campi",
          "GET.endpoint.json"
        )
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          mocksDir,
          "be",
          "causali-tributo",
          "{idCausale}",
          "configurazione-campi",
          "GET.responses/001.response.json"
        )
      )
    ).toBe(true);

    const nestedMockResponse = await request(app).get("/be/causali-tributo/42/configurazione-campi");
    expect(nestedMockResponse.status).toBe(200);
    expect(nestedMockResponse.body).toEqual({ nested: true });
    expect(nestedMockResponse.headers["x-mock-source"]).toBe("mock");
  });

  test("maps the query string to a dedicated folder segment when creating a mock", async () => {
    const app = await buildApp();

    const createResponse = await request(app)
      .post("/_admin/api/mocks")
      .send({
        config: {
          method: "GET",
          path: "/be/example?cippa=lippa&lippo=lippi",
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
        body: { queryFolder: true },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.configFilePath).toBe(
      "be/example/^cippa-lippa_lippo-lippi/GET.endpoint.json"
    );
    expect(
      fs.existsSync(
        path.join(
          mocksDir,
          "be",
          "example",
          "^cippa-lippa_lippo-lippi",
          "GET.endpoint.json"
        )
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          mocksDir,
          "be",
          "example",
          "^cippa-lippa_lippo-lippi",
          "GET.responses/001.response.json"
        )
      )
    ).toBe(true);
  });

  test("rejects route paths that contain the reserved ^ character", async () => {
    const app = await buildApp();

    const response = await request(app)
      .post("/_admin/api/mocks")
      .send({
        config: {
          method: "GET",
          path: "/be/^example",
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
        body: { invalid: true },
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Mock path cannot contain '^' because it is reserved for derived query folders.");
  });

  test("rejects admin mock ids that resolve outside the mocks directory", async () => {
    const app = await buildApp();
    const traversalId = encodeMockId("../outside.endpoint.json");

    const response = await request(app).get(`/_admin/api/mocks/${traversalId}`);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid mock id.");
  });

  test("mock-only mode returns a clear 404 without BACKEND_URL", async () => {
    const app = createApp({
      registry: new MockRegistry([]),
      config: {
        mocksDir,
        adminApiEnabled: false,
        proxyFallbackEnabled: false,
        requestTimeoutMs: 15000,
      },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry([]),
    });

    const response = await request(app).get("/not-mocked");

    expect(response.status).toBe(404);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: "Mock Not Found",
        method: "GET",
        path: "/not-mocked",
        reason: "path_not_mocked",
      })
    );
    expect(response.headers["x-mock-source"]).toBe("mock-only");
  });

  test("returns a clear 501 when proxy fallback is enabled but BACKEND_URL is missing", async () => {
    const app = createApp({
      registry: new MockRegistry([]),
      config: {
        mocksDir,
        adminApiEnabled: false,
        proxyFallbackEnabled: true,
        requestTimeoutMs: 15000,
      },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry([]),
    });

    const response = await request(app).get("/not-mocked");

    expect(response.status).toBe(501);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: "Backend Not Configured",
        method: "GET",
        path: "/not-mocked",
      })
    );
    expect(response.body.message).toContain("BACKEND_URL");
    expect(response.headers["x-mock-source"]).toBe("backend-unconfigured");
  });

  describe("copy endpoint", () => {
    async function idOf(app, method, routePath) {
      const list = await request(app).get("/_admin/api/mocks");
      const item = list.body.items.find((entry) => entry.method === method && entry.path === routePath);
      if (!item) {
        throw new Error(`endpoint not found: ${method} ${routePath}`);
      }
      return item.id;
    }

    // GET /orig con response mock 001 {a:1}; aggiunge una 2a response mock 002 {b:2} che diventa selezionata.
    async function setupTwoResponseMock(app) {
      const id = await idOf(app, "GET", "/orig");
      const added = await request(app)
        .post(`/_admin/api/mocks/${id}/responses`)
        .send({ type: "mock", title: "Second", status: 201, headers: { "content-type": "application/json" }, body: { b: 2 } });
      expect(added.status).toBe(201);
      expect(added.body.selectedResponseFile).toBe("002.response.json");
      return id;
    }

    test("copies only the selected response by default to a new method+path", async () => {
      await writeMock({ mocksDir, folder: "orig", method: "GET", routePath: "/orig", body: { a: 1 } });
      const app = await buildApp();
      const id = await setupTwoResponseMock(app);

      const copy = await request(app)
        .post(`/_admin/api/mocks/${id}/copy`)
        .send({ method: "PUT", path: "/copia", copyResponses: false });

      expect(copy.status).toBe(201);
      expect(copy.body).toMatchObject({ method: "PUT", path: "/copia", responseCount: 1 });
      expect(copy.body.selectedResponseFile).toBe("002.response.json");
      expect(copy.body.responses).toHaveLength(1);

      // l'originale resta intatto (2 response)
      const original = await request(app).get(`/_admin/api/mocks/${id}`);
      expect(original.body.responseCount).toBe(2);

      // il duplicato serve la response selezionata della sorgente
      const served = await request(app).put("/copia");
      expect(served.status).toBe(201);
      expect(served.body).toEqual({ b: 2 });
    });

    test("copies all responses (and keeps the selected one) when copyResponses is true", async () => {
      await writeMock({ mocksDir, folder: "orig", method: "GET", routePath: "/orig", body: { a: 1 } });
      const app = await buildApp();
      const id = await setupTwoResponseMock(app);

      const copy = await request(app)
        .post(`/_admin/api/mocks/${id}/copy`)
        .send({ method: "POST", path: "/copia-tutto", copyResponses: true });

      expect(copy.status).toBe(201);
      expect(copy.body).toMatchObject({ method: "POST", path: "/copia-tutto", responseCount: 2 });
      expect(copy.body.selectedResponseFile).toBe("002.response.json");
      expect(copy.body.responses.map((entry) => entry.fileName)).toEqual(["001.response.json", "002.response.json"]);
    });

    test("rejects a copy that collides with an existing method+path", async () => {
      await writeMock({ mocksDir, folder: "orig", method: "GET", routePath: "/orig", body: { a: 1 } });
      await writeMock({ mocksDir, folder: "taken", method: "POST", routePath: "/taken", body: { t: 1 } });
      const app = await buildApp();
      const id = await idOf(app, "GET", "/orig");

      const collide = await request(app)
        .post(`/_admin/api/mocks/${id}/copy`)
        .send({ method: "POST", path: "/taken", copyResponses: false });
      expect(collide.status).toBe(409);

      // copiare su se stesso (stesso metodo + stessa path) è anch'esso un conflitto
      const itself = await request(app)
        .post(`/_admin/api/mocks/${id}/copy`)
        .send({ method: "GET", path: "/orig", copyResponses: false });
      expect(itself.status).toBe(409);
    });

    test("copies a handler endpoint preserving its source asset", async () => {
      await writeHandler({
        mocksDir,
        folder: "h",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/h",
  disabled: false,
  async resolveResponse() {
    return { jsonBody: { from: "handler" } };
  }
};
`,
      });
      const app = await buildApp();
      const id = await idOf(app, "GET", "/h");

      const copy = await request(app)
        .post(`/_admin/api/mocks/${id}/copy`)
        .send({ method: "POST", path: "/h2", copyResponses: false });

      expect(copy.status).toBe(201);
      expect(copy.body).toMatchObject({ type: "handler", method: "POST", path: "/h2" });
      expect(copy.body.source).toContain("resolveResponse");
      expect(copy.body.source).toContain("from");
    });
  });

  describe("file dati (pagina Dati)", () => {
    let filesDir;

    beforeEach(async () => {
      // La cartella viene passata alla config ma NON creata: deve nascere pigramente al primo upload.
      filesDir = path.join(await createTempDir("admin-files-"), "files");
    });

    afterEach(async () => {
      if (filesDir) {
        await removeDir(path.dirname(filesDir));
        filesDir = null;
      }
    });

    function buildFilesApp() {
      return buildApp({ filesDir });
    }

    function uploadDataFile(app, name, value) {
      return request(app)
        .put(`/_admin/api/files/${name}`)
        .set("content-type", "application/octet-stream")
        .send(Buffer.from(typeof value === "string" ? value : JSON.stringify(value)));
    }

    test("elenco vuoto quando la cartella non esiste ancora", async () => {
      const app = await buildFilesApp();
      const res = await request(app).get("/_admin/api/files");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [] });
    });

    test("upload valido: 201 con metadati, poi in elenco e leggibile", async () => {
      const app = await buildFilesApp();

      const created = await uploadDataFile(app, "utenti", [{ id: 1, nome: "Ada" }]);
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ name: "utenti", fileName: "utenti.json" });
      expect(created.body.sizeBytes).toBeGreaterThan(0);

      const list = await request(app).get("/_admin/api/files");
      expect(list.body.items.map((i) => i.name)).toEqual(["utenti"]);

      const read = await request(app).get("/_admin/api/files/utenti");
      expect(read.status).toBe(200);
      expect(JSON.parse(read.body.content)).toEqual([{ id: 1, nome: "Ada" }]);
    });

    test("upload normalizza il nome a lowercase (e tollera il suffisso .json)", async () => {
      const app = await buildFilesApp();

      const created = await uploadDataFile(app, "Utenti.JSON", { ok: true });
      expect(created.status).toBe(201);
      expect(created.body.name).toBe("utenti");
      expect(fs.existsSync(path.join(filesDir, "utenti.json"))).toBe(true);
    });

    test("upload con JSON invalido: 400 e nessun file scritto", async () => {
      const app = await buildFilesApp();

      const res = await uploadDataFile(app, "rotto", "{ non json ");
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not valid JSON/);
      expect(fs.existsSync(path.join(filesDir, "rotto.json"))).toBe(false);
    });

    test("upload con nome invalido o body vuoto: 400", async () => {
      const app = await buildFilesApp();

      const badName = await uploadDataFile(app, "con%20spazi", { ok: true });
      expect(badName.status).toBe(400);

      const emptyBody = await request(app)
        .put("/_admin/api/files/vuoto")
        .set("content-type", "application/octet-stream")
        .send();
      expect(emptyBody.status).toBe(400);
    });

    test("replace di un file esistente: 200", async () => {
      const app = await buildFilesApp();

      await uploadDataFile(app, "utenti", [{ id: 1 }]);
      const replaced = await uploadDataFile(app, "utenti", [{ id: 1 }, { id: 2 }]);

      expect(replaced.status).toBe(200);
      const read = await request(app).get("/_admin/api/files/utenti");
      expect(JSON.parse(read.body.content)).toHaveLength(2);
    });

    test("rinomina: 200 col nuovo nome (normalizzato), il vecchio sparisce, collisione 409", async () => {
      const app = await buildFilesApp();
      await uploadDataFile(app, "utenti", []);
      await uploadDataFile(app, "aziende", []);

      const renamed = await request(app)
        .patch("/_admin/api/files/utenti")
        .send({ name: "Persone" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe("persone");
      expect(fs.existsSync(path.join(filesDir, "persone.json"))).toBe(true);
      expect(fs.existsSync(path.join(filesDir, "utenti.json"))).toBe(false);

      const conflict = await request(app)
        .patch("/_admin/api/files/persone")
        .send({ name: "aziende" });
      expect(conflict.status).toBe(409);

      const missingSource = await request(app)
        .patch("/_admin/api/files/utenti")
        .send({ name: "altro" });
      expect(missingSource.status).toBe(404);

      const invalidTarget = await request(app)
        .patch("/_admin/api/files/persone")
        .send({ name: "con spazi" });
      expect(invalidTarget.status).toBe(400);
    });

    test("cancellazione: 204, poi 404 su lettura e seconda cancellazione", async () => {
      const app = await buildFilesApp();
      await uploadDataFile(app, "temporaneo", { ok: true });

      const deleted = await request(app).delete("/_admin/api/files/temporaneo");
      expect(deleted.status).toBe(204);

      const readMissing = await request(app).get("/_admin/api/files/temporaneo");
      expect(readMissing.status).toBe(404);

      const deleteMissing = await request(app).delete("/_admin/api/files/temporaneo");
      expect(deleteMissing.status).toBe(404);
    });

    test("upload e handler insieme: il file caricato via API è subito leggibile con data()", async () => {
      await writeHandler({
        mocksDir,
        folder: "usa-dati",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/usa-dati",
  async resolveResponse({ data }) {
    const ruoli = await data("ruoli");
    return { jsonBody: ruoli.map(r => r.nome) };
  }
};
`,
      });
      const app = await buildFilesApp();

      await uploadDataFile(app, "ruoli", [{ nome: "admin" }, { nome: "viewer" }]);
      const res = await request(app).get("/usa-dati");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(["admin", "viewer"]);
    });

    test("l'elenco riporta gli endpoint che referenziano ogni file (usedBy)", async () => {
      await writeHandler({
        mocksDir,
        folder: "consumer",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/consumer",
  async resolveResponse({ data }) {
    return { jsonBody: await data("ruoli") };
  }
};`,
      });
      const app = await buildFilesApp();
      await uploadDataFile(app, "ruoli", [{ nome: "admin" }]);
      await uploadDataFile(app, "inutile", [1, 2, 3]);

      const list = await request(app).get("/_admin/api/files");
      const byName = Object.fromEntries(list.body.items.map((i) => [i.name, i]));

      // "ruoli" è referenziato dall'handler /consumer; "inutile" da nessuno.
      expect(byName.ruoli.usedBy).toEqual([
        { id: expect.any(String), method: "GET", path: "/consumer", type: "handler" },
      ]);
      expect(byName.inutile.usedBy).toEqual([]);
    });

    test("rinomina con rewriteReferences aggiorna i sorgenti e l'endpoint continua a leggere il file", async () => {
      await writeHandler({
        mocksDir,
        folder: "consumer",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/consumer",
  async resolveResponse({ data }) {
    return { jsonBody: await data("ruoli") };
  }
};`,
      });
      const app = await buildFilesApp();
      await uploadDataFile(app, "ruoli", [{ nome: "admin" }]);

      // prima della rinomina l'endpoint legge data('ruoli')
      const before = await request(app).get("/consumer");
      expect(before.body).toEqual([{ nome: "admin" }]);

      // rinomina ruoli → roles, chiedendo di aggiornare i riferimenti
      const renamed = await request(app)
        .patch("/_admin/api/files/ruoli")
        .send({ name: "roles", rewriteReferences: true });
      expect(renamed.status).toBe(200);
      expect(renamed.body.name).toBe("roles");
      expect(renamed.body.referencesRewritten).toBe(1);
      expect(renamed.body.referencingEndpoints).toEqual([
        { id: expect.any(String), method: "GET", path: "/consumer", type: "handler" },
      ]);

      // il sorgente su disco ora referenzia data("roles")
      const source = fs.readFileSync(
        path.join(mocksDir, "consumer", "GET.responses", "001.handler.js"),
        "utf8"
      );
      expect(source).toContain('data("roles")');
      expect(source).not.toContain('data("ruoli")');

      // dopo il reload runtime (fatto dalla rotta) l'endpoint legge il file rinominato senza rompersi
      const after = await request(app).get("/consumer");
      expect(after.status).toBe(200);
      expect(after.body).toEqual([{ nome: "admin" }]);
    });

    test("rinomina senza rewriteReferences lascia i sorgenti invariati", async () => {
      await writeHandler({
        mocksDir,
        folder: "consumer",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/consumer",
  async resolveResponse({ data }) {
    return { jsonBody: await data("ruoli") };
  }
};`,
      });
      const app = await buildFilesApp();
      await uploadDataFile(app, "ruoli", [{ nome: "admin" }]);

      const renamed = await request(app)
        .patch("/_admin/api/files/ruoli")
        .send({ name: "roles" });
      expect(renamed.status).toBe(200);
      expect(renamed.body.referencesRewritten).toBe(0);

      const source = fs.readFileSync(
        path.join(mocksDir, "consumer", "GET.responses", "001.handler.js"),
        "utf8"
      );
      expect(source).toContain('data("ruoli")');
    });
  });
});
