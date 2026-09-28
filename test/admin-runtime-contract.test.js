const fs = require("fs");
const path = require("path");
const request = require("supertest");
const yaml = require("js-yaml");
const { createServerRuntime } = require("../src/server");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

const REPO_ROOT = path.join(__dirname, "..");
const SPEC_PATH = path.join(REPO_ROOT, "src", "admin", "admin-api.openapi.yaml");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Identità, configurazione effettiva e contratto del runtime in esecuzione (piano agent/API,
// §5 S2 e §13 C2).
describe("admin API: configurazione effettiva e contratto del runtime", () => {
  let workspaceDir;

  beforeEach(async () => {
    workspaceDir = await createTempDir("admin-runtime-contract-");
    await fs.promises.mkdir(path.join(workspaceDir, "mocks"), { recursive: true });
  });

  afterEach(async () => {
    await removeDir(workspaceDir);
  });

  function startRuntime(configOverrides = {}) {
    return createServerRuntime({
      configOverrides: {
        host: "127.0.0.1",
        mocksDir: path.join(workspaceDir, "mocks"),
        monitorDumpDir: path.join(workspaceDir, "dump"),
        devWatch: false,
        adminApiEnabled: true,
        proxyFallbackEnabled: false,
        ...configOverrides,
      },
      logger: createNoopLogger(),
    });
  }

  describe("GET /config", () => {
    test("espone solo le nove chiavi di avvio ed effettive, senza override e senza persistenza", async () => {
      const runtime = await startRuntime({
        backendUrl: "http://127.0.0.1:9",
        proxyFallbackEnabled: true,
        globalDelayMs: 250,
        requestTimeoutMs: 4000,
      });

      const response = await request(runtime.app).get("/_admin/api/config");

      expect(response.status).toBe(200);
      const expected = {
        backendUrl: "http://127.0.0.1:9",
        proxyFallbackEnabled: true,
        corsEnabled: runtime.config.corsEnabled,
        delayAllRequests: runtime.config.delayAllRequests,
        caseInsensitiveFilters: runtime.config.caseInsensitiveFilters,
        adaptProxyCookies: runtime.config.adaptProxyCookies,
        rewriteProxyRedirects: runtime.config.rewriteProxyRedirects,
        globalDelayMs: 250,
        requestTimeoutMs: 4000,
      };
      expect(response.body).toEqual({
        runtimeId: runtime.runtimeIdentity.runtimeId,
        startup: expected,
        effective: expected,
        overrides: {},
        persisted: false,
      });
    });

    test("un backend non configurato è null", async () => {
      const runtime = await startRuntime({ backendUrl: "" });

      const response = await request(runtime.app).get("/_admin/api/config");

      expect(response.body.startup.backendUrl).toBeNull();
      expect(response.body.effective.backendUrl).toBeNull();
    });

    test("ogni avvio ha un runtimeId nuovo", async () => {
      const first = await startRuntime();
      const second = await startRuntime();

      const firstId = (await request(first.app).get("/_admin/api/config")).body.runtimeId;
      const secondId = (await request(second.app).get("/_admin/api/config")).body.runtimeId;

      expect(firstId).toMatch(UUID);
      expect(secondId).toMatch(UUID);
      expect(firstId).not.toBe(secondId);
      expect(Number.isNaN(Date.parse(first.runtimeIdentity.startedAt))).toBe(false);
    });
  });

  describe("GET /openapi.yaml", () => {
    test("serve la fonte canonica così com'è, come YAML", async () => {
      const runtime = await startRuntime();

      const response = await request(runtime.app).get("/_admin/api/openapi.yaml").buffer(true).parse((res, done) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^application\/yaml/);
      expect(response.body.equals(fs.readFileSync(SPEC_PATH))).toBe(true);
      const spec = yaml.safeLoad(response.body.toString("utf8"));
      expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(["/config", "/openapi.yaml"]));
    });

    test("risolve il file dal modulo, non dalla directory corrente", async () => {
      const runtime = await startRuntime();
      const previousCwd = process.cwd();
      process.chdir(workspaceDir);
      try {
        const response = await request(runtime.app).get("/_admin/api/openapi.yaml");
        expect(response.status).toBe(200);
      } finally {
        process.chdir(previousCwd);
      }
    });
  });

  test("con l'admin spenta le due rotte restano disabilitate", async () => {
    const runtime = await startRuntime({ adminApiEnabled: false });

    for (const route of ["/_admin/api/config", "/_admin/api/openapi.yaml"]) {
      const response = await request(runtime.app).get(route);
      expect(response.status).toBe(404);
      expect(response.body.message).toBe("The local mock administration API is disabled for this runtime.");
    }
  });

  // La spec vive in src/, che entrambi i pacchetti confezionano: l'immagine Docker di sviluppo
  // esclude docs/ e il pacchetto Electron copia ../src.
  describe("distribuzione della spec", () => {
    test("c'è una sola fonte, in src/admin", () => {
      expect(fs.existsSync(SPEC_PATH)).toBe(true);
      expect(fs.existsSync(path.join(REPO_ROOT, "docs", "admin-api.openapi.yaml"))).toBe(false);
    });

    test("l'immagine Docker di sviluppo include src/", () => {
      const ignored = fs.readFileSync(path.join(REPO_ROOT, ".dockerignore"), "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
      // I pattern valgono dalla radice del contesto: solo uno su src/, sulla spec o su tutti gli
      // YAML dell'albero la escluderebbe (docker-compose*.yml riguarda solo la radice).
      expect(ignored.some((pattern) => /^\/?src(\/|$)|openapi|^(\*\*\/)?\*\.ya?ml$/.test(pattern))).toBe(false);
      expect(ignored).toContain("docs");
      expect(fs.readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8")).toMatch(/^COPY \. \.$/m);
    });

    test("il pacchetto Electron copia tutta src/", () => {
      const { build } = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "electron", "package.json"), "utf8"));
      const sourceSet = build.files.find((entry) => typeof entry === "object" && entry.from === "../src");
      expect(sourceSet).toEqual({ from: "../src", to: "src" });
    });
  });
});
