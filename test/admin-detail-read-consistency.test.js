const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { getAdminMockDetail } = require("../src/admin/mock-catalog");
const { encodeMockId } = require("../src/admin/mock-ids");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { SharedStateStore } = require("../src/mocks/shared-state");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Letture del dettaglio concorrenti a una modifica (piano agent/API, §13 C4): le GET non
// attendono la coda delle mutazioni, quindi un file può sparire mentre il dettaglio si compone.
// Un secondo tentativo completo segue la definizione riletta; se non basta, READ_INCONSISTENT.
describe("dettaglio endpoint: lettura incompleta", () => {
  let mocksDir;
  let endpointPath;
  let responsesDir;
  const id = encodeMockId("items/GET.endpoint.json");

  beforeEach(async () => {
    mocksDir = await createTempDir("admin-detail-read-");
    endpointPath = path.join(mocksDir, "items", "GET.endpoint.json");
    responsesDir = path.join(mocksDir, "items", "GET.responses");
    await fs.promises.mkdir(responsesDir, { recursive: true });
    await writeVariant("001.response.json", { from: "001" });
    await writeVariant("002.response.json", { from: "002" });
    await writeEndpoint("002.response.json");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await removeDir(mocksDir);
  });

  const writeVariant = (fileName, body) =>
    fs.promises.writeFile(
      path.join(responsesDir, fileName),
      JSON.stringify({ type: "mock", title: "", status: 200, headers: {}, delayMs: 0, body })
    );
  const writeEndpoint = (selectedResponseFile, responseFiles = ["001.response.json", "002.response.json"]) =>
    fs.promises.writeFile(
      endpointPath,
      JSON.stringify({ method: "GET", path: "/items", description: "", enabled: true, responseFiles, selectedResponseFile })
    );

  // Esegue `change` appena il dettaglio ha letto la definizione dell'endpoint per la prima volta:
  // il resto della costruzione trova i file già cambiati.
  function changeAfterFirstDefinitionRead(change) {
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let definitionReads = 0;
    jest.spyOn(fs.promises, "readFile").mockImplementation(async (filePath, ...rest) => {
      const content = await realReadFile(filePath, ...rest);
      if (filePath === endpointPath) {
        definitionReads += 1;
        if (definitionReads === 1) {
          await change();
        }
      }
      return content;
    });
    return () => definitionReads;
  }

  test("una variante rimossa mentre la selezione passa a un'altra: il secondo tentativo segue la nuova selezione", async () => {
    const definitionReads = changeAfterFirstDefinitionRead(async () => {
      await writeEndpoint("001.response.json", ["001.response.json"]);
      await fs.promises.rm(path.join(responsesDir, "002.response.json"));
    });

    const detail = await getAdminMockDetail(mocksDir, id);

    expect(definitionReads()).toBe(2);
    expect(detail.selectedResponseFile).toBe("001.response.json");
    expect(detail.body).toEqual({ from: "001" });
    expect(detail.responses.map((response) => response.fileName)).toEqual(["001.response.json"]);
  });

  test("un endpoint eliminato durante la lettura risponde 404", async () => {
    changeAfterFirstDefinitionRead(() => fs.promises.rm(path.join(mocksDir, "items"), { recursive: true, force: true }));

    await expect(getAdminMockDetail(mocksDir, id)).rejects.toMatchObject({
      status: 404,
      message: "Endpoint definition not found.",
    });
  });

  test("un file ancora mancante al secondo tentativo è READ_INCONSISTENT, senza dettaglio parziale", async () => {
    await fs.promises.rm(path.join(responsesDir, "002.response.json"));
    const app = createApp({
      registry: new MockRegistry([]),
      config: { mocksDir, adminApiEnabled: true, proxyFallbackEnabled: false },
      logger: createNoopLogger(),
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry([]),
      reloadRuntime: async () => ({ applied: true, loadErrors: [], fatalError: null }),
      sharedStates: new SharedStateStore(),
    });

    const response = await request(app).get(`/_admin/api/mocks/${id}`);

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Bad Request",
      message: "The endpoint could not be read consistently: Selected response file not found.",
      details: { code: "READ_INCONSISTENT", retryable: true },
    });
  });

  test("un errore che non dipende da un file mancante non viene ritentato né trasformato", async () => {
    await fs.promises.writeFile(path.join(responsesDir, "002.response.json"), "{ json invalido");
    const definitionReads = changeAfterFirstDefinitionRead(async () => {});

    await expect(getAdminMockDetail(mocksDir, id)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Invalid JSON"),
    });
    expect(definitionReads()).toBe(1);
  });
});
