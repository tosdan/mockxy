const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createServerRuntime } = require("../src/server");
const {
  createNoopLogger,
  createTempDir,
  writeMock,
  removeDir,
  startBackendServer,
  stopBackendServer,
  waitFor,
} = require("./helpers");

describe("mock watch behavior", () => {
  let mocksDir;
  let backend;

  beforeEach(async () => {
    mocksDir = await createTempDir("mock-watch-");
    backend = await startBackendServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ backend: true }));
    });
  });

  afterEach(async () => {
    if (backend) {
      await stopBackendServer(backend.server);
      backend = null;
    }
    if (mocksDir) {
      await removeDir(mocksDir);
      mocksDir = null;
    }
  });

  test("reloads mocks in dev watch mode without restart", async () => {
    await writeMock({
      mocksDir,
      folder: "watched",
      method: "GET",
      routePath: "/watched",
      body: { version: 1 },
    });

    const runtime = await createServerRuntime({
      configOverrides: {
        backendUrl: backend.url,
        mocksDir,
        devWatch: true,
        nodeEnv: "development",
      },
      logger: createNoopLogger(),
    });

    try {
      if (runtime.watcher) {
        await new Promise((resolve) => runtime.watcher.on("ready", resolve));
      }

      const first = await request(runtime.app).get("/watched");
      expect(first.body).toEqual({ version: 1 });
      expect(first.headers["x-mock-source"]).toBe("mock");

      const responsePath = path.join(mocksDir, "watched", "GET.responses", "001.response.json");
      await fs.promises.writeFile(
        responsePath,
        JSON.stringify({ type: "mock", status: 200, headers: {}, delayMs: 0, body: { version: 2 } }, null, 2),
        "utf8"
      );

      await waitFor(async () => {
        const next = await request(runtime.app).get("/watched");
        return next.body.version === 2;
      }, 5000);
    } finally {
      if (runtime.watcher) {
        await runtime.watcher.close();
      }
    }
  }, 15000);

  // Scheda 03 della code review 2026-07-09: con mocksDir assente al boot il watcher partiva
  // sul percorso grezzo (non canonicalizzabile) e chokidar agganciava l'antenato esistente
  // con quella stringa — su un antenato in forma corta 8.3, crash libuv alla comparsa della
  // cartella. Ora la cartella viene creata prima della canonicalizzazione.
  test("con mocksDir assente al boot, la cartella viene creata e il watch funziona", async () => {
    const missingDir = path.join(mocksDir, "non-ancora-creata");
    expect(fs.existsSync(missingDir)).toBe(false);

    const runtime = await createServerRuntime({
      configOverrides: {
        backendUrl: backend.url,
        mocksDir: missingDir,
        devWatch: true,
        nodeEnv: "development",
      },
      logger: createNoopLogger(),
    });

    try {
      expect(fs.existsSync(missingDir)).toBe(true);
      if (runtime.watcher) {
        await new Promise((resolve) => runtime.watcher.on("ready", resolve));
      }

      await writeMock({
        mocksDir: missingDir,
        folder: "nato-dopo",
        method: "GET",
        routePath: "/nato-dopo",
        body: { ok: true },
      });

      await waitFor(async () => {
        const response = await request(runtime.app).get("/nato-dopo");
        return response.headers["x-mock-source"] === "mock";
      }, 5000);
    } finally {
      if (runtime.watcher) {
        await runtime.watcher.close();
      }
    }
  }, 15000);

  test("does not start watcher in production", async () => {
    await writeMock({
      mocksDir,
      folder: "prod",
      method: "GET",
      routePath: "/prod",
      body: { ok: true },
    });

    const runtime = await createServerRuntime({
      configOverrides: {
        backendUrl: backend.url,
        mocksDir,
        devWatch: true,
        nodeEnv: "production",
      },
      logger: createNoopLogger(),
    });

    expect(runtime.watcher).toBeNull();
  });

  test("keeps the previous mock configuration when reload fails and recovers after a valid save", async () => {
    await writeMock({
      mocksDir,
      folder: "watched",
      method: "GET",
      routePath: "/watched",
      body: { version: 1 },
    });

    const runtime = await createServerRuntime({
      configOverrides: {
        backendUrl: backend.url,
        mocksDir,
        devWatch: true,
        nodeEnv: "development",
      },
      logger: createNoopLogger(),
    });

    try {
      if (runtime.watcher) {
        await new Promise((resolve) => runtime.watcher.on("ready", resolve));
      }

      const responsePath = path.join(mocksDir, "watched", "GET.responses", "001.response.json");
      await fs.promises.writeFile(responsePath, "{ invalid json", "utf8");

      await waitFor(async () => {
        const response = await request(runtime.app).get("/watched");
        return response.body.version === 1;
      }, 5000);

      await fs.promises.writeFile(
        responsePath,
        JSON.stringify({ type: "mock", status: 200, headers: {}, delayMs: 0, body: { version: 2 } }, null, 2),
        "utf8"
      );

      await waitFor(async () => {
        const response = await request(runtime.app).get("/watched");
        return response.body.version === 2;
      }, 5000);
    } finally {
      if (runtime.watcher) {
        await runtime.watcher.close();
      }
    }
  }, 15000);

  test("con un file rotto, gli altri mock si aggiornano e il rotto resta all'ultima versione buona", async () => {
    await writeMock({
      mocksDir,
      folder: "stable",
      method: "GET",
      routePath: "/stable",
      body: { version: 1 },
    });
    await writeMock({
      mocksDir,
      folder: "evolving",
      method: "GET",
      routePath: "/evolving",
      body: { version: 1 },
    });

    const runtime = await createServerRuntime({
      configOverrides: {
        backendUrl: backend.url,
        mocksDir,
        devWatch: true,
        nodeEnv: "development",
      },
      logger: createNoopLogger(),
    });

    try {
      if (runtime.watcher) {
        await new Promise((resolve) => runtime.watcher.on("ready", resolve));
      }

      const stablePath = path.join(mocksDir, "stable", "GET.responses", "001.response.json");
      await fs.promises.writeFile(stablePath, "{ invalid json", "utf8");

      // Con "stable" rotto, una modifica a "evolving" deve comunque applicarsi:
      // un file rotto non blocca i reload degli altri mock.
      const evolvingPath = path.join(mocksDir, "evolving", "GET.responses", "001.response.json");
      await fs.promises.writeFile(
        evolvingPath,
        JSON.stringify({ type: "mock", status: 200, headers: {}, delayMs: 0, body: { version: 2 } }, null, 2),
        "utf8"
      );

      await waitFor(async () => {
        const response = await request(runtime.app).get("/evolving");
        return response.body.version === 2;
      }, 5000);

      // E il mock rotto continua a servire la sua ultima versione buona dal mock, non dal proxy.
      const stableResponse = await request(runtime.app).get("/stable");
      expect(stableResponse.body).toEqual({ version: 1 });
      expect(stableResponse.headers["x-mock-source"]).toBe("mock");
    } finally {
      if (runtime.watcher) {
        await runtime.watcher.close();
      }
    }
  }, 15000);

  test("applies the latest mock body after rapid consecutive saves", async () => {
    await writeMock({
      mocksDir,
      folder: "rapid",
      method: "GET",
      routePath: "/rapid",
      body: { version: 1 },
    });

    const runtime = await createServerRuntime({
      configOverrides: {
        backendUrl: backend.url,
        mocksDir,
        devWatch: true,
        nodeEnv: "development",
      },
      logger: createNoopLogger(),
    });

    try {
      if (runtime.watcher) {
        await new Promise((resolve) => runtime.watcher.on("ready", resolve));
      }

      const responsePath = path.join(mocksDir, "rapid", "GET.responses", "001.response.json");
      await fs.promises.writeFile(
        responsePath,
        JSON.stringify({ type: "mock", status: 200, headers: {}, delayMs: 0, body: { version: 2 } }, null, 2),
        "utf8"
      );
      await fs.promises.writeFile(
        responsePath,
        JSON.stringify({ type: "mock", status: 200, headers: {}, delayMs: 0, body: { version: 3 } }, null, 2),
        "utf8"
      );

      await waitFor(async () => {
        const response = await request(runtime.app).get("/rapid");
        return response.body.version === 3;
      }, 5000);
    } finally {
      if (runtime.watcher) {
        await runtime.watcher.close();
      }
    }
  }, 15000);

  test("disables and re-enables a mock after config updates", async () => {
    await writeMock({
      mocksDir,
      folder: "toggle",
      method: "GET",
      routePath: "/toggle",
      body: { version: 1 },
    });

    const runtime = await createServerRuntime({
      configOverrides: {
        backendUrl: backend.url,
        mocksDir,
        devWatch: true,
        nodeEnv: "development",
      },
      logger: createNoopLogger(),
    });

    try {
      if (runtime.watcher) {
        await new Promise((resolve) => runtime.watcher.on("ready", resolve));
      }

      const configPath = path.join(mocksDir, "toggle", "GET.endpoint.json");

      await waitFor(async () => {
        const response = await request(runtime.app).get("/toggle");
        return response.headers["x-mock-source"] === "mock";
      }, 5000);

      await fs.promises.writeFile(
        configPath,
        JSON.stringify(
          {
            method: "GET",
            path: "/toggle",
            description: "",
            enabled: false,
            responseFiles: ["001.response.json"],
            selectedResponseFile: "001.response.json",
          },
          null,
          2
        ),
        "utf8"
      );

      await waitFor(async () => {
        const response = await request(runtime.app).get("/toggle");
        return response.headers["x-mock-source"] === "backend";
      }, 5000);

      await fs.promises.writeFile(
        configPath,
        JSON.stringify(
          {
            method: "GET",
            path: "/toggle",
            description: "",
            enabled: true,
            responseFiles: ["001.response.json"],
            selectedResponseFile: "001.response.json",
          },
          null,
          2
        ),
        "utf8"
      );

      await waitFor(async () => {
        const response = await request(runtime.app).get("/toggle");
        return response.headers["x-mock-source"] === "mock";
      }, 5000);
    } finally {
      if (runtime.watcher) {
        await runtime.watcher.close();
      }
    }
  }, 15000);
});
