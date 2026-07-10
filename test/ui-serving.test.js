const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

describe("serving dell'interfaccia admin (/_admin/ui)", () => {
  let uiDistDir;

  const INDEX_HTML =
    '<!doctype html><html><head><base href="/_admin/ui/"></head>' +
    '<body><app-root></app-root><script src="main.js"></script></body></html>';
  const MAIN_JS = "console.log('mockxy ui');";

  beforeEach(async () => {
    uiDistDir = await createTempDir();
    await fs.promises.writeFile(path.join(uiDistDir, "index.html"), INDEX_HTML, "utf8");
    await fs.promises.writeFile(path.join(uiDistDir, "main.js"), MAIN_JS, "utf8");
  });

  afterEach(async () => {
    if (uiDistDir) {
      await removeDir(uiDistDir);
      uiDistDir = null;
    }
  });

  function buildApp({ serveUi = true } = {}) {
    return createApp({
      registry: new MockRegistry([]),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry([]),
      requestMonitor: new RequestMonitorStore(),
      logger: createNoopLogger(),
      config: {
        uiDistDir: serveUi ? uiDistDir : undefined,
        adminApiEnabled: false,
        // I miss dei mock tornano 404 invece di tentare il proxy: rende le asserzioni nette.
        proxyFallbackEnabled: false,
      },
    });
  }

  test("serve index.html alla radice dell'interfaccia", async () => {
    const response = await request(buildApp()).get("/_admin/ui/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("<app-root>");
  });

  test("serve gli asset statici", async () => {
    const response = await request(buildApp()).get("/_admin/ui/main.js");

    expect(response.status).toBe(200);
    expect(response.text).toContain("mockxy ui");
  });

  test("fallback a index.html per le route lato client (ricaricamento SPA)", async () => {
    const response = await request(buildApp()).get("/_admin/ui/storico");

    expect(response.status).toBe(200);
    expect(response.text).toContain("<app-root>");
  });

  test("non oscura i path dei mock nello spazio dei nomi radice", async () => {
    // Nessun mock + proxy fallback off → 404 mock-only, NON la index dell'interfaccia.
    const response = await request(buildApp()).get("/be/qualche/api");

    expect(response.status).toBe(404);
    expect(response.text).not.toContain("<app-root>");
    expect(response.headers["x-mock-source"]).toBe("mock-only");
  });

  test("è disattivato quando uiDistDir non è configurato", async () => {
    const response = await request(buildApp({ serveUi: false })).get("/_admin/ui/");

    expect(response.text).not.toContain("<app-root>");
    expect(response.status).toBe(404);
  });
});
