const net = require("net");
const { findFreePort, isPortFree, startDesktopServer } = require("../electron/desktop-server");

describe("desktop-server (avvio del motore per l'app desktop)", () => {
  test("la versione del pacchetto desktop è allineata a quella del root", () => {
    // electron-builder nomina l'artefatto con la versione di electron/package.json
    // (Mockxy-<versione>-portable.exe): se diverge dal root, l'exe esce col numero sbagliato.
    // Questo test è la "fonte unica": un bump di versione deve toccare entrambi i file.
    const rootVersion = require("../package.json").version;
    const desktopVersion = require("../electron/package.json").version;
    expect(desktopVersion).toBe(rootVersion);
  });

  test("il pacchetto desktop include ws tra le dipendenze di produzione", () => {
    const rootWsVersion = require("../package.json").dependencies.ws;
    const desktopWsVersion = require("../electron/package.json").dependencies.ws;
    expect(desktopWsVersion).toBe(rootWsVersion);
  });

  test("findFreePort restituisce una porta utilizzabile", async () => {
    const port = await findFreePort();
    expect(typeof port).toBe("number");
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });

  test("startDesktopServer passa gli override giusti al motore", async () => {
    let captured;
    const fakeRuntime = { shutdown: async () => {} };
    const startServerFn = async (options) => {
      captured = options;
      return fakeRuntime;
    };

    const result = await startDesktopServer({
      mocksDir: "/ws/mocks",
      uiDistDir: "/ui/dist",
      monitorDumpDir: "/ws/.local/dump",
      startServerFn,
    });

    expect(captured.configOverrides).toEqual(
      expect.objectContaining({
        host: "127.0.0.1",
        mocksDir: "/ws/mocks",
        uiDistDir: "/ui/dist",
        monitorDumpDir: "/ws/.local/dump",
        adminApiEnabled: true,
      })
    );
    expect(typeof captured.configOverrides.port).toBe("number");
    expect(captured.configOverrides.port).toBeGreaterThan(0);
    expect(result.runtime).toBe(fakeRuntime);
    expect(result.url).toBe(`http://127.0.0.1:${captured.configOverrides.port}/_admin/ui/`);
  });

  test("usa la porta esplicita quando fornita", async () => {
    let captured;
    const startServerFn = async (options) => {
      captured = options;
      return {};
    };

    const result = await startDesktopServer({
      mocksDir: "/ws/mocks",
      uiDistDir: "/ui/dist",
      port: 4321,
      startServerFn,
    });

    expect(captured.configOverrides.port).toBe(4321);
    expect(result.port).toBe(4321);
  });

  test("senza interfaccia servita l'url punta alla radice", async () => {
    let captured;
    const startServerFn = async (options) => {
      captured = options;
      return {};
    };

    const result = await startDesktopServer({ mocksDir: "/ws/mocks", startServerFn });

    expect(result.url).toBe(`http://127.0.0.1:${captured.configOverrides.port}/`);
  });

  test("rifiuta l'avvio senza mocksDir", async () => {
    await expect(startDesktopServer({})).rejects.toThrow(/mocksDir/);
  });

  test("con onError passa al motore un logger che duplica le righe error", async () => {
    let captured;
    const startServerFn = async (options) => {
      captured = options;
      return {};
    };
    const seen = [];

    await startDesktopServer({
      mocksDir: "/ws/mocks",
      onError: (message, fields) => seen.push([message, fields]),
      startServerFn,
    });

    expect(captured.logger).toBeDefined();
    captured.logger.info("solo console");
    captured.logger.error("Local handler failed.", { error: "data is not defined" });
    expect(seen).toEqual([["Local handler failed.", { error: "data is not defined" }]]);
  });

  test("senza onError non impone un logger (il motore crea il suo)", async () => {
    let captured;
    const startServerFn = async (options) => {
      captured = options;
      return {};
    };

    await startDesktopServer({ mocksDir: "/ws/mocks", startServerFn });

    expect(captured.logger).toBeUndefined();
  });

  test("isPortFree: falso se la porta è occupata, vero dopo averla liberata", async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    expect(await isPortFree(port)).toBe(false); // occupata dal nostro server

    await new Promise((resolve) => server.close(resolve));
    expect(await isPortFree(port)).toBe(true); // liberata
  });
});
