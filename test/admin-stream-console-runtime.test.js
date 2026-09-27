const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createServerRuntime } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Push e stato delle console SSE/WS risolti dal runtime installato (piano agent/API, §13 C1):
// il bersaglio è la definizione che serve le connessioni, non la selezione su disco.
describe("console SSE/WS: bersaglio dal runtime installato", () => {
  let workspaceDir;
  let mocksDir;
  let runtime;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-stream-console-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
  });

  afterEach(async () => {
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
    return runtime;
  }

  async function writeStreamEndpoint(folder, routePath, response) {
    const responseDir = path.join(mocksDir, folder, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(path.join(responseDir, "001.response.json"), JSON.stringify(response));
    await writeDefinition(folder, routePath, "001.response.json");
    return encodeMockId(`${folder}/GET.endpoint.json`);
  }

  const writeDefinition = (folder, routePath, selectedResponseFile, { enabled = true } = {}) =>
    fs.promises.writeFile(
      path.join(mocksDir, folder, "GET.endpoint.json"),
      JSON.stringify({
        method: "GET",
        path: routePath,
        description: "",
        enabled,
        responseFiles: ["001.response.json", "002.response.json"],
        selectedResponseFile,
      })
    );

  // Seleziona su disco una variante che non si carica e ricarica: il runtime mantiene la rotta
  // precedente, e la selezione su disco non è più quella servita.
  async function selectBrokenVariant(folder, routePath) {
    await fs.promises.writeFile(path.join(mocksDir, folder, "GET.responses", "002.response.json"), "{ json invalido");
    await writeDefinition(folder, routePath, "002.response.json");
    const outcome = await runtime.reloadRuntime();
    expect(outcome.loadErrors.map((loadError) => path.relative(mocksDir, loadError.filePath)))
      .toEqual([path.join(folder, "GET.endpoint.json")]);
  }

  test("SSE: con una nuova selezione non caricata, push e stato restano sulla rotta mantenuta", async () => {
    const id = await writeStreamEndpoint("stream", "/stream", { type: "sse", title: "", script: [] });
    await startRuntime();
    await selectBrokenVariant("stream", "/stream");
    const written = [];
    runtime.sseConnections.register("GET /stream", { scriptLength: 0, write: (text) => written.push(text), close: () => {} });

    const push = await request(runtime.app).post(`/_admin/api/mocks/${id}/sse/push`).send({ data: "ciao" });
    expect(push.status).toBe(200);
    expect(push.body).toEqual({ delivered: 1, connections: 1 });
    expect(written.join("")).toContain("data: ciao");

    const state = await request(runtime.app).get(`/_admin/api/mocks/${id}/sse/connections`);
    expect(state.status).toBe(200);
    expect(state.body.connections).toHaveLength(1);
    expect(state.body.history).toEqual([expect.objectContaining({ origin: "manual" })]);
  });

  test("WS: con una nuova selezione non caricata, push e stato restano sulla rotta mantenuta", async () => {
    const id = await writeStreamEndpoint("canale", "/canale", { type: "ws", title: "", script: [], rules: [] });
    await startRuntime();
    await selectBrokenVariant("canale", "/canale");
    const sent = [];
    runtime.wsConnections.register("GET /canale", { scriptLength: 0, send: (text) => sent.push(text), close: () => {} });

    const push = await request(runtime.app).post(`/_admin/api/mocks/${id}/ws/push`).send({ data: "ciao" });
    expect(push.status).toBe(200);
    expect(push.body).toEqual({ delivered: 1, connections: 1 });
    expect(sent).toEqual(["ciao"]);

    const state = await request(runtime.app).get(`/_admin/api/mocks/${id}/ws/connections`);
    expect(state.status).toBe(200);
    expect(state.body.connections).toHaveLength(1);
    expect(state.body.transcript).toEqual([expect.objectContaining({ direction: "out", origin: "manual" })]);
  });

  test("un endpoint che il runtime non serve risponde 404, anche se su disco è uno stream", async () => {
    await writeStreamEndpoint("stream", "/stream", { type: "sse", title: "", script: [] });
    await writeDefinition("stream", "/stream", "001.response.json", { enabled: false });
    await startRuntime();
    const id = encodeMockId("stream/GET.endpoint.json");

    const push = await request(runtime.app).post(`/_admin/api/mocks/${id}/sse/push`).send({ data: "ciao" });
    expect(push.status).toBe(404);
    expect(push.body.message).toBe("The runtime does not serve this endpoint.");
    expect((await request(runtime.app).get(`/_admin/api/mocks/${id}/sse/connections`)).status).toBe(404);

    const missing = await request(runtime.app)
      .post(`/_admin/api/mocks/${encodeMockId("assente/GET.endpoint.json")}/sse/push`)
      .send({ data: "ciao" });
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe("Endpoint definition not found.");
  });

  test("il tipo conta sulla definizione servita: una console ws su uno stream sse è 400", async () => {
    const id = await writeStreamEndpoint("stream", "/stream", { type: "sse", title: "", script: [] });
    await startRuntime();

    const push = await request(runtime.app).post(`/_admin/api/mocks/${id}/ws/push`).send({ data: "ciao" });
    expect(push.status).toBe(400);
    expect(push.body.message).toBe("The response served by this endpoint is not a ws variant.");
  });
});
