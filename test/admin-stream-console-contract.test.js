const fs = require("fs");
const http = require("http");
const path = require("path");
const Ajv2020 = require("ajv/dist/2020");
const yaml = require("js-yaml");
const request = require("supertest");
const WebSocket = require("ws");
const { startServer } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir, waitFor } = require("./helpers");

const SSE_ID = encodeMockId("flusso/GET.endpoint.json");
const WS_ID = encodeMockId("canale/GET.endpoint.json");

// Stato delle console SSE/WS con connessioni vere, validato contro lo schema pubblicato della
// risposta: connessioni aperte, storico e transcript con gli identificativi delle connessioni.
describe("console SSE/WS: risposte conformi alla spec", () => {
  let workspaceDir;
  let mocksDir;
  let runtime;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-stream-console-contract-");
    mocksDir = path.join(workspaceDir, "mocks");
    await writeStream("flusso", "/flusso", { type: "sse", title: "Flusso", script: [{ afterMs: 0, data: "uno", id: "evento-1" }] });
    await writeStream("canale", "/canale", {
      type: "ws",
      title: "Canale",
      script: [{ afterMs: 0, data: "ciao" }],
      rules: [{ match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] }],
    });
  });

  afterEach(async () => {
    await runtime?.shutdown?.();
    runtime = null;
    await removeDir(workspaceDir);
  });

  async function writeStream(folder, routePath, response) {
    const responseDir = path.join(mocksDir, folder, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(path.join(responseDir, "001.response.json"), JSON.stringify(response));
    await fs.promises.writeFile(
      path.join(mocksDir, folder, "GET.endpoint.json"),
      JSON.stringify({ method: "GET", path: routePath, description: "", enabled: true, responseFiles: ["001.response.json"], selectedResponseFile: "001.response.json" })
    );
  }

  // Lo schema della risposta 200 di un path, preso dalla spec servita: i suoi $ref interni si
  // risolvono sulla spec intera, registrata come unico documento.
  function responseValidator(spec, routePath) {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    ajv.addSchema({ ...spec, $id: "admin-openapi" });
    const pointer = ["paths", routePath, "get", "responses", "200", "content", "application/json", "schema"]
      .map((segment) => encodeURIComponent(segment.replace(/~/g, "~0").replace(/\//g, "~1")))
      .join("/");
    return ajv.compile({ $ref: `admin-openapi#/${pointer}` });
  }

  function expectValid(validate, body) {
    const valid = validate(body);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  }

  test("connessioni, storico SSE e transcript WS rispettano gli schemi, con identificativi interi", async () => {
    runtime = await startServer({
      configOverrides: { host: "127.0.0.1", port: 0, mocksDir, monitorDumpDir: path.join(workspaceDir, "dump"), devWatch: false, adminApiEnabled: true, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
    });
    const { port } = runtime.server.address();
    const admin = () => request(runtime.app);

    const sseRequest = http.get({ host: "127.0.0.1", port, path: "/flusso" }, (response) => response.on("data", () => {}));
    sseRequest.on("error", () => {});
    const client = new WebSocket(`ws://127.0.0.1:${port}/canale`);
    client.on("error", () => {});

    try {
      await new Promise((resolve) => client.on("open", resolve));
      client.send("ping");
      const ssePush = await admin().post(`/_admin/api/mocks/${SSE_ID}/sse/push`).send({ data: "manuale" });
      expect(ssePush.status).toBe(200);
      expect(ssePush.body.delivered).toBe(1);
      const wsPush = await admin().post(`/_admin/api/mocks/${WS_ID}/ws/push`).send({ data: "manuale" });
      expect(wsPush.status).toBe(200);
      expect(wsPush.body.delivered).toBe(1);
      // Copione, regola e messaggio ricevuto sono voci legate alla connessione; i push manuali
      // sono broadcast, registrati una volta sola.
      await waitFor(async () => {
        const sse = (await admin().get(`/_admin/api/mocks/${SSE_ID}/sse/connections`)).body;
        const ws = (await admin().get(`/_admin/api/mocks/${WS_ID}/ws/connections`)).body;
        return ["script", "manual"].every((origin) => sse.history.some((entry) => entry.origin === origin))
          && ["script", "rule", "received", "manual"].every((origin) => ws.transcript.some((entry) => entry.origin === origin));
      });

      const spec = yaml.safeLoad((await admin().get("/_admin/api/openapi.yaml")).text);
      const sse = await admin().get(`/_admin/api/mocks/${SSE_ID}/sse/connections`);
      const ws = await admin().get(`/_admin/api/mocks/${WS_ID}/ws/connections`);

      expect(sse.status).toBe(200);
      expectValid(responseValidator(spec, "/mocks/{id}/sse/connections"), sse.body);
      expect(ws.status).toBe(200);
      expectValid(responseValidator(spec, "/mocks/{id}/ws/connections"), ws.body);

      // Le voci legate a una connessione portano il suo identificativo; l'id dell'evento SSE è
      // invece la stringa scelta dal copione.
      const [sseConnection] = sse.body.connections;
      expect(Number.isInteger(sseConnection.id)).toBe(true);
      expect(sse.body.history.find((entry) => entry.origin === "script")).toMatchObject({ connectionId: sseConnection.id, id: "evento-1" });
      const [wsConnection] = ws.body.connections;
      expect(Number.isInteger(wsConnection.id)).toBe(true);
      for (const origin of ["script", "rule", "received"]) {
        expect(ws.body.transcript.find((entry) => entry.origin === origin)).toMatchObject({ connectionId: wsConnection.id });
      }

      // I broadcast della console non sono legati a una connessione: niente connectionId.
      const sseManual = sse.body.history.filter((entry) => entry.origin === "manual");
      expect(sseManual).toEqual([expect.objectContaining({ data: "manuale" })]);
      expect(sseManual[0]).not.toHaveProperty("connectionId");
      const wsManual = ws.body.transcript.filter((entry) => entry.origin === "manual");
      expect(wsManual).toEqual([expect.objectContaining({ direction: "out", data: "manuale" })]);
      expect(wsManual[0]).not.toHaveProperty("connectionId");
    } finally {
      sseRequest.destroy();
      client.terminate();
    }
  });
});
