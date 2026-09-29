const fs = require("fs");
const path = require("path");
const request = require("supertest");
const yaml = require("js-yaml");
const Ajv2020 = require("ajv/dist/2020");
const { createServerRuntime } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir, writeMock } = require("./helpers");

const SPEC = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "..", "src", "admin", "admin-api.openapi.yaml"), "utf8"));

// Lo schema dichiarato per la risposta 201 di una rotta, per validare le risposte reali.
function responseValidator(routePath) {
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  // I riferimenti `#/components/...` dello schema in linea si risolvono sulla sua radice.
  return ajv.compile({ ...SPEC.paths[routePath].post.responses["201"].content["application/json"].schema, components: SPEC.components });
}

// Creazione di mock dal traffico (piano agent/API, §10 S7 e §13 C7), col runtime reale.
describe("POST /monitoring/requests/create-mocks e Storico", () => {
  let workspaceDir;
  let mocksDir;
  let dumpDir;
  let runtime;
  let app;
  let runtimeId;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-create-mocks-");
    mocksDir = path.join(workspaceDir, "mocks");
    dumpDir = path.join(workspaceDir, "dump");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    await fs.promises.mkdir(dumpDir, { recursive: true });
    await writeMock({ mocksDir, folder: "items", method: "GET", routePath: "/items", body: { v: 1 } });
    runtime = await createServerRuntime({
      configOverrides: {
        host: "127.0.0.1",
        mocksDir,
        filesDir: path.join(workspaceDir, "files"),
        monitorDumpDir: dumpDir,
        devWatch: false,
        adminApiEnabled: true,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });
    app = runtime.app;
    runtimeId = (await request(app).get("/_admin/api/info")).body.runtimeId;
  });

  afterEach(async () => {
    await removeDir(workspaceDir);
  });

  // Una risposta catturata come la registra il Monitor, senza dover servire davvero quel traffico.
  function capture({ method = "GET", path: requestPath, matchedRoutePath, status = 200, headers = { "content-type": "application/json" }, body = "{}", truncated = false }) {
    const bodyBuffer = Buffer.from(body);
    return runtime.requestMonitor.recordRequest({
      req: { method, path: requestPath, originalUrl: requestPath, headers: {}, _matchedRoutePath: matchedRoutePath },
      res: { statusCode: status, getHeaders: () => headers },
      startedAt: Date.parse("2026-09-29T10:11:12.000Z"),
      completedAt: Date.parse("2026-09-29T10:11:12.003Z"),
      source: "backend",
      responseCapture: { snapshot: () => ({ bodyBuffer, totalBytes: bodyBuffer.length, truncated }) },
    }).id;
  }

  const validateMonitorResult = responseValidator("/monitoring/requests/create-mocks");
  const validateDumpResult = responseValidator("/monitoring/dumps/create-mocks");
  function expectConforming(validate, body) {
    expect(validate(body) ? [] : validate.errors).toEqual([]);
  }
  // Ogni risposta 201 del Monitor si confronta con lo schema dichiarato.
  const createMocks = async (body) => {
    const res = await request(app).post("/_admin/api/monitoring/requests/create-mocks").send({ runtimeId, ...body });
    if (res.status === 201) expectConforming(validateMonitorResult, res.body);
    return res;
  };
  const detailOf = async (id) => (await request(app).get(`/_admin/api/mocks/${id}`)).body;

  test("una cattura valida crea un endpoint che serve quella risposta", async () => {
    const id = capture({ path: "/orders", body: '{"orders":[{"id":"o-1"}]}' });

    const res = await createMocks({ ids: [id], onConflict: "skip", newEndpointEnabled: true });
    expect(res.status).toBe(201);
    expect(res.body.runtimeId).toBe(runtimeId);
    expect(res.body.items).toEqual([expect.objectContaining({
      requestId: id,
      method: "GET",
      path: "/orders",
      id: encodeMockId("orders/GET.endpoint.json"),
      responseFile: "001.response.json",
      writeOutcome: "created",
      runtimeOutcome: "applied",
      captureOutcome: "complete",
      warnings: [],
      error: null,
    })]);
    expect(res.body.counts).toEqual({ created: 1, addedVariants: 0, skipped: 0, unavailable: 0, failed: 0, incomplete: 0 });
    expect(res.body.runtime.status).toBe("applied");

    const served = await request(app).get("/orders");
    expect(served.status).toBe(200);
    expect(served.body).toEqual({ orders: [{ id: "o-1" }] });
  });

  test("con newEndpointEnabled false l'endpoint nasce preparato, non servito", async () => {
    const id = capture({ path: "/prepared", body: '{"ok":true}' });

    const res = await createMocks({ ids: [id], onConflict: "skip", newEndpointEnabled: false });
    expect(res.body.items[0]).toMatchObject({ writeOutcome: "created", runtimeOutcome: "not_applicable" });
    expect((await detailOf(res.body.items[0].id)).disabled).toBe(true);
    expect((await request(app).get("/prepared")).status).toBe(404);
  });

  test("endpoint esistente: skip lo salta, add-variant aggiunge senza cambiare la selezione salvo richiesta", async () => {
    const itemsId = encodeMockId("items/GET.endpoint.json");
    const id = capture({ path: "/items", matchedRoutePath: "/items", body: '{"v":"captured"}' });

    const skipped = await createMocks({ ids: [id], onConflict: "skip", newEndpointEnabled: true });
    expect(skipped.body.items[0]).toMatchObject({ id: itemsId, writeOutcome: "skipped", runtimeOutcome: "not_applicable", captureOutcome: "complete" });

    const prepared = await createMocks({ ids: [id], onConflict: "add-variant", newEndpointEnabled: true });
    expect(prepared.body.items[0]).toMatchObject({ id: itemsId, responseFile: "002.response.json", writeOutcome: "variant_added", runtimeOutcome: "not_applicable" });
    const detail = await detailOf(itemsId);
    expect(detail.selectedResponseFile).toBe("001.response.json");
    expect(detail.responses.find((variant) => variant.fileName === "002.response.json").title).toBe("monitor · 10:11:12");
    expect((await request(app).get("/items")).body).toEqual({ v: 1 });

    const activated = await createMocks({ ids: [id], onConflict: "add-variant", selectAddedVariants: true, newEndpointEnabled: true });
    expect(activated.body.items[0]).toMatchObject({ responseFile: "003.response.json", writeOutcome: "variant_added", runtimeOutcome: "applied" });
    expect((await request(app).get("/items")).body).toEqual({ v: "captured" });
  });

  test("la variante catturata non eredita il templating della variante selezionata", async () => {
    const itemsId = encodeMockId("items/GET.endpoint.json");
    const templated = await request(app).put(`/_admin/api/mocks/${itemsId}/responses/001.response.json`).send({ type: "mock", templated: true });
    expect(templated.status).toBe(200);
    const id = capture({ path: "/items", matchedRoutePath: "/items", body: '{"text":"{{params.id}}"}' });

    const res = await createMocks({ ids: [id], onConflict: "add-variant", newEndpointEnabled: true });
    const variant = (await request(app).get(`/_admin/api/mocks/${itemsId}/responses/${res.body.items[0].responseFile}`)).body;
    expect(variant.response.templated).not.toBe(true);
    expect(variant.response.body).toEqual({ text: "{{params.id}}" });
  });

  test("più catture sullo stesso endpoint nello stesso batch: la seconda vede quello appena creato", async () => {
    const first = capture({ path: "/multi", body: '{"n":1}' });
    const second = capture({ path: "/multi", body: '{"n":2}' });

    const res = await createMocks({ ids: [first, second], onConflict: "add-variant", newEndpointEnabled: true });
    const [created, added] = res.body.items;
    expect(created).toMatchObject({ requestId: first, writeOutcome: "created", responseFile: "001.response.json" });
    expect(added).toMatchObject({ requestId: second, writeOutcome: "variant_added", id: created.id, responseFile: "002.response.json" });
    expect((await request(app).get("/multi")).body).toEqual({ n: 1 });
  });

  // Codex, #35: nello stesso batch resta servita solo l'ultima variante selezionata.
  test("selezioni superate da un elemento successivo dello stesso batch non risultano applicate", async () => {
    const itemsId = encodeMockId("items/GET.endpoint.json");
    const first = capture({ path: "/items", matchedRoutePath: "/items", body: '{"v":"a"}' });
    const second = capture({ path: "/items", matchedRoutePath: "/items", body: '{"v":"b"}' });
    const created = capture({ path: "/fresh", body: '{"v":1}' });
    const selected = capture({ path: "/fresh", body: '{"v":2}' });

    const res = await createMocks({ ids: [first, second, created, selected], onConflict: "add-variant", selectAddedVariants: true, newEndpointEnabled: true });
    const [a, b, c, d] = res.body.items;
    expect(a).toMatchObject({ id: itemsId, responseFile: "002.response.json", runtimeOutcome: "not_applicable", warnings: [{ code: "SUPERSEDED", by: "003.response.json" }] });
    expect(b).toMatchObject({ id: itemsId, responseFile: "003.response.json", runtimeOutcome: "applied", warnings: [] });
    expect(c).toMatchObject({ writeOutcome: "created", responseFile: "001.response.json", runtimeOutcome: "not_applicable", warnings: [{ code: "SUPERSEDED", by: "002.response.json" }] });
    expect(d).toMatchObject({ writeOutcome: "variant_added", responseFile: "002.response.json", runtimeOutcome: "applied" });
    expect((await request(app).get("/items")).body).toEqual({ v: "b" });
    expect((await request(app).get("/fresh")).body).toEqual({ v: 2 });
  });

  test("una cattura assente o cancellata è saltata come non disponibile, le altre proseguono", async () => {
    const cleared = capture({ path: "/gone", body: "{}" });
    await request(app).delete("/_admin/api/monitoring/requests");
    const kept = capture({ path: "/kept", body: '{"kept":true}' });

    const res = await createMocks({ ids: ["999", cleared, kept], onConflict: "skip", newEndpointEnabled: true });
    expect(res.status).toBe(201);
    expect(res.body.items.map((item) => [item.requestId, item.writeOutcome, item.captureOutcome])).toEqual([
      ["999", "skipped", "unavailable"],
      [cleared, "skipped", "unavailable"],
      [kept, "created", "complete"],
    ]);
    expect(res.body.counts).toMatchObject({ created: 1, unavailable: 2 });
  });

  test("un body binario o troncato diventa una bozza incompleta dichiarata, e i flag valgono comunque", async () => {
    const binary = capture({ path: "/logo", headers: { "content-type": "image/png" }, body: "\u0089PNG" });
    const truncated = capture({ path: "/items", matchedRoutePath: "/items", body: '{"items":[1,2', truncated: true });

    const res = await createMocks({ ids: [binary, truncated], onConflict: "add-variant", selectAddedVariants: false, newEndpointEnabled: true });
    const [created, added] = res.body.items;
    expect(created).toMatchObject({ writeOutcome: "created", runtimeOutcome: "applied", captureOutcome: "incomplete", warnings: [{ code: "INCOMPLETE_CAPTURE", reason: "binary" }] });
    const logo = await detailOf(created.id);
    expect(logo.endpoint.description).toMatch(/^\[da completare\]/);
    expect(logo.body).toEqual({});
    expect(logo.config.headers).toEqual({ "content-type": "image/png" });

    expect(added).toMatchObject({ writeOutcome: "variant_added", captureOutcome: "incomplete", warnings: [{ code: "INCOMPLETE_CAPTURE", reason: "truncated" }] });
    const items = await detailOf(added.id);
    expect(items.selectedResponseFile).toBe("001.response.json");
    expect(items.responses.find((variant) => variant.fileName === added.responseFile).title).toBe("[da completare] monitor · 10:11:12");
    expect(res.body.counts.incomplete).toBe(2);
  });

  // Codex, #35: un body JSON null si conserva, non diventa {}.
  test("una risposta JSON null diventa un mock che serve null", async () => {
    const id = capture({ path: "/nothing", body: "null" });
    const res = await createMocks({ ids: [id], onConflict: "skip", newEndpointEnabled: true });
    expect(res.body.items[0]).toMatchObject({ writeOutcome: "created", captureOutcome: "complete" });
    const served = await request(app).get("/nothing");
    expect(served.status).toBe(200);
    expect(served.text).toBe("null");
  });

  test("gli header mascherati o di trasporto non finiscono nel mock", async () => {
    const id = capture({
      path: "/secret",
      headers: { "content-type": "application/json", "set-cookie": ["***", "***"], "x-api-key": "***", "content-length": "11", "x-trace": ["a", "b"] },
      body: '{"ok":true}',
    });

    const res = await createMocks({ ids: [id], onConflict: "skip", newEndpointEnabled: true });
    expect((await detailOf(res.body.items[0].id)).config.headers).toEqual({ "content-type": "application/json", "x-trace": "a, b" });
  });

  test("destinazioni ambigue e collisioni di cartella falliscono per elemento; il resto del batch prosegue", async () => {
    await writeMock({ mocksDir, folder: "dup-a", method: "GET", routePath: "/dup", body: {} });
    await writeMock({ mocksDir, folder: "dup-b", method: "GET", routePath: "/dup", body: {} });
    await writeMock({ mocksDir, folder: "coll", method: "GET", routePath: "/other", body: {} });
    const ambiguous = capture({ path: "/dup", body: "{}" });
    const collision = capture({ path: "/coll", body: "{}" });
    const fine = capture({ path: "/fine", body: "{}" });

    const res = await createMocks({ ids: [ambiguous, collision, fine], onConflict: "add-variant", newEndpointEnabled: true });
    expect(res.status).toBe(201);
    const [first, second, third] = res.body.items;
    expect(first).toMatchObject({ writeOutcome: "failed", candidates: expect.arrayContaining([encodeMockId("dup-a/GET.endpoint.json"), encodeMockId("dup-b/GET.endpoint.json")]) });
    expect(first.error).toMatch(/ambiguous/);
    expect(second).toMatchObject({ writeOutcome: "failed", id: encodeMockId("coll/GET.endpoint.json") });
    expect(second.error).toMatch(/does not serve GET \/coll/);
    expect(third).toMatchObject({ writeOutcome: "created", runtimeOutcome: "applied" });
  });

  test("un runtime diverso è un 409 prima di scrivere", async () => {
    const id = capture({ path: "/late", body: "{}" });
    const res = await request(app).post("/_admin/api/monitoring/requests/create-mocks").send({ runtimeId: "altro", ids: [id], onConflict: "skip", newEndpointEnabled: true });
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual({ code: "RUNTIME_CHANGED", runtimeId });
    expect(fs.existsSync(path.join(mocksDir, "late"))).toBe(false);
  });

  test.each([
    [{ onConflict: "skip" }, /newEndpointEnabled/],
    [{ newEndpointEnabled: true }, /onConflict/],
    [{ onConflict: "overwrite", newEndpointEnabled: true }, /onConflict/],
    [{ onConflict: "skip", newEndpointEnabled: "yes" }, /newEndpointEnabled/],
    [{ onConflict: "skip", newEndpointEnabled: true, selectAddedVariants: 1 }, /selectAddedVariants/],
    [{ onConflict: "skip", newEndpointEnabled: true, ids: [] }, /ids/],
    [{ onConflict: "skip", newEndpointEnabled: true, ids: ["1", "1"] }, /ids/],
    [{ onConflict: "skip", newEndpointEnabled: true, ids: ["uno"] }, /ids/],
    [{ onConflict: "skip", newEndpointEnabled: true, ids: Array.from({ length: 251 }, (_, i) => String(i + 1)) }, /ids/],
    [{ onConflict: "skip", newEndpointEnabled: true, force: true }, /Unknown field: force/],
    // Codex, #35: un campo presente ma null non vale come omesso.
    [{ onConflict: null, newEndpointEnabled: true }, /onConflict/],
    [{ onConflict: "skip", newEndpointEnabled: null }, /newEndpointEnabled/],
    [{ onConflict: "skip", newEndpointEnabled: true, selectAddedVariants: null }, /selectAddedVariants/],
  ])("richiesta non valida %#: 400 senza scrivere", async (body, message) => {
    const res = await request(app).post("/_admin/api/monitoring/requests/create-mocks").send({ runtimeId, ids: ["1"], ...body });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
    expect(res.body.details).toMatchObject({ code: "MUTATION_REJECTED", rollback: "not_needed" });
  });

  test("runtimeId è obbligatorio", async () => {
    const res = await request(app).post("/_admin/api/monitoring/requests/create-mocks").send({ ids: ["1"], onConflict: "skip", newEndpointEnabled: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/runtimeId/);
  });

  describe("Storico: stessa trasformazione ed esiti, input e conteggi storici", () => {
    function writeDump(name, entries) {
      fs.writeFileSync(path.join(dumpDir, name), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
    }
    const entry = (overrides) => ({
      id: "1",
      timestamp: "2026-09-29T08:00:00.000Z",
      method: "GET",
      status: 200,
      responseHeaders: { "content-type": "application/json", "x-api-key": "***" },
      responseBody: '{"from":"dump"}',
      responseBodyTruncated: false,
      ...overrides,
    });

    test("un'opzione presente ma null è un 400, non il default storico", async () => {
      writeDump("dump-2.ndjson", [entry({ path: "/never" })]);
      for (const options of [{ newEndpointEnabled: null }, { onConflict: null }, { selectAddedVariants: null }]) {
        const res = await request(app).post("/_admin/api/monitoring/dumps/create-mocks").send({ file: "dump-2.ndjson", ...options });
        expect(res.status).toBe(400);
      }
      expect(fs.existsSync(path.join(mocksDir, "never"))).toBe(false);
    });

    test("senza opzioni resta il comportamento storico; con add-variant conta addedVariants", async () => {
      writeDump("dump-1.ndjson", [
        entry({ path: "/from-dump" }),
        entry({ path: "/items", matchedRoutePath: "/items" }),
        entry({ path: "/binary", responseBody: "[binary payload: 10 bytes]" }),
      ]);

      const legacy = await request(app).post("/_admin/api/monitoring/dumps/create-mocks").send({ file: "dump-1.ndjson" });
      expect(legacy.status).toBe(201);
      expectConforming(validateDumpResult, legacy.body);
      expect(legacy.body).toMatchObject({ created: 1, createdEmpty: 1, skippedExisting: 1, failed: 0, addedVariants: 0 });
      expect(legacy.body.items.map((item) => [item.key, item.writeOutcome, item.captureOutcome])).toEqual([
        ["dump-1.ndjson#0", "created", "complete"],
        ["dump-1.ndjson#1", "skipped", "complete"],
        ["dump-1.ndjson#2", "created", "incomplete"],
      ]);
      expect((await detailOf(legacy.body.items[0].id)).config.headers).toEqual({ "content-type": "application/json" });

      const added = await request(app).post("/_admin/api/monitoring/dumps/create-mocks").send({
        keys: ["dump-1.ndjson#1", "dump-1.ndjson#9", "dump-1.ndjson#1"],
        onConflict: "add-variant",
        selectAddedVariants: false,
        newEndpointEnabled: true,
      });
      expectConforming(validateDumpResult, added.body);
      expect(added.body).toMatchObject({ created: 0, skippedExisting: 0, addedVariants: 1 });
      expect(added.body.items.map((item) => [item.key, item.writeOutcome, item.captureOutcome])).toEqual([
        ["dump-1.ndjson#1", "variant_added", "complete"],
        ["dump-1.ndjson#9", "skipped", "unavailable"],
      ]);
      const detail = await detailOf(added.body.items[0].id);
      expect(detail.selectedResponseFile).toBe("001.response.json");
      expect(detail.responses.find((variant) => variant.fileName === added.body.items[0].responseFile).title).toBe("dump · 08:00:00");
    });
  });
});
