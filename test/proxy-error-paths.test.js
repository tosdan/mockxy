const http = require("http");
const zlib = require("zlib");
const request = require("supertest");
const { createApp } = require("../src/app");
const {
  buildBufferedUpstreamResponse,
  classifyUpstreamError,
  resolveProxyMiddlewareResponse,
  sanitizeRequestHeaders,
  serializeError,
} = require("../src/proxy/proxy");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const {
  createNoopLogger,
  createTempDir,
  removeDir,
  startBackendServer,
  stopBackendServer,
  waitFor,
  writeProxyMiddleware,
} = require("./helpers");

// Rami d'errore e validazioni del proxy (punto B2 di archived/PIANO-TEST.md): le vie che i bug
// colpiscono più spesso e che non si riproducono facilmente a mano.

describe("classifyUpstreamError", () => {
  test("classifica timeout, abort del client e i codici di rete noti", () => {
    expect(classifyUpstreamError(null)).toBe("unknown");
    expect(classifyUpstreamError(new Error("upstream_timeout"))).toBe("timeout");
    expect(classifyUpstreamError(new Error("client_aborted"))).toBe("client_aborted");
    expect(classifyUpstreamError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("connection_refused");
    expect(classifyUpstreamError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("connection_reset");
    expect(classifyUpstreamError(Object.assign(new Error("x"), { code: "ENOTFOUND" }))).toBe("dns_not_found");
    expect(classifyUpstreamError(Object.assign(new Error("x"), { code: "EAI_AGAIN" }))).toBe("dns_lookup_timeout");
    expect(classifyUpstreamError(Object.assign(new Error("x"), { code: "ETIMEDOUT" }))).toBe("socket_timeout");
    expect(classifyUpstreamError(Object.assign(new Error("x"), { code: "EMISTERO" }))).toBe("network_error");
  });
});

describe("serializeError", () => {
  test("senza errore ritorna un payload vuoto", () => {
    expect(serializeError(null)).toEqual({});
  });

  test("include messaggio, codice, stack e causa quando presenti", () => {
    const cause = new Error("origine");
    const error = Object.assign(new Error("guasto"), { code: "EX", cause });
    const details = serializeError(error);
    expect(details.error).toBe("guasto");
    expect(details.errorCode).toBe("EX");
    expect(details.errorStack).toContain("guasto");
    expect(details.errorCause).toBe("origine");
  });
});

describe("resolveProxyMiddlewareResponse (contratto del risultato)", () => {
  const upstream = {
    status: 200,
    headers: { "content-type": "text/plain", "content-length": "4", "x-keep": "1" },
    bodyBuffer: Buffer.from("ciao"),
  };

  test("undefined → passthrough della risposta upstream", () => {
    const out = resolveProxyMiddlewareResponse(upstream, undefined);
    expect(out).toEqual({ status: 200, headers: upstream.headers, body: upstream.bodyBuffer });
  });

  test("un risultato non-oggetto (array o primitivo) viene rifiutato", () => {
    expect(() => resolveProxyMiddlewareResponse(upstream, [])).toThrow("must return an object");
    expect(() => resolveProxyMiddlewareResponse(upstream, "no")).toThrow("must return an object");
  });

  test("status fuori range o non intero viene rifiutato", () => {
    expect(() => resolveProxyMiddlewareResponse(upstream, { status: 99 })).toThrow("valid HTTP status");
    expect(() => resolveProxyMiddlewareResponse(upstream, { status: 600 })).toThrow("valid HTTP status");
    expect(() => resolveProxyMiddlewareResponse(upstream, { status: "abc" })).toThrow("valid HTTP status");
  });

  test("body e jsonBody insieme vengono rifiutati", () => {
    expect(() => resolveProxyMiddlewareResponse(upstream, { body: "x", jsonBody: {} }))
      .toThrow("cannot return both");
  });

  test("un body che non è Buffer né stringa viene rifiutato", () => {
    expect(() => resolveProxyMiddlewareResponse(upstream, { body: 42 })).toThrow("Buffer or a string");
    expect(() => resolveProxyMiddlewareResponse(upstream, { body: { json: true } })).toThrow("Buffer or a string");
  });

  test("un body stringa sostituisce il payload e ripulisce gli header dipendenti dal body", () => {
    const out = resolveProxyMiddlewareResponse(upstream, { status: 201, body: "nuovo" });
    expect(out.status).toBe(201);
    expect(out.body).toBe("nuovo");
    expect(out.headers["content-length"]).toBeUndefined();
    expect(out.headers["x-keep"]).toBe("1");
  });

  test("headers non-oggetto e removeHeaders non-array vengono rifiutati", () => {
    expect(() => resolveProxyMiddlewareResponse(upstream, { headers: ["no"] })).toThrow("headers as an object");
    expect(() => resolveProxyMiddlewareResponse(upstream, { removeHeaders: "x-keep" })).toThrow("removeHeaders as an array");
  });

  test("removeHeaders rimuove (case-insensitive) anche senza header nuovi", () => {
    const out = resolveProxyMiddlewareResponse(upstream, { removeHeaders: ["X-KEEP"] });
    expect(out.headers["x-keep"]).toBeUndefined();
    expect(out.body).toBe(upstream.bodyBuffer);
  });

  test("gli header nuovi vincono su quelli upstream e i valori undefined sono ignorati", () => {
    const out = resolveProxyMiddlewareResponse(upstream, {
      headers: { "x-keep": "2", "x-skip": undefined },
      removeHeaders: ["content-type"],
    });
    expect(out.headers["x-keep"]).toBe("2");
    expect(out.headers["x-skip"]).toBeUndefined();
    expect(out.headers["content-type"]).toBeUndefined();
  });
});

describe("buildBufferedUpstreamResponse (decodifica per il middleware)", () => {
  test("deflate e brotli vengono decodificati per bodyText/jsonBody", async () => {
    const json = JSON.stringify({ ok: true });
    const deflated = await buildBufferedUpstreamResponse(
      { statusCode: 200, headers: { "content-type": "application/json", "content-encoding": "deflate" } },
      zlib.deflateSync(json),
    );
    expect(deflated.jsonBody).toEqual({ ok: true });

    const brotlied = await buildBufferedUpstreamResponse(
      { statusCode: 200, headers: { "content-type": "application/json", "content-encoding": "br" } },
      zlib.brotliCompressSync(json),
    );
    expect(brotlied.jsonBody).toEqual({ ok: true });
  });

  test("una content-encoding sconosciuta lascia solo i byte grezzi (niente bodyText/jsonBody)", async () => {
    const out = await buildBufferedUpstreamResponse(
      { statusCode: 200, headers: { "content-type": "application/json", "content-encoding": "zstd" } },
      Buffer.from("irrilevante"),
    );
    expect(out.bodyText).toBeUndefined();
    expect(out.jsonBody).toBeUndefined();
    expect(out.bodyBuffer).toEqual(Buffer.from("irrilevante"));
  });

  test("content-encoding identity è equivalente all'assenza", async () => {
    const out = await buildBufferedUpstreamResponse(
      { statusCode: 200, headers: { "content-type": "application/json", "content-encoding": "identity" } },
      Buffer.from('{"a":1}'),
    );
    expect(out.jsonBody).toEqual({ a: 1 });
  });

  test("con content-type JSON dichiarato anche uno scalare è jsonBody; senza dichiarazione serve un corpo strutturato", async () => {
    const declared = await buildBufferedUpstreamResponse(
      { statusCode: 200, headers: { "content-type": "application/json" } },
      Buffer.from("42"),
    );
    expect(declared.jsonBody).toBe(42);

    const undeclaredScalar = await buildBufferedUpstreamResponse(
      { statusCode: 200, headers: { "content-type": "text/plain" } },
      Buffer.from("42"),
    );
    expect(undeclaredScalar.jsonBody).toBeUndefined();
    expect(undeclaredScalar.bodyText).toBe("42");

    const undeclaredStructured = await buildBufferedUpstreamResponse(
      { statusCode: 200, headers: { "content-type": "text/plain" } },
      Buffer.from('{"a":1}'),
    );
    expect(undeclaredStructured.jsonBody).toEqual({ a: 1 });
  });

  test("JSON dichiarato ma invalido non produce jsonBody", async () => {
    const out = await buildBufferedUpstreamResponse(
      { statusCode: 200, headers: { "content-type": "application/json" } },
      Buffer.from("{rotto"),
    );
    expect(out.jsonBody).toBeUndefined();
  });

  test("uno statusCode mancante degrada a 502", async () => {
    const out = await buildBufferedUpstreamResponse({ statusCode: 0, headers: {} }, Buffer.alloc(0));
    expect(out.status).toBe(502);
  });
});

describe("sanitizeRequestHeaders (hop-by-hop)", () => {
  test("rimuove gli header elencati in Connection oltre a quelli standard", () => {
    const out = sanitizeRequestHeaders(
      {
        host: "originale",
        connection: "keep-alive, X-Custom-Hop",
        "x-custom-hop": "via",
        "keep-alive": "timeout=5",
        "x-resta": "1",
      },
      "backend:8080",
      false,
    );
    expect(out.host).toBe("backend:8080");
    expect(out["x-custom-hop"]).toBeUndefined();
    expect(out["keep-alive"]).toBeUndefined();
    expect(out.connection).toBeUndefined();
    expect(out["x-resta"]).toBe("1");
  });
});

describe("proxy sotto guasto (integrazione)", () => {
  let mocksDir;
  let backend;
  let appServer;

  beforeEach(async () => {
    mocksDir = await createTempDir();
  });

  afterEach(async () => {
    if (appServer) {
      await new Promise((resolve) => appServer.close(resolve));
      appServer = null;
    }
    if (backend) {
      await stopBackendServer(backend.server);
      backend = null;
    }
    if (mocksDir) {
      await removeDir(mocksDir);
      mocksDir = null;
    }
  });

  async function buildApp(backendHandler) {
    backend = await startBackendServer(backendHandler);
    const { mockRouteGroups, handlerRouteGroups, proxyMiddlewareRouteGroups } =
      await loadEndpointRouteGroups(mocksDir);
    const registry = new MockRegistry(mergeLocalRouteGroups({ mockRouteGroups, handlerRouteGroups }));
    return createApp({
      registry,
      config: {
        backendUrl: backend.url,
        delayAllRequests: false,
        globalDelayMs: 0,
        requestTimeoutMs: 15000,
      },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry(proxyMiddlewareRouteGroups),
      requestMonitor: new RequestMonitorStore(),
    });
  }

  test("backend che muore durante il buffering per il middleware → 502 pulito", async () => {
    await writeProxyMiddleware({
      mocksDir,
      folder: "proxy-troncata",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/proxy-troncata",
  async transformResponse({ headers }) {
    return { headers: { ...headers, "x-added-by-middleware": "true" } };
  }
};
`,
    });
    const app = await buildApp((_req, res) => {
      // dichiara più byte di quanti ne scriva, poi tronca la connessione: il buffering
      // della risposta upstream fallisce PRIMA che qualcosa parta verso il client.
      res.writeHead(200, { "content-type": "application/json", "content-length": "1000" });
      res.write('{"parziale":');
      setTimeout(() => res.destroy(), 20);
    });

    const response = await request(app).get("/proxy-troncata");

    expect(response.status).toBe(502);
    expect(response.body.error).toBe("Bad Gateway");
    expect(response.headers["x-added-by-middleware"]).toBeUndefined();
  });

  test("backend che muore a metà stream (senza middleware) → troncamento visibile al client", async () => {
    const app = await buildApp((_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": "1000" });
      res.write("solo-un-pezzo");
      setTimeout(() => res.destroy(), 20);
    });
    appServer = app.listen(0);
    const port = appServer.address().port;

    const outcome = await new Promise((resolve) => {
      const clientReq = http.get({ host: "127.0.0.1", port, path: "/stream-morto" }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        // il troncamento DEVE emergere come errore di rete, non come risposta completata
        res.on("end", () => resolve({ kind: "end", body: Buffer.concat(chunks).toString() }));
        res.on("error", (error) => resolve({ kind: "error", status: res.statusCode, error }));
        res.on("aborted", () => resolve({ kind: "aborted", status: res.statusCode }));
      });
      clientReq.on("error", (error) => resolve({ kind: "request-error", error }));
    });

    expect(outcome.kind).not.toBe("end");
  });

  test("client che abbandona durante lo streaming → la tratta upstream viene distrutta", async () => {
    let upstreamClosed = false;
    const app = await buildApp((_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const timer = setInterval(() => res.write("chunk "), 10);
      res.on("close", () => {
        clearInterval(timer);
        upstreamClosed = true;
      });
    });
    appServer = app.listen(0);
    const port = appServer.address().port;

    await new Promise((resolve) => {
      const clientReq = http.get({ host: "127.0.0.1", port, path: "/download-lento" }, (res) => {
        res.once("data", () => {
          clientReq.destroy(); // il client molla a download iniziato
          resolve();
        });
      });
      clientReq.on("error", () => resolve());
    });

    await waitFor(() => upstreamClosed);
    expect(upstreamClosed).toBe(true);
  });
});
