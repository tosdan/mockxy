const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { startServer } = require("../src/server");
const {
  createMemoryLogger,
  createTempDir,
  removeDir,
  startBackendServer,
  stopBackendServer,
  waitFor,
  writeHandler,
  writeProxyMiddleware,
} = require("./helpers");

const REPO_ROOT = path.join(__dirname, "..");

function get(port, requestPath, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: requestPath }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          /* corpo non JSON */
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ status: null, timedOut: true });
    });
    req.on("error", (error) => resolve({ status: null, error: error.code || error.message }));
  });
}

const OK_HANDLER = `module.exports = {
  path: "/ok",
  resolveResponse() {
    return { status: 200, jsonBody: { ok: true } };
  },
};`;

// Uno script del workspace che sbaglia non deve portarsi dietro il server: né bloccandolo con
// codice sincrono che non finisce, né spegnendolo con un errore lanciato fuori dalla richiesta.
describe("script del workspace: errori che restano confinati", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("script-faults-");
    await writeHandler({ mocksDir, folder: "ok", method: "GET", source: OK_HANDLER });
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  describe("codice sincrono che non finisce", () => {
    let runtime;
    let backend;
    let logger;

    afterEach(async () => {
      if (runtime) {
        await runtime.shutdown();
        runtime = null;
      }
      if (backend) {
        await stopBackendServer(backend.server);
        backend = null;
      }
    });

    async function start(configOverrides = {}) {
      logger = createMemoryLogger();
      runtime = await startServer({
        configOverrides: {
          port: 0,
          host: "127.0.0.1",
          mocksDir,
          monitorDumpDir: mocksDir,
          devWatch: false,
          adminApiEnabled: false,
          requestTimeoutMs: 300,
          ...configOverrides,
        },
        logger,
      });
      if (!runtime.server.listening) {
        await new Promise((resolve) => runtime.server.once("listening", resolve));
      }
      return runtime.server.address().port;
    }

    test("un handler che cicla viene interrotto: 504, e il server continua a rispondere", async () => {
      await writeHandler({
        mocksDir,
        folder: "ciclo",
        method: "GET",
        source: `module.exports = {
  path: "/ciclo",
  resolveResponse() {
    while (true) {}
  },
};`,
      });
      const port = await start();

      const blocked = await get(port, "/ciclo");
      const after = await get(port, "/ok");

      expect(blocked.status).toBe(504);
      expect(blocked.headers["x-mock-source"]).toBe("handler");
      expect(blocked.body).toEqual({
        error: "Handler Timeout",
        message: "The local handler kept the server busy for 300ms with synchronous code and was interrupted.",
        details: { code: "HANDLER_BLOCKED" },
      });
      expect(after.status).toBe(200);
      const failure = logger.entries.error.find((entry) => entry.message === "Local handler failed.");
      expect(failure.fields.errorName).toBe("ScriptBlockedError");
      expect(failure.fields.handlerPath).toBe("/ciclo");
    });

    test("un handler che attende senza occupare il thread resta il 504 di sempre", async () => {
      await writeHandler({
        mocksDir,
        folder: "attesa",
        method: "GET",
        source: `module.exports = {
  path: "/attesa",
  resolveResponse() {
    return new Promise(() => {});
  },
};`,
      });
      const port = await start();

      const response = await get(port, "/attesa");

      expect(response.status).toBe(504);
      expect(response.body).toEqual({
        error: "Handler Timeout",
        message: "The local handler did not produce a response within 300ms.",
      });
    });

    test("un initializer dello stato condiviso che cicla non lascia la risorsa bloccata", async () => {
      await writeHandler({
        mocksDir,
        folder: "stato-rotto",
        method: "GET",
        source: `module.exports = {
  path: "/stato-rotto",
  resolveResponse({ sharedState }) {
    return sharedState.open("contatore", {
      seedKey: "v1",
      initialize: () => {
        while (true) {}
      },
    });
  },
};`,
      });
      await writeHandler({
        mocksDir,
        folder: "stato-buono",
        method: "GET",
        source: `module.exports = {
  path: "/stato-buono",
  async resolveResponse({ sharedState }) {
    const contatore = await sharedState.open("contatore", { seedKey: "v1", initialize: () => ({ n: 0 }) });
    const n = contatore.mutate((draft) => {
      draft.n += 1;
      return draft.n;
    });
    return { status: 200, jsonBody: { n } };
  },
};`,
      });
      const port = await start();

      const blocked = await get(port, "/stato-rotto");
      const first = await get(port, "/stato-buono");
      const second = await get(port, "/stato-buono");

      expect(blocked.status).toBe(504);
      expect(blocked.body.details).toEqual({ code: "HANDLER_BLOCKED" });
      expect(first).toMatchObject({ status: 200, body: { n: 1 } });
      expect(second).toMatchObject({ status: 200, body: { n: 2 } });
    });

    test("un middleware che cicla viene interrotto: passa la risposta del backend com'è", async () => {
      backend = await startBackendServer((_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ dal: "backend" }));
      });
      await writeProxyMiddleware({
        mocksDir,
        folder: "proxy-ciclo",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/proxy-ciclo",
  transformResponse() {
    while (true) {}
  },
};`,
      });
      const port = await start({ backendUrl: backend.url });

      const response = await get(port, "/proxy-ciclo");
      const after = await get(port, "/ok");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ dal: "backend" });
      expect(after.status).toBe(200);
      const failure = logger.entries.error.find((entry) => entry.message.startsWith("Proxy middleware failed."));
      expect(failure.fields.errorName).toBe("ScriptBlockedError");
    });
  });

  // Chi termina il processo è Node, quando un'eccezione non trova gestori: va provato sul
  // processo vero, avviato come lo avvia chi usa il motore senza app desktop.
  describe("errori lanciati fuori dalla richiesta (node index.js)", () => {
    // Stato del processo figlio del test in corso. Ogni avvio ne crea uno nuovo: l'uscita di
    // un figlio ucciso a fine test arriva dopo, e non deve finire nel test successivo.
    let engine;

    afterEach(() => {
      if (engine && engine.exitCode === undefined) {
        engine.child.kill("SIGKILL");
      }
      engine = null;
    });

    function freePort() {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address();
          server.close(() => resolve(port));
        });
      });
    }

    async function spawnEngine(args = ["index.js"]) {
      const port = await freePort();
      const state = { output: "", exitCode: undefined, child: null };
      engine = state;
      const child = spawn(process.execPath, args, {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PORT: String(port),
          HOST: "127.0.0.1",
          MOCKS_DIR: mocksDir,
          FILES_DIR: path.join(mocksDir, "_files"),
          MONITOR_DUMP_DIR: path.join(mocksDir, "_dump"),
          BACKEND_URL: "",
          DEV_WATCH: "false",
          ADMIN_API_ENABLED: "false",
          LOG_LEVEL: "error",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      state.child = child;
      child.stdout.on("data", (chunk) => {
        state.output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        state.output += chunk;
      });
      child.on("exit", (code, signal) => {
        state.exitCode = signal || code;
      });
      return port;
    }

    const serverIsUp = (port) => waitFor(async () => (await get(port, "/ok", 500)).status === 200, 15000, 100);

    function containedFaults() {
      return engine.output
        .split("\n")
        .filter((line) => line.includes("workspace script failed outside its request"))
        .map((line) => JSON.parse(line));
    }

    test.each([
      [
        "un throw in un timer",
        "uncaught_exception",
        `setTimeout(() => { throw new Error("boom staccato"); }, 20);`,
      ],
      [
        "una promise rifiutata che nessuno attende",
        "unhandled_rejection",
        `Promise.resolve().then(() => { throw new Error("boom staccato"); });`,
      ],
    ])("%s: il server resta in piedi e il log dice quale script", async (_label, fault, statement) => {
      await writeHandler({
        mocksDir,
        folder: "staccato",
        method: "GET",
        source: `module.exports = {
  path: "/staccato",
  resolveResponse() {
    ${statement}
    return { status: 200, jsonBody: { avviato: true } };
  },
};`,
      });
      const port = await spawnEngine();
      await serverIsUp(port);

      const response = await get(port, "/staccato");
      await waitFor(() => containedFaults().length > 0, 5000, 50);
      const after = await get(port, "/ok");

      expect(response.status).toBe(200);
      expect(after.status).toBe(200);
      expect(engine.exitCode).toBeUndefined();
      const [entry] = containedFaults();
      expect(entry).toMatchObject({
        level: "error",
        fault,
        scriptKind: "handler",
        endpoint: "GET /staccato",
        error: "boom staccato",
      });
      expect(entry.script).toContain(path.join("staccato", "GET.responses", "001.handler.js"));
    }, 30000);

    test("un timer avviato dal codice di primo livello dello script è attribuito al suo file", async () => {
      await writeHandler({
        mocksDir,
        folder: "primo-livello",
        method: "GET",
        source: `setTimeout(() => { throw new Error("boom al caricamento"); }, 300);
module.exports = {
  path: "/primo-livello",
  resolveResponse() {
    return { status: 200, jsonBody: {} };
  },
};`,
      });
      const port = await spawnEngine();
      await serverIsUp(port);

      await waitFor(() => containedFaults().length > 0, 5000, 50);
      const after = await get(port, "/ok");

      expect(after.status).toBe(200);
      expect(engine.exitCode).toBeUndefined();
      expect(containedFaults()[0]).toMatchObject({ scriptKind: "script-load", error: "boom al caricamento" });
      expect(containedFaults()[0].script).toContain(path.join("primo-livello", "GET.responses", "001.handler.js"));
    }, 30000);

    test("un errore che non viene da uno script resta fatale: uscita con codice 1", async () => {
      await spawnEngine([
        "-e",
        `process.argv.length = 2; require("./index.js"); setTimeout(() => { throw new Error("guasto del motore"); }, 1500);`,
      ]);

      await waitFor(() => engine.exitCode !== undefined, 15000, 50);

      expect(engine.exitCode).toBe(1);
      expect(engine.output).toContain("guasto del motore");
      expect(containedFaults()).toEqual([]);
    }, 30000);
  });
});
