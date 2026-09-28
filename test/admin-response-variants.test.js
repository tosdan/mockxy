const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createServerRuntime } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir, writeMock } = require("./helpers");

const ID = encodeMockId("items/GET.endpoint.json");
const BROKEN_SOURCE = "module.exports = { async resolveResponse( { return 1; } };\n";

// Varianti inattive: lettura per filename e preparazione senza attivazione (piano agent/API,
// §6 S3 e §13 C3).
describe("varianti inattive", () => {
  let workspaceDir;
  let mocksDir;
  let app;
  let runtime;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-response-variants-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    await writeMock({ mocksDir, folder: "items", method: "GET", routePath: "/items", body: { step: 1 } });
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
    app = runtime.app;
  });

  afterEach(async () => {
    await removeDir(workspaceDir);
  });

  const responsesDir = () => path.join(mocksDir, "items", "GET.responses");
  const readDetail = async () => (await request(app).get(`/_admin/api/mocks/${ID}`)).body;
  const readVariant = (file) => request(app).get(`/_admin/api/mocks/${ID}/responses/${file}`);
  const served = async () => (await request(app).get("/items")).body;
  const create = (payload) => request(app).post(`/_admin/api/mocks/${ID}/responses`).send(payload);

  // 001 (step 1) e 002 (step 2) più la sequence 003 selezionata, che serve 001 una volta e poi 002.
  async function selectSequence() {
    expect((await create({ type: "mock", title: "Step 2", status: 200, body: { step: 2 } })).status).toBe(201);
    const sequence = await create({
      type: "sequence",
      title: "Scenario",
      onEnd: "stay",
      steps: [{ response: "001.response.json", times: 1 }, { response: "002.response.json" }],
    });
    expect(sequence.status).toBe(201);
    expect(sequence.body.selectedResponseFile).toBe("003.response.json");
  }

  describe("GET /mocks/:id/responses/:file", () => {
    test("legge una variante inattiva senza cambiare selezione né risposta servita", async () => {
      expect((await create({ type: "mock", title: "Vuota", status: 404, body: [], select: false })).status).toBe(201);

      const response = await readVariant("002.response.json");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: ID,
        responseFile: "002.response.json",
        selected: false,
        active: false,
        response: expect.objectContaining({ type: "mock", title: "Vuota", status: 404, body: [] }),
        source: null,
        fileInfo: null,
        revision: expect.stringMatching(/^rev-v1:[0-9a-f]{64}$/),
      });
      expect((await readDetail()).selectedResponseFile).toBe("001.response.json");
      expect(await served()).toEqual({ step: 1 });
    });

    test("uno step della sequence selezionata è attivo, pur non essendo selezionato", async () => {
      await selectSequence();

      expect((await readVariant("001.response.json")).body).toMatchObject({ selected: false, active: true });
      expect((await readVariant("003.response.json")).body).toMatchObject({ selected: true, active: true });
    });

    test("con la selezione illeggibile l'errore resta esplicito, invece di un active falso", async () => {
      await selectSequence();
      expect(await served()).toEqual({ step: 1 });
      await fs.promises.writeFile(path.join(responsesDir(), "003.response.json"), "{ json invalido");

      const response = await readVariant("001.response.json");

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("Invalid JSON");
      // Il runtime serve ancora la sequence caricata in precedenza.
      expect(await served()).toEqual({ step: 2 });
    });

    test("riporta il sorgente di un handler e i metadati di un asset, mai il contenuto binario", async () => {
      await create({ type: "handler", title: "Handler", select: false });
      await fs.promises.writeFile(path.join(responsesDir(), "003.file.png"), Buffer.from([1, 2, 3, 4]));
      await fs.promises.writeFile(path.join(responsesDir(), "003.response.json"), JSON.stringify({ type: "mock", title: "Logo", status: 200, headers: {}, delayMs: 0, file: "003.file.png" }));
      const endpointPath = path.join(mocksDir, "items", "GET.endpoint.json");
      const endpoint = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
      await fs.promises.writeFile(endpointPath, JSON.stringify({ ...endpoint, responseFiles: [...endpoint.responseFiles, "003.response.json"] }));

      const handler = (await readVariant("002.response.json")).body;
      expect(handler.source).toContain("resolveResponse");
      expect(handler.fileInfo).toBeNull();

      const asset = (await readVariant("003.response.json")).body;
      expect(asset.fileInfo).toEqual({ name: "003.file.png", size: 4 });
      expect(asset.source).toBeNull();
      expect(asset.response).not.toHaveProperty("body");
    });

    test("variante non elencata, endpoint assente, JSON invalido, file mancante", async () => {
      await fs.promises.writeFile(path.join(responsesDir(), "009.response.json"), "{}");
      expect((await readVariant("009.response.json")).status).toBe(404);
      expect((await request(app).get(`/_admin/api/mocks/${encodeMockId("nope/GET.endpoint.json")}/responses/001.response.json`)).status).toBe(404);

      await create({ type: "mock", title: "Rotta", status: 200, body: {}, select: false });
      await fs.promises.writeFile(path.join(responsesDir(), "002.response.json"), "{ json invalido");
      const invalid = await readVariant("002.response.json");
      expect(invalid.status).toBe(400);
      expect(invalid.body.message).toContain("Invalid JSON");

      await fs.promises.rm(path.join(responsesDir(), "002.response.json"));
      const missing = await readVariant("002.response.json");
      expect(missing.status).toBe(409);
      expect(missing.body.details).toEqual({ code: "READ_INCONSISTENT", retryable: true });
    });

    test("una variante tolta dall'elenco durante la lettura è un 404, non un dettaglio parziale", async () => {
      await create({ type: "mock", title: "Transitoria", status: 200, body: {}, select: false });
      const endpointPath = path.join(mocksDir, "items", "GET.endpoint.json");
      const realReadFile = fs.promises.readFile.bind(fs.promises);
      let definitionReads = 0;
      const spy = jest.spyOn(fs.promises, "readFile").mockImplementation(async (filePath, ...rest) => {
        const content = await realReadFile(filePath, ...rest);
        if (filePath === endpointPath && ++definitionReads === 1) {
          const endpoint = JSON.parse(content.toString());
          await fs.promises.writeFile(endpointPath, JSON.stringify({ ...endpoint, responseFiles: ["001.response.json"] }));
          await fs.promises.rm(path.join(responsesDir(), "002.response.json"));
        }
        return content;
      });
      try {
        const response = await readVariant("002.response.json");
        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Response file not found in endpoint.responseFiles.");
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("POST /mocks/:id/responses con select", () => {
    test("select false prepara la variante senza cambiare risposta, selezione né cursore della sequence", async () => {
      await selectSequence();
      expect(await served()).toEqual({ step: 1 });

      const response = await create({ type: "mock", title: "Preparata", status: 500, body: { step: "nuovo" }, select: false });

      expect(response.status).toBe(201);
      expect(response.body.createdResponseFile).toBe("004.response.json");
      expect(response.body.selectedResponseFile).toBe("003.response.json");
      // Il cursore non riparte: la sequence prosegue col secondo step.
      expect(await served()).toEqual({ step: 2 });
      expect((await readVariant("004.response.json")).body).toMatchObject({ selected: false, active: false });
    });

    test("senza select la variante creata viene selezionata, come prima", async () => {
      const response = await create({ type: "mock", title: "Nuova", status: 201, body: { created: true } });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ createdResponseFile: "002.response.json", selectedResponseFile: "002.response.json" });
      expect(await served()).toEqual({ created: true });
    });

    test.each([
      ["un handler che non compila", { type: "handler", title: "Rotto", source: BROKEN_SOURCE }],
      ["una sequence con uno step inesistente", { type: "sequence", title: "Rotta", steps: [{ response: "001.response.json", times: 1 }, { response: "099.response.json" }] }],
      ["uno script SSE invalido", { type: "sse", title: "Rotto", script: [{ afterMs: -1, data: "x" }] }],
    ])("rifiuta %s anche se non viene attivato", async (_label, payload) => {
      const before = await readDetail();

      const response = await create({ ...payload, select: false });

      expect(response.status).toBe(400);
      const after = await readDetail();
      expect(after.endpoint.responseFiles).toEqual(before.endpoint.responseFiles);
      expect(fs.existsSync(path.join(responsesDir(), "002.response.json"))).toBe(false);
      expect(await served()).toEqual({ step: 1 });
    });

    test("select dev'essere un booleano", async () => {
      const response = await create({ type: "mock", title: "X", select: "no" });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe("select must be a boolean.");
    });
  });

  describe("aggiornamento per filename", () => {
    test("riporta la variante aggiornata e non cambia la selezione", async () => {
      await create({ type: "mock", title: "Inattiva", status: 200, body: { v: 1 }, select: false });

      const response = await request(app)
        .put(`/_admin/api/mocks/${ID}/responses/002.response.json`)
        .send({ body: { v: 2 } });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ updatedResponseFile: "002.response.json", selectedResponseFile: "001.response.json" });
      expect(await served()).toEqual({ step: 1 });
    });

    test("aggiornare una variante inattiva che referenzia un asset assente è rifiutato e ripristinato", async () => {
      await create({ type: "mock", title: "Da file", status: 200, body: {}, select: false });
      const variantPath = path.join(responsesDir(), "002.response.json");
      const broken = JSON.stringify({ type: "mock", title: "Da file", status: 200, headers: {}, delayMs: 0, file: "missing.bin" });
      await fs.promises.writeFile(variantPath, broken);

      const response = await request(app)
        .put(`/_admin/api/mocks/${ID}/responses/002.response.json`)
        .send({ title: "Rinominata" });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: "Response asset file not found: missing.bin.",
        details: { code: "MUTATION_REJECTED", rollback: "restored" },
      });
      expect(await fs.promises.readFile(variantPath, "utf8")).toBe(broken);
      expect(await served()).toEqual({ step: 1 });
    });

    test("modificare una variante usata da uno step attivo cambia lo scenario; prepararne una separata no", async () => {
      await selectSequence();
      expect(await served()).toEqual({ step: 1 });
      expect((await readVariant("002.response.json")).body.active).toBe(true);

      // Preparazione separata: lo scenario in corso resta quello di prima.
      await create({ type: "mock", title: "Step 2 rivisto", status: 200, body: { step: "2 rivisto" }, select: false });
      expect(await served()).toEqual({ step: 2 });

      // Modifica dello step attivo: il cursore resta, ma lo scenario serve il contenuto nuovo.
      await request(app).put(`/_admin/api/mocks/${ID}/responses/002.response.json`).send({ body: { step: "2 modificato" } });
      expect(await served()).toEqual({ step: "2 modificato" });
    });
  });
});
