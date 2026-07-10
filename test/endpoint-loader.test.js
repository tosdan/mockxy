const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { createServerRuntime } = require("../src/server");
const { createNoopLogger, createTempDir, removeDir, writeHandler, writeMock } = require("./helpers");

// Degradazione per-endpoint del loader (#5 revisione): un file rotto viene saltato e
// segnalato in loadErrors, senza bloccare il caricamento degli altri endpoint.
describe("endpoint loader graceful degradation", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("endpoint-loader-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  async function writeBrokenEndpoint(folder) {
    const brokenDir = path.join(mocksDir, folder);
    await fs.promises.mkdir(brokenDir, { recursive: true });
    const brokenPath = path.join(brokenDir, "GET.endpoint.json");
    await fs.promises.writeFile(brokenPath, "{ invalid json", "utf8");
    return brokenPath;
  }

  test("un endpoint con JSON invalido viene saltato e segnalato, gli altri caricano", async () => {
    await writeMock({
      mocksDir,
      folder: "valid",
      method: "GET",
      routePath: "/valid",
      body: { ok: true },
    });
    const brokenPath = await writeBrokenEndpoint("broken");

    const result = await loadEndpointRouteGroups(mocksDir);

    expect(result.mockRouteGroups).toHaveLength(1);
    expect(result.mockRouteGroups[0].path).toBe("/valid");
    expect(result.loadErrors).toHaveLength(1);
    expect(result.loadErrors[0].filePath).toBe(brokenPath);
    expect(result.loadErrors[0].message).toContain("Invalid JSON");
  });

  test("una response selezionata mancante non blocca gli altri endpoint", async () => {
    await writeMock({
      mocksDir,
      folder: "valid",
      method: "GET",
      routePath: "/valid",
      body: { ok: true },
    });
    await writeMock({
      mocksDir,
      folder: "orphan",
      method: "GET",
      routePath: "/orphan",
      body: { ok: true },
    });
    await fs.promises.rm(path.join(mocksDir, "orphan", "GET.responses", "001.response.json"));

    const result = await loadEndpointRouteGroups(mocksDir);

    expect(result.mockRouteGroups).toHaveLength(1);
    expect(result.mockRouteGroups[0].path).toBe("/valid");
    expect(result.loadErrors).toHaveLength(1);
    expect(result.loadErrors[0].message).toContain("Missing selected response");
  });

  test("un helper condiviso modificato viene ricaricato alla scansione successiva", async () => {
    await writeHandler({
      mocksDir,
      folder: "with-helper",
      method: "GET",
      source: `const helper = require("./helper");
module.exports = {
  path: "/with-helper",
  async resolveResponse() {
    return { jsonBody: { value: helper.value } };
  }
};
`,
    });
    const helperPath = path.join(mocksDir, "with-helper", "GET.responses", "helper.js");
    await fs.promises.writeFile(helperPath, "module.exports = { value: 1 };\n", "utf8");

    const first = await loadEndpointRouteGroups(mocksDir);
    expect(first.loadErrors).toEqual([]);
    const firstResult = await first.handlerRouteGroups[0].methods.get("GET").resolveResponse({});
    expect(firstResult.jsonBody.value).toBe(1);

    await fs.promises.writeFile(helperPath, "module.exports = { value: 2 };\n", "utf8");
    // La firma della cache è mtime+dimensione: qui la dimensione non cambia e due scritture
    // nello stesso millisecondo avrebbero lo stesso mtime (flaky). Un utente reale non riscrive
    // il file nello stesso istante della scansione: forziamo un mtime diverso, senza sleep.
    const bumpedMtime = new Date(Date.now() + 10);
    await fs.promises.utimes(helperPath, bumpedMtime, bumpedMtime);

    const second = await loadEndpointRouteGroups(mocksDir);
    expect(second.loadErrors).toEqual([]);
    const secondResult = await second.handlerRouteGroups[0].methods.get("GET").resolveResponse({});
    expect(secondResult.jsonBody.value).toBe(2);
  });

  test("la scansione non ri-esegue gli script non toccati (compilazione incrementale)", async () => {
    // Handler con side effect al top-level: ogni compilazione appende un carattere al marker.
    await writeHandler({
      mocksDir,
      folder: "fx",
      method: "GET",
      source: `const fs = require("fs");
const nodePath = require("path");
const helper = require("./helper");
fs.appendFileSync(nodePath.join(__dirname, "..", "..", "marker.txt"), "x");
module.exports = {
  path: "/fx",
  async resolveResponse() {
    return { jsonBody: { value: helper.value } };
  }
};
`,
    });
    const helperPath = path.join(mocksDir, "fx", "GET.responses", "helper.js");
    const markerPath = path.join(mocksDir, "marker.txt");
    await fs.promises.writeFile(helperPath, "module.exports = { value: 1 };\n", "utf8");

    const readMarker = async () => (await fs.promises.readFile(markerPath, "utf8")).length;

    const first = await loadEndpointRouteGroups(mocksDir);
    expect(first.loadErrors).toEqual([]);
    expect(await readMarker()).toBe(1);

    // Aggiungere/modificare un mock JSON non deve ricompilare l'handler.
    await writeMock({ mocksDir, folder: "other", method: "GET", routePath: "/other", body: { ok: true } });
    const second = await loadEndpointRouteGroups(mocksDir);
    expect(second.loadErrors).toEqual([]);
    expect(await readMarker()).toBe(1);
    const secondResult = await second.handlerRouteGroups[0].methods.get("GET").resolveResponse({});
    expect(secondResult.jsonBody.value).toBe(1);

    // Modificare una dipendenza dell'handler deve invalidarlo e ricompilare.
    await fs.promises.writeFile(helperPath, "module.exports = { value: 22 };\n", "utf8");
    const third = await loadEndpointRouteGroups(mocksDir);
    expect(await readMarker()).toBe(2);
    const thirdResult = await third.handlerRouteGroups[0].methods.get("GET").resolveResponse({});
    expect(thirdResult.jsonBody.value).toBe(22);
  });

  test("il server parte comunque con un endpoint rotto e serve gli altri mock", async () => {
    await writeMock({
      mocksDir,
      folder: "valid",
      method: "GET",
      routePath: "/valid",
      body: { ok: true },
    });
    await writeBrokenEndpoint("broken");

    const runtime = await createServerRuntime({
      configOverrides: {
        mocksDir,
        devWatch: false,
        adminApiEnabled: false,
        proxyFallbackEnabled: false,
      },
      logger: createNoopLogger(),
    });

    const response = await request(runtime.app).get("/valid");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(response.headers["x-mock-source"]).toBe("mock");
  });
});
