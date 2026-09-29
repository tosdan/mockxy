const fs = require("fs");
const http = require("http");
const path = require("path");
const request = require("supertest");
const yaml = require("js-yaml");
const Ajv2020 = require("ajv/dist/2020");
const { createServerRuntime } = require("../src/server");
const { createNoopLogger, createTempDir, removeDir, writeMock } = require("./helpers");

const SPEC = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "..", "src", "admin", "admin-api.openapi.yaml"), "utf8"));

// Monitor interrogabile via admin API (piano agent/API, §8 S5 e §13 C5), col runtime reale.
describe("GET /monitoring/requests — modalità page e voce per ID", () => {
  let workspaceDir;
  let mocksDir;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-monitor-page-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    await writeMock({ mocksDir, folder: "items", method: "GET", routePath: "/items", body: { v: 1 } });
  });

  afterEach(async () => {
    await removeDir(workspaceDir);
  });

  async function startRuntime() {
    const runtime = await createServerRuntime({
      configOverrides: {
        host: "127.0.0.1",
        mocksDir,
        filesDir: path.join(workspaceDir, "files"),
        monitorDumpDir: path.join(workspaceDir, "dump"),
        devWatch: false,
        adminApiEnabled: true,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });
    return runtime.app;
  }

  const monitor = (app, query = "") => request(app).get(`/_admin/api/monitoring/requests${query}`);
  const runtimeIdOf = async (app) => (await request(app).get("/_admin/api/info")).body.runtimeId;

  test("senza query la risposta resta {items}, più recente prima", async () => {
    const app = await startRuntime();
    await request(app).get("/items");
    await request(app).get("/missing");

    const res = await monitor(app);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(["items"]);
    expect(res.body.items.map((item) => item.path)).toEqual(["/missing", "/items"]);
    expect(res.body.items[0]).toHaveProperty("responseBody");
  });

  test("view=page: ordine crescente, filtri applicati, sommario senza body, cursore del runtime", async () => {
    const app = await startRuntime();
    await request(app).get("/items");
    await request(app).get("/missing");
    await request(app).get("/items");
    const runtimeId = await runtimeIdOf(app);

    const res = await monitor(app, "?view=page&path=/items&method=get");
    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => [item.id, item.path, item.status])).toEqual([["1", "/items", 200], ["3", "/items", 200]]);
    expect(res.body.items[0]).not.toHaveProperty("responseBody");
    expect(res.body.items[0]).not.toHaveProperty("requestHeaders");
    expect(res.body).toMatchObject({
      hasMore: false,
      gap: false,
      gapReason: null,
      cursor: { runtimeId, generation: 1, since: "3" },
      available: { oldestId: "1", newestId: "3", highWatermark: "3" },
    });

    const missing = await monitor(app, "?view=page&status=404");
    expect(missing.body.items.map((item) => item.id)).toEqual(["2"]);
  });

  test("dopo since=latest si legge solo il traffico successivo; il clear si riconosce", async () => {
    const app = await startRuntime();
    await request(app).get("/items");
    const latest = (await monitor(app, "?view=page&since=latest")).body;
    expect(latest).toMatchObject({ items: [], gap: false, cursor: { since: "1" } });

    await request(app).get("/items");
    const { runtimeId, generation, since } = latest.cursor;
    const next = await monitor(app, `?view=page&since=${since}&runtimeId=${runtimeId}&generation=${generation}`);
    expect(next.body.items.map((item) => item.id)).toEqual(["2"]);

    await request(app).delete("/_admin/api/monitoring/requests");
    const afterClear = await monitor(app, `?view=page&since=${next.body.cursor.since}&runtimeId=${runtimeId}&generation=${generation}`);
    expect(afterClear.body).toMatchObject({ items: [], gap: true, gapReason: "cleared", cursor: { generation: 2, since: "2" } });
  });

  test("un cursore del runtime precedente dichiara il riavvio", async () => {
    const first = await startRuntime();
    await request(first).get("/items");
    const cursor = (await monitor(first, "?view=page")).body.cursor;

    const second = await startRuntime();
    await request(second).get("/items");
    const res = await monitor(second, `?view=page&since=${cursor.since}&runtimeId=${cursor.runtimeId}&generation=${cursor.generation}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gap: true, gapReason: "runtime_changed" });
    expect(res.body.cursor.runtimeId).not.toBe(cursor.runtimeId);
    expect(res.body.items.map((item) => item.id)).toEqual(["1"]);
  });

  test("parametri non validi o senza view=page sono un 400 con il parametro", async () => {
    const app = await startRuntime();
    const withoutView = await monitor(app, "?limit=10");
    expect(withoutView.status).toBe(400);
    expect(withoutView.body.details).toEqual({ code: "INVALID_QUERY", parameter: "view" });

    const unknown = await monitor(app, "?view=page&methd=GET");
    expect(unknown.status).toBe(400);
    expect(unknown.body.details).toEqual({ code: "INVALID_QUERY", parameter: "methd" });

    const ahead = await monitor(app, `?view=page&since=5&runtimeId=${await runtimeIdOf(app)}&generation=1`);
    expect(ahead.status).toBe(400);
    expect(ahead.body.details).toMatchObject({ code: "CURSOR_AHEAD", since: "5", highWatermark: "0" });
  });

  test("voce per ID: completa col runtime giusto, 409 con un altro, 404 dopo il clear", async () => {
    const app = await startRuntime();
    await request(app).get("/items");
    const runtimeId = await runtimeIdOf(app);

    const found = await request(app).get(`/_admin/api/monitoring/requests/1?runtimeId=${runtimeId}`);
    expect(found.status).toBe(200);
    expect(found.body.runtimeId).toBe(runtimeId);
    expect(found.body.item).toMatchObject({ id: "1", path: "/items", responseBodyTruncated: false });
    expect(found.body.item.responseBody).toContain('"v"');

    const otherRuntime = await request(app).get("/_admin/api/monitoring/requests/1?runtimeId=altro");
    expect(otherRuntime.status).toBe(409);
    expect(otherRuntime.body.details).toEqual({ code: "RUNTIME_CHANGED", runtimeId });

    await request(app).delete("/_admin/api/monitoring/requests");
    const gone = await request(app).get(`/_admin/api/monitoring/requests/1?runtimeId=${runtimeId}`);
    expect(gone.status).toBe(404);
    expect(gone.body.details).toMatchObject({ code: "REQUEST_NOT_AVAILABLE" });
  });

  // Codex, #33: le risposte reali devono rispettare lo schema dichiarato, non solo il documento
  // OpenAPI essere valido. Le due forme della lista si distinguono dai campi.
  describe("risposte conformi alla spec", () => {
    let validateList;
    let validateEntry;

    beforeAll(() => {
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      ajv.addSchema({ $id: "admin-openapi", components: SPEC.components });
      validateList = ajv.compile({ $ref: "admin-openapi#/components/schemas/MonitorRequestsResponse" });
      validateEntry = ajv.compile({ $ref: "admin-openapi#/components/schemas/MonitorEntryRead" });
    });

    function expectValid(validate, body) {
      const valid = validate(body);
      expect(validate.errors ?? []).toEqual([]);
      expect(valid).toBe(true);
    }

    test("vista storica, sommario, since=latest, pagina vuota, full e voce per ID", async () => {
      const app = await startRuntime();
      await request(app).get("/items");
      await request(app).get("/missing");
      await request(app)["m-search"]("/discovery");
      const runtimeId = await runtimeIdOf(app);

      for (const query of ["", "?view=page", "?view=page&since=latest", "?view=page&path=/nessuna", "?view=page&fields=full", "?view=page&method=M-SEARCH"]) {
        const res = await monitor(app, query);
        expect(res.status).toBe(200);
        expectValid(validateList, res.body);
      }
      for (const id of ["1", "3"]) {
        const res = await request(app).get(`/_admin/api/monitoring/requests/${id}?runtimeId=${runtimeId}`);
        expect(res.status).toBe(200);
        expectValid(validateEntry, res.body);
      }
    });
  });

  test("il filtro method accetta qualunque metodo registrato, come M-SEARCH", async () => {
    const app = await startRuntime();
    await request(app).get("/items");
    await request(app)["m-search"]("/discovery");

    const res = await monitor(app, "?view=page&method=m-search");
    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => [item.id, item.method, item.path])).toEqual([["2", "M-SEARCH", "/discovery"]]);
  });

  test("/stream resta lo stream SSE, non una voce per ID", async () => {
    const app = await startRuntime();
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { statusCode, contentType, firstEvent } = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${server.address().port}/_admin/api/monitoring/requests/stream`, (res) => {
          res.setEncoding("utf8");
          res.once("data", (chunk) => {
            resolve({ statusCode: res.statusCode, contentType: res.headers["content-type"], firstEvent: chunk });
            req.destroy();
          });
        });
        req.on("error", reject);
      });
      expect(statusCode).toBe(200);
      expect(contentType).toMatch(/^text\/event-stream/);
      expect(firstEvent).toContain('"type":"snapshot"');
      // Lo snapshot dichiara il runtime delle sue voci (§13 C7): gli ID ripartono a ogni avvio.
      const snapshot = JSON.parse(firstEvent.trim().replace(/^data: /, ""));
      expect(snapshot.runtimeId).toBe(await runtimeIdOf(app));
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
