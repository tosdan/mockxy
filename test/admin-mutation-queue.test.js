const fs = require("fs");
const http = require("http");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { encodeMockId } = require("../src/admin/mock-ids");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { SharedStateStore } = require("../src/mocks/shared-state");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { createNoopLogger, createTempDir, removeDir, waitFor, writeMock } = require("./helpers");

// Coda delle mutazioni per workspace (piano agent/API, §13 C1): una mutazione alla volta,
// letture e push fuori dalla coda, turno legato all'operazione e non alla connessione.
describe("coda delle mutazioni admin", () => {
  let mocksDir;
  let endpointId;

  beforeEach(async () => {
    mocksDir = await createTempDir("admin-mutation-queue-");
    await writeMock({ mocksDir, folder: "q", method: "GET", routePath: "/q", body: { ok: true } });
    endpointId = encodeMockId("q/GET.endpoint.json");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  // Il primo reload resta sospeso finché il test non chiama release(): la mutazione che lo
  // attende tiene il turno della coda.
  function createHeldReload() {
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const reload = jest.fn(async () => {
      if (reload.mock.calls.length === 1) {
        await held;
      }
      return { applied: true, loadErrors: [], fatalError: null };
    });
    return { reload, release: () => release() };
  }

  function buildApp(reloadRuntime) {
    return createApp({
      registry: new MockRegistry([]),
      config: { mocksDir, adminApiEnabled: true, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry([]),
      reloadRuntime,
      sharedStates: new SharedStateStore(),
    });
  }

  const readDescription = () =>
    JSON.parse(fs.readFileSync(path.join(mocksDir, "q", "GET.endpoint.json"), "utf8")).description;
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  test("una seconda mutazione attende la prima; le letture no", async () => {
    const { reload, release } = createHeldReload();
    const app = buildApp(reload);

    const first = request(app).put(`/_admin/api/mocks/${endpointId}/endpoint`).send({ description: "A" }).then((r) => r);
    await waitFor(() => reload.mock.calls.length === 1);
    let secondDone = false;
    const second = request(app)
      .put(`/_admin/api/mocks/${endpointId}/endpoint`)
      .send({ description: "B" })
      .then((r) => {
        secondDone = true;
        return r;
      });

    // Letture e stato del server rispondono mentre la prima mutazione tiene la coda.
    const detail = await request(app).get(`/_admin/api/mocks/${endpointId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.endpoint.description).toBe("A");
    expect((await request(app).get("/_admin/api/server")).status).toBe(200);

    await pause(150);
    expect(secondDone).toBe(false);
    expect(readDescription()).toBe("A");

    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(readDescription()).toBe("B");
  });

  test("una mutazione fallita non blocca le successive", async () => {
    const reload = jest
      .fn()
      .mockRejectedValueOnce(new Error("reload rotto"))
      .mockResolvedValue({ applied: true, loadErrors: [], fatalError: null });
    const app = buildApp(reload);

    const failed = await request(app).put(`/_admin/api/mocks/${endpointId}/endpoint`).send({ description: "A" });
    expect(failed.status).toBe(500);
    expect(failed.body.details).toEqual({ code: "RUNTIME_APPLY_FAILED", rollback: "restored" });
    expect(readDescription()).toBe("");

    const next = await request(app).put(`/_admin/api/mocks/${endpointId}/endpoint`).send({ description: "B" });
    expect(next.status).toBe(200);
    expect(readDescription()).toBe("B");
  });

  test("la disconnessione del client non libera la coda prima che l'operazione finisca", async () => {
    const { reload, release } = createHeldReload();
    const server = buildApp(reload).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    try {
      const body = JSON.stringify({ description: "A" });
      const aborted = http.request({
        host: "127.0.0.1",
        port,
        method: "PUT",
        path: `/_admin/api/mocks/${endpointId}/endpoint`,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      });
      aborted.on("error", () => {});
      aborted.end(body);
      await waitFor(() => reload.mock.calls.length === 1);
      aborted.destroy();

      let secondDone = false;
      const second = request(server)
        .put(`/_admin/api/mocks/${endpointId}/endpoint`)
        .send({ description: "B" })
        .then((r) => {
          secondDone = true;
          return r;
        });
      await pause(150);
      expect(secondDone).toBe(false);

      release();
      expect((await second).status).toBe(200);
      expect(readDescription()).toBe("B");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("un push SSE non attende la coda delle mutazioni", async () => {
    const sseDir = path.join(mocksDir, "stream");
    await fs.promises.mkdir(path.join(sseDir, "GET.responses"), { recursive: true });
    await fs.promises.writeFile(
      path.join(sseDir, "GET.endpoint.json"),
      JSON.stringify({
        method: "GET",
        path: "/stream",
        description: "",
        enabled: true,
        responseFiles: ["001.response.json"],
        selectedResponseFile: "001.response.json",
      })
    );
    await fs.promises.writeFile(
      path.join(sseDir, "GET.responses", "001.response.json"),
      JSON.stringify({ type: "sse", title: "", script: [] })
    );
    const { reload, release } = createHeldReload();
    const app = buildApp(reload);

    const held = request(app).put(`/_admin/api/mocks/${endpointId}/endpoint`).send({ description: "A" }).then((r) => r);
    await waitFor(() => reload.mock.calls.length === 1);

    const push = await request(app)
      .post(`/_admin/api/mocks/${encodeMockId("stream/GET.endpoint.json")}/sse/push`)
      .send({ data: "ciao" });
    expect(push.status).toBe(200);
    expect(push.body).toMatchObject({ delivered: 0 });

    release();
    expect((await held).status).toBe(200);
  });
});
