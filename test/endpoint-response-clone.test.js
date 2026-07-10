const fs = require("fs");
const path = require("path");
const { createAdminResponse } = require("../src/admin/endpoint-operations");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createTempDir, removeDir } = require("./helpers");

// Regressione dalla code review 2026-07-09 (doc 02 §6): clonare una response file-backed
// passando un body esplicito era impossibile — il clone riaggiungeva `file` guardando la
// response SORGENTE invece dell'esito del merge, il JSON usciva con body+file insieme e la
// validazione lo respingeva sempre (400), senza alcuna via di fuga nel payload.
describe("createAdminResponse: clone di una response file-backed", () => {
  let mocksDir;
  let responseDir;
  const id = encodeMockId("api/GET.endpoint.json");
  const assetContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  beforeEach(async () => {
    mocksDir = await createTempDir("response-clone-");
    const configDir = path.join(mocksDir, "api");
    responseDir = path.join(configDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(configDir, "GET.endpoint.json"),
      `${JSON.stringify({
        method: "GET",
        path: "/api",
        description: "",
        enabled: true,
        responseFiles: ["001.response.json"],
        selectedResponseFile: "001.response.json",
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      `${JSON.stringify({
        type: "mock",
        title: "immagine",
        status: 200,
        headers: {},
        delayMs: 0,
        file: "001.file.bin",
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(path.join(responseDir, "001.file.bin"), assetContent);
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("con un body esplicito il clone diventa body-backed, senza trascinarsi il file", async () => {
    await createAdminResponse(mocksDir, id, { title: "json", body: { nuovo: true } }, jest.fn());

    const cloned = JSON.parse(await fs.promises.readFile(path.join(responseDir, "002.response.json"), "utf8"));
    expect(cloned).toMatchObject({ type: "mock", title: "json", body: { nuovo: true } });
    expect(Object.prototype.hasOwnProperty.call(cloned, "file")).toBe(false);

    // L'asset della sorgente non viene duplicato inutilmente.
    expect((await fs.promises.readdir(responseDir)).sort()).toEqual([
      "001.file.bin",
      "001.response.json",
      "002.response.json",
    ]);
  });

  test("il clone puro (senza payload) continua a duplicare l'asset", async () => {
    await createAdminResponse(mocksDir, id, { title: "copia" }, jest.fn());

    const cloned = JSON.parse(await fs.promises.readFile(path.join(responseDir, "002.response.json"), "utf8"));
    expect(cloned).toMatchObject({ type: "mock", title: "copia", file: "002.file.bin" });
    const clonedAsset = await fs.promises.readFile(path.join(responseDir, "002.file.bin"));
    expect(clonedAsset.equals(assetContent)).toBe(true);
  });
});
