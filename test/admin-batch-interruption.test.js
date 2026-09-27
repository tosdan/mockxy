const fs = require("fs");
const path = require("path");
const { createAdminError } = require("../src/admin/admin-errors");
const { createAdminMock } = require("../src/admin/endpoint-operations");
const { assignAdminCollection } = require("../src/admin/collection-operations");
const { readDumpEntriesByKeys } = require("../src/monitoring/monitor-dump-reader");
const { importAdminOpenapi } = require("../src/admin/openapi-admin-import");
const { createMocksFromDump } = require("../src/admin/dump-to-mock");
const { createTempDir, removeDir } = require("./helpers");

jest.mock("../src/admin/endpoint-operations", () => {
  const actual = jest.requireActual("../src/admin/endpoint-operations");
  return { ...actual, createAdminMock: jest.fn() };
});
jest.mock("../src/admin/collection-operations", () => {
  const actual = jest.requireActual("../src/admin/collection-operations");
  return { ...actual, assignAdminCollection: jest.fn() };
});
jest.mock("../src/monitoring/monitor-dump-reader", () => {
  const actual = jest.requireActual("../src/monitoring/monitor-dump-reader");
  return { ...actual, readDumpEntriesByKeys: jest.fn() };
});

const actualCreateAdminMock = jest.requireActual("../src/admin/endpoint-operations").createAdminMock;
const actualAssignAdminCollection = jest.requireActual("../src/admin/collection-operations").assignAdminCollection;

// Batch admin (import OpenAPI, creazione dallo storico) davanti a un elemento il cui ripristino
// fallisce o a un'assegnazione di collection fallita (piano agent/API, §13 C1): il batch arriva
// sempre al reload finale e non nasconde uno stato incerto dietro una risposta positiva.
describe("batch admin: interruzione ed errori dopo la scrittura", () => {
  let mocksDir;
  let reloadRuntime;

  beforeEach(async () => {
    mocksDir = await createTempDir("admin-batch-interruption-");
    reloadRuntime = jest.fn().mockResolvedValue({ applied: true, loadErrors: [], fatalError: null });
    createAdminMock.mockReset();
    createAdminMock.mockImplementation(actualCreateAdminMock);
    assignAdminCollection.mockReset();
    assignAdminCollection.mockImplementation(actualAssignAdminCollection);
    readDumpEntriesByKeys.mockReset();
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  // Un elemento la cui scrittura fallisce e il cui ripristino fallisce a sua volta lascia file
  // orfani: è l'esito che commitWithRollback dichiara con ROLLBACK_FAILED.
  const failWithUnrestoredWrite = async (dir, payload) => {
    const orphan = path.join(dir, "orphan", `${payload.config.method}.endpoint.json`);
    await fs.promises.mkdir(path.dirname(orphan), { recursive: true });
    await fs.promises.writeFile(orphan, "{");
    throw createAdminError(500, "Mock creation rejected: disk full; recovery failed: permission denied", {
      code: "ROLLBACK_FAILED",
      rollback: "failed",
      cause: "disk full",
      recoveryError: "permission denied",
    });
  };

  const example = (value) => ({
    responses: { 200: { description: "ok", content: { "application/json": { example: value } } } },
  });
  const spec = (operations) => JSON.stringify({
    openapi: "3.0.0",
    info: { title: "t", version: "1" },
    paths: operations,
  });

  test("l'import OpenAPI si ferma al primo ripristino fallito e risponde ROLLBACK_FAILED", async () => {
    createAdminMock
      .mockImplementationOnce(actualCreateAdminMock)
      .mockImplementationOnce(failWithUnrestoredWrite);
    const document = spec({
      "/alpha": { get: example({ a: 1 }) },
      "/beta": { get: example({ b: 1 }) },
      "/gamma": { get: example({ c: 1 }) },
    });

    const failure = await importAdminOpenapi(mocksDir, document, reloadRuntime).catch((error) => error);

    expect(failure).toMatchObject({
      status: 500,
      message: expect.stringContaining("stopped after 2 of 3 items"),
      details: {
        code: "ROLLBACK_FAILED",
        rollback: "failed",
        cause: "disk full",
        recoveryError: "permission denied",
        result: {
          created: 1,
          failed: 1,
          runtime: { status: "applied", errors: [] },
        },
      },
    });
    expect(failure.details.result.items).toEqual([
      expect.objectContaining({ path: "/alpha", writeOutcome: "created", runtimeOutcome: "applied", error: null }),
      expect.objectContaining({ path: "/beta", writeOutcome: "failed", runtimeOutcome: "not_applicable" }),
    ]);
    // Nessun elemento dopo l'interruzione; il reload finale allinea comunque il runtime al disco.
    expect(createAdminMock).toHaveBeenCalledTimes(2);
    expect(reloadRuntime).toHaveBeenCalledTimes(1);
  });

  test("un ripristino fallito prevale anche su un reload finale fallito", async () => {
    createAdminMock.mockImplementationOnce(failWithUnrestoredWrite);
    reloadRuntime.mockResolvedValue({ applied: false, loadErrors: [], fatalError: new Error("scansione fallita") });

    const failure = await importAdminOpenapi(mocksDir, spec({ "/alpha": { get: example({ a: 1 }) } }), reloadRuntime)
      .catch((error) => error);

    expect(failure).toMatchObject({
      status: 500,
      details: { code: "ROLLBACK_FAILED", result: { runtime: { status: "failed" } } },
    });
  });

  test("la creazione dallo storico si ferma al primo ripristino fallito e risponde ROLLBACK_FAILED", async () => {
    const entry = (key, routePath) => ({
      dumpKey: key,
      method: "GET",
      path: routePath,
      status: 200,
      responseHeaders: { "content-type": "application/json" },
      responseBody: "{}",
    });
    readDumpEntriesByKeys.mockResolvedValue([entry("d#1", "/one"), entry("d#2", "/two"), entry("d#3", "/three")]);
    createAdminMock
      .mockImplementationOnce(actualCreateAdminMock)
      .mockImplementationOnce(failWithUnrestoredWrite);

    const failure = await createMocksFromDump(mocksDir, "/dump", { keys: ["d#1", "d#2", "d#3"] }, reloadRuntime)
      .catch((error) => error);

    expect(failure).toMatchObject({
      status: 500,
      message: expect.stringContaining("stopped after 2 of 3 items"),
      details: { code: "ROLLBACK_FAILED", rollback: "failed", result: { created: 1, failed: 1 } },
    });
    expect(failure.details.result.items.map((item) => [item.key, item.writeOutcome])).toEqual([
      ["d#1", "created"],
      ["d#2", "failed"],
    ]);
    expect(createAdminMock).toHaveBeenCalledTimes(2);
    expect(reloadRuntime).toHaveBeenCalledTimes(1);
  });

  test("un'assegnazione di collection fallita resta nell'esito dell'elemento e il batch si conclude", async () => {
    assignAdminCollection.mockRejectedValueOnce(new Error("disco pieno"));
    const document = spec({
      "/alpha": { get: { tags: ["Pets"], ...example({ a: 1 }) } },
      "/beta": { get: { tags: ["Pets"], ...example({ b: 1 }) } },
    });

    const result = await importAdminOpenapi(mocksDir, document, reloadRuntime);

    expect(result).toMatchObject({ created: 2, failed: 0, runtime: { status: "applied" } });
    expect(result.items).toEqual([
      expect.objectContaining({
        path: "/alpha",
        writeOutcome: "created",
        runtimeOutcome: "applied",
        error: "Created, but the collection could not be assigned: disco pieno",
      }),
      expect.objectContaining({ path: "/beta", writeOutcome: "created", runtimeOutcome: "applied", error: null }),
    ]);
    expect(assignAdminCollection).toHaveBeenCalledTimes(2);
    expect(reloadRuntime).toHaveBeenCalledTimes(1);
  });
});
