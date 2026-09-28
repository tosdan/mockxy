const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createServerRuntime } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir, writeMock } = require("./helpers");

const ID = encodeMockId("items/GET.endpoint.json");
const TOKEN = /^rev-v1:[0-9a-f]{64}$/;
const HANDLER = "module.exports = { async resolveResponse() { return { status: 200, jsonBody: { from: 'handler' } }; } };\n";

// Token di revisione e precondizioni delle bozze (piano agent/API, §7 S4 e §13 C4).
describe("revisioni e precondizioni", () => {
  let workspaceDir;
  let mocksDir;
  let app;
  let runtime;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-revisions-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    await writeMock({ mocksDir, folder: "items", method: "GET", routePath: "/items", body: { v: 1 } });
    await startRuntime();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await removeDir(workspaceDir);
  });

  async function startRuntime() {
    runtime = await createServerRuntime({
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
    app = runtime.app;
  }

  const responsesDir = () => path.join(mocksDir, "items", "GET.responses");
  const readDetail = async () => (await request(app).get(`/_admin/api/mocks/${ID}`)).body;
  const readVariant = async (file) => (await request(app).get(`/_admin/api/mocks/${ID}/responses/${file}`)).body;
  const putVariant = (file, body) => request(app).put(`/_admin/api/mocks/${ID}/responses/${file}`).send(body);
  const putDescription = (body) => request(app).put(`/_admin/api/mocks/${ID}/endpoint`).send(body);
  const lastAttemptId = async () => (await request(app).get("/_admin/api/runtime/status")).body.lastAttempt.id;

  test("il dettaglio e la variante espongono i token della stessa lettura", async () => {
    const detail = await readDetail();

    expect(detail.descriptionRevision).toMatch(TOKEN);
    expect(detail.responseRevision).toMatch(TOKEN);
    expect((await readVariant("001.response.json")).revision).toBe(detail.responseRevision);
  });

  describe("due salvataggi dalla stessa versione", () => {
    test("della variante: uno riesce, l'altro è un conflitto che non scrive né ricarica", async () => {
      const { responseRevision } = await readDetail();

      const first = await putVariant("001.response.json", { body: { v: "primo" }, expectedRevision: responseRevision });
      expect(first.status).toBe(200);
      expect(first.body.updatedResponseRevision).toBe((await readDetail()).responseRevision);
      const attempts = await lastAttemptId();
      const written = await fs.promises.readFile(path.join(responsesDir(), "001.response.json"), "utf8");

      const second = await putVariant("001.response.json", { body: { v: "secondo" }, expectedRevision: responseRevision });

      expect(second.status).toBe(409);
      expect(second.body.details).toEqual({
        code: "REVISION_CONFLICT",
        resource: { kind: "response", endpointId: ID, responseFile: "001.response.json" },
        expectedRevision: responseRevision,
        currentRevision: first.body.updatedResponseRevision,
      });
      expect(await fs.promises.readFile(path.join(responsesDir(), "001.response.json"), "utf8")).toBe(written);
      expect(await lastAttemptId()).toBe(attempts);
    });

    test("della descrizione: uno riesce, l'altro è un conflitto", async () => {
      const { descriptionRevision } = await readDetail();

      expect((await putDescription({ description: "A", expectedRevision: descriptionRevision })).status).toBe(200);
      const second = await putDescription({ description: "B", expectedRevision: descriptionRevision });

      expect(second.status).toBe(409);
      expect(second.body.details).toMatchObject({ code: "REVISION_CONFLICT", resource: { kind: "description", endpointId: ID } });
      expect((await readDetail()).endpoint.description).toBe("A");
    });
  });

  test("varianti diverse non confliggono", async () => {
    await request(app).post(`/_admin/api/mocks/${ID}/responses`).send({ type: "mock", title: "Due", status: 200, body: { v: 2 }, select: false });
    const first = (await readVariant("001.response.json")).revision;
    const second = (await readVariant("002.response.json")).revision;

    expect((await putVariant("001.response.json", { body: { v: "uno" }, expectedRevision: first })).status).toBe(200);
    expect((await putVariant("002.response.json", { body: { v: "due" }, expectedRevision: second })).status).toBe(200);
  });

  test("la revisione della descrizione non cambia con un toggle, e il salvataggio protetto non tocca enabled", async () => {
    const { descriptionRevision } = await readDetail();
    await putDescription({ enabled: false });

    const saved = await putDescription({ description: "nuova", expectedRevision: descriptionRevision });

    expect(saved.status).toBe(200);
    expect(saved.body.endpoint).toMatchObject({ description: "nuova", enabled: false });
    const mixed = await putDescription({ description: "x", enabled: true, expectedRevision: saved.body.descriptionRevision });
    expect(mixed.status).toBe(400);
  });

  test("il token resta uguale dopo un riavvio a contenuto invariato", async () => {
    const before = await readDetail();

    await startRuntime();
    const after = await readDetail();

    expect(after.descriptionRevision).toBe(before.descriptionRevision);
    expect(after.responseRevision).toBe(before.responseRevision);
  });

  test("un contenuto diverso di pari lunghezza e mtime conservato cambia il token e fa fallire il salvataggio", async () => {
    const variantPath = path.join(responsesDir(), "001.response.json");
    const tick = new Date(Math.floor(Date.now() / 1000) * 1000);
    await fs.promises.utimes(variantPath, tick, tick);
    const { responseRevision } = await readDetail();

    const original = await fs.promises.readFile(variantPath, "utf8");
    await fs.promises.writeFile(variantPath, original.replace(/("v":\s*)1/, "$19"));
    await fs.promises.utimes(variantPath, tick, tick);

    expect((await readDetail()).responseRevision).not.toBe(responseRevision);
    expect((await putVariant("001.response.json", { body: { v: 3 }, expectedRevision: responseRevision })).status).toBe(409);
  });

  test("l'indentazione non conta; tornare allo stesso contenuto torna allo stesso token", async () => {
    const variantPath = path.join(responsesDir(), "001.response.json");
    const { responseRevision } = await readDetail();
    const definition = JSON.parse(await fs.promises.readFile(variantPath, "utf8"));

    await fs.promises.writeFile(variantPath, JSON.stringify(definition));
    expect((await readDetail()).responseRevision).toBe(responseRevision);

    await putVariant("001.response.json", { body: { v: 2 } });
    expect((await readDetail()).responseRevision).not.toBe(responseRevision);
    await putVariant("001.response.json", { body: { v: 1 } });
    expect((await readDetail()).responseRevision).toBe(responseRevision);
  });

  test("il token copre i byte del sorgente e dell'asset diretti", async () => {
    await request(app).post(`/_admin/api/mocks/${ID}/responses`).send({ type: "handler", title: "Handler", source: HANDLER });
    const withHandler = await readDetail();
    await fs.promises.writeFile(path.join(responsesDir(), withHandler.response.sourceFile), HANDLER.replace("handler", "altro"));
    expect((await readDetail()).responseRevision).not.toBe(withHandler.responseRevision);

    await request(app).put(`/_admin/api/mocks/${ID}`).send({ selectedResponseFile: "001.response.json" });
    await request(app)
      .put(`/_admin/api/mocks/${ID}/responses/001.response.json/file?contentType=image/png&filename=logo.png`)
      .set("content-type", "application/octet-stream")
      .send(Buffer.from([1, 2, 3]));
    const withAsset = await readDetail();
    await fs.promises.writeFile(path.join(responsesDir(), withAsset.fileInfo.name), Buffer.from([1, 2, 4]));
    expect((await readDetail()).responseRevision).not.toBe(withAsset.responseRevision);
  });

  describe("upload raw", () => {
    const upload = (headers) => {
      const call = request(app)
        .put(`/_admin/api/mocks/${ID}/responses/001.response.json/file?contentType=application/octet-stream&filename=blob.bin`)
        .set("content-type", "application/octet-stream");
      for (const [name, value] of Object.entries(headers)) {
        call.set(name, value);
      }
      return call.send(Buffer.from("dati"));
    };

    test("rispetta X-Mockxy-Expected-Revision", async () => {
      const { responseRevision } = await readDetail();

      const ok = await upload({ "X-Mockxy-Expected-Revision": responseRevision });
      expect(ok.status).toBe(200);
      expect(ok.body.updatedResponseRevision).toMatch(TOKEN);

      const stale = await upload({ "X-Mockxy-Expected-Revision": responseRevision });
      expect(stale.status).toBe(409);
      expect(stale.body.details.code).toBe("REVISION_CONFLICT");

      const malformed = await upload({ "X-Mockxy-Expected-Revision": "abc" });
      expect(malformed.status).toBe(400);
    });
  });

  describe("PUT /mocks/:id legacy", () => {
    const legacyUpdate = (extra = {}) =>
      request(app).put(`/_admin/api/mocks/${ID}`).send({
        config: { method: "GET", path: "/items", status: 200, disabled: false, headers: {}, delayMs: 0 },
        body: { v: "legacy" },
        ...extra,
      });

    test("protegge la variante selezionata: il token incorpora il filename", async () => {
      const { responseRevision } = await readDetail();
      await request(app).post(`/_admin/api/mocks/${ID}/responses`).send({ title: "Clone" });

      const otherSelection = await legacyUpdate({ expectedRevision: responseRevision });
      expect(otherSelection.status).toBe(409);

      await request(app).put(`/_admin/api/mocks/${ID}`).send({ selectedResponseFile: "001.response.json" });
      expect((await legacyUpdate({ expectedRevision: responseRevision })).status).toBe(200);
    });

    test("rifiuta un payload protetto che cambia enabled o la selezione", async () => {
      const { responseRevision } = await readDetail();

      const changesEnabled = await request(app).put(`/_admin/api/mocks/${ID}`).send({
        config: { method: "GET", path: "/items", status: 200, disabled: true, headers: {}, delayMs: 0 },
        body: {},
        expectedRevision: responseRevision,
      });
      expect(changesEnabled.status).toBe(400);

      const selection = await request(app).put(`/_admin/api/mocks/${ID}`).send({ selectedResponseFile: "001.response.json", expectedRevision: responseRevision });
      expect(selection.status).toBe(400);
    });
  });

  test("precondizione malformata 400, risorsa eliminata 404, precondizione assente come prima", async () => {
    expect((await putVariant("001.response.json", { body: {}, expectedRevision: "rev-v1:abc" })).status).toBe(400);
    expect((await putVariant("009.response.json", { body: {}, expectedRevision: `rev-v1:${"0".repeat(64)}` })).status).toBe(404);
    expect((await putVariant("001.response.json", { body: { v: "senza" } })).status).toBe(200);
  });

  test("nessun falso successo da un token calcolato su dati diversi da quelli letti", async () => {
    await request(app).post(`/_admin/api/mocks/${ID}/responses`).send({ type: "handler", title: "Handler", source: HANDLER });
    const sourcePath = path.join(responsesDir(), "002.handler.js");
    // Il sorgente cambia subito dopo che il dettaglio lo ha letto: la risposta e il token
    // descrivono la versione letta, non quella corrente.
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let intercepted = false;
    jest.spyOn(fs.promises, "readFile").mockImplementation(async (filePath, ...rest) => {
      const content = await realReadFile(filePath, ...rest);
      if (filePath === sourcePath && !intercepted) {
        intercepted = true;
        await fs.promises.writeFile(sourcePath, HANDLER.replace("handler", "concorrente"));
      }
      return content;
    });
    const detail = await readDetail();
    jest.restoreAllMocks();

    expect(detail.source).toBe(HANDLER);
    const save = await putVariant("002.response.json", { title: "Rinominato", expectedRevision: detail.responseRevision });
    expect(save.status).toBe(409);
  });
});
