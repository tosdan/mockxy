const fs = require("fs");
const path = require("path");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");

// Scorciatoia di test: la scansione reale è unica (loadEndpointRouteGroups); qui interessa
// solo la vista dei mock JSON.
async function loadMockRouteGroups(mocksDir) {
  return (await loadEndpointRouteGroups(mocksDir)).mockRouteGroups;
}
const { MockRegistry } = require("../src/mocks/mock-registry");
const { sortRouteGroups } = require("../src/mocks/route-groups");
const {
  loadConfig,
  parseCliArgs,
  shouldEnableAdminApi,
  shouldEnableWatch,
} = require("../src/config");
const { createTempDir, removeDir, writeMock } = require("./helpers");

describe("mock scan and config", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("mock-loader-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("skips an endpoint with an invalid schema and reports it", async () => {
    const folder = path.join(mocksDir, "invalid");
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(
      path.join(folder, "GET.endpoint.json"),
      JSON.stringify(
        {
          method: "GET",
          path: "/invalid",
          enabled: true,
          responseFiles: [],
          selectedResponseFile: "001.response.json",
        },
        null,
        2
      ),
      "utf8"
    );

    const { loadErrors } = await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].message).toContain("Invalid endpoint");

    const groups = await loadMockRouteGroups(mocksDir);
    expect(groups).toEqual([]);
  });

  test("skips the later duplicate method+path and reports it", async () => {
    await writeMock({
      mocksDir,
      folder: "a",
      method: "GET",
      routePath: "/dup",
      body: { a: 1 },
    });
    await writeMock({
      mocksDir,
      folder: "b",
      method: "GET",
      routePath: "/dup",
      body: { b: 2 },
    });

    const { loadErrors } = await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].message).toContain("Duplicate endpoint definition");

    // Vince il primo file in ordine di scansione (deterministico: percorsi ordinati).
    const groups = await loadMockRouteGroups(mocksDir);
    expect(groups).toHaveLength(1);
    expect(groups[0].methods.get("GET").body).toEqual({ a: 1 });
  });

  test("ignores disabled endpoints and does not load their response", async () => {
    const folder = path.join(mocksDir, "disabled");
    await fs.promises.mkdir(folder, { recursive: true });
    await fs.promises.writeFile(
      path.join(folder, "GET.endpoint.json"),
      JSON.stringify(
        {
          method: "GET",
          path: "/disabled",
          enabled: false,
          responseFiles: ["001.response.json"],
          selectedResponseFile: "001.response.json",
        },
        null,
        2
      ),
      "utf8"
    );

    const groups = await loadMockRouteGroups(mocksDir);

    expect(groups).toEqual([]);
  });

  test("registers file payloads by path without loading their content in memory", async () => {
    const fileContent = Buffer.from("%PDF-1.7\nmock pdf", "utf8");

    await writeMock({
      mocksDir,
      folder: "pdf",
      method: "POST",
      routePath: "/pdf",
      headers: { "content-type": "application/pdf" },
      fileName: "POST.file.pdf",
      fileContent,
    });

    const groups = await loadMockRouteGroups(mocksDir);
    const group = groups.find((currentGroup) => currentGroup.path === "/pdf");
    const response = group.methods.get("POST");

    expect(response.payloadType).toBe("file");
    // Il contenuto resta su disco e viene servito in streaming: nel registry c'è solo il percorso.
    expect(response.fileContent).toBeUndefined();
    expect(response.payloadFilePath).toBe(path.join(mocksDir, "pdf", "POST.responses", "POST.file.pdf"));
  });

  test("skips a file mock whose payload file is missing and reports it", async () => {
    await writeMock({
      mocksDir,
      folder: "pdf",
      method: "POST",
      routePath: "/pdf",
      fileName: "POST.file.pdf",
      fileContent: Buffer.from("x"),
    });
    await fs.promises.rm(path.join(mocksDir, "pdf", "POST.responses", "POST.file.pdf"));

    const { loadErrors } = await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].message).toContain("Missing file payload");

    const groups = await loadMockRouteGroups(mocksDir);
    expect(groups).toEqual([]);
  });

  test("skips a mock that declares both body and file and reports it", async () => {
    const folder = path.join(mocksDir, "invalid-dual-payload");
    const responseDir = path.join(folder, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(folder, "GET.endpoint.json"),
      JSON.stringify(
        {
          method: "GET",
          path: "/invalid-dual-payload",
          enabled: true,
          responseFiles: ["001.response.json"],
          selectedResponseFile: "001.response.json",
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      JSON.stringify(
        {
          type: "mock",
          status: 200,
          file: "GET.file.pdf",
          body: {},
          delayMs: 0,
        },
        null,
        2
      ),
      "utf8"
    );

    const { loadErrors } = await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].message).toContain("body and file are mutually exclusive");

    const groups = await loadMockRouteGroups(mocksDir);
    expect(groups).toEqual([]);
  });

  test("exact route wins over param route when method differs", async () => {
    await writeMock({
      mocksDir,
      folder: "exact-get",
      method: "GET",
      routePath: "/users/me",
      body: { source: "exact-get" },
    });
    await writeMock({
      mocksDir,
      folder: "param-post",
      method: "POST",
      routePath: "/users/:id",
      body: { source: "param-post" },
    });

    const groups = await loadMockRouteGroups(mocksDir);
    const registry = new MockRegistry(groups);

    const decision = registry.matchRequest("POST", "/users/me");
    expect(decision.mode).toBe("proxy");
    expect(decision.reason).toBe("method_not_mocked");
  });

  test("loads and matches mock routes that declare an exact query string", async () => {
    await writeMock({
      mocksDir,
      folder: path.join("users", "{id}", "^view-full_locale-it"),
      method: "GET",
      routePath: "/users/:id?view=full&locale=it",
      body: { source: "query-route" },
    });

    const groups = await loadMockRouteGroups(mocksDir);
    const registry = new MockRegistry(groups);

    const matchingDecision = registry.matchRequest(
      "GET",
      "/users/42",
      "/users/42?locale=it&view=full"
    );
    expect(matchingDecision.mode).toBe("mock");
    expect(matchingDecision.routePath).toBe("/users/:id?view=full&locale=it");

    const missingQueryDecision = registry.matchRequest("GET", "/users/42", "/users/42");
    expect(missingQueryDecision.mode).toBe("proxy");
    expect(missingQueryDecision.reason).toBe("path_not_mocked");
  });

  test("query route is not shadowed by its query-less sibling", async () => {
    await writeMock({
      mocksDir,
      folder: path.join("items", "{id}"),
      method: "GET",
      routePath: "/items/:id",
      body: { source: "no-query" },
    });
    await writeMock({
      mocksDir,
      folder: path.join("items", "{id}", "^type-special"),
      method: "GET",
      routePath: "/items/:id?type=special",
      body: { source: "with-query" },
    });

    const groups = await loadMockRouteGroups(mocksDir);
    const registry = new MockRegistry(groups);

    const withQuery = registry.matchRequest("GET", "/items/5", "/items/5?type=special");
    expect(withQuery.mode).toBe("mock");
    expect(withQuery.routePath).toBe("/items/:id?type=special");

    const withoutQuery = registry.matchRequest("GET", "/items/5", "/items/5");
    expect(withoutQuery.mode).toBe("mock");
    expect(withoutQuery.routePath).toBe("/items/:id");
  });

  test("sortRouteGroups puts a query route before its query-less sibling regardless of sortKey", () => {
    const plain = { path: "/items/:id", dynamic: true, staticSegments: 1, sortKey: "a-plain" };
    const query = {
      path: "/items/:id?type=special",
      dynamic: true,
      staticSegments: 1,
      sortKey: "z-query",
    };

    // plain has the smaller sortKey, so without the query tie-break it would sort first.
    const sorted = sortRouteGroups([plain, query]);

    expect(sorted[0].path).toBe("/items/:id?type=special");
  });

  test("shouldEnableWatch is false in production", () => {
    expect(shouldEnableWatch({ devWatch: true, nodeEnv: "production" })).toBe(false);
    expect(shouldEnableWatch({ devWatch: true, nodeEnv: "development" })).toBe(true);
  });

  test("shouldEnableAdminApi is false in production by default", () => {
    expect(shouldEnableAdminApi({ nodeEnv: "production" })).toBe(false);
  });

  test("shouldEnableAdminApi is true in development by default", () => {
    expect(shouldEnableAdminApi({ nodeEnv: "development" })).toBe(true);
  });

  test("loadConfig does not require BACKEND_URL when proxy fallback is disabled", () => {
    const originalBackendUrl = process.env.BACKEND_URL;
    delete process.env.BACKEND_URL;

    try {
      const config = loadConfig({
        backendUrl: "",
        proxyFallbackEnabled: false,
      });

      expect(config.backendUrl).toBeUndefined();
      expect(config.proxyFallbackEnabled).toBe(false);
    } finally {
      if (originalBackendUrl == null) {
        delete process.env.BACKEND_URL;
      } else {
        process.env.BACKEND_URL = originalBackendUrl;
      }
    }
  });

  test("loadConfig non attiva il polling del watcher di default (nemmeno su Windows)", () => {
    const originalUsePolling = process.env.CHOKIDAR_USEPOLLING;
    delete process.env.CHOKIDAR_USEPOLLING;

    try {
      expect(loadConfig({ backendUrl: undefined }).watchUsePolling).toBe(false);
    } finally {
      if (originalUsePolling == null) {
        delete process.env.CHOKIDAR_USEPOLLING;
      } else {
        process.env.CHOKIDAR_USEPOLLING = originalUsePolling;
      }
    }
  });

  test("loadConfig enables polling when CHOKIDAR_USEPOLLING is true", () => {
    const originalBackendUrl = process.env.BACKEND_URL;
    const originalUsePolling = process.env.CHOKIDAR_USEPOLLING;

    process.env.BACKEND_URL = "http://127.0.0.1:3001";
    process.env.CHOKIDAR_USEPOLLING = "true";

    try {
      const config = loadConfig();
      expect(config.watchUsePolling).toBe(true);
    } finally {
      if (originalBackendUrl == null) {
        delete process.env.BACKEND_URL;
      } else {
        process.env.BACKEND_URL = originalBackendUrl;
      }

      if (originalUsePolling == null) {
        delete process.env.CHOKIDAR_USEPOLLING;
      } else {
        process.env.CHOKIDAR_USEPOLLING = originalUsePolling;
      }
    }
  });

  test("parseCliArgs reads the global delay from startup arguments", () => {
    expect(parseCliArgs(["delay=250"])).toEqual({ globalDelayMs: 250 });
    expect(parseCliArgs(["--delay=250"])).toEqual({ globalDelayMs: 250 });
    expect(parseCliArgs(["delay", "250"])).toEqual({ globalDelayMs: 250 });
    expect(parseCliArgs(["--delay", "250"])).toEqual({ globalDelayMs: 250 });
  });

  test("parseCliArgs reads the delay-all launch flag", () => {
    expect(parseCliArgs(["delay-all"])).toEqual({ delayAllRequests: true });
    expect(parseCliArgs(["--delay-all"])).toEqual({ delayAllRequests: true });
    expect(parseCliArgs(["delay-all=false"])).toEqual({ delayAllRequests: false });
    expect(parseCliArgs([], { npm_config_delay_all: "true" })).toEqual({
      delayAllRequests: true,
    });
  });

  test("parseCliArgs reads npm launch options for delay and delay-all", () => {
    expect(
      parseCliArgs([], { npm_config_delay: "250", npm_config_delay_all: "true" })
    ).toEqual({
      globalDelayMs: 250,
      delayAllRequests: true,
    });
  });

  test("parseCliArgs rejects invalid global delay values", () => {
    expect(() => parseCliArgs(["delay=abc"])).toThrow(
      "Use a non-negative integer number of milliseconds"
    );
    expect(() => parseCliArgs(["--delay", "-5"])).toThrow(
      "Use a non-negative integer number of milliseconds"
    );
  });

  test("loadConfig does not require BACKEND_URL even when proxy fallback is enabled", () => {
    const originalBackendUrl = process.env.BACKEND_URL;
    delete process.env.BACKEND_URL;

    try {
      const config = loadConfig({ backendUrl: "   ", proxyFallbackEnabled: true });

      expect(config.backendUrl).toBeUndefined();
      expect(config.proxyFallbackEnabled).toBe(true);
    } finally {
      if (originalBackendUrl == null) {
        delete process.env.BACKEND_URL;
      } else {
        process.env.BACKEND_URL = originalBackendUrl;
      }
    }
  });

  test("loadConfig reports a clear error when BACKEND_URL is invalid", () => {
    expect(() => loadConfig({ backendUrl: "localhost:3001" })).toThrow(
      "Use an absolute URL including protocol, for example http://localhost:3001."
    );
  });

  test("loadConfig stores the global delay override", () => {
    const config = loadConfig({
      backendUrl: "http://127.0.0.1:3001",
      globalDelayMs: 120,
    });

    expect(config.globalDelayMs).toBe(120);
  });

  test("loadConfig stores the delay-all override", () => {
    const config = loadConfig({
      backendUrl: "http://127.0.0.1:3001",
      delayAllRequests: true,
    });

    expect(config.delayAllRequests).toBe(true);
  });

  test("loadConfig fa il bind di default solo su loopback, con HOST come opt-in", () => {
    const originalHost = process.env.HOST;
    delete process.env.HOST;

    try {
      expect(loadConfig({ backendUrl: undefined }).host).toBe("127.0.0.1");

      process.env.HOST = "0.0.0.0";
      expect(loadConfig({ backendUrl: undefined }).host).toBe("0.0.0.0");

      expect(loadConfig({ backendUrl: undefined, host: "192.168.1.10" }).host).toBe("192.168.1.10");
    } finally {
      if (originalHost == null) {
        delete process.env.HOST;
      } else {
        process.env.HOST = originalHost;
      }
    }
  });

  test("loadConfig stores admin and proxy fallback overrides", () => {
    const config = loadConfig({
      backendUrl: undefined,
      adminApiEnabled: true,
      proxyFallbackEnabled: false,
    });

    expect(config.adminApiEnabled).toBe(true);
    expect(config.proxyFallbackEnabled).toBe(false);
  });
});
