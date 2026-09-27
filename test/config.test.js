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
});

describe("loadConfig — abilitazione dell'admin API", () => {
  const SAVED_ENV = {};
  const ENV_KEYS = ["ADMIN_API_ENABLED", "NODE_ENV"];

  // loadConfig legge .env una sola volta per processo: il primo caricamento avviene qui, così
  // un eventuale .env locale non reintroduce il flag dopo che ogni test lo ha rimosso.
  beforeAll(() => {
    loadConfig({});
  });

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

  test("senza flag è attiva in development, anche quando NODE_ENV non è impostato", () => {
    expect(loadConfig({}).adminApiEnabled).toBe(true);
    process.env.NODE_ENV = "development";
    expect(loadConfig({}).adminApiEnabled).toBe(true);
  });

  test("senza flag è spenta in production", () => {
    process.env.NODE_ENV = "production";
    expect(loadConfig({}).adminApiEnabled).toBe(false);
  });

  test("il flag esplicito dell'ambiente prevale sul default di NODE_ENV", () => {
    process.env.ADMIN_API_ENABLED = "false";
    expect(loadConfig({}).adminApiEnabled).toBe(false);
    process.env.NODE_ENV = "production";
    process.env.ADMIN_API_ENABLED = "true";
    expect(loadConfig({}).adminApiEnabled).toBe(true);
  });

  test("l'override esplicito prevale su ambiente e NODE_ENV", () => {
    process.env.ADMIN_API_ENABLED = "true";
    expect(loadConfig({ adminApiEnabled: false }).adminApiEnabled).toBe(false);
    expect(loadConfig({ adminApiEnabled: "false" }).adminApiEnabled).toBe(false);
    process.env.NODE_ENV = "production";
    process.env.ADMIN_API_ENABLED = "false";
    expect(loadConfig({ adminApiEnabled: true }).adminApiEnabled).toBe(true);
  });

  test("un valore non riconosciuto vale come flag assente", () => {
    process.env.ADMIN_API_ENABLED = "forse";
    expect(loadConfig({}).adminApiEnabled).toBe(true);
    process.env.NODE_ENV = "production";
    expect(loadConfig({}).adminApiEnabled).toBe(false);
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
