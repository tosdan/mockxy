const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const request = require("supertest");
const {
  buildMockPayload,
  createApp,
  resolveMockDelayMs,
  resolveProxyDelayMs,
} = require("../src/app");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { MAX_MIDDLEWARE_BODY_BYTES } = require("../src/proxy/proxy");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const {
  createMemoryLogger,
  createNoopLogger,
  createTempDir,
  writeHandler,
  writeMock,
  writeProxyMiddleware,
  removeDir,
  startBackendServer,
  stopBackendServer,
} = require("./helpers");

describe("app integration", () => {
  let mocksDir;
  let backend;
  let logger;

  function binaryParser(res, callback) {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
  }

  beforeEach(async () => {
    mocksDir = await createTempDir();
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

  async function buildApp({
    backendHandler,
    timeoutMs = 15000,
    customLogger,
    delayAllRequests = false,
    globalDelayMs = 0,
    serverState,
    filesDir,
    caseInsensitiveFilters = true,
    corsEnabled = false,
    proxyFallbackEnabled = true,
    adaptProxyCookies = true,
    rewriteProxyRedirects = true,
    requestMonitor,
  } = {}) {
    backend = await startBackendServer(backendHandler || ((req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ backend: true }));
    }));

    const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups } =
      await loadEndpointRouteGroups(mocksDir);
    const routeGroups = mergeLocalRouteGroups({
      mockRouteGroups,
      handlerRouteGroups,
    });
    const registry = new MockRegistry(routeGroups);
    const proxyMiddlewareRegistry = new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups);
    const config = {
      backendUrl: backend.url,
      delayAllRequests,
      globalDelayMs,
      requestTimeoutMs: timeoutMs,
      filesDir,
      caseInsensitiveFilters,
      corsEnabled,
      proxyFallbackEnabled,
      adaptProxyCookies,
      rewriteProxyRedirects,
    };

    return createApp({
      registry,
      config,
      logger: customLogger || createNoopLogger(),
      proxyMiddlewareRegistry,
      requestMonitor: requestMonitor || new RequestMonitorStore(),
      serverState,
    });
  }

  // Backend che raccoglie il body ricevuto e risponde solo quando la richiesta è completa:
  // se il body va perso lungo il proxy, la richiesta upstream non termina mai e scatta il timeout.
  function createEchoBackendHandler(sink) {
    return (req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        sink.body = Buffer.concat(chunks).toString("utf8");
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ receivedBytes: sink.body.length }));
      });
    };
  }

  test("GET /mocked returns configured mock response", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: { message: "from mock" },
      headers: { "x-custom-mock": "yes" },
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "from mock" });
    expect(response.headers["x-custom-mock"]).toBe("yes");
    expect(response.headers["x-mock-source"]).toBe("mock");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers.pragma).toBe("no-cache");
  });

  test("text (string body) mock serves the body with the user's content-type (no hidden default)", async () => {
    await writeMock({ mocksDir, folder: "plain", method: "GET", routePath: "/plain", body: "hello world" });
    await writeMock({
      mocksDir,
      folder: "xmlish",
      method: "GET",
      routePath: "/xmlish",
      body: "<x>1</x>",
      headers: { "content-type": "application/xml" },
    });
    const app = await buildApp();

    // niente content-type esplicito → nessun default text/plain nascosto, il body è servito così com'è
    const plain = await request(app).get("/plain");
    expect(plain.status).toBe(200);
    expect(plain.text).toBe("hello world");
    expect(plain.headers["content-type"]).not.toContain("text/plain");

    // content-type impostato dall'utente → rispettato
    const xml = await request(app).get("/xmlish");
    expect(xml.text).toBe("<x>1</x>");
    expect(xml.headers["content-type"]).toContain("application/xml");
  });

  test("matched local handler returns a generated response without calling the backend", async () => {
    let backendHits = 0;

    await writeHandler({
      mocksDir,
      folder: "generated-order",
      method: "POST",
      source: `module.exports = {
  method: "POST",
  path: "/generated-order/:orderId",
  async resolveResponse({ params, query, requestHeaders, jsonBody }) {
    return {
      status: 201,
      headers: {
        "x-handler-id": requestHeaders["x-request-id"]
      },
      jsonBody: {
        orderId: params.orderId,
        page: query.page,
        customerCode: jsonBody.customerCode,
        generatedLocally: true
      }
    };
  }
};
`,
    });

    const app = await buildApp({
      backendHandler: (_req, res) => {
        backendHits += 1;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ backend: true }));
      },
    });

    const response = await request(app)
      .post("/generated-order/42?page=3")
      .set("x-request-id", "req-123")
      .send({ customerCode: "ABC123" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      orderId: "42",
      page: "3",
      customerCode: "ABC123",
      generatedLocally: true,
    });
    expect(response.headers["x-handler-id"]).toBe("req-123");
    expect(response.headers["x-mock-source"]).toBe("handler");
    expect(backendHits).toBe(0);
  });

  test("un handler che non risolve mai riceve un 504 entro il timeout configurato", async () => {
    await writeHandler({
      mocksDir,
      folder: "hanging",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/hanging",
  async resolveResponse() {
    return new Promise(() => {});
  }
};
`,
    });

    const app = await buildApp({ timeoutMs: 300 });
    const startedAt = Date.now();
    const response = await request(app).get("/hanging");
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(504);
    expect(response.body.error).toBe("Handler Timeout");
    expect(response.headers["x-mock-source"]).toBe("handler");
    expect(elapsedMs).toBeGreaterThanOrEqual(250);
  });

  test("un handler che viola il contratto (body non Buffer/stringa, status invalido) riceve un 500 pulito (#B3)", async () => {
    await writeHandler({
      mocksDir,
      folder: "bad-body",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/bad-body",
  async resolveResponse() {
    return { body: 42 };
  }
};
`,
    });
    await writeHandler({
      mocksDir,
      folder: "bad-status",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/bad-status",
  async resolveResponse() {
    return { status: 700, jsonBody: {} };
  }
};
`,
    });

    const app = await buildApp();

    const badBody = await request(app).get("/bad-body");
    expect(badBody.status).toBe(500);
    expect(badBody.body.error).toBe("Handler Execution Failed");
    expect(badBody.headers["x-mock-source"]).toBe("handler");

    const badStatus = await request(app).get("/bad-status");
    expect(badStatus.status).toBe(500);
    expect(badStatus.body.error).toBe("Handler Execution Failed");
  });

  test("un handler legge un file dati via data() e lo manipola", async () => {
    const filesDir = await createTempDir("mockxy-files-");
    try {
      await fs.promises.writeFile(
        path.join(filesDir, "utenti.json"),
        JSON.stringify([
          { id: 1, nome: "Ada", attivo: true },
          { id: 2, nome: "Bob", attivo: false },
          { id: 3, nome: "Cleo", attivo: true },
        ])
      );
      await writeHandler({
        mocksDir,
        folder: "con-dati",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/con-dati",
  async resolveResponse({ data }) {
    const utenti = await data("utenti");
    return { jsonBody: utenti.filter(u => u.attivo).map(u => u.nome) };
  }
};
`,
      });

      const app = await buildApp({ filesDir });
      const response = await request(app).get("/con-dati");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(["Ada", "Cleo"]);
      expect(response.headers["x-mock-source"]).toBe("handler");
    } finally {
      await removeDir(filesDir);
    }
  });

  test("un handler che referenzia un file dati inesistente riceve un 500 pulito e il dettaglio va nel log", async () => {
    const filesDir = await createTempDir("mockxy-files-");
    const logged = [];
    try {
      await writeHandler({
        mocksDir,
        folder: "dati-mancanti",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/dati-mancanti",
  async resolveResponse({ data }) {
    return { jsonBody: await data("inesistente") };
  }
};
`,
      });

      const app = await buildApp({
        filesDir,
        customLogger: {
          info() {},
          warn() {},
          error(message, meta) {
            logged.push({ message, meta });
          },
        },
      });
      const response = await request(app).get("/dati-mancanti");

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Handler Execution Failed");
      expect(JSON.stringify(logged)).toContain("no data file named 'inesistente.json'");
    } finally {
      await removeDir(filesDir);
    }
  });

  test("un proxy middleware legge un file dati via data() per arricchire la risposta del backend", async () => {
    const filesDir = await createTempDir("mockxy-files-");
    try {
      await fs.promises.writeFile(
        path.join(filesDir, "extra.json"),
        JSON.stringify({ nota: "arricchito dai dati" })
      );
      await writeProxyMiddleware({
        mocksDir,
        folder: "proxy-dati",
        method: "GET",
        source: `module.exports = {
  method: "GET",
  path: "/proxy-dati",
  async transformResponse({ jsonBody, data }) {
    const extra = await data("extra");
    return { jsonBody: { ...jsonBody, ...extra } };
  }
};
`,
      });

      const app = await buildApp({
        filesDir,
        backendHandler: (_req, res) => {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ proxied: true }));
        },
      });
      const response = await request(app).get("/proxy-dati");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ proxied: true, nota: "arricchito dai dati" });
    } finally {
      await removeDir(filesDir);
    }
  });

  test("un body della richiesta oltre il limite dell'handler riceve un 413 (#B3)", async () => {
    await writeHandler({
      mocksDir,
      folder: "echo-body",
      method: "POST",
      source: `module.exports = {
  method: "POST",
  path: "/echo-body",
  async resolveResponse({ requestBody }) {
    return { jsonBody: { bytes: (requestBody || "").length } };
  }
};
`,
    });

    const app = await buildApp();
    const huge = Buffer.alloc(2 * 1024 * 1024 + 1024, 65); // appena oltre i 2MB

    const response = await request(app)
      .post("/echo-body")
      .set("content-type", "application/octet-stream")
      .send(huge);

    expect(response.status).toBe(413);
    expect(response.body.error).toBe("Payload Too Large");
    expect(response.headers["x-mock-source"]).toBe("handler");
  });

  test("exact mock route wins over a dynamic local handler on the same path family", async () => {
    await writeMock({
      mocksDir,
      folder: "user-me",
      method: "GET",
      routePath: "/users/me",
      body: { source: "mock" },
    });
    await writeHandler({
      mocksDir,
      folder: "user-by-id",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/users/:id",
  async resolveResponse({ params }) {
    return {
      jsonBody: {
        source: "handler",
        id: params.id
      }
    };
  }
};
`,
    });

    const app = await buildApp();
    const response = await request(app).get("/users/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ source: "mock" });
    expect(response.headers["x-mock-source"]).toBe("mock");
  });

  test("resolveMockDelayMs gives precedence to the mock-specific delay", () => {
    expect(resolveMockDelayMs({ delayMs: 0 }, 120)).toBe(120);
    expect(resolveMockDelayMs({ delayMs: 35 }, 120)).toBe(35);
    expect(resolveMockDelayMs({ delayMs: 0 }, 0)).toBe(0);
  });

  test("resolveProxyDelayMs applies the global delay only when delay-all is enabled", () => {
    expect(resolveProxyDelayMs({ globalDelayMs: 120, delayAllRequests: true })).toBe(120);
    expect(resolveProxyDelayMs({ globalDelayMs: 120, delayAllRequests: false })).toBe(0);
    expect(resolveProxyDelayMs({ globalDelayMs: 0, delayAllRequests: true })).toBe(0);
  });

  test("GET /mocked applies the global delay when the mock delay is zero", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: { message: "from mock" },
    });

    const app = await buildApp({ globalDelayMs: 60 });
    const startedAt = Date.now();
    const response = await request(app).get("/mocked");
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "from mock" });
    expect(elapsedMs).toBeGreaterThanOrEqual(45);
  });

  test("unmocked requests apply the global delay when delay-all is enabled", async () => {
    const app = await buildApp({
      globalDelayMs: 60,
      delayAllRequests: true,
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ backend: true }));
      },
    });

    const startedAt = Date.now();
    const response = await request(app).get("/only-backend");
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ backend: true });
    expect(response.headers["x-mock-source"]).toBe("backend");
    expect(elapsedMs).toBeGreaterThanOrEqual(45);
  });

  test("il body di una POST proxata arriva integro al backend anche con monitor e delay attivi", async () => {
    const payload = JSON.stringify({ hello: "world", filler: "x".repeat(2048) });
    const sink = {};
    const app = await buildApp({
      delayAllRequests: true,
      globalDelayMs: 50,
      timeoutMs: 1000,
      backendHandler: createEchoBackendHandler(sink),
    });

    const response = await request(app)
      .post("/proxied-with-body")
      .set("content-type", "application/json")
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ receivedBytes: payload.length });
    expect(sink.body).toBe(payload);
  });

  test("il body di una POST arriva integro al backend in passthrough (proxy all) con delay attivo", async () => {
    const { ServerStateStore } = require("../src/server-state");
    const payload = JSON.stringify({ mode: "passthrough", filler: "y".repeat(2048) });
    const sink = {};
    const app = await buildApp({
      delayAllRequests: true,
      globalDelayMs: 50,
      timeoutMs: 1000,
      backendHandler: createEchoBackendHandler(sink),
      serverState: new ServerStateStore({ proxyAll: true }),
    });

    const response = await request(app)
      .post("/proxied-passthrough")
      .set("content-type", "application/json")
      .send(payload);

    expect(response.status).toBe(200);
    expect(sink.body).toBe(payload);
  });

  test("POST /pdf returns the configured file payload", async () => {
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

    const app = await buildApp();
    const response = await request(app).post("/pdf").buffer(true).parse(binaryParser);

    expect(response.status).toBe(200);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.equals(fileContent)).toBe(true);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["x-mock-source"]).toBe("mock");
    expect(response.headers["x-total-count"]).toBeUndefined();
  });

  test("un payload file senza content-type dichiarato risponde application/octet-stream", async () => {
    const fileContent = Buffer.from([0x01, 0x02, 0x03]);
    await writeMock({
      mocksDir,
      folder: "raw-file",
      method: "GET",
      routePath: "/raw-file",
      fileName: "GET.file.bin",
      fileContent,
    });

    const app = await buildApp();
    const response = await request(app).get("/raw-file").buffer(true).parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/octet-stream");
    expect(response.headers["content-length"]).toBe(String(fileContent.length));
    expect(response.body.equals(fileContent)).toBe(true);
  });

  test("un payload file sparito dopo il load produce un 500 pulito", async () => {
    await writeMock({
      mocksDir,
      folder: "vanishing",
      method: "GET",
      routePath: "/vanishing",
      fileName: "GET.file.bin",
      fileContent: Buffer.from("presto sparito"),
    });

    const app = await buildApp();
    await fs.promises.rm(path.join(mocksDir, "vanishing", "GET.responses", "GET.file.bin"));

    const response = await request(app).get("/vanishing");

    expect(response.status).toBe(500);
  });

  test("GET /mocked paginates array body when page and size are provided", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ],
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?page=1&size=2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 3 }, { id: 4 }]);
    expect(response.headers["x-total-count"]).toBe("5");
    expect(response.headers["x-mock-source"]).toBe("mock");
  });

  test("GET /mocked treats page as zero-based index", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ],
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?page=0&size=2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1 }, { id: 2 }]);
    expect(response.headers["x-total-count"]).toBe("5");
  });

  test("GET /mocked paginates object body when it exposes a single top-level array", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: {
        totalElements: 3,
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      },
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?page=0&size=2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalElements: 3,
      items: [{ id: 1 }, { id: 2 }],
    });
    expect(response.headers["x-total-count"]).toBe("3");
  });

  test("GET /mocked does not paginate object body when it exposes multiple top-level arrays", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: {
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        errors: [],
      },
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?page=0&size=2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      errors: [],
    });
    expect(response.headers["x-total-count"]).toBeUndefined();
  });

  test("buildMockPayload reads pagination from raw querystring when req.query is not populated", () => {
    const payload = buildMockPayload(
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      {
        query: undefined,
        originalUrl: "/mocked?page=1&size=2",
      }
    );

    expect(payload).toEqual({
      body: [{ id: 3 }, { id: 4 }],
      totalCount: 4,
    });
  });

  test("GET /mocked filters array body by a query parameter matching an item key", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1, ruolo: "admin" },
        { id: 2, ruolo: "user" },
        { id: 3, ruolo: "admin" },
      ],
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?ruolo=admin");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 1, ruolo: "admin" },
      { id: 3, ruolo: "admin" },
    ]);
    expect(response.headers["x-total-count"]).toBe("2");
  });

  test("GET /mocked filter matches values case-insensitively by default", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1, ruolo: "admin" },
        { id: 2, ruolo: "user" },
        { id: 3, ruolo: "Admin" },
      ],
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?ruolo=ADMIN");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 1, ruolo: "admin" },
      { id: 3, ruolo: "Admin" },
    ]);
    expect(response.headers["x-total-count"]).toBe("2");
  });

  test("GET /mocked filter is case-sensitive when caseInsensitiveFilters is false", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1, ruolo: "admin" },
        { id: 2, ruolo: "user" },
        { id: 3, ruolo: "Admin" },
      ],
    });

    const app = await buildApp({ caseInsensitiveFilters: false });
    const response = await request(app).get("/mocked?ruolo=admin");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1, ruolo: "admin" }]);
    expect(response.headers["x-total-count"]).toBe("1");
  });

  test("OPTIONS preflight is answered automatically when corsEnabled is true", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "POST",
      routePath: "/mocked",
      body: { ok: true },
    });

    const monitor = new RequestMonitorStore();
    const app = await buildApp({ corsEnabled: true, requestMonitor: monitor });
    const response = await request(app)
      .options("/mocked")
      .set("Origin", "http://spa.local:4200")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type, x-api-key");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
    // Eco degli header richiesti, non lista fissa: i custom header non devono fallire il preflight.
    expect(response.headers["access-control-allow-headers"]).toBe("content-type, x-api-key");
    expect(response.headers["vary"]).toContain("Origin");
    expect(response.headers["x-mock-source"]).toBe("cors-preflight");
    // Plumbing del browser: il preflight automatico non deve comparire nel monitor.
    expect(monitor.listEntries()).toEqual([]);
  });

  test("OPTIONS preflight follows the normal flow when corsEnabled is false", async () => {
    const seen = {};
    const app = await buildApp({
      backendHandler: (req, res) => {
        seen.method = req.method;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ backend: true }));
      },
    });
    const response = await request(app)
      .options("/anything")
      .set("Origin", "http://spa.local:4200")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(200);
    expect(seen.method).toBe("OPTIONS");
    expect(response.headers["access-control-allow-methods"]).toBeUndefined();
  });

  test("mocked response echoes the request Origin when corsEnabled is true", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [{ id: 1 }],
    });

    const app = await buildApp({ corsEnabled: true });
    const response = await request(app).get("/mocked").set("Origin", "http://spa.local:4200");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-expose-headers"]).toContain("X-Total-Count");
    expect(response.headers["vary"]).toContain("Origin");

    // Senza Origin la richiesta non è cross-origin: nessun header CORS.
    const sameOrigin = await request(app).get("/mocked");
    expect(sameOrigin.status).toBe(200);
    expect(sameOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("engine CORS echo wins over CORS headers captured into the mock", async () => {
    // Un mock creato da una cattura del monitor eredita la policy CORS del backend originale
    // (es. origine jolly): con l'opzione attiva deve valere l'eco del motore, non la policy stantia.
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "x-request-id",
      },
      body: [{ id: 1 }],
    });

    const app = await buildApp({ corsEnabled: true });
    const response = await request(app).get("/mocked").set("Origin", "http://spa.local:4200");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    // Gli Expose-Headers del mock vengono preservati e uniti a quelli del motore.
    expect(response.headers["access-control-expose-headers"]).toContain("x-request-id");
    expect(response.headers["access-control-expose-headers"]).toContain("X-Total-Count");
  });

  test("engine CORS echo overrides the backend policy on proxied responses", async () => {
    // La policy del backend (es. staging condiviso) può non ammettere l'origin dello sviluppatore:
    // con l'opzione attiva è Mockxy a possedere la superficie CORS, anche sulle risposte proxate.
    const app = await buildApp({
      corsEnabled: true,
      backendHandler: (req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "http://backend-policy.example");
        res.setHeader("Access-Control-Expose-Headers", "x-request-id");
        res.end(JSON.stringify({ backend: true }));
      },
    });
    const response = await request(app).get("/not-mocked").set("Origin", "http://spa.local:4200");

    expect(response.status).toBe(200);
    // Valore unico (l'eco), non concatenato né duplicato con quello del backend.
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    // Gli Expose-Headers del backend vengono preservati e uniti a quelli del motore.
    expect(response.headers["access-control-expose-headers"]).toContain("x-request-id");
    expect(response.headers["access-control-expose-headers"]).toContain("X-Total-Count");
  });

  test("proxied Set-Cookie is adapted to the Mockxy topology by default", async () => {
    // Il backend emette cookie scritti per chi gli parla direttamente: Domain suo, Secure,
    // SameSite=None. Con Mockxy in mezzo quegli attributi farebbero scartare il cookie dal
    // browser: vengono rimossi, senza toccare nome, valore e gli altri attributi.
    const app = await buildApp({
      backendHandler: (req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("Set-Cookie", [
          "sessione=abc123; Path=/; Domain=staging.example; Secure; HttpOnly; SameSite=None",
          "pref=compact; Path=/; SameSite=Lax",
        ]);
        res.end(JSON.stringify({ backend: true }));
      },
    });
    const response = await request(app).get("/not-mocked");

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toEqual([
      "sessione=abc123; Path=/; HttpOnly",
      "pref=compact; Path=/; SameSite=Lax",
    ]);
  });

  test("proxied Set-Cookie passes through untouched when adaptProxyCookies is false", async () => {
    const original = "sessione=abc123; Path=/; Domain=staging.example; Secure; HttpOnly; SameSite=None";
    const app = await buildApp({
      adaptProxyCookies: false,
      backendHandler: (req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("Set-Cookie", original);
        res.end(JSON.stringify({ backend: true }));
      },
    });
    const response = await request(app).get("/not-mocked");

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toEqual([original]);
  });

  test("proxied CORS headers pass through untouched when corsEnabled is false", async () => {
    const app = await buildApp({
      backendHandler: (req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "http://backend-policy.example");
        res.end(JSON.stringify({ backend: true }));
      },
    });
    const response = await request(app).get("/not-mocked").set("Origin", "http://spa.local:4200");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://backend-policy.example");
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  test("mock-only 404 miss carries the CORS echo when corsEnabled is true", async () => {
    const app = await buildApp({ corsEnabled: true, proxyFallbackEnabled: false });
    const response = await request(app).get("/not-mocked").set("Origin", "http://spa.local:4200");

    expect(response.status).toBe(404);
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
  });

  test("an explicit OPTIONS mock wins over the automatic preflight", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "OPTIONS",
      routePath: "/mocked",
      status: 200,
      headers: { "x-custom-options": "yes" },
      body: { custom: true },
    });

    const app = await buildApp({ corsEnabled: true });
    const response = await request(app)
      .options("/mocked")
      .set("Origin", "http://spa.local:4200")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ custom: true });
    expect(response.headers["x-custom-options"]).toBe("yes");
    expect(response.headers["x-mock-source"]).toBe("mock");
    // Anche il mock esplicito è una risposta locale: riceve comunque l'eco dell'origine.
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
  });

  test("preflight on an unmocked route is intercepted before the proxy fallback", async () => {
    // La policy del preflight dev'essere sempre quella del motore, coerente con le risposte
    // mockate che seguiranno: il backend non deve nemmeno vedere la richiesta.
    let backendHits = 0;
    const app = await buildApp({
      corsEnabled: true,
      backendHandler: (_req, res) => {
        backendHits += 1;
        res.statusCode = 200;
        res.end("{}");
      },
    });
    const response = await request(app)
      .options("/rotta-senza-mock")
      .set("Origin", "http://spa.local:4200")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(204);
    expect(response.headers["x-mock-source"]).toBe("cors-preflight");
    expect(backendHits).toBe(0);
  });

  test("OPTIONS with an empty Origin header is not treated as a preflight", async () => {
    // Un Origin vuoto non permette l'eco: trattarlo da preflight produrrebbe un 204 senza
    // Allow-Origin, cioè un blocco mascherato. Segue il flusso normale (qui: proxy).
    let backendHits = 0;
    const app = await buildApp({
      corsEnabled: true,
      backendHandler: (_req, res) => {
        backendHits += 1;
        res.statusCode = 200;
        res.end("{}");
      },
    });
    const response = await request(app)
      .options("/anything")
      .set("Origin", "")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(200);
    expect(backendHits).toBe(1);
    expect(response.headers["x-mock-source"]).not.toBe("cors-preflight");
  });

  test("plain OPTIONS without Access-Control-Request-Method follows the normal flow", async () => {
    // Solo i preflight veri vengono intercettati: un OPTIONS semplice (es. scoperta capacità)
    // va al proxy anche con l'opzione attiva.
    let backendHits = 0;
    const app = await buildApp({
      corsEnabled: true,
      backendHandler: (_req, res) => {
        backendHits += 1;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ backend: true }));
      },
    });
    const response = await request(app).options("/anything").set("Origin", "http://spa.local:4200");

    expect(response.status).toBe(200);
    expect(backendHits).toBe(1);
    expect(response.headers["access-control-allow-methods"]).toBeUndefined();
    // La risposta proxata resta soggetta all'override CORS: l'eco c'è comunque.
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
  });

  test("preflight without Access-Control-Request-Headers omits Allow-Headers", async () => {
    const app = await buildApp({ corsEnabled: true });
    const response = await request(app)
      .options("/rotta-senza-mock")
      .set("Origin", "http://spa.local:4200")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-headers"]).toBeUndefined();
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
  });

  test("local handler response carries the CORS echo when corsEnabled is true", async () => {
    await writeHandler({
      mocksDir,
      folder: "generato",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/generato",
  async resolveResponse() {
    return { status: 200, jsonBody: { ok: true } };
  }
};
`,
    });

    const app = await buildApp({ corsEnabled: true });
    const response = await request(app).get("/generato").set("Origin", "http://spa.local:4200");

    expect(response.status).toBe(200);
    expect(response.headers["x-mock-source"]).toBe("handler");
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("file mock response (streaming) carries the CORS echo when corsEnabled is true", async () => {
    await writeMock({
      mocksDir,
      folder: "scaricabile",
      method: "GET",
      routePath: "/scaricabile",
      fileContent: Buffer.from("contenuto-binario"),
    });

    const app = await buildApp({ corsEnabled: true });
    const response = await request(app)
      .get("/scaricabile")
      .set("Origin", "http://spa.local:4200")
      .buffer()
      .parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
    expect(response.headers["vary"]).toContain("Origin");
  });

  test("monitor keeps recording normal traffic while skipping automatic preflights", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: { ok: true },
    });

    const monitor = new RequestMonitorStore();
    const app = await buildApp({ corsEnabled: true, requestMonitor: monitor });

    await request(app)
      .options("/mocked")
      .set("Origin", "http://spa.local:4200")
      .set("Access-Control-Request-Method", "GET");
    await request(app).get("/mocked").set("Origin", "http://spa.local:4200");

    // L'esclusione è selettiva: fuori il preflight automatico, dentro la richiesta vera.
    expect(monitor.listEntries()).toHaveLength(1);
  });

  test("proxy-all mode responses also get the CORS echo override", async () => {
    const { ServerStateStore } = require("../src/server-state");
    const app = await buildApp({
      corsEnabled: true,
      serverState: new ServerStateStore({ proxyAll: true }),
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(JSON.stringify({ backend: true }));
      },
    });
    const response = await request(app).get("/qualunque").set("Origin", "http://spa.local:4200");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://spa.local:4200");
  });

  test("proxied Set-Cookie adaptation tolerates sloppy attribute formatting", async () => {
    const app = await buildApp({
      backendHandler: (req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("Set-Cookie", [
          // Maiuscole e spazi attorno all'uguale: formati sciatti ma visti in giro.
          "sessione=abc; Path=/; DOMAIN = staging.example; SECURE; SameSite = None",
          // Expires contiene una virgola (non un ";"): non deve confondere il parsing.
          "ricorda=si; Max-Age=3600; Expires=Wed, 08 Jul 2026 12:00:00 GMT; SameSite=Strict",
        ]);
        res.end(JSON.stringify({ backend: true }));
      },
    });
    const response = await request(app).get("/not-mocked");

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toEqual([
      "sessione=abc; Path=/",
      "ricorda=si; Max-Age=3600; Expires=Wed, 08 Jul 2026 12:00:00 GMT; SameSite=Strict",
    ]);
  });

  test("proxied redirect to the backend origin is rewritten to the request host", async () => {
    // Un Location assoluto verso il backend farebbe uscire il browser da Mockxy: viene
    // riportato sull'host con cui il client ci ha raggiunto, preservando path e query.
    const app = await buildApp({
      backendHandler: (req, res) => {
        res.statusCode = 302;
        res.setHeader("Location", `${backend.url}/nuova/rotta?a=1`);
        res.end();
      },
    });
    const response = await request(app).get("/not-mocked").set("Host", "mockxy.test:3199");

    expect(response.status).toBe(302);
    expect(response.headers["location"]).toBe("http://mockxy.test:3199/nuova/rotta?a=1");
  });

  test("proxied relative redirect passes through untouched", async () => {
    const app = await buildApp({
      backendHandler: (req, res) => {
        res.statusCode = 302;
        res.setHeader("Location", "/login?next=%2Fhome");
        res.end();
      },
    });
    const response = await request(app).get("/not-mocked").set("Host", "mockxy.test:3199");

    expect(response.status).toBe(302);
    expect(response.headers["location"]).toBe("/login?next=%2Fhome");
  });

  test("proxied redirect to a third-party host passes through untouched", async () => {
    // SSO esterni, CDN: riscriverli romperebbe flussi legittimi.
    const app = await buildApp({
      backendHandler: (req, res) => {
        res.statusCode = 302;
        res.setHeader("Location", "https://sso.example/auth?client=x");
        res.end();
      },
    });
    const response = await request(app).get("/not-mocked").set("Host", "mockxy.test:3199");

    expect(response.status).toBe(302);
    expect(response.headers["location"]).toBe("https://sso.example/auth?client=x");
  });

  test("proxied redirect passes through untouched when rewriteProxyRedirects is false", async () => {
    let backendLocation;
    const app = await buildApp({
      rewriteProxyRedirects: false,
      backendHandler: (req, res) => {
        backendLocation = `${backend.url}/nuova/rotta`;
        res.statusCode = 302;
        res.setHeader("Location", backendLocation);
        res.end();
      },
    });
    const response = await request(app).get("/not-mocked").set("Host", "mockxy.test:3199");

    expect(response.status).toBe(302);
    expect(response.headers["location"]).toBe(backendLocation);
  });

  test("GET /mocked filter compares scalars as strings (numbers and booleans)", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1, attivo: true },
        { id: "2", attivo: false },
        { id: 3, attivo: true },
      ],
    });

    const app = await buildApp();

    const byBoolean = await request(app).get("/mocked?attivo=true");
    expect(byBoolean.body).toEqual([
      { id: 1, attivo: true },
      { id: 3, attivo: true },
    ]);

    const byNumberAsString = await request(app).get("/mocked?id=2");
    expect(byNumberAsString.body).toEqual([{ id: "2", attivo: false }]);
  });

  test("GET /mocked combines distinct filters as AND and repeated values as OR", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1, ruolo: "admin", area: "nord" },
        { id: 2, ruolo: "user", area: "nord" },
        { id: 3, ruolo: "admin", area: "sud" },
        { id: 4, ruolo: "editor", area: "nord" },
      ],
    });

    const app = await buildApp();

    const andFilter = await request(app).get("/mocked?ruolo=admin&area=nord");
    expect(andFilter.body).toEqual([{ id: 1, ruolo: "admin", area: "nord" }]);

    const orFilter = await request(app).get("/mocked?ruolo=admin&ruolo=editor");
    expect(orFilter.body).toEqual([
      { id: 1, ruolo: "admin", area: "nord" },
      { id: 3, ruolo: "admin", area: "sud" },
      { id: 4, ruolo: "editor", area: "nord" },
    ]);
  });

  test("GET /mocked ignores query parameters that do not match any item key", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [{ id: 1 }, { id: 2 }],
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?sconosciuto=x");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1 }, { id: 2 }]);
    expect(response.headers["x-total-count"]).toBeUndefined();
  });

  test("GET /mocked keeps page and size reserved for pagination even when items expose those keys", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1, page: "a" },
        { id: 2, page: "b" },
        { id: 3, page: "a" },
      ],
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?page=0&size=2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 1, page: "a" },
      { id: 2, page: "b" },
    ]);
    expect(response.headers["x-total-count"]).toBe("3");
  });

  test("GET /mocked filters before paginating so X-Total-Count reflects the filtered total", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: {
        items: [
          { id: 1, ruolo: "admin" },
          { id: 2, ruolo: "user" },
          { id: 3, ruolo: "admin" },
          { id: 4, ruolo: "admin" },
        ],
      },
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?ruolo=admin&page=1&size=2");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [{ id: 4, ruolo: "admin" }] });
    expect(response.headers["x-total-count"]).toBe("3");
  });

  test("GET /mocked computed X-Total-Count overrides a user-configured header, case-insensitively", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      headers: { "x-total-count": "999" },
      body: [
        { id: 1, ruolo: "admin" },
        { id: 2, ruolo: "user" },
        { id: 3, ruolo: "admin" },
      ],
    });

    const app = await buildApp();

    // Con paginazione/filtro attivi il valore calcolato dall'engine vince sull'header dell'utente.
    const paginated = await request(app).get("/mocked?page=0&size=2");
    expect(paginated.headers["x-total-count"]).toBe("3");

    const filtered = await request(app).get("/mocked?ruolo=admin");
    expect(filtered.headers["x-total-count"]).toBe("2");

    // Senza paginazione né filtro l'header configurato dall'utente passa inalterato.
    const untouched = await request(app).get("/mocked");
    expect(untouched.headers["x-total-count"]).toBe("999");
  });

  test("GET /mocked excludes items whose filtered key is missing or not scalar", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: [
        { id: 1, tag: "x" },
        { id: 2 },
        { id: 3, tag: ["x"] },
        { id: 4, tag: null },
      ],
    });

    const app = await buildApp();
    const response = await request(app).get("/mocked?tag=x");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1, tag: "x" }]);
    expect(response.headers["x-total-count"]).toBe("1");
  });

  test("POST /mocked falls back to backend when only GET is mocked", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: { message: "from mock" },
    });

    const app = await buildApp({
      backendHandler: (req, res) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          res.statusCode = 201;
          res.setHeader("content-type", "application/json");
          res.setHeader("x-upstream", "true");
          res.end(
            JSON.stringify({
              method: req.method,
              url: req.url,
              body: Buffer.concat(chunks).toString("utf8"),
            })
          );
        });
      },
    });

    const response = await request(app)
      .post("/mocked?x=1")
      .set("x-client-header", "abc")
      .send({ test: true });

    expect(response.status).toBe(201);
    expect(response.headers["x-upstream"]).toBe("true");
    expect(response.headers["x-mock-source"]).toBe("backend");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body.method).toBe("POST");
    expect(response.body.url).toBe("/mocked?x=1");
  });

  test("GET /mocked falls back to backend when the mock is disabled", async () => {
    await writeMock({
      mocksDir,
      folder: "mocked",
      method: "GET",
      routePath: "/mocked",
      body: { message: "from mock" },
    });

    await fs.promises.writeFile(
      path.join(mocksDir, "mocked", "GET.endpoint.json"),
      JSON.stringify(
        {
          method: "GET",
          path: "/mocked",
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

    const app = await buildApp();
    const response = await request(app).get("/mocked");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ backend: true });
    expect(response.headers["x-mock-source"]).toBe("backend");
  });

  test("dynamic route /delege/:id is matched", async () => {
    await writeMock({
      mocksDir,
      folder: "delege-param",
      method: "GET",
      routePath: "/delege/:id",
      body: { source: "param" },
    });

    const app = await buildApp();
    const response = await request(app).get("/delege/123");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ source: "param" });
    expect(response.headers["x-mock-source"]).toBe("mock");
  });

  test("dynamic route /soggetti/:idSoggetto/deleghe/ricerca is matched", async () => {
    await writeMock({
      mocksDir,
      folder: "deleghe-soggetto-ricerca",
      method: "GET",
      routePath: "/soggetti/:idSoggetto/deleghe/ricerca",
      body: {
        deleghe: [
          {
            id: 15,
            stato: "IN_GESTIONE",
          },
        ],
      },
    });

    const app = await buildApp();
    const response = await request(app).get("/soggetti/123/deleghe/ricerca");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      deleghe: [
        {
          id: 15,
          stato: "IN_GESTIONE",
        },
      ],
    });
    expect(response.headers["x-mock-source"]).toBe("mock");
  });

  test("POST /be/soggetti/:idSoggetto/deleghe/ricerca is matched when POST is mocked", async () => {
    await writeMock({
      mocksDir,
      folder: "deleghe-soggetto-ricerca-post",
      method: "POST",
      routePath: "/be/soggetti/:idSoggetto/deleghe/ricerca",
      body: {
        deleghe: [
          {
            id: 15,
            stato: "IN_GESTIONE",
          },
        ],
      },
    });

    const app = await buildApp();
    const response = await request(app)
      .post("/be/soggetti/123/deleghe/ricerca")
      .send({ filtro: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      deleghe: [
        {
          id: 15,
          stato: "IN_GESTIONE",
        },
      ],
    });
    expect(response.headers["x-mock-source"]).toBe("mock");
  });

  test("POST /be/soggetti/:idSoggetto/deleghe/ricerca paginates the deleghe collection", async () => {
    await writeMock({
      mocksDir,
      folder: "deleghe-soggetto-ricerca-post",
      method: "POST",
      routePath: "/be/soggetti/:idSoggetto/deleghe/ricerca",
      body: {
        deleghe: [
          { id: 10 },
          { id: 11 },
          { id: 12 },
        ],
      },
    });

    const app = await buildApp();
    const response = await request(app)
      .post("/be/soggetti/123/deleghe/ricerca?page=0&size=2")
      .send({ filtro: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      deleghe: [{ id: 10 }, { id: 11 }],
    });
    expect(response.headers["x-total-count"]).toBe("3");
    expect(response.headers["x-mock-source"]).toBe("mock");
  });

  test("exact route has precedence over dynamic route", async () => {
    await writeMock({
      mocksDir,
      folder: "exact",
      method: "GET",
      routePath: "/delege/fisso",
      body: { source: "exact" },
    });

    await writeMock({
      mocksDir,
      folder: "param",
      method: "GET",
      routePath: "/delege/:id",
      body: { source: "param" },
    });

    const app = await buildApp();
    const response = await request(app).get("/delege/fisso");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ source: "exact" });
  });

  test("unmocked route is proxied and preserves upstream headers including set-cookie", async () => {
    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("x-upstream-header", "present");
        res.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/"]);
        res.end(JSON.stringify({ proxied: true }));
      },
    });

    const response = await request(app).get("/real-backend-route");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ proxied: true });
    expect(response.headers["x-upstream-header"]).toBe("present");
    expect(response.headers["x-mock-source"]).toBe("backend");
    expect(response.headers["set-cookie"]).toHaveLength(2);
  });

  test("unmocked route can transform proxied JSON responses through a proxy middleware", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-transform",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-transform/:id",
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status: status + 1,
      headers: {
        ...headers,
        "x-upstream-header": "rewritten",
        "x-added-by-middleware": "true"
      },
      removeHeaders: ["set-cookie"],
      jsonBody: {
        ...jsonBody,
        proxied: false,
        intercepted: true
      }
    };
  }
};
`,
    });

    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 201;
        res.setHeader("content-type", "application/json");
        res.setHeader("x-upstream-header", "present");
        res.setHeader("set-cookie", ["a=1; Path=/"]);
        res.end(JSON.stringify({ proxied: true }));
      },
    });

    const response = await request(app).get("/proxy-transform/42");

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      proxied: false,
      intercepted: true,
    });
    expect(response.headers["x-upstream-header"]).toBe("rewritten");
    expect(response.headers["x-added-by-middleware"]).toBe("true");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["x-mock-source"]).toBe("middleware");
  });

  test("uno stream con silenzi oltre il timeout non viene troncato (#25)", async () => {
    const app = await buildApp({
      timeoutMs: 300,
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write("data: uno\n\n");
        // Silenzio più lungo del timeout: il ritmo lo decide il backend, non l'idle timeout.
        setTimeout(() => {
          res.end("data: due\n\n");
        }, 700);
      },
    });

    const response = await request(app).get("/slow-stream");

    expect(response.status).toBe(200);
    expect(response.text).toContain("data: uno");
    expect(response.text).toContain("data: due");
  });

  test("un upstream morto a metà stream produce un errore visibile, non una risposta completa (#25)", async () => {
    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/octet-stream");
        res.write("inizio");
        setTimeout(() => res.destroy(), 100);
      },
    });

    // La chiusura sporca deve arrivare al client come errore di rete:
    // una risposta 200 "completata" con body parziale sarebbe il troncamento invisibile.
    await expect(request(app).get("/broken-stream")).rejects.toThrow();
  });

  test("il proxy non inoltra al backend gli header hop-by-hop del client", async () => {
    let receivedHeaders = null;
    const app = await buildApp({
      backendHandler: (req, res) => {
        receivedHeaders = req.headers;
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ backend: true }));
      },
    });

    const response = await request(app)
      .get("/hop-by-hop-request")
      .set("Connection", "x-strip-me")
      .set("x-strip-me", "leak")
      .set("proxy-connection", "keep-alive")
      .set("te", "trailers")
      .set("keep-alive", "timeout=5")
      .set("x-normal", "ok");

    expect(response.status).toBe(200);
    // Gli hop-by-hop (e gli header nominati dentro Connection) muoiono sulla tratta client→proxy.
    expect(receivedHeaders["x-strip-me"]).toBeUndefined();
    expect(receivedHeaders["proxy-connection"]).toBeUndefined();
    expect(receivedHeaders.te).toBeUndefined();
    expect(receivedHeaders["keep-alive"]).toBeUndefined();
    // Gli header normali passano.
    expect(receivedHeaders["x-normal"]).toBe("ok");
  });

  test("il proxy non rigira al client gli header hop-by-hop del backend", async () => {
    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("keep-alive", "timeout=5, max=100");
        res.setHeader("upgrade", "websocket");
        res.setHeader("connection", "x-secret");
        res.setHeader("x-secret", "leak");
        res.setHeader("x-normal", "ok");
        res.end(JSON.stringify({ backend: true }));
      },
    });

    const response = await request(app).get("/hop-by-hop-response");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ backend: true });
    expect(response.headers["keep-alive"]).toBeUndefined();
    expect(response.headers.upgrade).toBeUndefined();
    expect(response.headers["x-secret"]).toBeUndefined();
    expect(response.headers["x-normal"]).toBe("ok");
  });

  // Scrive un middleware che marca la risposta con un header: se l'header manca nella
  // risposta al client, il middleware è stato bypassato (passthrough).
  async function writeMarkerMiddleware(folder, routePath) {
    await writeProxyMiddleware({
      mocksDir,
      folder,
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "${routePath}",
  async transformResponse({ headers }) {
    return { headers: { ...headers, "x-added-by-middleware": "true" } };
  }
};
`,
    });
  }

  test("una risposta oltre il cap del middleware arriva integra al client senza trasformazione", async () => {
    const bigBody = Buffer.alloc(MAX_MIDDLEWARE_BODY_BYTES + 64 * 1024, 120);
    await writeMarkerMiddleware("proxy-big", "/proxy-big");

    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/octet-stream");
        // Nessun content-length: risposta chunked, il cap scatta durante il buffering.
        res.write(bigBody.subarray(0, 1024));
        res.end(bigBody.subarray(1024));
      },
    });

    const response = await request(app).get("/proxy-big").buffer(true).parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers["x-added-by-middleware"]).toBeUndefined();
    expect(response.headers["x-mock-source"]).toBe("backend");
    expect(response.body.length).toBe(bigBody.length);
    expect(response.body.equals(bigBody)).toBe(true);
  });

  test("una risposta con content-length dichiarato oltre il cap bypassa subito il middleware", async () => {
    const bigBody = Buffer.alloc(MAX_MIDDLEWARE_BODY_BYTES + 64 * 1024, 121);
    await writeMarkerMiddleware("proxy-declared-big", "/proxy-declared-big");

    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("content-length", String(bigBody.length));
        res.end(bigBody);
      },
    });

    const response = await request(app).get("/proxy-declared-big").buffer(true).parse(binaryParser);

    expect(response.status).toBe(200);
    expect(response.headers["x-added-by-middleware"]).toBeUndefined();
    expect(response.headers["x-mock-source"]).toBe("backend");
    expect(response.body.length).toBe(bigBody.length);
  });

  test("una risposta text/event-stream bypassa il middleware e passa in streaming", async () => {
    await writeMarkerMiddleware("proxy-sse", "/proxy-sse");

    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write("data: uno\n\n");
        res.end("data: due\n\n");
      },
    });

    const response = await request(app).get("/proxy-sse");

    expect(response.status).toBe(200);
    expect(response.headers["x-added-by-middleware"]).toBeUndefined();
    expect(response.headers["x-mock-source"]).toBe("backend");
    expect(response.text).toContain("data: uno");
    expect(response.text).toContain("data: due");
  });

  test("una risposta gzip viene decodificata (in async) per il middleware (#26)", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-gzip",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-gzip",
  async transformResponse({ jsonBody }) {
    return { jsonBody: { ...jsonBody, added: true } };
  }
};
`,
    });

    const app = await buildApp({
      backendHandler: (_req, res) => {
        // Il backend ignora accept-encoding: identity e risponde compresso comunque.
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("content-encoding", "gzip");
        res.end(zlib.gzipSync(JSON.stringify({ fromBackend: true })));
      },
    });

    const response = await request(app).get("/proxy-gzip");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ fromBackend: true, added: true });
  });

  test("una bomba di decompressione non viene gonfiata: il middleware vede solo il body compresso (#26)", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-bomb",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-bomb",
  async transformResponse({ bodyText, jsonBody, bodyBuffer }) {
    // Il middleware fa da testimone: riferisce se il body gli è arrivato decodificato.
    return { jsonBody: { decoded: bodyText != null || jsonBody != null, rawBytes: bodyBuffer.length } };
  }
};
`,
    });

    // ~55MB di zeri: compressi stanno in pochi KB (sotto il cap di buffering),
    // ma decompressi supererebbero il tetto di 50MB sull'output.
    const bomb = zlib.gzipSync(Buffer.alloc(55 * 1024 * 1024));
    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("content-encoding", "gzip");
        res.end(bomb);
      },
    });

    const response = await request(app).get("/proxy-bomb");

    expect(response.status).toBe(200);
    expect(response.body.decoded).toBe(false);
    expect(response.body.rawBytes).toBe(bomb.length);
  });

  test("proxy middleware receives jsonBody for valid JSON even with a +json content type", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-plus-json",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-plus-json",
  async transformResponse({ jsonBody }) {
    return {
      jsonBody: {
        ...jsonBody,
        intercepted: true
      }
    };
  }
};
`,
    });

    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/problem+json; charset=utf-8");
        res.end(JSON.stringify({ title: "problem" }));
      },
    });

    const response = await request(app).get("/proxy-plus-json");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      title: "problem",
      intercepted: true,
    });
    expect(response.headers["x-mock-source"]).toBe("middleware");
  });

  test("proxy middleware requests identity encoding for buffered upstream JSON responses", async () => {
    let seenAcceptEncoding;

    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-array-identity",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-array-identity",
  async transformResponse({ jsonBody, headers }) {
    return {
      headers: {
        ...headers,
        "x-array-length": String(Array.isArray(jsonBody) ? jsonBody.length : 0)
      },
      jsonBody
    };
  }
};
`,
    });

    const app = await buildApp({
      backendHandler: (req, res) => {
        seenAcceptEncoding = req.headers["accept-encoding"];
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify([{ code: "LAZ" }, { code: "LOM" }]));
      },
    });

    const response = await request(app)
      .get("/proxy-array-identity")
      .set("accept-encoding", "gzip");

    expect(seenAcceptEncoding).toBe("identity");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ code: "LAZ" }, { code: "LOM" }]);
    expect(response.headers["x-array-length"]).toBe("2");
    expect(response.headers["x-mock-source"]).toBe("middleware");
  });

  test("proxy middleware receives jsonBody for gzipped JSON arrays", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-gzip-array",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-gzip-array",
  async transformResponse({ jsonBody, headers }) {
    return {
      headers: {
        ...headers,
        "x-body-kind": Array.isArray(jsonBody) ? "array" : "missing"
      },
      jsonBody
    };
  }
};
`,
    });

    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("content-encoding", "gzip");
        res.end(zlib.gzipSync(Buffer.from(JSON.stringify([{ id: 1 }, { id: 2 }]), "utf8")));
      },
    });

    const response = await request(app).get("/proxy-gzip-array");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 1 }, { id: 2 }]);
    expect(response.headers["x-body-kind"]).toBe("array");
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.headers["x-mock-source"]).toBe("middleware");
  });

  test("proxy middleware receives jsonBody for valid JSON even without a JSON content type", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-json-without-header",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-json-without-header",
  async transformResponse({ jsonBody }) {
    return {
      jsonBody: {
        ...jsonBody,
        intercepted: true
      }
    };
  }
};
`,
    });

    const app = await buildApp({
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(JSON.stringify({ title: "plain-json" }));
      },
    });

    const response = await request(app).get("/proxy-json-without-header");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      title: "plain-json",
      intercepted: true,
    });
    expect(response.headers["x-mock-source"]).toBe("middleware");
  });

  test("proxy middleware failures fall back to the original upstream response", async () => {
    logger = createMemoryLogger();

    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-fallback",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-fallback",
  async transformResponse() {
    throw new Error("transform failed");
  }
};
`,
    });

    const app = await buildApp({
      customLogger: logger,
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("x-upstream-header", "present");
        res.end(JSON.stringify({ proxied: true }));
      },
    });

    const response = await request(app).get("/proxy-fallback");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ proxied: true });
    expect(response.headers["x-upstream-header"]).toBe("present");
    expect(response.headers["x-mock-source"]).toBe("middleware");
    expect(logger.entries.error).toContainEqual({
      message: "Proxy middleware failed. Returning unmodified upstream response.",
      fields: expect.objectContaining({
        requestPath: "/proxy-fallback",
        middlewarePath: "/proxy-fallback",
        middlewareFilePath: expect.stringContaining("GET.responses"),
        error: "transform failed",
      }),
    });
  });

  test("un transformResponse che non risolve mai non lascia la richiesta appesa (#34)", async () => {
    logger = createMemoryLogger();

    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-hang",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-hang",
  async transformResponse() {
    return new Promise(() => {});
  }
};
`,
    });

    const app = await buildApp({
      timeoutMs: 300,
      customLogger: logger,
      backendHandler: (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.setHeader("x-upstream-header", "present");
        res.end(JSON.stringify({ proxied: true }));
      },
    });

    const response = await request(app).get("/proxy-hang");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ proxied: true });
    expect(response.headers["x-upstream-header"]).toBe("present");
    expect(response.headers["x-mock-source"]).toBe("middleware");
    expect(logger.entries.error).toContainEqual({
      message: "Proxy middleware failed. Returning unmodified upstream response.",
      fields: expect.objectContaining({
        requestPath: "/proxy-hang",
        middlewarePath: "/proxy-hang",
        error: "Proxy middleware transformResponse timed out after 300ms.",
      }),
    });
  }, 10000);

  test("upstream timeout returns 502", async () => {
    logger = createMemoryLogger();
    const app = await buildApp({
      timeoutMs: 50,
      customLogger: logger,
      backendHandler: (_req, res) => {
        setTimeout(() => {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ slow: true }));
        }, 200);
      },
    });

    const response = await request(app).get("/slow");
    expect(response.status).toBe(502);
    expect(response.body.error).toBe("Bad Gateway");
    expect(response.headers["x-mock-source"]).toBe("backend");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(logger.entries.error).toHaveLength(1);
    expect(logger.entries.error[0]).toEqual({
      message: "Proxy request failed.",
      fields: expect.objectContaining({
        method: "GET",
        requestPath: "/slow",
        backendUrl: backend.url,
        upstreamProtocol: "http:",
        upstreamHost: "127.0.0.1",
        upstreamPath: "/slow",
        requestTimeoutMs: 50,
        error: "upstream_timeout",
        errorName: "Error",
        errorType: "timeout",
        errorStack: expect.any(String),
      }),
    });
  });

  test("connection failures log upstream communication details", async () => {
    logger = createMemoryLogger();
    const app = createApp({
      registry: new MockRegistry([]),
      config: {
        backendUrl: "http://127.0.0.1:1",
        requestTimeoutMs: 100,
      },
      logger,
    });

    const response = await request(app).get("/unreachable");
    expect(response.status).toBe(502);
    expect(response.body.error).toBe("Bad Gateway");
    expect(logger.entries.error).toHaveLength(1);
    expect(logger.entries.error[0]).toEqual({
      message: "Proxy request failed.",
      fields: expect.objectContaining({
        method: "GET",
        requestPath: "/unreachable",
        backendUrl: "http://127.0.0.1:1",
        upstreamProtocol: "http:",
        upstreamHost: "127.0.0.1",
        upstreamPort: "1",
        upstreamPath: "/unreachable",
        requestTimeoutMs: 100,
        errorName: "Error",
        errorType: "connection_refused",
        errorCode: "ECONNREFUSED",
        errorStack: expect.any(String),
      }),
    });
  });

  test("monitoring API stores mocked requests with redacted headers and formatted payload", async () => {
    await writeMock({
      mocksDir,
      folder: "monitor-mock",
      method: "POST",
      routePath: "/monitor-mock",
      body: { ok: true },
    });

    const app = await buildApp();
    const response = await request(app)
      .post("/monitor-mock")
      .set("authorization", "Bearer secret-token")
      .send({ feature: "monitoring", enabled: true });

    expect(response.status).toBe(200);

    const monitorResponse = await request(app).get("/_admin/api/monitoring/requests");

    expect(monitorResponse.status).toBe(200);
    expect(monitorResponse.body.items).toHaveLength(1);
    expect(monitorResponse.body.items[0]).toEqual(
      expect.objectContaining({
        method: "POST",
        path: "/monitor-mock",
        status: 200,
        source: "mock",
        matchedRoutePath: "/monitor-mock",
        requestHeaders: expect.objectContaining({
          authorization: "***",
        }),
        requestBody: expect.stringContaining('"feature": "monitoring"'),
      })
    );
  });

  test("monitoring API distinguishes proxied and middleware requests", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "monitor-middleware",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/monitor-middleware",
  async transformResponse({ jsonBody }) {
    return {
      jsonBody: {
        ...jsonBody,
        transformed: true
      }
    };
  }
};
`,
    });

    const app = await buildApp({
      backendHandler: (req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ path: req.url }));
      },
    });

    await request(app).get("/only-proxy");
    await request(app).get("/monitor-middleware");

    const monitorResponse = await request(app).get("/_admin/api/monitoring/requests");

    expect(monitorResponse.status).toBe(200);
    expect(monitorResponse.body.items).toHaveLength(2);
    expect(monitorResponse.body.items[0]).toEqual(
      expect.objectContaining({
        path: "/monitor-middleware",
        source: "middleware",
        middlewareRoutePath: "/monitor-middleware",
      })
    );
    expect(monitorResponse.body.items[1]).toEqual(
      expect.objectContaining({
        path: "/only-proxy",
        source: "backend",
      })
    );
  });

  test("monitoring API can clear the stored request log", async () => {
    await writeMock({
      mocksDir,
      folder: "monitor-clear",
      method: "GET",
      routePath: "/monitor-clear",
      body: { ok: true },
    });

    const app = await buildApp();

    await request(app).get("/monitor-clear");
    const beforeClearResponse = await request(app).get("/_admin/api/monitoring/requests");
    expect(beforeClearResponse.body.items).toHaveLength(1);

    const clearResponse = await request(app).delete("/_admin/api/monitoring/requests");
    expect(clearResponse.status).toBe(204);

    const afterClearResponse = await request(app).get("/_admin/api/monitoring/requests");
    expect(afterClearResponse.body.items).toEqual([]);
  });
});
