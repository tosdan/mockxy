const fs = require("fs");
const path = require("path");
const { CatalogRevisionTracker } = require("../src/catalog-revision");
const { createTempDir, removeDir } = require("./helpers");

// Revisione informativa del catalogo con cache per file (piano agent/API, §13 C2).
describe("CatalogRevisionTracker", () => {
  let mocksDir;
  let tracker;

  beforeEach(async () => {
    mocksDir = await createTempDir("catalog-revision-");
    await fs.promises.mkdir(path.join(mocksDir, "items", "GET.responses"), { recursive: true });
    await write("items/GET.endpoint.json", "{\"a\":1}");
    await write(".collections.json", "{}");
    tracker = new CatalogRevisionTracker({ mocksDir });
    await tracker.refresh();
  });

  afterEach(async () => {
    await fs.promises.chmod(path.join(mocksDir, "items", "GET.endpoint.json"), 0o644).catch(() => {});
    await removeDir(mocksDir);
  });

  const write = (relativePath, content) => fs.promises.writeFile(path.join(mocksDir, relativePath), content);

  test("la prima scansione è la revisione 1; una scansione senza cambiamenti non la muove", async () => {
    expect(tracker.revision).toBe(1);
    expect(await tracker.refresh()).toBe(1);
  });

  test("un file che compare, cambia contenuto o scompare la muove; un file nascosto conta", async () => {
    await write("items/GET.responses/002.response.json", "{}");
    expect(await tracker.refresh()).toBe(2);

    await write(".collections.json", "{\"collections\":[]}");
    expect(await tracker.refresh()).toBe(3);

    await fs.promises.rm(path.join(mocksDir, "items", "GET.responses", "002.response.json"));
    expect(await tracker.refresh()).toBe(4);
  });

  test("un contenuto riscritto identico non la muove, anche se l'mtime cambia", async () => {
    const endpoint = path.join(mocksDir, "items", "GET.endpoint.json");
    await fs.promises.utimes(endpoint, new Date(), new Date(Date.now() + 5000));
    expect(await tracker.refresh()).toBe(1);
  });

  test("a firma invariata una modifica esterna resta invisibile, ma una scrittura API la rilegge", async () => {
    // Due scritture nello stesso tick di un filesystem a risoluzione grossolana: stesso mtime,
    // intero e recente, e stessa dimensione.
    const endpoint = path.join(mocksDir, "items", "GET.endpoint.json");
    const tick = new Date(Math.floor(Date.now() / 1000) * 1000);
    await fs.promises.utimes(endpoint, tick, tick);
    expect(await tracker.refresh()).toBe(1);
    const writtenSince = Date.now();
    await write("items/GET.endpoint.json", "{\"a\":2}");
    await fs.promises.utimes(endpoint, tick, tick);

    // Stessa dimensione e stesso mtime: il limite dichiarato del contratto.
    expect(await tracker.refresh()).toBe(1);
    // L'invalidazione di una mutazione API rilegge i file scritti da quell'istante.
    expect(await tracker.refresh({ writtenSince })).toBe(2);
  });

  test("i node_modules sotto la cartella dei mock non contano", async () => {
    await fs.promises.mkdir(path.join(mocksDir, "node_modules", "lib"), { recursive: true });
    await write("node_modules/lib/index.js", "module.exports = 1;");
    expect(await tracker.refresh()).toBe(1);
  });

  (process.platform === "win32" ? test.skip : test)("un file che non si riesce a leggere la muove", async () => {
    const endpoint = path.join(mocksDir, "items", "GET.endpoint.json");
    await write("items/GET.endpoint.json", "{\"a\":3}");
    await fs.promises.chmod(endpoint, 0o000);
    expect(await tracker.refresh()).toBe(2);
  });

  test("le scansioni concorrenti sono serializzate", async () => {
    await write("items/GET.responses/002.response.json", "{}");
    const results = await Promise.all([tracker.refresh(), tracker.refresh(), tracker.refresh()]);
    expect(results).toEqual([2, 2, 2]);
  });
});
