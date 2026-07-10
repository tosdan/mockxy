const fs = require("fs");
const path = require("path");
const { listAdminMocks, getAdminMockDetail } = require("../src/admin/mock-catalog");
const { encodeMockId } = require("../src/admin/mock-ids");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { createTempDir, removeDir } = require("./helpers");

// Regressioni dalla code review 2026-07-09 (doc 02 §1): la validazione admin era più severa
// del loader (response.file limitato al basename) e scattava anche in lettura, senza catch
// per-endpoint: un solo file valido per il runtime rendeva 400 l'intero catalogo admin.
describe("catalogo admin: parità col loader e degradazione per-endpoint", () => {
  let mocksDir;

  async function writeEndpoint(folder, endpoint, responses) {
    const configDir = path.join(mocksDir, folder);
    const responseDir = path.join(configDir, `${endpoint.method}.responses`);
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(configDir, `${endpoint.method}.endpoint.json`),
      `${JSON.stringify(endpoint, null, 2)}\n`,
      "utf8"
    );
    for (const [fileName, content] of Object.entries(responses)) {
      const filePath = path.join(responseDir, fileName);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(
        filePath,
        typeof content === "string" || Buffer.isBuffer(content) ? content : `${JSON.stringify(content, null, 2)}\n`
      );
    }
  }

  const imageEndpoint = {
    method: "GET",
    path: "/img",
    description: "",
    enabled: true,
    responseFiles: ["001.response.json"],
    selectedResponseFile: "001.response.json",
  };

  beforeEach(async () => {
    mocksDir = await createTempDir("catalog-listing-");
    // Il caso della review: response file-backed con l'asset in una SOTTOCARTELLA della
    // cartella response — valido per il loader, prima respinto dall'admin.
    await writeEndpoint("img", imageEndpoint, {
      "001.response.json": { type: "mock", title: "", status: 200, headers: {}, delayMs: 0, file: "assets/img.png" },
      "assets/img.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("un asset in sottocartella è valido per il loader E per il listing admin", async () => {
    const { mockRouteGroups, loadErrors } = await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toEqual([]);
    expect(mockRouteGroups).toHaveLength(1);

    const items = await listAdminMocks(mocksDir);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ method: "GET", path: "/img", payloadType: "file", file: "assets/img.png" });
  });

  test("il dettaglio risolve l'asset in sottocartella (fileInfo compreso)", async () => {
    const detail = await getAdminMockDetail(mocksDir, encodeMockId("img/GET.endpoint.json"));
    expect(detail.fileInfo).toEqual({ name: "assets/img.png", size: 4 });
  });

  test("un endpoint illeggibile viene saltato e segnalato, il resto del catalogo sopravvive", async () => {
    await writeEndpoint("rotto", { ...imageEndpoint, path: "/rotto" }, {});
    await fs.promises.writeFile(path.join(mocksDir, "rotto", "GET.endpoint.json"), "{ json invalido", "utf8");

    const loadErrors = [];
    const items = await listAdminMocks(mocksDir, loadErrors);

    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("/img");
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].configFilePath).toBe("rotto/GET.endpoint.json");
    expect(loadErrors[0].message).toContain("Invalid JSON");
  });

  test("asset sparito da disco: il dettaglio risponde 404 esplicito, non 500", async () => {
    await fs.promises.rm(path.join(mocksDir, "img", "GET.responses", "assets", "img.png"));

    await expect(getAdminMockDetail(mocksDir, encodeMockId("img/GET.endpoint.json"))).rejects.toMatchObject({
      status: 404,
      message: "Response asset file not found on disk.",
    });
  });

  test("sorgente script sparito da disco: il dettaglio risponde 404 esplicito, non 500", async () => {
    await writeEndpoint("script", { ...imageEndpoint, path: "/script" }, {
      "001.response.json": { type: "handler", title: "", sourceFile: "001.handler.js" },
      // Il file 001.handler.js non viene scritto: sparito.
    });

    await expect(getAdminMockDetail(mocksDir, encodeMockId("script/GET.endpoint.json"))).rejects.toMatchObject({
      status: 404,
      message: "Response source file not found on disk.",
    });
  });

  test("una response selezionata mancante degrada il singolo endpoint, non il listing", async () => {
    await writeEndpoint("senza-response", { ...imageEndpoint, path: "/senza-response" }, {
      // La cartella esiste ma il file selezionato no.
      "999.response.json": { type: "mock", title: "", status: 200, headers: {}, delayMs: 0, body: {} },
    });

    const loadErrors = [];
    const items = await listAdminMocks(mocksDir, loadErrors);

    expect(items.map((item) => item.path)).toEqual(["/img"]);
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].configFilePath).toBe("senza-response/GET.endpoint.json");
  });
});
