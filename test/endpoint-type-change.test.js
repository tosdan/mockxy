const fs = require("fs");
const path = require("path");
const { updateAdminMock } = require("../src/admin/endpoint-operations");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createTempDir, removeDir } = require("./helpers");

// Regressione dalla code review 2026-07-09 (doc 02 §3): il cambio tipo della response
// selezionata scriveva il sorgente su un nome FISSO (001.handler.js) invece di derivarlo
// dalla response selezionata: con la 002 selezionata sovrascriveva in silenzio il sorgente
// della 001 e agganciava due response allo stesso file.
describe("updateAdminMock: cambio tipo della response selezionata", () => {
  let mocksDir;
  let responseDir;
  const id = encodeMockId("api/GET.endpoint.json");

  const originalHandlerSource = `module.exports = {
  async resolveResponse() {
    return { status: 200, jsonBody: { variante: "001 originale" } };
  }
};
`;
  const newHandlerSource = `module.exports = {
  async resolveResponse() {
    return { status: 201, jsonBody: { variante: "002 nuova" } };
  }
};
`;

  beforeEach(async () => {
    mocksDir = await createTempDir("type-change-");
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
        responseFiles: ["001.response.json", "002.response.json"],
        selectedResponseFile: "002.response.json",
      }, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      `${JSON.stringify({ type: "handler", title: "", sourceFile: "001.handler.js" }, null, 2)}\n`,
      "utf8"
    );
    await fs.promises.writeFile(path.join(responseDir, "001.handler.js"), originalHandlerSource, "utf8");
    await fs.promises.writeFile(
      path.join(responseDir, "002.response.json"),
      `${JSON.stringify({ type: "mock", title: "", status: 200, headers: {}, delayMs: 0, body: {} }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("il sorgente va sul file derivato dalla selezionata, non su 001 di un'altra response", async () => {
    const detail = await updateAdminMock(mocksDir, id, {
      type: "handler",
      definition: { method: "GET", path: "/api", disabled: false },
      source: newHandlerSource,
    }, jest.fn());

    // La response selezionata (002) ora è un handler col SUO file sorgente.
    const updatedResponse = JSON.parse(
      await fs.promises.readFile(path.join(responseDir, "002.response.json"), "utf8")
    );
    expect(updatedResponse).toMatchObject({ type: "handler", sourceFile: "002.handler.js" });
    expect(await fs.promises.readFile(path.join(responseDir, "002.handler.js"), "utf8")).toBe(newHandlerSource);
    expect(detail.sourceFilePath).toBe(path.join(responseDir, "002.handler.js"));

    // Il sorgente della response 001 non è stato toccato.
    expect(await fs.promises.readFile(path.join(responseDir, "001.handler.js"), "utf8")).toBe(originalHandlerSource);
  });

  test("se la selezionata è già un handler, il suo sourceFile esistente viene riusato", async () => {
    // Rendi la 001 selezionata (già handler con 001.handler.js).
    const endpointPath = path.join(mocksDir, "api", "GET.endpoint.json");
    const endpoint = JSON.parse(await fs.promises.readFile(endpointPath, "utf8"));
    await fs.promises.writeFile(
      endpointPath,
      `${JSON.stringify({ ...endpoint, selectedResponseFile: "001.response.json" }, null, 2)}\n`,
      "utf8"
    );

    await updateAdminMock(mocksDir, id, {
      type: "handler",
      definition: { method: "GET", path: "/api", disabled: false },
      source: newHandlerSource,
    }, jest.fn());

    const response = JSON.parse(await fs.promises.readFile(path.join(responseDir, "001.response.json"), "utf8"));
    expect(response.sourceFile).toBe("001.handler.js");
    expect(await fs.promises.readFile(path.join(responseDir, "001.handler.js"), "utf8")).toBe(newHandlerSource);
  });
});
