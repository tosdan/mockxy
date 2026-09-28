const fs = require("fs");
const path = require("path");
const request = require("supertest");
const yaml = require("js-yaml");
const Ajv2020 = require("ajv/dist/2020");
const { createServerRuntime } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

const SPEC = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "..", "src", "admin", "admin-api.openapi.yaml"), "utf8"));
const GOOD_HANDLER = "module.exports = { async resolveResponse() { return { status: 200, jsonBody: { ok: true } }; } };\n";
const BROKEN_HANDLER = "module.exports = { async resolveResponse( { return 1; } };\n";

// Esito dei caricamenti del runtime reale (piano agent/API, §5 S2 e §13 C2): tentativi con le
// loro cause, errori per file con la disponibilità della rotta, fallimento globale.
describe("GET /runtime/status", () => {
  let workspaceDir;
  let mocksDir;
  let runtime;
  let validate;

  beforeAll(() => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addSchema({ $id: "admin-openapi", components: SPEC.components });
    validate = ajv.compile({ $ref: "admin-openapi#/components/schemas/RuntimeStatus" });
  });

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-runtime-status-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.chmod(mocksDir, 0o755).catch(() => {});
    await removeDir(workspaceDir);
  });

  async function startRuntime() {
    runtime = await createServerRuntime({
      configOverrides: {
        host: "127.0.0.1",
        mocksDir,
        monitorDumpDir: path.join(workspaceDir, "dump"),
        devWatch: false,
        adminApiEnabled: true,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });
  }

  async function writeHandler(folder, source) {
    const responseDir = path.join(mocksDir, folder, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(mocksDir, folder, "GET.endpoint.json"),
      JSON.stringify({
        method: "GET",
        path: `/${folder}`,
        description: "",
        enabled: true,
        responseFiles: ["001.response.json"],
        selectedResponseFile: "001.response.json",
      })
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      JSON.stringify({ type: "handler", title: "", sourceFile: "001.handler.js" })
    );
    await fs.promises.writeFile(path.join(responseDir, "001.handler.js"), source);
  }

  const setHandlerSource = (folder, source) =>
    fs.promises.writeFile(path.join(mocksDir, folder, "GET.responses", "001.handler.js"), source);

  async function readStatus() {
    const response = await request(runtime.app).get("/_admin/api/runtime/status");
    expect(response.status).toBe(200);
    expect(validate(response.body) ? [] : validate.errors).toEqual([]);
    return response.body;
  }

  const brokenError = (serving) => ({
    endpointId: encodeMockId("broken/GET.endpoint.json"),
    filePath: "broken/GET.endpoint.json",
    message: expect.any(String),
    serving,
  });

  test("un handler invalido all'avvio: tentativo degradato, rotta non disponibile", async () => {
    await writeHandler("broken", BROKEN_HANDLER);
    await writeHandler("fine", GOOD_HANDLER);
    await startRuntime();

    const status = await readStatus();

    expect(status).toEqual({
      runtimeId: runtime.runtimeIdentity.runtimeId,
      lastAttempt: {
        id: 1,
        startedAt: expect.any(String),
        completedAt: expect.any(String),
        reasons: ["startup"],
        status: "degraded",
      },
      lastAppliedAttemptId: 1,
      errors: [brokenError("missing")],
      fatalError: null,
    });
  });

  test("un handler che si rompe dopo un reload resta servito nella versione precedente, poi l'errore sparisce", async () => {
    await writeHandler("broken", GOOD_HANDLER);
    await startRuntime();
    expect((await readStatus()).lastAttempt.status).toBe("applied");

    await setHandlerSource("broken", BROKEN_HANDLER);
    await runtime.reloadRuntime("watcher");
    let status = await readStatus();
    expect(status.lastAttempt).toMatchObject({ id: 2, reasons: ["watcher"], status: "degraded" });
    expect(status.lastAppliedAttemptId).toBe(2);
    expect(status.errors).toEqual([brokenError("retained")]);
    expect((await request(runtime.app).get("/broken")).status).toBe(200);

    await setHandlerSource("broken", GOOD_HANDLER);
    await runtime.reloadRuntime("watcher");
    status = await readStatus();
    expect(status.lastAttempt).toMatchObject({ id: 3, status: "applied" });
    expect(status.errors).toEqual([]);
  });

  test("una mutazione admin registra la propria causa", async () => {
    await writeHandler("fine", GOOD_HANDLER);
    await startRuntime();

    const response = await request(runtime.app)
      .put(`/_admin/api/mocks/${encodeMockId("fine/GET.endpoint.json")}/endpoint`)
      .send({ description: "aggiornata" });

    expect(response.status).toBe(200);
    expect((await readStatus()).lastAttempt).toMatchObject({ id: 2, reasons: ["admin"], status: "applied" });
  });

  test("le richieste arrivate durante un reload formano il tentativo successivo, con tutte le loro cause", async () => {
    await startRuntime();

    const first = runtime.reloadRuntime("watcher");
    const aggregated = [runtime.reloadRuntime("watcher"), runtime.reloadRuntime("admin"), runtime.reloadRuntime("watcher")];
    await Promise.all([first, ...aggregated]);

    expect((await readStatus()).lastAttempt).toMatchObject({ id: 3, reasons: ["admin", "watcher"] });
  });

  (process.platform === "win32" ? test.skip : test)(
    "un fallimento globale conserva gli errori del registro in uso e lo dichiara fino al tentativo riuscito",
    async () => {
      await writeHandler("broken", BROKEN_HANDLER);
      await startRuntime();

      await fs.promises.chmod(mocksDir, 0o000);
      try {
        await runtime.reloadRuntime("admin");
      } finally {
        await fs.promises.chmod(mocksDir, 0o755);
      }
      let status = await readStatus();
      expect(status.lastAttempt).toMatchObject({ id: 2, reasons: ["admin"], status: "failed" });
      expect(status.lastAppliedAttemptId).toBe(1);
      expect(status.errors).toEqual([brokenError("missing")]);
      expect(status.fatalError).toEqual({ message: expect.stringContaining("EACCES") });

      await runtime.reloadRuntime("admin");
      status = await readStatus();
      expect(status.lastAttempt).toMatchObject({ id: 3, status: "degraded" });
      expect(status.lastAppliedAttemptId).toBe(3);
      expect(status.fatalError).toBeNull();
    }
  );
});
