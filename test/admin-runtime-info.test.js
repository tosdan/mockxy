const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const yaml = require("js-yaml");
const Ajv2020 = require("ajv/dist/2020");
const { createServerRuntime, startServer } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir, waitFor, writeMock } = require("./helpers");

const SPEC = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "..", "src", "admin", "admin-api.openapi.yaml"), "utf8"));
const PACKAGE_VERSION = require("../package.json").version;
const BROKEN_HANDLER = "module.exports = { async resolveResponse( { return 1; } };\n";

// Identità del runtime e del workspace, indirizzo, watcher e revisioni (piano agent/API, §5 S2
// e §13 C2).
describe("GET /info", () => {
  let workspaceDir;
  let mocksDir;
  let filesDir;
  let validate;
  const started = [];

  beforeAll(() => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addSchema({ $id: "admin-openapi", components: SPEC.components });
    validate = ajv.compile({ $ref: "admin-openapi#/components/schemas/RuntimeInfo" });
  });

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-runtime-info-");
    mocksDir = path.join(workspaceDir, "mocks");
    filesDir = path.join(workspaceDir, "files");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    await fs.promises.mkdir(filesDir, { recursive: true });
  });

  afterEach(async () => {
    for (const runtime of started.splice(0)) {
      await (runtime.shutdown ? runtime.shutdown() : runtime.watcher?.close());
    }
    await removeDir(workspaceDir);
  });

  function overrides(extra = {}) {
    return {
      host: "127.0.0.1",
      mocksDir,
      filesDir,
      monitorDumpDir: path.join(workspaceDir, "dump"),
      devWatch: false,
      adminApiEnabled: true,
      proxyFallbackEnabled: false,
      ...extra,
    };
  }

  async function createRuntime(extra) {
    const runtime = await createServerRuntime({ configOverrides: overrides(extra), logger: createNoopLogger() });
    started.push(runtime);
    return runtime;
  }

  async function readInfo(app) {
    const response = await request(app).get("/_admin/api/info");
    expect(response.status).toBe(200);
    expect(validate(response.body) ? [] : validate.errors).toEqual([]);
    return response.body;
  }

  const expectedWorkspaceId = (canonicalMocksDir, canonicalFilesDir) =>
    `workspace-v1:${crypto.createHash("sha256").update(JSON.stringify([canonicalMocksDir, canonicalFilesDir]), "utf8").digest("hex")}`;

  test("un server avviato sulla porta 0 riporta l'indirizzo reale e la propria identità", async () => {
    const runtime = await startServer({ configOverrides: overrides({ port: 0 }), logger: createNoopLogger() });
    started.push(runtime);

    const info = await readInfo(runtime.app);

    expect(info.listener).toEqual({ host: "127.0.0.1", port: runtime.server.address().port });
    expect(info.listener.port).toBeGreaterThan(0);
    expect(info).toMatchObject({
      version: PACKAGE_VERSION,
      runtimeId: runtime.runtimeIdentity.runtimeId,
      startedAt: runtime.runtimeIdentity.startedAt,
      watcher: { state: "disabled", polling: false, lastError: null },
      revisions: { catalog: 1, server: 1, dump: 1, diagnostics: 1, config: 1 },
    });
  });

  test("l'identità del workspace segue la formula sui percorsi canonici; la radice è null senza app desktop", async () => {
    const info = await readInfo((await createRuntime()).app);
    const canonicalMocksDir = fs.realpathSync.native(mocksDir);
    const canonicalFilesDir = fs.realpathSync.native(filesDir);

    expect(info.workspace).toEqual({
      id: expectedWorkspaceId(canonicalMocksDir, canonicalFilesDir),
      root: null,
      mocksDir: canonicalMocksDir,
      filesDir: canonicalFilesDir,
    });
  });

  test("con la radice fornita dall'app desktop la riporta, senza che cambi l'identità", async () => {
    const plain = await readInfo((await createRuntime()).app);
    const desktop = await readInfo((await createRuntime({ workspaceRoot: workspaceDir })).app);

    expect(desktop.workspace.root).toBe(fs.realpathSync.native(workspaceDir));
    expect(desktop.workspace.id).toBe(plain.workspace.id);
  });

  test("due runtime sullo stesso workspace condividono l'identità, non il runtimeId", async () => {
    const first = await readInfo((await createRuntime()).app);
    const second = await readInfo((await createRuntime()).app);

    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.runtimeId).not.toBe(first.runtimeId);
  });

  (process.platform === "win32" ? test.skip : test)("un percorso con symlink porta alla stessa identità", async () => {
    const linkedWorkspace = path.join(workspaceDir, "link");
    await fs.promises.symlink(workspaceDir, linkedWorkspace, "dir");
    const direct = await readInfo((await createRuntime()).app);
    const linked = await readInfo((await createRuntime({
      mocksDir: path.join(linkedWorkspace, "mocks"),
      filesDir: path.join(linkedWorkspace, "files"),
    })).app);

    expect(linked.workspace).toEqual(direct.workspace);
  });

  test("con il watcher attivo lo stato passa a ready", async () => {
    const runtime = await createRuntime({ devWatch: true });

    await waitFor(async () => (await readInfo(runtime.app)).watcher.state === "ready");
    expect((await readInfo(runtime.app)).watcher).toEqual({ state: "ready", polling: false, lastError: null });
  });

  describe("revisioni", () => {
    test("server e dump cambiano solo con un cambiamento effettivo, anche se annullato fra due letture", async () => {
      const runtime = await createRuntime();
      const { app } = runtime;

      await request(app).patch("/_admin/api/server").send({ proxyAll: true });
      expect((await readInfo(app)).revisions.server).toBe(2);
      await request(app).patch("/_admin/api/server").send({ proxyAll: true });
      expect((await readInfo(app)).revisions.server).toBe(2);
      await request(app).patch("/_admin/api/server").send({ proxyAll: false });
      await request(app).patch("/_admin/api/server").send({ proxyAll: true });
      expect((await readInfo(app)).revisions.server).toBe(4);

      await request(app).patch("/_admin/api/monitoring/dump").send({ threshold: 7 });
      expect((await readInfo(app)).revisions.dump).toBe(2);
      await request(app).patch("/_admin/api/monitoring/dump").send({ threshold: 7 });
      expect((await readInfo(app)).revisions).toMatchObject({ dump: 2, config: 1 });
    });

    test("diagnostics segue lo stato dei caricamenti", async () => {
      await writeMock({ mocksDir, folder: "fine", method: "GET", routePath: "/fine", body: { ok: true } });
      const runtime = await createRuntime();

      await runtime.reloadRuntime("watcher");
      expect((await readInfo(runtime.app)).revisions.diagnostics).toBe(1);

      await fs.promises.writeFile(path.join(mocksDir, "fine", "GET.endpoint.json"), "{ json invalido");
      await runtime.reloadRuntime("watcher");
      expect((await readInfo(runtime.app)).revisions.diagnostics).toBe(2);
    });

    test("catalog cambia con le mutazioni che cambiano i file, non con quelle che li riscrivono uguali", async () => {
      await writeMock({ mocksDir, folder: "items", method: "GET", routePath: "/items", body: { ok: true } });
      const runtime = await createRuntime();
      const id = encodeMockId("items/GET.endpoint.json");
      expect((await readInfo(runtime.app)).revisions.catalog).toBe(1);

      await request(runtime.app).put(`/_admin/api/mocks/${id}/endpoint`).send({ description: "nuova" });
      expect((await readInfo(runtime.app)).revisions.catalog).toBe(2);

      await request(runtime.app).put(`/_admin/api/mocks/${id}/endpoint`).send({ description: "nuova" });
      expect((await readInfo(runtime.app)).revisions.catalog).toBe(2);

      await request(runtime.app).post("/_admin/api/mocks/collections").send({ label: "Negozio" });
      expect((await readInfo(runtime.app)).revisions.catalog).toBe(3);
    });

    test("una variante inattiva cambiata via API conta", async () => {
      await writeMock({ mocksDir, folder: "items", method: "GET", routePath: "/items", body: { ok: true } });
      const runtime = await createRuntime();
      const id = encodeMockId("items/GET.endpoint.json");
      await request(runtime.app).post(`/_admin/api/mocks/${id}/responses`).send({ type: "mock", title: "vuota", status: 200, headers: {}, delayMs: 0, body: [] });
      await request(runtime.app).put(`/_admin/api/mocks/${id}`).send({ selectedResponseFile: "001.response.json" });
      const before = (await readInfo(runtime.app)).revisions.catalog;

      const response = await request(runtime.app)
        .put(`/_admin/api/mocks/${id}/responses/002.response.json`)
        .send({ type: "mock", title: "vuota", status: 404, headers: {}, delayMs: 0, body: [] });

      expect(response.status).toBe(200);
      expect((await readInfo(runtime.app)).revisions.catalog).toBe(before + 1);
    });

    test("senza watcher una modifica esterna emerge alla lettura successiva del catalogo, non da /info", async () => {
      await writeMock({ mocksDir, folder: "items", method: "GET", routePath: "/items", body: { ok: true } });
      const runtime = await createRuntime();

      await fs.promises.writeFile(path.join(mocksDir, "items", "GET.responses", "002.response.json"), JSON.stringify({ type: "mock", status: 500 }));
      expect((await readInfo(runtime.app)).revisions.catalog).toBe(1);

      await request(runtime.app).get("/_admin/api/mocks");
      await waitFor(async () => (await readInfo(runtime.app)).revisions.catalog === 2);
    });

    test("un reload del watcher riallinea catalog", async () => {
      await writeMock({ mocksDir, folder: "items", method: "GET", routePath: "/items", body: { ok: true } });
      const runtime = await createRuntime();

      await fs.promises.writeFile(
        path.join(mocksDir, "items", "GET.responses", "001.handler.js"),
        BROKEN_HANDLER
      );
      await runtime.reloadRuntime("watcher");

      expect((await readInfo(runtime.app)).revisions.catalog).toBe(2);
    });
  });
});
