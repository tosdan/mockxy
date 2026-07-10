const path = require("path");
const { loadConfig } = require("../src/config");

describe("loadConfig — serving dell'interfaccia e host", () => {
  const SAVED_ENV = {};
  const ENV_KEYS = ["UI_DIST_DIR", "HOST"];

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

  test("uiDistDir è assente per default", () => {
    expect(loadConfig({}).uiDistDir).toBeUndefined();
  });

  test("uiDistDir da override viene risolto in path assoluto", () => {
    const config = loadConfig({ uiDistDir: "some/ui/dist" });
    expect(path.isAbsolute(config.uiDistDir)).toBe(true);
    expect(config.uiDistDir.endsWith(path.join("some", "ui", "dist"))).toBe(true);
  });

  test("uiDistDir già assoluto resta invariato", () => {
    const absolute = path.join(process.cwd(), "abs-ui-dist");
    expect(loadConfig({ uiDistDir: absolute }).uiDistDir).toBe(absolute);
  });

  test("uiDistDir viene letto anche dall'ambiente", () => {
    process.env.UI_DIST_DIR = "env/ui/dist";
    const config = loadConfig({});
    expect(path.isAbsolute(config.uiDistDir)).toBe(true);
    expect(config.uiDistDir.endsWith(path.join("env", "ui", "dist"))).toBe(true);
  });

  test("host è 127.0.0.1 per default (solo loopback) e passa quando impostato", () => {
    expect(loadConfig({}).host).toBe("127.0.0.1");
    expect(loadConfig({ host: "192.168.1.10" }).host).toBe("192.168.1.10");
  });

  test("host viene letto anche dall'ambiente", () => {
    process.env.HOST = "0.0.0.0";
    expect(loadConfig({}).host).toBe("0.0.0.0");
  });

  test("i percorsi relativi si risolvono dalla radice esplicita (baseDir), non dal cwd", () => {
    const originalMocksDir = process.env.MOCKS_DIR;
    const originalDumpDir = process.env.MONITOR_DUMP_DIR;
    process.env.MOCKS_DIR = "i-miei-mock";
    process.env.MONITOR_DUMP_DIR = "dump-qui";

    try {
      const base = path.join(process.cwd(), "radice-esplicita");
      const config = loadConfig({ baseDir: base });

      expect(config.mocksDir).toBe(path.resolve(base, "i-miei-mock"));
      expect(config.monitorDumpDir).toBe(path.resolve(base, "dump-qui"));
    } finally {
      if (originalMocksDir == null) {
        delete process.env.MOCKS_DIR;
      } else {
        process.env.MOCKS_DIR = originalMocksDir;
      }
      if (originalDumpDir == null) {
        delete process.env.MONITOR_DUMP_DIR;
      } else {
        process.env.MONITOR_DUMP_DIR = originalDumpDir;
      }
    }
  });
});
