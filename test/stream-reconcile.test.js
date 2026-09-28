const fs = require("fs");
const http = require("http");
const path = require("path");
const request = require("supertest");
const WebSocket = require("ws");
const { createServerRuntime, startServer } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { streamSignatureOf } = require("../src/mocks/stream-signature");
const { createNoopLogger, createTempDir, removeDir, waitFor, writeMock } = require("./helpers");

const SSE_ID = encodeMockId("stream/GET.endpoint.json");
const WS_ID = encodeMockId("canale/GET.endpoint.json");

// Riconciliazione degli stream ai reload (piano agent/API, §6 S3 e §13 C3): si chiudono solo le
// connessioni il cui stream installato cambia o sparisce.
describe("stream preservati ai reload", () => {
  let workspaceDir;
  let mocksDir;
  let runtime;

  beforeEach(async () => {
    workspaceDir = await createTempDir("stream-reconcile-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    await writeStream("stream", "/stream", [{ type: "sse", title: "Flusso", script: [{ afterMs: 0, data: { n: 1 } }] }]);
    await writeStream("canale", "/canale", [{ type: "ws", title: "Canale", script: [], rules: [] }]);
    await writeMock({ mocksDir, folder: "altro", method: "GET", routePath: "/altro", body: { ok: true } });
  });

  afterEach(async () => {
    await runtime?.shutdown?.();
    runtime = null;
    await removeDir(workspaceDir);
  });

  async function writeStream(folder, routePath, responses, { enabled = true, selected = 0 } = {}) {
    const responseDir = path.join(mocksDir, folder, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    const names = responses.map((_response, index) => `00${index + 1}.response.json`);
    for (const [index, response] of responses.entries()) {
      await fs.promises.writeFile(path.join(responseDir, names[index]), JSON.stringify(response));
    }
    await fs.promises.writeFile(
      path.join(mocksDir, folder, "GET.endpoint.json"),
      JSON.stringify({ method: "GET", path: routePath, description: "", enabled, responseFiles: names, selectedResponseFile: names[selected] })
    );
  }

  async function createRuntime() {
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
    return runtime;
  }

  // Connessioni registrate negli store come farebbe il serving: `closed` dice se il reload le ha chiuse.
  function openFakeConnections() {
    const sseClose = jest.fn();
    const wsClose = jest.fn();
    runtime.sseConnections.register("GET /stream", { scriptLength: 1, write: () => {}, close: sseClose });
    runtime.wsConnections.register("GET /canale", { scriptLength: 0, send: () => {}, close: wsClose });
    return {
      sse: () => sseClose.mock.calls.length > 0,
      ws: () => wsClose.mock.calls.length > 0,
    };
  }

  const admin = () => request(runtime.app);

  describe("si conservano", () => {
    test("descrizione, variante inattiva, endpoint estraneo ed eco del watcher", async () => {
      await createRuntime();
      const closed = openFakeConnections();

      await admin().put(`/_admin/api/mocks/${SSE_ID}/endpoint`).send({ description: "nuova" });
      await admin().put(`/_admin/api/mocks/${WS_ID}/endpoint`).send({ description: "nuova" });
      await admin().post(`/_admin/api/mocks/${SSE_ID}/responses`).send({ type: "sse", title: "Bozza", script: [{ afterMs: 0, data: "altro" }], select: false });
      await admin().put(`/_admin/api/mocks/${SSE_ID}/responses/002.response.json`).send({ script: [{ afterMs: 5, data: "rivisto" }] });
      await admin().put(`/_admin/api/mocks/${encodeMockId("altro/GET.endpoint.json")}/endpoint`).send({ description: "estraneo" });
      await runtime.reloadRuntime("watcher");

      expect(closed.sse()).toBe(false);
      expect(closed.ws()).toBe(false);
      expect(runtime.sseConnections.listConnections("GET /stream")).toHaveLength(1);
      expect(runtime.wsConnections.listConnections("GET /canale")).toHaveLength(1);
    });

    test("un altro filename con la stessa definizione effettiva, titolo e preset diversi", async () => {
      await createRuntime();
      const closed = openFakeConnections();

      const clone = await admin().post(`/_admin/api/mocks/${SSE_ID}/responses`).send({ title: "Stesso flusso" });
      expect(clone.body.selectedResponseFile).toBe("002.response.json");
      await admin().put(`/_admin/api/mocks/${WS_ID}/responses/001.response.json`).send({ title: "Rinominato", presets: [{ label: "ping", data: "ping" }] });

      expect(closed.sse()).toBe(false);
      expect(closed.ws()).toBe(false);
    });

    test("i default omessi ed espliciti sono equivalenti", async () => {
      await createRuntime();
      const closed = openFakeConnections();

      await writeStream("stream", "/stream", [{ type: "sse", title: "Flusso", onEnd: "keep-open", retryMs: null, script: [{ afterMs: 0, data: { n: 1 } }] }]);
      await writeStream("canale", "/canale", [{ type: "ws", title: "Canale", onEnd: "keep-open", closeCode: null, script: [], rules: [] }]);
      await runtime.reloadRuntime("watcher");

      expect(closed.sse()).toBe(false);
      expect(closed.ws()).toBe(false);
    });

    test("una nuova selezione che non si carica lascia la vecchia rotta e le sue connessioni", async () => {
      await createRuntime();
      const closed = openFakeConnections();

      await fs.promises.writeFile(path.join(mocksDir, "stream", "GET.responses", "001.response.json"), "{ json invalido");
      await runtime.reloadRuntime("watcher");

      expect(closed.sse()).toBe(false);
      const status = await admin().get("/_admin/api/runtime/status");
      expect(status.body.errors).toEqual([expect.objectContaining({ filePath: "stream/GET.endpoint.json", serving: "retained" })]);
    });
  });

  describe("si chiudono solo quelle interessate", () => {
    test("un copione cambiato chiude lo stream dell'endpoint, non quello dell'altro", async () => {
      await createRuntime();
      const closed = openFakeConnections();

      await admin().put(`/_admin/api/mocks/${SSE_ID}/responses/001.response.json`).send({ script: [{ afterMs: 0, data: { n: 2 } }] });
      expect(closed.sse()).toBe(true);
      expect(closed.ws()).toBe(false);
      expect(runtime.sseConnections.listConnections("GET /stream")).toEqual([]);

      await admin().put(`/_admin/api/mocks/${WS_ID}/responses/001.response.json`).send({ rules: [{ match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] }] });
      expect(closed.ws()).toBe(true);
    });

    test("un cambio di tipo, una disabilitazione o un'eliminazione chiudono", async () => {
      await createRuntime();
      let closed = openFakeConnections();

      await admin().post(`/_admin/api/mocks/${SSE_ID}/responses`).send({ type: "mock", title: "Statico", status: 200, body: {} });
      await admin().put(`/_admin/api/mocks/${WS_ID}/endpoint`).send({ enabled: false });
      expect(closed.sse()).toBe(true);
      expect(closed.ws()).toBe(true);

      await admin().put(`/_admin/api/mocks/${WS_ID}/endpoint`).send({ enabled: true });
      closed = openFakeConnections();
      expect((await admin().delete(`/_admin/api/mocks/${WS_ID}`)).status).toBe(204);
      expect(closed.ws()).toBe(true);
    });

    test("lo shutdown chiude tutte le connessioni", async () => {
      runtime = await startServer({
        configOverrides: { host: "127.0.0.1", port: 0, mocksDir, monitorDumpDir: path.join(workspaceDir, "dump"), devWatch: false, adminApiEnabled: true, proxyFallbackEnabled: false },
        logger: createNoopLogger(),
      });
      const closed = openFakeConnections();

      await runtime.shutdown();
      runtime = null;

      expect(closed.sse()).toBe(true);
      expect(closed.ws()).toBe(true);
    });
  });

  test("connessioni vere: SSE e WebSocket sopravvivono a una modifica estranea e si chiudono al cambio di copione", async () => {
    runtime = await startServer({
      configOverrides: { host: "127.0.0.1", port: 0, mocksDir, monitorDumpDir: path.join(workspaceDir, "dump"), devWatch: false, adminApiEnabled: true, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
    });
    const { port } = runtime.server.address();
    let sseEnded = false;
    const sseRequest = http.get({ host: "127.0.0.1", port, path: "/stream" }, (response) => {
      response.on("data", () => {});
      response.on("end", () => {
        sseEnded = true;
      });
    });
    sseRequest.on("error", () => {});
    const client = new WebSocket(`ws://127.0.0.1:${port}/canale`);
    let wsClosed = false;
    client.on("close", () => {
      wsClosed = true;
    });
    client.on("error", () => {});
    await waitFor(() => runtime.sseConnections.listConnections("GET /stream").length === 1
      && runtime.wsConnections.listConnections("GET /canale").length === 1);

    try {
      await admin().put(`/_admin/api/mocks/${SSE_ID}/endpoint`).send({ description: "nuova" });
      await admin().put(`/_admin/api/mocks/${encodeMockId("altro/GET.endpoint.json")}/endpoint`).send({ description: "estraneo" });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(sseEnded).toBe(false);
      expect(wsClosed).toBe(false);
      expect(client.readyState).toBe(WebSocket.OPEN);

      await admin().put(`/_admin/api/mocks/${SSE_ID}/responses/001.response.json`).send({ script: [{ afterMs: 0, data: { n: 3 } }] });
      await waitFor(() => sseEnded);
      expect(wsClosed).toBe(false);
    } finally {
      sseRequest.destroy();
      client.terminate();
    }
  });

  test("la firma esclude filename, titolo e preset, include copione, regole e chiusura", () => {
    const base = { type: "ws", method: "GET", path: "/c", script: [{ afterMs: 0, data: "a" }], rules: [], onEnd: "close", closeCode: 1000, closeReason: null };
    const signature = streamSignatureOf(base);

    expect(streamSignatureOf({ ...base, title: "Altro", presets: [{ label: "x", data: 1 }], selectedResponseFile: "009.response.json" })).toBe(signature);
    expect(streamSignatureOf({ ...base, closeCode: 4000 })).not.toBe(signature);
    expect(streamSignatureOf({ ...base, closeReason: "fine" })).not.toBe(signature);
    expect(streamSignatureOf({ ...base, script: [{ afterMs: 1, data: "a" }] })).not.toBe(signature);
    expect(streamSignatureOf({ ...base, type: "mock" })).toBeNull();
  });
});
