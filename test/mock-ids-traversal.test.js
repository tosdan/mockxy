const fs = require("fs");
const path = require("path");
const { resolveAdminFilePath, encodeMockId } = require("../src/admin/mock-ids");
const { createAdminMock, deleteAdminMock } = require("../src/admin/endpoint-operations");
const { getAdminMockDetail } = require("../src/admin/mock-catalog");
const { createTempDir, removeDir } = require("./helpers");

// Regressione dalla code review 2026-07-09 (doc 02 §4): la creazione accettava segmenti come
// "a..b" ma la risoluzione degli id rifiutava ".." come SUBSTRING: l'endpoint veniva creato
// su disco e caricato dal runtime, ma detail/update/delete rispondevano 400 per sempre —
// orfano ingestibile via API.
describe("resolveAdminFilePath: '..' vietato come segmento, non come substring", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("traversal-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("un segmento con punti interni (a..b) è un nome valido", () => {
    const filePath = resolveAdminFilePath(mocksDir, encodeMockId("a..b/GET.endpoint.json"));
    expect(filePath).toBe(path.join(mocksDir, "a..b", "GET.endpoint.json"));
  });

  test.each([
    ["../fuori/GET.endpoint.json"],
    ["a/../GET.endpoint.json"],
    ["./a/GET.endpoint.json"],
    ["..\\fuori\\GET.endpoint.json"],
  ])("il traversal vero resta bloccato: %s", (relativePath) => {
    expect(() => resolveAdminFilePath(mocksDir, encodeMockId(relativePath))).toThrow("Invalid mock id.");
  });

  test("un endpoint creato su path /a..b è gestibile: detail e delete funzionano", async () => {
    const detail = await createAdminMock(mocksDir, {
      config: { method: "GET", path: "/a..b", status: 200, disabled: false, headers: {}, delayMs: 0 },
      body: { ok: true },
    }, jest.fn());

    expect(detail.path).toBe("/a..b");
    expect(detail.configFilePath).toBe("a..b/GET.endpoint.json");

    const reread = await getAdminMockDetail(mocksDir, detail.id);
    expect(reread.body).toEqual({ ok: true });

    await deleteAdminMock(mocksDir, detail.id, jest.fn());
    expect(fs.existsSync(path.join(mocksDir, "a..b"))).toBe(false);
  });
});
