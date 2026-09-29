const fs = require("fs");
const http = require("http");
const path = require("path");
const request = require("supertest");
const yaml = require("js-yaml");
const Ajv2020 = require("ajv/dist/2020");
const { createServerRuntime, startServer } = require("../src/server");
const { createNoopLogger, createTempDir, removeDir, waitFor, writeMock } = require("./helpers");

const SPEC = yaml.safeLoad(fs.readFileSync(path.join(__dirname, "..", "src", "admin", "admin-api.openapi.yaml"), "utf8"));
const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema({ $id: "admin-openapi", components: SPEC.components });
const validateConfigState = ajv.compile({ $ref: "admin-openapi#/components/schemas/RuntimeConfigState" });
const validateDumpStatus = ajv.compile({ $ref: "admin-openapi#/components/schemas/DumpStatus" });

// Backend finto che si identifica, imposta un cookie di dominio, fa redirect assoluti verso se
// stesso e su /slow non risponde mai. Tiene traccia dei socket per chiudersi senza attese.
async function startNamedBackend(name) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (req.url === "/slow") {
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { location: `${url}/landing` });
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.setHeader("set-cookie", "sid=1; Domain=example.test; Path=/");
    res.end(JSON.stringify({ backend: name }));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  // Upgrade: tunnel che risponde col proprio nome, per riconoscere dove è finita la connessione.
  server.on("upgrade", (_req, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nx-backend: ${name}\r\n\r\n`);
    socket.on("data", (chunk) => socket.write(`${name}:${chunk}`));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

// Configurazione effimera del runtime (piano agent/API, §11 S8 e §13 C8).
describe("PATCH /config: override effimeri", () => {
  let workspaceDir;
  let mocksDir;
  let backends;
  let runtimes;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-runtime-config-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    backends = [];
    runtimes = [];
  });

  afterEach(async () => {
    for (const runtime of runtimes) await runtime.shutdown?.();
    for (const backend of backends) await backend.close();
    await removeDir(workspaceDir);
  });

  async function backend(name) {
    const started = await startNamedBackend(name);
    backends.push(started);
    return started;
  }

  const baseConfig = () => ({
    host: "127.0.0.1",
    mocksDir,
    filesDir: path.join(workspaceDir, "files"),
    monitorDumpDir: path.join(workspaceDir, "dump"),
    devWatch: false,
    adminApiEnabled: true,
    proxyFallbackEnabled: true,
  });

  async function startRuntime(configOverrides = {}) {
    const runtime = await createServerRuntime({ configOverrides: { ...baseConfig(), ...configOverrides }, logger: createNoopLogger() });
    runtimes.push(runtime);
    return runtime;
  }

  const patchConfig = (runtime, body) => request(runtime.app).patch("/_admin/api/config").send(body);
  const readConfig = async (runtime) => (await request(runtime.app).get("/_admin/api/config")).body;
  const configRevision = async (runtime) => (await request(runtime.app).get("/_admin/api/info")).body.revisions.config;
  const whoAnswers = async (runtime, requestPath = "/who") => (await request(runtime.app).get(requestPath)).body.backend;

  describe("validazione: tutto il candidato prima di qualunque effetto", () => {
    test.each([
      ["un corpo non oggetto", [], undefined],
      ["un campo esterno sconosciuto", { set: { corsEnabled: true }, reset: true }, undefined],
      ["set non oggetto", { set: null }, undefined],
      ["set array", { set: [] }, undefined],
      ["unset non array", { unset: "corsEnabled" }, undefined],
      ["nessuna chiave", {}, undefined],
      ["contenitori vuoti", { set: {}, unset: [] }, undefined],
      ["unset con un valore non stringa", { unset: [1] }, undefined],
      ["una chiave non modificabile", { set: { port: 4000 } }, "port"],
      ["una chiave sconosciuta in unset", { unset: ["mocksDir"] }, "mocksDir"],
      ["una chiave ripetuta in unset", { unset: ["corsEnabled", "corsEnabled"] }, "corsEnabled"],
      ["una chiave sia in set sia in unset", { set: { corsEnabled: true }, unset: ["corsEnabled"] }, "corsEnabled"],
      ["backendUrl vuoto", { set: { backendUrl: "" } }, "backendUrl"],
      ["backendUrl relativo", { set: { backendUrl: "/api" } }, "backendUrl"],
      ["backendUrl non http", { set: { backendUrl: "ftp://example.test" } }, "backendUrl"],
      ["backendUrl numerico", { set: { backendUrl: 8080 } }, "backendUrl"],
      ["un booleano da stringa", { set: { corsEnabled: "true" } }, "corsEnabled"],
      ["un booleano da numero", { set: { adaptProxyCookies: 0 } }, "adaptProxyCookies"],
      ["un ritardo negativo", { set: { globalDelayMs: -1 } }, "globalDelayMs"],
      ["un ritardo frazionario", { set: { globalDelayMs: 1.5 } }, "globalDelayMs"],
      ["un ritardo oltre il timer", { set: { globalDelayMs: 2147483648 } }, "globalDelayMs"],
      ["un ritardo da stringa", { set: { globalDelayMs: "10" } }, "globalDelayMs"],
      ["un timeout zero", { set: { requestTimeoutMs: 0 } }, "requestTimeoutMs"],
      ["un timeout oltre il timer", { set: { requestTimeoutMs: 2147483648 } }, "requestTimeoutMs"],
      ["una chiave valida e una no", { set: { corsEnabled: true, requestTimeoutMs: null } }, "requestTimeoutMs"],
    ])("%s: 400 senza cambiare valori, override o revisione", async (_label, body, key) => {
      const origin = await backend("A");
      const runtime = await startRuntime({ backendUrl: origin.url });
      await patchConfig(runtime, { set: { globalDelayMs: 5 } });
      const before = await readConfig(runtime);
      const revision = await configRevision(runtime);

      const response = await patchConfig(runtime, body);

      expect(response.status).toBe(400);
      expect(response.body.details).toMatchObject({ code: "MUTATION_REJECTED", rollback: "not_needed" });
      if (key !== undefined) expect(response.body.details.key).toBe(key);
      expect(await readConfig(runtime)).toEqual(before);
      expect(await configRevision(runtime)).toBe(revision);
    });

    test("un corpo assente o non JSON è un 400", async () => {
      const runtime = await startRuntime();
      expect((await request(runtime.app).patch("/_admin/api/config")).status).toBe(400);
      expect((await request(runtime.app).patch("/_admin/api/config").type("text").send("set")).status).toBe(400);
    });
  });

  test("set e unset: override espliciti, valori di avvio intatti, revisione solo quando cambia qualcosa", async () => {
    const origin = await backend("A");
    const other = await backend("B");
    const runtime = await startRuntime({ backendUrl: origin.url });
    const startup = (await readConfig(runtime)).startup;
    expect(await configRevision(runtime)).toBe(1);

    const changed = await patchConfig(runtime, { set: { globalDelayMs: 5, backendUrl: ` ${other.url} ` } });
    expect(changed.status).toBe(200);
    expect(validateConfigState(changed.body) ? [] : validateConfigState.errors).toEqual([]);
    expect(changed.body).toEqual(await readConfig(runtime));
    expect(changed.body.startup).toEqual(startup);
    expect(changed.body.effective).toEqual({ ...startup, backendUrl: other.url, globalDelayMs: 5 });
    // Le chiavi degli override seguono l'ordine fisso di C8, non quello del PATCH.
    expect(Object.keys(changed.body.overrides)).toEqual(["backendUrl", "globalDelayMs"]);
    expect(await configRevision(runtime)).toBe(2);

    // Lo stesso PATCH non cambia niente: revisione ferma.
    await patchConfig(runtime, { set: { globalDelayMs: 5 } });
    expect(await configRevision(runtime)).toBe(2);

    // Un override uguale al valore di avvio resta esplicito, e cambia l'insieme degli override.
    const explicit = await patchConfig(runtime, { set: { corsEnabled: startup.corsEnabled } });
    expect(explicit.body.overrides).toEqual({ backendUrl: other.url, corsEnabled: startup.corsEnabled, globalDelayMs: 5 });
    expect(explicit.body.effective).toEqual(changed.body.effective);
    expect(await configRevision(runtime)).toBe(3);

    // Unset di un override assente: riuscito, nessun cambiamento.
    await patchConfig(runtime, { unset: ["corsEnabled"] });
    expect(await configRevision(runtime)).toBe(4);
    const noop = await patchConfig(runtime, { unset: ["corsEnabled", "requestTimeoutMs"] });
    expect(noop.status).toBe(200);
    expect(await configRevision(runtime)).toBe(4);

    const restored = await patchConfig(runtime, { unset: ["backendUrl", "globalDelayMs"] });
    expect(restored.body.effective).toEqual(startup);
    expect(restored.body.overrides).toEqual({});
    expect(restored.body.persisted).toBe(false);
    expect(await configRevision(runtime)).toBe(5);
  });

  test("backendUrl: null disabilita il backend, unset torna a quello di avvio", async () => {
    const origin = await backend("A");
    const other = await backend("B");
    const runtime = await startRuntime({ backendUrl: origin.url });
    expect(await whoAnswers(runtime)).toBe("A");

    await patchConfig(runtime, { set: { backendUrl: null } });
    expect((await readConfig(runtime)).overrides).toEqual({ backendUrl: null });
    expect((await request(runtime.app).get("/who")).status).toBe(501);

    await patchConfig(runtime, { set: { backendUrl: other.url } });
    expect(await whoAnswers(runtime)).toBe("B");

    await patchConfig(runtime, { unset: ["backendUrl"] });
    expect(await whoAnswers(runtime)).toBe("A");
  });

  describe("ogni leva vale dalla richiesta successiva", () => {
    let origin;
    let runtime;

    beforeEach(async () => {
      origin = await backend("A");
      await writeMock({ mocksDir, folder: "people", method: "GET", routePath: "/people", body: [{ name: "Ada" }, { name: "Bob" }] });
      runtime = await startRuntime({ backendUrl: origin.url });
    });

    test("proxyFallbackEnabled", async () => {
      expect(await whoAnswers(runtime)).toBe("A");
      await patchConfig(runtime, { set: { proxyFallbackEnabled: false } });
      expect((await request(runtime.app).get("/who")).status).toBe(404);
    });

    test("corsEnabled", async () => {
      const preflight = () => request(runtime.app).options("/who").set("origin", "http://app.test").set("access-control-request-method", "PUT");
      expect((await preflight()).headers["access-control-allow-origin"]).toBeUndefined();
      await patchConfig(runtime, { set: { corsEnabled: true } });
      const response = await preflight();
      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("http://app.test");
    });

    test("caseInsensitiveFilters", async () => {
      expect((await request(runtime.app).get("/people?name=ada")).body).toEqual([{ name: "Ada" }]);
      await patchConfig(runtime, { set: { caseInsensitiveFilters: false } });
      expect((await request(runtime.app).get("/people?name=ada")).body).toEqual([]);
    });

    test("adaptProxyCookies", async () => {
      expect((await request(runtime.app).get("/who")).headers["set-cookie"]).toEqual(["sid=1; Path=/"]);
      await patchConfig(runtime, { set: { adaptProxyCookies: false } });
      expect((await request(runtime.app).get("/who")).headers["set-cookie"]).toEqual(["sid=1; Domain=example.test; Path=/"]);
    });

    test("rewriteProxyRedirects", async () => {
      expect((await request(runtime.app).get("/redirect")).headers.location).not.toContain(origin.url);
      await patchConfig(runtime, { set: { rewriteProxyRedirects: false } });
      expect((await request(runtime.app).get("/redirect")).headers.location).toBe(`${origin.url}/landing`);
    });

    // Nessuna aspettativa stretta sui tempi: il timeout di avvio (15 s) supererebbe quello del
    // test, quello impostato chiude la richiesta molto prima.
    test("requestTimeoutMs", async () => {
      await patchConfig(runtime, { set: { requestTimeoutMs: 100 } });
      expect((await request(runtime.app).get("/slow")).status).toBe(502);
    });

    // Solo un limite inferiore, con margine: un timer non scatta prima del suo ritardo.
    test("globalDelayMs sui mock e, con delayAllRequests, sul proxy", async () => {
      await patchConfig(runtime, { set: { globalDelayMs: 150 } });
      let started = Date.now();
      await request(runtime.app).get("/people");
      expect(Date.now() - started).toBeGreaterThanOrEqual(130);

      await patchConfig(runtime, { set: { delayAllRequests: true } });
      started = Date.now();
      expect(await whoAnswers(runtime)).toBe("A");
      expect(Date.now() - started).toBeGreaterThanOrEqual(130);
    });
  });

  test("una richiesta in attesa del ritardo finisce con la configurazione con cui è entrata, la successiva usa la nuova", async () => {
    const startupBackend = await backend("S");
    const first = await backend("A");
    const second = await backend("B");
    const runtime = await startRuntime({ backendUrl: startupBackend.url });
    // La configurazione vecchia è a sua volta un override: leggere quella di avvio sarebbe un errore visibile.
    await patchConfig(runtime, { set: { backendUrl: first.url, globalDelayMs: 1000, delayAllRequests: true, adaptProxyCookies: true } });

    // Segnala quando la richiesta ha fotografato la configurazione, cioè è entrata nel serving.
    const store = runtime.runtimeConfig;
    const current = store.current.bind(store);
    let signalEntered;
    const entered = new Promise((resolve) => {
      signalEntered = resolve;
    });
    const spy = jest.spyOn(store, "current").mockImplementation(() => {
      const snapshot = current();
      signalEntered();
      return snapshot;
    });
    const delayed = request(runtime.app).get("/who").then((response) => response);
    await entered;
    spy.mockRestore();

    // Durante il ritardo di un secondo: altro backend, nessun ritardo, cookie non adattati.
    await patchConfig(runtime, { set: { backendUrl: second.url, globalDelayMs: 0, adaptProxyCookies: false } });

    const next = await request(runtime.app).get("/who");
    expect(next.body.backend).toBe("B");
    expect(next.headers["set-cookie"]).toEqual(["sid=1; Domain=example.test; Path=/"]);

    const old = await delayed;
    expect(old.body.backend).toBe("A");
    expect(old.headers["set-cookie"]).toEqual(["sid=1; Path=/"]);
  });

  test("un tunnel WebSocket aperto resta sul suo backend, il successivo va sul nuovo", async () => {
    const first = await backend("A");
    const second = await backend("B");
    const runtime = await startServer({ configOverrides: { ...baseConfig(), port: 0, backendUrl: first.url }, logger: createNoopLogger() });
    runtimes.push(runtime);
    const port = runtime.server.address().port;
    const openTunnel = () => new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/live", headers: { connection: "Upgrade", upgrade: "websocket" } });
      req.on("upgrade", (res, socket) => resolve({ res, socket }));
      req.on("response", (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
      req.on("error", reject);
      req.end();
    });
    const echo = (socket, text) => new Promise((resolve) => {
      socket.once("data", (chunk) => resolve(chunk.toString()));
      socket.write(text);
    });

    const opened = await openTunnel();
    expect(opened.res.headers["x-backend"]).toBe("A");

    await patchConfig(runtime, { set: { backendUrl: second.url } });

    expect(await echo(opened.socket, "ping")).toBe("A:ping");
    const next = await openTunnel();
    expect(next.res.headers["x-backend"]).toBe("B");
    expect(await echo(next.socket, "ping")).toBe("B:ping");
    opened.socket.destroy();
    next.socket.destroy();
  });

  test("un riavvio elimina gli override: il nuovo runtime parte dai valori di avvio", async () => {
    const first = await startRuntime({ globalDelayMs: 0 });
    await patchConfig(first, { set: { globalDelayMs: 250, corsEnabled: true } });
    expect((await readConfig(first)).overrides).toEqual({ corsEnabled: true, globalDelayMs: 250 });

    const restarted = await startRuntime({ globalDelayMs: 0 });
    const config = await readConfig(restarted);
    expect(config.overrides).toEqual({});
    expect(config.effective).toEqual(config.startup);
    expect(config.effective.globalDelayMs).toBe(0);
    expect(await configRevision(restarted)).toBe(1);
  });
});

// Limiti del dump sul PATCH esistente (§13 C8): stessi principi, niente duplicati sotto /config.
describe("PATCH /monitoring/dump: limiti effimeri", () => {
  let workspaceDir;
  let dumpDir;
  let runtime;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-dump-limits-");
    dumpDir = path.join(workspaceDir, "dump");
    await fs.promises.mkdir(path.join(workspaceDir, "mocks"), { recursive: true });
    runtime = await createServerRuntime({
      configOverrides: {
        host: "127.0.0.1",
        mocksDir: path.join(workspaceDir, "mocks"),
        monitorDumpDir: dumpDir,
        devWatch: false,
        adminApiEnabled: true,
        proxyFallbackEnabled: false,
        monitorDumpMaxFileBytes: 5000,
        monitorDumpMaxTotalBytes: 100000,
      },
      logger: createNoopLogger(),
    });
  });

  afterEach(async () => {
    await runtime.monitorDump.stop();
    await removeDir(workspaceDir);
  });

  const patchDump = (body) => request(runtime.app).patch("/_admin/api/monitoring/dump").send(body);
  const readDump = async () => (await request(runtime.app).get("/_admin/api/monitoring/dump")).body;
  const dumpRevision = async () => (await request(runtime.app).get("/_admin/api/info")).body.revisions.dump;

  test("il GET espone entrambi i limiti; il PATCH li cambia insieme ai campi storici", async () => {
    expect(await readDump()).toMatchObject({ maxFileBytes: 5000, maxTotalBytes: 100000 });

    const response = await patchDump({ intervalMs: 2500, threshold: 7, maxFileBytes: 1024, maxTotalBytes: 0 });

    expect(response.status).toBe(200);
    expect(validateDumpStatus(response.body) ? [] : validateDumpStatus.errors).toEqual([]);
    expect(response.body).toMatchObject({ intervalMs: 2500, threshold: 7, maxFileBytes: 1024, maxTotalBytes: 0 });
    expect(await readDump()).toMatchObject({ maxFileBytes: 1024, maxTotalBytes: 0 });
    expect(await dumpRevision()).toBe(2);
  });

  test.each([
    ["maxFileBytes zero", { maxFileBytes: 0 }],
    ["maxFileBytes negativo", { maxFileBytes: -1 }],
    ["maxFileBytes frazionario", { maxFileBytes: 1.5 }],
    ["maxFileBytes da stringa", { maxFileBytes: "1024" }],
    ["maxFileBytes oltre gli interi sicuri", { maxFileBytes: 2 ** 53 }],
    ["maxFileBytes null", { maxFileBytes: null }],
    ["maxTotalBytes negativo", { maxTotalBytes: -1 }],
    ["maxTotalBytes frazionario", { maxTotalBytes: 0.5 }],
    ["maxTotalBytes da stringa", { maxTotalBytes: "0" }],
  ])("%s: 400 e nessun campo applicato, nemmeno quelli validi", async (_label, invalid) => {
    const before = await readDump();

    const response = await patchDump({ intervalMs: 2500, threshold: 7, maxTotalBytes: 2048, ...invalid });

    expect(response.status).toBe(400);
    expect(await readDump()).toEqual(before);
    expect(await dumpRevision()).toBe(1);
  });

  // Un file piu' grande del limite resta dov'e' finché la potatura ordinaria non lo tocca.
  test("i limiti non cancellano file nel PATCH: vale la prossima potatura ordinaria", async () => {
    await fs.promises.mkdir(dumpDir, { recursive: true });
    const old = path.join(dumpDir, "dump-2026-01-01T00-00-00.000Z.ndjson");
    await fs.promises.writeFile(old, "x".repeat(4096));

    expect((await patchDump({ maxTotalBytes: 1024 })).status).toBe(200);
    expect(fs.existsSync(old)).toBe(true);

    // L'avvio di una sessione pota con il limite nuovo.
    await patchDump({ enabled: true });
    await waitFor(() => !fs.existsSync(old));
  });
});
