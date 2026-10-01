const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { loadScriptModule } = require("../src/mocks/script-loader");
const { createServerRuntime } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir, writeHandler, writeMock } = require("./helpers");

// Require dalla radice dei mock: handler e middleware importano gli helper condivisi con la
// stessa stringa (`require("_shared/…")`) a qualsiasi profondità, così copiare o spostare un mock
// non rompe il riferimento. Gli helper si importano tra loro con path relativi.

async function writeSharedHelpers(mocksDir, value) {
  const sharedDir = path.join(mocksDir, "_shared");
  await fs.promises.mkdir(sharedDir, { recursive: true });
  await fs.promises.writeFile(path.join(sharedDir, "dati.js"), `module.exports = { value: ${JSON.stringify(value)} };\n`, "utf8");
  await fs.promises.writeFile(
    path.join(sharedDir, "flusso.js"),
    `const dati = require("./dati");\nmodule.exports = { leggi: () => dati.value };\n`,
    "utf8"
  );
  return sharedDir;
}

function handlerSource(routePath, specifier) {
  return `const flusso = require(${JSON.stringify(specifier)});
module.exports = {
  path: ${JSON.stringify(routePath)},
  async resolveResponse() {
    return { jsonBody: { value: flusso.leggi() } };
  }
};
`;
}

const ROOT_SOURCE = `module.exports = {
  async resolveResponse() {
    return { jsonBody: { value: require("_shared/flusso").leggi() } };
  }
};
`;

describe("loader: require dalla radice dei mock", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("mocks-root-require-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  async function resolveValue(result, routePath) {
    const group = result.handlerRouteGroups.find((entry) => entry.path === routePath);
    return (await group.methods.get("GET").resolveResponse({})).jsonBody.value;
  }

  test("senza radice il loader rifiuta la chiamata invece di risolvere a metà", async () => {
    await writeHandler({ mocksDir, folder: "a", method: "GET", source: handlerSource("/a", "./x") });
    const scriptPath = path.join(mocksDir, "a", "GET.responses", "001.handler.js");

    for (const missingRoot of [undefined, null, "", "   "]) {
      expect(() => loadScriptModule(scriptPath, missingRoot)).toThrow("requires the mocks directory");
    }
  });

  test("la stessa stringa risolve a profondità diverse, accanto ai require relativi esistenti", async () => {
    await writeSharedHelpers(mocksDir, 1);
    await writeHandler({ mocksDir, folder: "a/b/c", method: "GET", source: handlerSource("/profondo", "_shared/flusso") });
    await writeHandler({ mocksDir, folder: "a", method: "GET", source: handlerSource("/superficiale", "_shared/flusso") });
    await writeHandler({ mocksDir, folder: "rel", method: "GET", source: handlerSource("/relativo", "../../_shared/flusso") });

    const result = await loadEndpointRouteGroups(mocksDir);

    expect(result.loadErrors).toEqual([]);
    expect(await resolveValue(result, "/profondo")).toBe(1);
    expect(await resolveValue(result, "/superficiale")).toBe(1);
    expect(await resolveValue(result, "/relativo")).toBe(1);
  });

  test("la modifica di un helper annidato viene ricaricata alla scansione successiva", async () => {
    const sharedDir = await writeSharedHelpers(mocksDir, 1);
    await writeHandler({ mocksDir, folder: "a/b/c", method: "GET", source: handlerSource("/profondo", "_shared/flusso") });

    const first = await loadEndpointRouteGroups(mocksDir);
    expect(first.loadErrors).toEqual([]);
    expect(await resolveValue(first, "/profondo")).toBe(1);

    const datiPath = path.join(sharedDir, "dati.js");
    await fs.promises.writeFile(datiPath, "module.exports = { value: 2 };\n", "utf8");
    // Firma della cache = mtime+dimensione, e la dimensione non cambia: mtime forzato, senza sleep.
    const bumpedMtime = new Date(Date.now() + 10);
    await fs.promises.utimes(datiPath, bumpedMtime, bumpedMtime);

    const second = await loadEndpointRouteGroups(mocksDir);
    expect(second.loadErrors).toEqual([]);
    expect(await resolveValue(second, "/profondo")).toBe(2);
  });

  test("un handler usato come step di una sequence risolve dalla radice", async () => {
    await writeSharedHelpers(mocksDir, "da-sequence");
    await writeHandler({ mocksDir, folder: "a/b", method: "GET", source: handlerSource("/seq", "_shared/flusso") });
    const endpointPath = path.join(mocksDir, "a", "b", "GET.endpoint.json");
    const responseDir = path.join(mocksDir, "a", "b", "GET.responses");
    await fs.promises.writeFile(
      path.join(responseDir, "002.response.json"),
      JSON.stringify({
        type: "sequence",
        title: "",
        steps: [{ response: "001.response.json", times: 1 }, { response: "001.response.json" }],
        onEnd: "stay",
      }),
      "utf8"
    );
    const endpoint = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
    endpoint.responseFiles.push("002.response.json");
    endpoint.selectedResponseFile = "002.response.json";
    await fs.promises.writeFile(endpointPath, JSON.stringify(endpoint), "utf8");

    const result = await loadEndpointRouteGroups(mocksDir);

    expect(result.loadErrors).toEqual([]);
    const [step] = result.sequenceRouteGroups[0].methods.get("GET").steps;
    expect((await step.resolveResponse({})).jsonBody.value).toBe("da-sequence");
  });

  test("due workspace risolvono ciascuno i propri helper", async () => {
    const otherMocksDir = await createTempDir("mocks-root-require-other-");
    try {
      await writeSharedHelpers(mocksDir, "primo");
      await writeSharedHelpers(otherMocksDir, "secondo");
      for (const dir of [mocksDir, otherMocksDir]) {
        await writeHandler({ mocksDir: dir, folder: "a/b", method: "GET", source: handlerSource("/ws", "_shared/flusso") });
      }

      const first = await loadEndpointRouteGroups(mocksDir);
      const second = await loadEndpointRouteGroups(otherMocksDir);

      expect(await resolveValue(first, "/ws")).toBe("primo");
      expect(await resolveValue(second, "/ws")).toBe("secondo");
    } finally {
      await removeDir(otherMocksDir);
    }
  });

  test("i pacchetti in node_modules mantengono la precedenza sulla radice dei mock", async () => {
    await fs.promises.writeFile(path.join(mocksDir, "omonimo.js"), "module.exports = { leggi: () => \"radice\" };\n", "utf8");
    const packageDir = path.join(mocksDir, "a", "node_modules", "omonimo");
    await fs.promises.mkdir(packageDir, { recursive: true });
    await fs.promises.writeFile(path.join(packageDir, "index.js"), "module.exports = { leggi: () => \"pacchetto\" };\n", "utf8");
    await writeHandler({ mocksDir, folder: "a/b", method: "GET", source: handlerSource("/pkg", "omonimo") });

    const result = await loadEndpointRouteGroups(mocksDir);

    expect(result.loadErrors).toEqual([]);
    expect(await resolveValue(result, "/pkg")).toBe("pacchetto");
  });
});

describe("admin: require dalla radice dei mock", () => {
  let workspaceDir;
  let mocksDir;
  let app;

  beforeEach(async () => {
    workspaceDir = await createTempDir("mocks-root-require-admin-");
    mocksDir = path.join(workspaceDir, "mocks");
    await fs.promises.mkdir(mocksDir, { recursive: true });
    await writeSharedHelpers(mocksDir, "condiviso");
  });

  afterEach(async () => {
    await removeDir(workspaceDir);
  });

  async function startRuntime() {
    const runtime = await createServerRuntime({
      configOverrides: {
        host: "127.0.0.1",
        mocksDir,
        monitorDumpDir: path.join(workspaceDir, "dump"),
        devWatch: false,
        adminApiEnabled: true,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });
    app = runtime.app;
  }

  test("un handler salvato dall'admin in profondità risolve dalla radice", async () => {
    await writeMock({ mocksDir, folder: "a/b/c", method: "GET", routePath: "/a/b/c", body: { mock: true } });
    await startRuntime();

    const created = await request(app)
      .post(`/_admin/api/mocks/${encodeMockId("a/b/c/GET.endpoint.json")}/responses`)
      .send({ type: "handler", title: "Condiviso", source: ROOT_SOURCE });

    expect(created.status).toBe(201);
    expect((await request(app).get("/a/b/c")).body).toEqual({ value: "condiviso" });
  });

  test("il Copy verso una profondità diversa conserva il riferimento all'helper", async () => {
    await writeHandler({ mocksDir, folder: "orig", method: "GET", source: handlerSource("/orig", "_shared/flusso") });
    await startRuntime();

    const copy = await request(app)
      .post(`/_admin/api/mocks/${encodeMockId("orig/GET.endpoint.json")}/copy`)
      .send({ method: "GET", path: "/x/y/z" });

    expect(copy.status).toBe(201);
    expect((await request(app).get("/x/y/z")).body).toEqual({ value: "condiviso" });
  });

  test("con un require relativo lo stesso Copy viene rifiutato", async () => {
    // Il caso che la risoluzione dalla radice evita: il path relativo dipende dalla profondità.
    await writeHandler({ mocksDir, folder: "orig", method: "GET", source: handlerSource("/orig", "../../_shared/flusso") });
    await startRuntime();

    const copy = await request(app)
      .post(`/_admin/api/mocks/${encodeMockId("orig/GET.endpoint.json")}/copy`)
      .send({ method: "GET", path: "/x/y/z" });

    expect(copy.status).toBeGreaterThanOrEqual(400);
    expect(fs.existsSync(path.join(mocksDir, "x", "y", "z", "GET.endpoint.json"))).toBe(false);
  });

  test("la validazione admin di una sequence risolve gli step handler dalla radice", async () => {
    await writeMock({ mocksDir, folder: "a/b", method: "GET", routePath: "/a/b", body: { mock: true } });
    await startRuntime();
    const id = encodeMockId("a/b/GET.endpoint.json");

    const handler = await request(app)
      .post(`/_admin/api/mocks/${id}/responses`)
      .send({ type: "handler", title: "Condiviso", source: ROOT_SOURCE, select: false });
    expect(handler.status).toBe(201);

    const sequence = await request(app)
      .post(`/_admin/api/mocks/${id}/responses`)
      .send({
        type: "sequence",
        title: "Scenario",
        onEnd: "stay",
        steps: [{ response: "002.response.json", times: 1 }, { response: "001.response.json" }],
      });

    expect(sequence.status).toBe(201);
    expect((await request(app).get("/a/b")).body).toEqual({ value: "condiviso" });
  });
});
