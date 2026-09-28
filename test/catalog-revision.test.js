const fs = require("fs");
const path = require("path");
const { CatalogRevisionTracker } = require("../src/catalog-revision");
const { createTempDir, removeDir } = require("./helpers");

// Revisione informativa del catalogo con cache per file (piano agent/API, §13 C2): il perimetro
// sono collezioni, endpoint, varianti elencate e le loro dipendenze dirette.
describe("CatalogRevisionTracker", () => {
  let mocksDir;
  let tracker;

  beforeEach(async () => {
    mocksDir = await createTempDir("catalog-revision-");
    await fs.promises.mkdir(path.join(mocksDir, "items", "GET.responses", "assets"), { recursive: true });
    await writeEndpoint(["001.response.json", "002.response.json"]);
    await write("items/GET.responses/001.response.json", JSON.stringify({ type: "handler", sourceFile: "001.handler.js" }));
    await write("items/GET.responses/001.handler.js", "module.exports = {};");
    await write("items/GET.responses/002.response.json", JSON.stringify({ type: "mock", status: 200, file: "assets/logo.png" }));
    await write("items/GET.responses/assets/logo.png", "PNG1");
    await write(".collections.json", "{}");
    tracker = new CatalogRevisionTracker({ mocksDir });
    await tracker.refresh();
  });

  afterEach(async () => {
    await fs.promises.chmod(path.join(mocksDir, "items", "GET.responses", "001.handler.js"), 0o644).catch(() => {});
    await removeDir(mocksDir);
  });

  const at = (relativePath) => path.join(mocksDir, relativePath);
  const write = (relativePath, content) => fs.promises.writeFile(at(relativePath), content);
  const writeEndpoint = (responseFiles) =>
    write("items/GET.endpoint.json", JSON.stringify({ method: "GET", path: "/items", responseFiles, selectedResponseFile: responseFiles[0] }));

  test("la prima scansione è la revisione 1; una scansione senza cambiamenti non la muove", async () => {
    expect(tracker.revision).toBe(1);
    expect(await tracker.refresh()).toBe(1);
  });

  test("ogni file del perimetro conta: variante, sorgente, asset, collezioni", async () => {
    await write("items/GET.responses/002.response.json", JSON.stringify({ type: "mock", status: 404, file: "assets/logo.png" }));
    expect(await tracker.refresh()).toBe(2);
    await write("items/GET.responses/001.handler.js", "module.exports = { changed: true };");
    expect(await tracker.refresh()).toBe(3);
    await write("items/GET.responses/assets/logo.png", "PNG2");
    expect(await tracker.refresh()).toBe(4);
    await write(".collections.json", "{\"collections\":[]}");
    expect(await tracker.refresh()).toBe(5);
  });

  test("i file estranei al catalogo non contano", async () => {
    await write("notes.txt", "appunti");
    await write("items/GET.responses/999.response.json", "{}");
    await write("items/GET.responses/helper.js", "module.exports = 1;");
    await fs.promises.mkdir(at("node_modules/lib"), { recursive: true });
    await write("node_modules/lib/index.js", "module.exports = 1;");
    expect(await tracker.refresh()).toBe(1);
  });

  test("un endpoint o una variante che compaiono o scompaiono la muovono; un riferimento mancante conta", async () => {
    await fs.promises.mkdir(at("other"), { recursive: true });
    await write("other/POST.endpoint.json", JSON.stringify({ responseFiles: [] }));
    expect(await tracker.refresh()).toBe(2);

    await write("items/GET.responses/003.response.json", JSON.stringify({ type: "mock", status: 204 }));
    await writeEndpoint(["001.response.json", "002.response.json", "003.response.json"]);
    expect(await tracker.refresh()).toBe(3);

    await fs.promises.rm(at("items/GET.responses/assets/logo.png"));
    expect(await tracker.refresh()).toBe(4);
  });

  test("un contenuto riscritto identico non la muove, anche se l'mtime cambia", async () => {
    await fs.promises.utimes(at("items/GET.endpoint.json"), new Date(), new Date(Date.now() + 5000));
    expect(await tracker.refresh()).toBe(1);
  });

  test("a firma invariata una modifica resta invisibile alla scansione, ma non all'invalidazione né alla verifica", async () => {
    const response = at("items/GET.responses/002.response.json");
    const { mtime } = await fs.promises.stat(response);
    const sameSize = JSON.stringify({ type: "mock", status: 500, file: "assets/logo.png" });
    const keepSignature = async (content) => {
      await fs.promises.writeFile(response, content);
      await fs.promises.utimes(response, mtime, mtime);
    };
    // Una firma a millisecondi interi, come la lascia utimes.
    await fs.promises.utimes(response, mtime, mtime);
    expect(await tracker.refresh()).toBe(1);

    await keepSignature(sameSize);
    expect(await tracker.refresh()).toBe(1);
    // Una scrittura API invalida i file che ha scritto.
    expect(await tracker.refresh({ invalidate: [response] })).toBe(2);

    await keepSignature(JSON.stringify({ type: "mock", status: 501, file: "assets/logo.png" }));
    // Una lettura effettiva del contenuto (GET di dettaglio) lo confronta con la cache.
    expect(await tracker.verify([response])).toBe(3);
    expect(await tracker.verify([response])).toBe(3);
  });

  test("la verifica registra anche un file comparso fuori dalla cache", async () => {
    await write("items/GET.responses/003.response.json", JSON.stringify({ type: "mock", status: 204 }));
    await writeEndpoint(["001.response.json", "002.response.json", "003.response.json"]);
    expect(await tracker.verify([at("items/GET.responses/003.response.json")])).toBe(2);
  });

  (process.platform === "win32" ? test.skip : test)("un file del perimetro che non si riesce a leggere la muove", async () => {
    await write("items/GET.responses/001.handler.js", "module.exports = { other: 1 };");
    await fs.promises.chmod(at("items/GET.responses/001.handler.js"), 0o000);
    expect(await tracker.refresh()).toBe(2);
  });

  test("le scansioni concorrenti sono serializzate", async () => {
    await write(".collections.json", "{\"collections\":[]}");
    const results = await Promise.all([tracker.refresh(), tracker.refresh(), tracker.refresh()]);
    expect(results).toEqual([2, 2, 2]);
  });
});
