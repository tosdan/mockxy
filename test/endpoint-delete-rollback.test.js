const fs = require("fs");
const path = require("path");
const { deleteAdminMock } = require("../src/admin/endpoint-operations");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createTempDir, removeDir } = require("./helpers");

// Regressione dalla code review 2026-07-09 (doc 02 §2): la delete cancellava la cartella
// delle response PRIMA dei passi ancora fallibili, ma il backup copriva solo i file JSON:
// un fallimento post-rm (es. reload) ripristinava l'endpoint ma perdeva le response per
// sempre, lasciando il catalogo admin in 404 permanente.
describe("deleteAdminMock: rollback della cartella delle response", () => {
  let mocksDir;
  let endpointPath;
  let responseDir;
  const relativePath = "api/GET.endpoint.json";

  const endpoint = {
    method: "GET",
    path: "/api",
    description: "",
    enabled: true,
    responseFiles: ["001.response.json", "002.response.json"],
    selectedResponseFile: "001.response.json",
  };
  const responseBody = { type: "mock", title: "", status: 200, headers: {}, delayMs: 0, body: { ok: true } };
  const responseFileBacked = { type: "mock", title: "", status: 200, headers: {}, delayMs: 0, file: "002.file.bin" };
  const assetContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  beforeEach(async () => {
    mocksDir = await createTempDir("delete-rollback-");
    const configDir = path.join(mocksDir, "api");
    endpointPath = path.join(configDir, "GET.endpoint.json");
    responseDir = path.join(configDir, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, "utf8");
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      `${JSON.stringify(responseBody, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "002.response.json"),
      `${JSON.stringify(responseFileBacked, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(path.join(responseDir, "002.file.bin"), assetContent);
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("se il reload fallisce, endpoint E response tornano tutti al loro posto", async () => {
    const failingReload = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);

    await expect(deleteAdminMock(mocksDir, encodeMockId(relativePath), failingReload)).rejects.toMatchObject({
      status: 400,
      message: "Endpoint delete rejected: boom",
    });

    expect(fs.existsSync(endpointPath)).toBe(true);
    const restored = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
    expect(restored).toEqual(endpoint);

    expect((await fs.promises.readdir(responseDir)).sort()).toEqual([
      "001.response.json",
      "002.file.bin",
      "002.response.json",
    ]);
    const restoredAsset = await fs.promises.readFile(path.join(responseDir, "002.file.bin"));
    expect(restoredAsset.equals(assetContent)).toBe(true);
  });

  test("a delete riuscita non resta nulla su disco", async () => {
    await deleteAdminMock(mocksDir, encodeMockId(relativePath), jest.fn());

    expect(fs.existsSync(endpointPath)).toBe(false);
    expect(fs.existsSync(responseDir)).toBe(false);
    // Anche la cartella intermedia svuotata viene rimossa.
    expect(fs.existsSync(path.join(mocksDir, "api"))).toBe(false);
  });
});
