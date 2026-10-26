const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createServerRuntime } = require("../src/server");
const { ENGINE_VERSION } = require("../src/runtime-info");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

const GOOD_HANDLER = "module.exports = { async resolveResponse() { return { status: 200, jsonBody: { ok: true } }; } };\n";
const BROKEN_HANDLER = "module.exports = { async resolveResponse( { return 1; } };\n";

// Health per orchestratori e load balancer (analisi dello staging condiviso, D7): risponde anche
// con l'admin spenta e senza Host di loopback, 503 con file rotti, e dei file solo i percorsi.
describe("GET /_admin/api/health", () => {
  let workspaceDir;
  let mocksDir;
  let runtime;
  let savedMocksVersion;

  beforeEach(async () => {
    // La versione dei mock arriva anche dall'ambiente: un MOCKS_VERSION della shell che lancia i
    // test non deve cambiarne l'esito.
    savedMocksVersion = process.env.MOCKS_VERSION;
    delete process.env.MOCKS_VERSION;
    workspaceDir = await createTempDir("health-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
  });

  afterEach(async () => {
    if (savedMocksVersion === undefined) {
      delete process.env.MOCKS_VERSION;
    } else {
      process.env.MOCKS_VERSION = savedMocksVersion;
    }
    await fs.promises.chmod(mocksDir, 0o755).catch(() => {});
    await removeDir(workspaceDir);
  });

  async function startRuntime(configOverrides = {}) {
    runtime = await createServerRuntime({
      configOverrides: {
        host: "127.0.0.1",
        mocksDir,
        monitorDumpDir: path.join(workspaceDir, "dump"),
        devWatch: false,
        adminApiEnabled: false,
        proxyFallbackEnabled: false,
        ...configOverrides,
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

  test("workspace caricato senza errori: 200, versioni e nessun errore", async () => {
    await writeHandler("fine", GOOD_HANDLER);
    await startRuntime({ mocksVersion: "a1b2c3d" });

    const response = await request(runtime.app).get("/_admin/api/health");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toEqual({
      status: "ok",
      mockxyVersion: ENGINE_VERSION,
      mocksVersion: "a1b2c3d",
      errors: [],
    });
  });

  test("senza MOCKS_VERSION la versione dei mock è null", async () => {
    await startRuntime();

    const response = await request(runtime.app).get("/_admin/api/health");

    expect(response.body.mocksVersion).toBeNull();
  });

  test("un file rotto: 503, degradato, solo il percorso relativo e nessun messaggio", async () => {
    await writeHandler("broken", BROKEN_HANDLER);
    await writeHandler("fine", GOOD_HANDLER);
    await startRuntime();

    const response = await request(runtime.app).get("/_admin/api/health");

    expect(response.status).toBe(503);
    expect(response.body.status).toBe("degraded");
    expect(response.body.errors).toEqual([{ filePath: "broken/GET.endpoint.json" }]);
  });

  test("risponde a HEAD con lo stesso status e senza body", async () => {
    await writeHandler("broken", BROKEN_HANDLER);
    await startRuntime();

    const response = await request(runtime.app).head("/_admin/api/health");

    expect(response.status).toBe(503);
    expect(response.text ?? "").toBe("");
  });

  test("con la guardia sull'Host attiva risponde anche a un Host qualunque, l'admin no", async () => {
    // Un orchestratore chiama con l'IP o il nome del container: la guardia anti DNS rebinding
    // dell'admin non deve fermare l'health.
    await startRuntime({ adminApiEnabled: true });

    const health = await request(runtime.app).get("/_admin/api/health").set("Host", "10.0.0.7:3000");
    const admin = await request(runtime.app).get("/_admin/api/info").set("Host", "10.0.0.7:3000");

    expect(health.status).toBe(200);
    expect(admin.status).toBe(403);
  });

  test("con l'admin spenta l'health risponde e il resto dell'admin no", async () => {
    await startRuntime();

    expect((await request(runtime.app).get("/_admin/api/health")).status).toBe(200);
    expect((await request(runtime.app).get("/_admin/api/info")).status).toBe(404);
  });

  test("un mock sullo stesso percorso non può oscurarla: /_admin/api è riservato", async () => {
    await writeHandler("_admin/api/health", GOOD_HANDLER);
    await startRuntime();

    const response = await request(runtime.app).get("/_admin/api/health");

    expect(response.body).toMatchObject({ status: "ok", mockxyVersion: ENGINE_VERSION });
  });

  (process.platform === "win32" ? test.skip : test)(
    "una ricarica fallita del tutto rende l'health degradata anche senza errori registrati",
    async () => {
      await writeHandler("fine", GOOD_HANDLER);
      await startRuntime({ adminApiEnabled: true });

      await fs.promises.chmod(mocksDir, 0o000);
      try {
        await runtime.reloadRuntime("admin");
      } finally {
        await fs.promises.chmod(mocksDir, 0o755);
      }

      const response = await request(runtime.app).get("/_admin/api/health");
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ status: "degraded", errors: [] });
    }
  );
});
