const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createServerRuntime } = require("../src/server");
const { createAdminError } = require("../src/admin/admin-errors");
const { commitWithRollback, readBackup } = require("../src/admin/admin-fs");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir, writeMock } = require("./helpers");

// Contratto delle mutazioni admin col reload reale (piano agent/API, §13 C1): il successo
// significa che il runtime installato riflette l'effetto richiesto, e un fallimento dichiara in
// details.code e details.rollback che cosa è stato ripristinato.
describe("mutazioni admin: esito applicato e rollback", () => {
  let workspaceDir;
  let mocksDir;
  let filesDir;
  let app;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-mutation-contract-");
    mocksDir = path.join(workspaceDir, "mocks");
    filesDir = path.join(workspaceDir, "files");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    await fs.promises.mkdir(filesDir, { recursive: true });
  });

  afterEach(async () => {
    await removeDir(workspaceDir);
  });

  async function startRuntime() {
    const runtime = await createServerRuntime({
      configOverrides: {
        host: "127.0.0.1",
        mocksDir,
        filesDir,
        monitorDumpDir: path.join(workspaceDir, "dump"),
        devWatch: false,
        adminApiEnabled: true,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });
    app = runtime.app;
    return runtime;
  }

  async function writeHandlerEndpoint({ folder, routePath, enabled = true, source }) {
    const endpointDir = path.join(mocksDir, folder);
    const responseDir = path.join(endpointDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(endpointDir, "GET.endpoint.json"),
      JSON.stringify({
        method: "GET",
        path: routePath,
        description: "",
        enabled,
        responseFiles: ["001.response.json"],
        selectedResponseFile: "001.response.json",
      })
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      JSON.stringify({ type: "handler", title: "", sourceFile: "001.handler.js" })
    );
    await fs.promises.writeFile(path.join(responseDir, "001.handler.js"), source);
    return encodeMockId(`${folder}/GET.endpoint.json`);
  }

  const BROKEN_SOURCE = "module.exports = { async resolveResponse( { return 1; } };\n";
  const readEndpoint = (folder) =>
    JSON.parse(fs.readFileSync(path.join(mocksDir, folder, "GET.endpoint.json"), "utf8"));

  test("abilitare in massa un handler non compilabile è rifiutato e ripristinato", async () => {
    const id = await writeHandlerEndpoint({ folder: "broken", routePath: "/broken", enabled: false, source: BROKEN_SOURCE });
    await startRuntime();

    const response = await request(app).patch("/_admin/api/mocks/enabled").send({ ids: [id], enabled: true });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: "MUTATION_REJECTED", rollback: "restored" });
    expect(readEndpoint("broken").enabled).toBe(false);
    expect((await request(app).get("/broken")).status).toBe(404);
  });

  test("la stessa abilitazione sulla rotta singola ha lo stesso esito", async () => {
    const id = await writeHandlerEndpoint({ folder: "broken", routePath: "/broken", enabled: false, source: BROKEN_SOURCE });
    await startRuntime();

    const response = await request(app).put(`/_admin/api/mocks/${id}/endpoint`).send({ enabled: true });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: "MUTATION_REJECTED", rollback: "restored" });
    expect(readEndpoint("broken").enabled).toBe(false);
  });

  test("abilitare un endpoint in conflitto con un altro sullo stesso metodo e percorso è rifiutato", async () => {
    await writeMock({ mocksDir, folder: "a-first", method: "GET", routePath: "/dup", body: { from: "a" } });
    await writeMock({ mocksDir, folder: "z-second", method: "GET", routePath: "/dup", enabled: false, body: { from: "z" } });
    await startRuntime();

    const response = await request(app)
      .patch("/_admin/api/mocks/enabled")
      .send({ ids: [encodeMockId("z-second/GET.endpoint.json")], enabled: true });

    expect(response.status).toBe(400);
    expect(response.body.details.code).toBe("MUTATION_REJECTED");
    expect(readEndpoint("z-second").enabled).toBe(false);
    expect((await request(app).get("/dup")).body).toEqual({ from: "a" });
  });

  test("disabilitare in massa toglie davvero le definizioni dal runtime", async () => {
    await writeMock({ mocksDir, folder: "one", method: "GET", routePath: "/one", body: { n: 1 } });
    await writeMock({ mocksDir, folder: "two", method: "GET", routePath: "/two", body: { n: 2 } });
    await startRuntime();

    const response = await request(app)
      .patch("/_admin/api/mocks/enabled")
      .send({ ids: [encodeMockId("one/GET.endpoint.json"), encodeMockId("two/GET.endpoint.json")], enabled: false });

    expect(response.status).toBe(200);
    expect((await request(app).get("/one")).status).toBe(404);
    expect((await request(app).get("/two")).status).toBe(404);
  });

  test("un endpoint estraneo non caricabile non fa fallire una mutazione valida", async () => {
    await writeHandlerEndpoint({ folder: "broken", routePath: "/broken", source: BROKEN_SOURCE });
    await writeMock({ mocksDir, folder: "fine", method: "GET", routePath: "/fine", body: { ok: true } });
    await startRuntime();

    const response = await request(app)
      .put(`/_admin/api/mocks/${encodeMockId("fine/GET.endpoint.json")}/endpoint`)
      .send({ description: "aggiornata" });

    expect(response.status).toBe(200);
    expect(readEndpoint("fine").description).toBe("aggiornata");
  });

  test("eliminare un endpoint lo toglie dal runtime", async () => {
    await writeMock({ mocksDir, folder: "gone", method: "GET", routePath: "/gone", body: { ok: true } });
    await startRuntime();
    expect((await request(app).get("/gone")).status).toBe(200);

    const response = await request(app).delete(`/_admin/api/mocks/${encodeMockId("gone/GET.endpoint.json")}`);

    expect(response.status).toBe(204);
    expect((await request(app).get("/gone")).status).toBe(404);
  });

  test("il ripristino non si dichiara riuscito se una definizione servita prima non torna servita", async () => {
    const HANDLER_OK = "module.exports = { async resolveResponse() { return { status: 200, jsonBody: { ok: true } }; } };\n";
    await writeHandlerEndpoint({ folder: "kept", routePath: "/kept", source: HANDLER_OK });
    const runtime = await startRuntime();
    // Il sorgente si rompe su disco: il runtime continua a servire la versione già caricata.
    await fs.promises.writeFile(path.join(mocksDir, "kept", "GET.responses", "001.handler.js"), BROKEN_SOURCE);
    expect((await request(app).get("/kept")).status).toBe(200);
    const endpointPath = path.join(mocksDir, "kept", "GET.endpoint.json");
    const backups = [await readBackup(endpointPath)];

    // Il reload intermedio toglie la definizione disabilitata; il ripristino riabilita il file,
    // ma ricaricare il sorgente rotto non ricostruisce la versione servita prima.
    const failure = await commitWithRollback({
      backups,
      reloadRuntime: runtime.reloadRuntime,
      rejectionLabel: "Toggle rejected",
      commit: () => fs.promises.writeFile(endpointPath, JSON.stringify({ ...readEndpoint("kept"), enabled: false })),
      validateReloadResult: () => {
        throw createAdminError(400, "another endpoint was rejected");
      },
      involved: [endpointPath],
      baseDir: mocksDir,
    }).catch((error) => error);

    expect(failure).toMatchObject({
      status: 500,
      details: {
        code: "ROLLBACK_FAILED",
        rollback: "failed",
        recoveryError: "kept/GET.endpoint.json was served before the mutation and is not served after the restore.",
      },
    });
    expect(readEndpoint("kept").enabled).toBe(true);
    expect((await request(app).get("/kept")).status).toBe(404);
  });

  test("un input rifiutato prima di scrivere dichiara che non serve ripristino", async () => {
    await writeMock({ mocksDir, folder: "fine", method: "GET", routePath: "/fine", body: { ok: true } });
    await startRuntime();

    const response = await request(app)
      .put(`/_admin/api/mocks/${encodeMockId("fine/GET.endpoint.json")}/endpoint`)
      .send({ enabled: "sì" });

    expect(response.status).toBe(400);
    expect(response.body.details).toEqual({ code: "MUTATION_REJECTED", rollback: "not_needed" });
  });

  test("anche le validazioni fatte dal router sulle mutazioni seguono il contratto", async () => {
    await startRuntime();

    const server = await request(app).patch("/_admin/api/server").send({ proxyAll: "sì" });
    expect(server.status).toBe(400);
    expect(server.body).toMatchObject({
      error: "Bad Request",
      message: "proxyAll must be a boolean.",
      details: { code: "MUTATION_REJECTED", rollback: "not_needed" },
    });

    const dump = await request(app).patch("/_admin/api/monitoring/dump").send({ threshold: 0 });
    expect(dump.status).toBe(400);
    expect(dump.body.details).toEqual({ code: "MUTATION_REJECTED", rollback: "not_needed" });
  });

  describe("rinomina di un file dati con riscrittura dei riferimenti", () => {
    const HANDLER_READING_ITEMS =
      "module.exports = { async resolveResponse({ data }) { return { status: 200, jsonBody: await data('items') }; } };\n";

    test("riscrive, ricarica e serve l'handler col nuovo nome", async () => {
      await fs.promises.writeFile(path.join(filesDir, "items.json"), JSON.stringify([{ id: 1 }]));
      await writeHandlerEndpoint({ folder: "items", routePath: "/items", source: HANDLER_READING_ITEMS });
      await startRuntime();

      const response = await request(app)
        .patch("/_admin/api/files/items")
        .send({ name: "goods", rewriteReferences: true });

      expect(response.status).toBe(200);
      expect(response.body.referencesRewritten).toBe(1);
      expect((await request(app).get("/items")).body).toEqual([{ id: 1 }]);
    });

    test("se un handler riscritto non si carica, file dati e sorgenti tornano com'erano", async () => {
      await fs.promises.writeFile(path.join(filesDir, "items.json"), JSON.stringify([{ id: 1 }]));
      const brokenReadingItems = "module.exports = { async resolveResponse( { return data('items'); } };\n";
      await writeHandlerEndpoint({ folder: "broken", routePath: "/broken", source: brokenReadingItems });
      await startRuntime();

      const response = await request(app)
        .patch("/_admin/api/files/items")
        .send({ name: "goods", rewriteReferences: true });

      expect(response.status).toBe(400);
      expect(response.body.details).toEqual({ code: "MUTATION_REJECTED", rollback: "restored" });
      expect(fs.existsSync(path.join(filesDir, "items.json"))).toBe(true);
      expect(fs.existsSync(path.join(filesDir, "goods.json"))).toBe(false);
      expect(fs.readFileSync(path.join(mocksDir, "broken", "GET.responses", "001.handler.js"), "utf8"))
        .toBe(brokenReadingItems);
    });
  });

  describe("batch con risultati parziali", () => {
    const SPEC = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/alpha": { get: { responses: { 200: { description: "ok", content: { "application/json": { example: { a: 1 } } } } } } },
        "/beta": { get: { responses: { 200: { description: "ok", content: { "application/json": { example: { b: 1 } } } } } } },
      },
    });

    test("l'import OpenAPI riporta per ogni elemento scrittura ed effetto sul runtime", async () => {
      await writeMock({ mocksDir, folder: "beta", method: "GET", routePath: "/beta", body: { existing: true } });
      await startRuntime();

      const response = await request(app)
        .post("/_admin/api/mocks/import/openapi")
        .set("content-type", "application/json")
        .send(SPEC);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ created: 1, skipped: 1, failed: 0, runtime: { status: "applied", errors: [] } });
      const byPath = Object.fromEntries(response.body.items.map((item) => [item.path, item]));
      expect(byPath["/alpha"]).toMatchObject({ writeOutcome: "created", runtimeOutcome: "applied", error: null });
      expect(byPath["/beta"]).toMatchObject({ writeOutcome: "skipped", runtimeOutcome: "not_applicable" });
      expect((await request(app).get("/alpha")).body).toEqual({ a: 1 });
    });

    test("un runtime già degradato è dichiarato senza annullare gli elementi applicati", async () => {
      await writeHandlerEndpoint({ folder: "broken", routePath: "/broken", source: BROKEN_SOURCE });
      await startRuntime();

      const response = await request(app)
        .post("/_admin/api/mocks/import/openapi")
        .set("content-type", "application/json")
        .send(SPEC);

      expect(response.status).toBe(201);
      expect(response.body.runtime.status).toBe("degraded");
      expect(response.body.runtime.errors).toEqual([
        { filePath: "broken/GET.endpoint.json", message: expect.any(String) },
      ]);
      expect(response.body.items.every((item) => item.runtimeOutcome === "applied")).toBe(true);
    });
  });
});
