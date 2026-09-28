jest.mock("../src/mocks/endpoint-loader", () => ({
  loadEndpointRouteGroups: jest.fn(),
}));

const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { createReloadHandler } = require("../src/server");
const { RuntimeStatusStore } = require("../src/runtime-status");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadResult(loadErrors = []) {
  return {
    mockRouteGroups: new Map(),
    handlerRouteGroups: new Map(),
    proxyMiddlewareRouteGroups: [],
    sequenceRouteGroups: new Map(),
    sseRouteGroups: new Map(),
    wsRouteGroups: new Map(),
    loadErrors,
  };
}

function buildReload({ changedSequenceKeys = new Set(), handlerStates, runtimeStatus } = {}) {
  const registry = { routeGroups: [], setRouteGroups: jest.fn(() => changedSequenceKeys) };
  const proxyMiddlewareRegistry = { routeGroups: [], setRouteGroups: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return createReloadHandler({
    mocksDir: "/tmp/mockxy-reload-handler-test",
    registry,
    proxyMiddlewareRegistry,
    logger,
    handlerStates,
    runtimeStatus,
  });
}

describe("createReloadHandler", () => {
  beforeEach(() => {
    loadEndpointRouteGroups.mockReset();
  });

  test("una chiamata arrivata durante un reload attende il giro successivo", async () => {
    const first = deferred();
    const second = deferred();
    loadEndpointRouteGroups.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const reload = buildReload();

    const firstCall = reload();
    const secondCall = reload();
    let secondSettled = false;
    secondCall.then(() => {
      secondSettled = true;
    });

    first.resolve(loadResult([{ filePath: "/first", message: "first" }]));
    await expect(firstCall).resolves.toMatchObject({
      applied: true,
      loadErrors: [{ filePath: "/first", message: "first" }],
    });
    expect(loadEndpointRouteGroups).toHaveBeenCalledTimes(2);
    expect(secondSettled).toBe(false);

    second.resolve(loadResult([{ filePath: "/second", message: "second" }]));
    await expect(secondCall).resolves.toMatchObject({
      applied: true,
      loadErrors: [{ filePath: "/second", message: "second" }],
    });
  });

  test("restituisce un esito fatale senza sostituire le route correnti", async () => {
    loadEndpointRouteGroups.mockRejectedValueOnce(new Error("scan failed"));
    const reload = buildReload();

    const outcome = await reload();

    expect(outcome.applied).toBe(false);
    expect(outcome.loadErrors).toEqual([]);
    expect(outcome.fatalError).toMatchObject({ message: "scan failed" });
  });

  test("un tentativo si pubblica nello stato del runtime solo quando è concluso", async () => {
    const pending = deferred();
    loadEndpointRouteGroups.mockReturnValueOnce(pending.promise);
    const runtimeStatus = new RuntimeStatusStore({ runtimeId: "r", mocksDir: "/tmp/mockxy-reload-handler-test" });
    const reload = buildReload({ runtimeStatus });

    const call = reload();
    await Promise.resolve();
    expect(runtimeStatus.snapshot().lastAttempt).toBeNull();

    pending.resolve(loadResult());
    await call;
    expect(runtimeStatus.snapshot().lastAttempt).toMatchObject({ id: 1, reasons: ["admin"], status: "applied" });
  });

  test("una causa sconosciuta, come il percorso passato da un evento, vale come admin", async () => {
    loadEndpointRouteGroups.mockResolvedValueOnce(loadResult());
    const runtimeStatus = new RuntimeStatusStore({ runtimeId: "r", mocksDir: "/tmp/mockxy-reload-handler-test" });
    const reload = buildReload({ runtimeStatus });

    await reload("/tmp/mockxy-reload-handler-test/a/GET.endpoint.json");

    expect(runtimeStatus.snapshot().lastAttempt.reasons).toEqual(["admin"]);
  });

  test("un fallimento globale è registrato come tentativo fallito", async () => {
    loadEndpointRouteGroups.mockRejectedValueOnce(new Error("scan failed"));
    const runtimeStatus = new RuntimeStatusStore({ runtimeId: "r", mocksDir: "/tmp/mockxy-reload-handler-test" });
    const reload = buildReload({ runtimeStatus });

    await reload("watcher");

    expect(runtimeStatus.snapshot()).toMatchObject({
      lastAttempt: { id: 1, reasons: ["watcher"], status: "failed" },
      lastAppliedAttemptId: null,
      fatalError: { message: "scan failed" },
    });
  });

  test("azzera la memoria handler soltanto per gli scenari sequence cambiati", async () => {
    loadEndpointRouteGroups.mockResolvedValueOnce(loadResult());
    const handlerStates = { reset: jest.fn() };
    const reload = buildReload({
      changedSequenceKeys: new Set(["GET /scenario", "POST /altro-scenario"]),
      handlerStates,
    });

    await reload();

    expect(handlerStates.reset.mock.calls).toEqual([
      ["GET /scenario"],
      ["POST /altro-scenario"],
    ]);
  });
});
