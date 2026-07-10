const http = require("http");
const { startServer } = require("../src/server");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

describe("startServer shutdown", () => {
  async function startTestServer(mocksDir) {
    return startServer({
      configOverrides: {
        port: 0,
        host: "127.0.0.1",
        mocksDir,
        monitorDumpDir: mocksDir,
        devWatch: false,
        adminApiEnabled: false,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });
  }

  test("lo shutdown rimuove i listener di segnale ed è idempotente", async () => {
    const mocksDir = await createTempDir();
    const baselineSigint = process.listenerCount("SIGINT");
    const baselineSigterm = process.listenerCount("SIGTERM");

    try {
      const runtime = await startTestServer(mocksDir);
      expect(process.listenerCount("SIGINT")).toBe(baselineSigint + 1);
      expect(process.listenerCount("SIGTERM")).toBe(baselineSigterm + 1);

      const first = runtime.shutdown();
      const second = runtime.shutdown();
      await Promise.all([first, second]);
      // Ri-entrante: la seconda invocazione riusa lo stesso spegnimento invece di ripeterlo.
      expect(second).toBe(first);

      expect(process.listenerCount("SIGINT")).toBe(baselineSigint);
      expect(process.listenerCount("SIGTERM")).toBe(baselineSigterm);
      expect(runtime.server.listening).toBe(false);
    } finally {
      await removeDir(mocksDir);
    }
  }, 10000);

  test("avvii e spegnimenti ripetuti non accumulano listener di segnale", async () => {
    const mocksDir = await createTempDir();
    const baselineSigint = process.listenerCount("SIGINT");

    try {
      for (let i = 0; i < 3; i += 1) {
        const runtime = await startTestServer(mocksDir);
        await runtime.shutdown();
      }
      expect(process.listenerCount("SIGINT")).toBe(baselineSigint);
    } finally {
      await removeDir(mocksDir);
    }
  }, 15000);

  test("un errore in un passo di pulizia non blocca il resto dello shutdown", async () => {
    const mocksDir = await createTempDir();

    try {
      const runtime = await startTestServer(mocksDir);
      runtime.monitorDump.stop = () => Promise.reject(new Error("boom dump"));

      await expect(runtime.shutdown()).resolves.toBeUndefined();
      expect(runtime.server.listening).toBe(false);
    } finally {
      await removeDir(mocksDir);
    }
  }, 10000);
  test("completa anche con una connessione keep-alive ancora aperta", async () => {
    const mocksDir = await createTempDir();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const runtime = await startServer({
      configOverrides: {
        port: 0,
        host: "127.0.0.1",
        mocksDir,
        monitorDumpDir: mocksDir,
        devWatch: false,
        adminApiEnabled: false,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });

    try {
      // startServer ritorna prima dell'evento "listening": aspettalo per avere la porta.
      if (!runtime.server.listening) {
        await new Promise((resolve) => runtime.server.once("listening", resolve));
      }
      const { port } = runtime.server.address();

      // Una richiesta che lascia il socket keep-alive aperto, come fa l'interfaccia già caricata.
      await new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: "/ping", agent }, (res) => {
          res.on("data", () => {});
          res.on("end", resolve);
        });
        req.on("error", reject);
      });

      // Senza il fix, server.close resterebbe appeso sul socket keep-alive e questo await non
      // tornerebbe mai (timeout del test). Col fix lo shutdown completa.
      await runtime.shutdown();
      expect(runtime.server.listening).toBe(false);
    } finally {
      agent.destroy();
      await removeDir(mocksDir);
    }
  }, 10000);
});
