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
});
