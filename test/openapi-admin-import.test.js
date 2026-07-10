const { importAdminOpenapi } = require("../src/admin/openapi-admin-import");
const { listAdminMocks, listAdminCollections } = require("../src/admin/mock-catalog");
const { createTempDir, removeDir } = require("./helpers");

// Regressione dalla code review 2026-07-09 (doc 02 §5): l'import OpenAPI abortiva a metà
// (workspace modificato, zero mock creati, nessun rollback) quando i tag contenevano la
// label riservata "Unsorted" o coppie che il comparatore delle collection considera uguali
// ("Café"/"Cafe": la mappa di riuso a toLowerCase le distingueva, la create no → 409).
describe("importAdminOpenapi: tag insidiosi non abortiscono l'import", () => {
  let mocksDir;

  function operation(tag) {
    return {
      tags: [tag],
      responses: {
        "200": {
          description: "ok",
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    };
  }

  const document = {
    openapi: "3.0.0",
    info: { title: "t", version: "1" },
    paths: {
      "/riservato": { get: operation("Unsorted") },
      "/caffe-accentato": { get: operation("Café") },
      "/caffe-piano": { get: operation("Cafe") },
    },
  };

  beforeEach(async () => {
    mocksDir = await createTempDir("openapi-import-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("label riservata e coppia accentata: tutti i mock creati, una sola collection", async () => {
    const result = await importAdminOpenapi(mocksDir, document, jest.fn());

    expect(result.created).toBe(3);
    expect(result.failed).toBe(0);

    const items = await listAdminMocks(mocksDir);
    expect(items).toHaveLength(3);

    // "Café" e "Cafe" convergono sulla stessa collection; il tag "Unsorted" non ne crea una.
    const collections = (await listAdminCollections(mocksDir, items)).filter((collection) => collection.id);
    expect(collections).toHaveLength(1);
    const collectionId = collections[0].id;

    const byPath = new Map(items.map((item) => [item.path, item]));
    expect(byPath.get("/caffe-accentato").collectionId).toBe(collectionId);
    expect(byPath.get("/caffe-piano").collectionId).toBe(collectionId);
    // Il mock col tag riservato resta non assegnato (collection virtuale Unsorted).
    expect(byPath.get("/riservato").collectionId ?? null).toBeNull();
  });
});
