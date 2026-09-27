const { createServerRuntime } = require("../src/server");
const { createMemoryLogger, createTempDir, removeDir } = require("./helpers");

// Avviso di sicurezza (#13 revisione): admin API attiva su un bind non-loopback = chiunque
// raggiunga la porta può eseguire codice. L'avviso deve esserci lì, e solo lì.
describe("avviso admin API su interfaccia di rete", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("server-host-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  async function createRuntimeOn(host, adminApiEnabled) {
    const logger = createMemoryLogger();
    await createServerRuntime({
      configOverrides: {
        host,
        mocksDir,
        monitorDumpDir: mocksDir,
        devWatch: false,
        adminApiEnabled,
        proxyFallbackEnabled: false,
      },
      logger,
    });
    return logger;
  }

  const isAdminExposureWarning = (entry) =>
    entry.message.includes("Admin API enabled on a non-loopback interface");

  test("avvisa quando l'admin API è attiva su un bind non-loopback", async () => {
    const logger = await createRuntimeOn("0.0.0.0", true);
    expect(logger.entries.warn.some(isAdminExposureWarning)).toBe(true);
  });

  test("nessun avviso su loopback o con admin API disattivata", async () => {
    const loopbackLogger = await createRuntimeOn("127.0.0.1", true);
    expect(loopbackLogger.entries.warn.some(isAdminExposureWarning)).toBe(false);

    const noAdminLogger = await createRuntimeOn("0.0.0.0", false);
    expect(noAdminLogger.entries.warn.some(isAdminExposureWarning)).toBe(false);
  });

  // Il caso dell'immagine Docker di sviluppo avviata senza compose: HOST=0.0.0.0 e nessun
  // flag. Col default corretto l'admin API è attiva in development, quindi l'avviso deve
  // comparire; in production il default la spegne e l'avviso non ha motivo di esserci.
  describe("senza flag esplicito", () => {
    const SAVED_ENV = {};
    const ENV_KEYS = ["ADMIN_API_ENABLED", "NODE_ENV"];

    beforeEach(() => {
      ENV_KEYS.forEach((key) => {
        SAVED_ENV[key] = process.env[key];
        delete process.env[key];
      });
    });

    afterEach(() => {
      ENV_KEYS.forEach((key) => {
        if (SAVED_ENV[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = SAVED_ENV[key];
        }
      });
    });

    test("in development su bind di rete l'admin è attiva e l'avviso compare", async () => {
      const logger = await createRuntimeOn("0.0.0.0", undefined);
      expect(logger.entries.warn.some(isAdminExposureWarning)).toBe(true);
    });

    test("in production su bind di rete l'admin resta spenta e senza avviso", async () => {
      process.env.NODE_ENV = "production";
      const logger = await createRuntimeOn("0.0.0.0", undefined);
      expect(logger.entries.warn.some(isAdminExposureWarning)).toBe(false);
    });
  });
});
