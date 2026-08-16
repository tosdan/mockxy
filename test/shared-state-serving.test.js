const fs = require("fs");
const http = require("http");
const path = require("path");
const request = require("supertest");
const { createApp } = require("../src/app");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");
const { MockRegistry } = require("../src/mocks/mock-registry");
const { ProxyMiddlewareRegistry } = require("../src/proxy/proxy-middleware-registry");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { HandlerStateStore } = require("../src/mocks/handler-state");
const { SharedStateStore } = require("../src/mocks/shared-state");
const {
  createMemoryLogger,
  createTempDir,
  removeDir,
  waitFor,
  writeHandler,
} = require("./helpers");

function handlerSource({ path, body }) {
  return `module.exports = {
  method: "GET",
  path: ${JSON.stringify(path)},
  async resolveResponse(context) {
    ${body}
  },
};
`;
}

describe("shared runtime state nel serving", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("shared-state-serving-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  async function buildApp({
    caseInsensitiveFilters = true,
    filesDir,
    requestTimeoutMs = 100,
    sharedStates: providedSharedStates,
  } = {}) {
    const loaded = await loadEndpointRouteGroups(mocksDir);
    expect(loaded.loadErrors).toEqual([]);
    const routeGroups = mergeLocalRouteGroups(loaded);
    const logger = createMemoryLogger();
    const requestMonitor = new RequestMonitorStore();
    const sharedStates = providedSharedStates || new SharedStateStore({ logger });
    const handlerStates = new HandlerStateStore();
    const registry = new MockRegistry(routeGroups);
    const app = createApp({
      registry,
      config: {
        requestTimeoutMs,
        proxyFallbackEnabled: false,
        caseInsensitiveFilters,
        filesDir,
      },
      logger,
      proxyMiddlewareRegistry: new ProxyMiddlewareRegistry(loaded.proxyMiddlewareRouteGroups),
      requestMonitor,
      handlerStates,
      sharedStates,
    });
    return { app, logger, requestMonitor, sharedStates, handlerStates, registry };
  }

  test("createApp richiede lo store esplicito e non crea runtime impliciti", () => {
    expect(() => createApp({})).toThrow(
      "createApp requires an explicitly injected sharedStates store"
    );
  });

  test("una POST aggiunge un item arbitrario e la GET successiva legge la lista condivisa", async () => {
    await writeHandler({
      mocksDir,
      folder: "items-get",
      method: "GET",
      source: handlerSource({
        path: "/api/items",
        body: `const items = await context.sharedState.open("items", {
      seedKey: "items@v1",
      initialize: () => [{ id: 1, name: "Seed" }],
    });
    return { status: 200, jsonBody: items.read(), applyListQuery: true };`,
      }),
    });
    await writeHandler({
      mocksDir,
      folder: "items-post",
      method: "POST",
      source: handlerSource({
        path: "/api/items",
        body: `const items = await context.sharedState.open("items", {
      seedKey: "items@v1",
      initialize: () => [{ id: 1, name: "Seed" }],
    });
    const created = items.mutate((draft) => {
      draft.push(context.jsonBody);
      return context.jsonBody;
    });
    return { status: 201, jsonBody: created };`,
      }),
    });
    const { app } = await buildApp();

    expect((await request(app).get("/api/items")).body).toEqual([{ id: 1, name: "Seed" }]);
    const created = await request(app)
      .post("/api/items")
      .send({ id: "frontend-temp-id", name: "Creato dal frontend", extra: { arbitrary: true } });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: "frontend-temp-id",
      name: "Creato dal frontend",
      extra: { arbitrary: true },
    });
    expect((await request(app).get("/api/items")).body).toEqual([
      { id: 1, name: "Seed" },
      { id: "frontend-temp-id", name: "Creato dal frontend", extra: { arbitrary: true } },
    ]);
  });

  test("applyListQuery è opt-in e riusa filtri, pagina e precedenza di X-Total-Count", async () => {
    await writeHandler({
      mocksDir,
      folder: "list",
      method: "GET",
      source: handlerSource({
        path: "/api/list",
        body: `return {
      status: 200,
      headers: { "X-Total-Count": "script-value" },
      jsonBody: [
        { id: 1, role: "admin" },
        { id: 2, role: "ADMIN" },
        { id: 3, role: "user" },
      ],
      applyListQuery: true,
    };`,
      }),
    });
    const { app } = await buildApp();

    const untouched = await request(app).get("/api/list");
    expect(untouched.body).toHaveLength(3);
    expect(untouched.headers["x-total-count"]).toBe("script-value");

    const filtered = await request(app).get("/api/list?role=admin&page=0&size=1");
    expect(filtered.body).toEqual([{ id: 1, role: "admin" }]);
    expect(filtered.headers["x-total-count"]).toBe("2");
  });

  test("applyListQuery non booleano o senza jsonBody segue il normale errore handler", async () => {
    await writeHandler({
      mocksDir,
      folder: "invalid-flag",
      method: "GET",
      source: handlerSource({
        path: "/invalid-flag",
        body: `return { status: 200, jsonBody: [], applyListQuery: "yes" };`,
      }),
    });
    await writeHandler({
      mocksDir,
      folder: "missing-json",
      method: "GET",
      source: handlerSource({
        path: "/missing-json",
        body: `return { status: 204, applyListQuery: true };`,
      }),
    });
    const { app } = await buildApp();

    expect((await request(app).get("/invalid-flag")).status).toBe(500);
    expect((await request(app).get("/missing-json")).status).toBe(500);
  });

  test("conflitto non intercettato è 409 sanitizzato e resta diagnosticabile nel Monitor", async () => {
    await writeHandler({
      mocksDir,
      folder: "v1",
      method: "GET",
      source: handlerSource({
        path: "/v1",
        body: `const value = await context.sharedState.open("private-items", {
      seedKey: "private-items@v1",
      initialize: () => [{ secret: "must-not-leak" }],
    });
    return { jsonBody: value.read() };`,
      }),
    });
    await writeHandler({
      mocksDir,
      folder: "v2",
      method: "GET",
      source: handlerSource({
        path: "/v2",
        body: `await context.sharedState.open("private-items", {
      seedKey: "private-items@v2",
      initialize: () => [],
    });
    return { jsonBody: [] };`,
      }),
    });
    const { app, requestMonitor } = await buildApp();
    await request(app).get("/v1");

    const conflict = await request(app).get("/v2");
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({
      error: "Shared State Conflict",
      code: "SHARED_STATE_SEED_CONFLICT",
      message: "The shared runtime state has an incompatible seed. Stop traffic, find the resource in the Mockxy monitor or server log, reset it, then retry.",
    });
    expect(JSON.stringify(conflict.body)).not.toContain("private-items");
    expect(JSON.stringify(conflict.body)).not.toContain("@v2");
    expect(JSON.stringify(conflict.body)).not.toContain("must-not-leak");

    const monitored = requestMonitor.listEntries().find((entry) => entry.path === "/v2");
    expect(monitored.sharedStateError).toEqual({
      code: "SHARED_STATE_SEED_CONFLICT",
      name: "private-items",
      requestedSeedKey: "private-items@v2",
      currentSeedKey: "private-items@v1",
      responseFile: "001.response.json",
    });
  });

  test("uno script può intercettare l'errore e scegliere il proprio contratto HTTP", async () => {
    await writeHandler({
      mocksDir,
      folder: "seed",
      method: "GET",
      source: handlerSource({
        path: "/seed",
        body: `await context.sharedState.open("items", { seedKey: "items@v1", initialize: () => [] });
    return { jsonBody: { ok: true } };`,
      }),
    });
    await writeHandler({
      mocksDir,
      folder: "caught",
      method: "GET",
      source: handlerSource({
        path: "/caught",
        body: `try {
      await context.sharedState.open("items", { seedKey: "items@v2", initialize: () => [] });
    } catch (error) {
      return { status: 422, jsonBody: { domainError: error.code } };
    }`,
      }),
    });
    const { app } = await buildApp();
    await request(app).get("/seed");
    const response = await request(app).get("/caught");
    expect(response.status).toBe(422);
    expect(response.body).toEqual({ domainError: "SHARED_STATE_SEED_CONFLICT" });
  });

  test("un Error ordinario con codice simile non viene riclassificato", async () => {
    await writeHandler({
      mocksDir,
      folder: "fake",
      method: "GET",
      source: handlerSource({
        path: "/fake",
        body: `const error = new Error("ordinary-domain-error");
    error.code = "SHARED_STATE_SEED_CONFLICT";
    throw error;`,
      }),
    });
    const { app, requestMonitor } = await buildApp();
    const response = await request(app).get("/fake");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Handler Execution Failed",
      message: "Unable to generate a local handler response.",
    });
    expect(requestMonitor.listEntries()[0].sharedStateError).toBeUndefined();
  });

  test("un Error ordinario CLIENT_ABORTED non viene scambiato per una disconnessione", async () => {
    await writeHandler({
      mocksDir,
      folder: "fake-abort",
      method: "GET",
      source: handlerSource({
        path: "/fake-abort",
        body: `const error = new Error("ordinary-client-aborted-code");
    error.code = "CLIENT_ABORTED";
    throw error;`,
      }),
    });
    const { app, logger } = await buildApp();
    const response = await request(app).get("/fake-abort");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Handler Execution Failed",
      message: "Unable to generate a local handler response.",
    });
    expect(logger.entries.error).toHaveLength(1);
  });

  test("factory fallita produce warning store-level e log request-level senza valore nel body", async () => {
    await writeHandler({
      mocksDir,
      folder: "failure",
      method: "GET",
      source: handlerSource({
        path: "/failure",
        body: `await context.sharedState.open("credentials", {
      seedKey: "credentials@v1",
      initialize: () => { throw new Error("password=hunter2"); },
    });`,
      }),
    });
    const { app, logger } = await buildApp();
    const response = await request(app).get("/failure");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Handler Execution Failed",
      code: "SHARED_STATE_INIT_FAILED",
      message: "Unable to use shared runtime state. See the Mockxy monitor or server log.",
    });
    expect(JSON.stringify(response.body)).not.toContain("credentials");
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
    expect(logger.entries.warn).toHaveLength(1);
    expect(logger.entries.error).toHaveLength(1);
  });

  test("il timeout chiude il facade e impedisce una mutazione tardiva", async () => {
    await writeHandler({
      mocksDir,
      folder: "timeout",
      method: "GET",
      source: handlerSource({
        path: "/timeout",
        body: `const state = await context.sharedState.open("late", {
      seedKey: "late@v1",
      initialize: () => ({ count: 0 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      state.mutate((draft) => { draft.count += 1; });
    } catch (error) {
      context.state.lateError = error.code;
    }
    return { jsonBody: state.read() };`,
      }),
    });
    const { app, sharedStates, handlerStates } = await buildApp();
    const response = await request(app).get("/timeout");
    expect(response.status).toBe(504);
    await waitFor(() => handlerStates.entries.get("GET /timeout")?.state.lateError != null);
    expect(handlerStates.entries.get("GET /timeout").state.lateError)
      .toBe("SHARED_STATE_CONTEXT_CLOSED");
    expect(sharedStates.listMetadata().items[0].version).toBe(1);
  });

  test("POST concorrenti non perdono aggiornamenti", async () => {
    await writeHandler({
      mocksDir,
      folder: "concurrent-get",
      method: "GET",
      source: handlerSource({
        path: "/concurrent",
        body: `const state = await context.sharedState.open("concurrent", {
      seedKey: "concurrent@v1",
      initialize: () => [],
    });
    return { jsonBody: state.read() };`,
      }),
    });
    await writeHandler({
      mocksDir,
      folder: "concurrent-post",
      method: "POST",
      source: handlerSource({
        path: "/concurrent",
        body: `const state = await context.sharedState.open("concurrent", {
      seedKey: "concurrent@v1",
      initialize: () => [],
    });
    state.mutate((draft) => { draft.push(context.jsonBody); });
    return { status: 201, jsonBody: context.jsonBody };`,
      }),
    });
    const { app, sharedStates } = await buildApp();

    const responses = await Promise.all(
      Array.from({ length: 30 }, (_, id) => request(app).post("/concurrent").send({ id }))
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const state = (await request(app).get("/concurrent")).body;
    expect(state).toHaveLength(30);
    expect(state.map((item) => item.id).sort((left, right) => left - right))
      .toEqual(Array.from({ length: 30 }, (_, id) => id));
    expect(sharedStates.listMetadata().items[0].version).toBe(31);
  });

  test("una mutazione già committata sopravvive a un errore successivo dello script", async () => {
    await writeHandler({
      mocksDir,
      folder: "commit-then-error",
      method: "POST",
      source: handlerSource({
        path: "/commit-then-error",
        body: `const state = await context.sharedState.open("committed", {
      seedKey: "committed@v1",
      initialize: () => ({ count: 0 }),
    });
    state.mutate((draft) => { draft.count += 1; });
    throw new Error("response failed after commit");`,
      }),
    });
    await writeHandler({
      mocksDir,
      folder: "committed-get",
      method: "GET",
      source: handlerSource({
        path: "/committed",
        body: `const state = await context.sharedState.open("committed", {
      seedKey: "committed@v1",
      initialize: () => ({ count: 0 }),
    });
    return { jsonBody: state.read() };`,
      }),
    });
    const { app } = await buildApp();

    expect((await request(app).post("/commit-then-error").send({})).status).toBe(500);
    expect((await request(app).get("/committed")).body).toEqual({ count: 1 });
  });

  test("il facade viene chiuso anche dopo un return riuscito", async () => {
    await writeHandler({
      mocksDir,
      folder: "return-late",
      method: "GET",
      source: handlerSource({
        path: "/return-late",
        body: `const state = await context.sharedState.open("return-late", {
      seedKey: "return-late@v1",
      initialize: () => ({ count: 0 }),
    });
    setTimeout(() => {
      try {
        state.mutate((draft) => { draft.count += 1; });
      } catch (error) {
        context.state.lateError = error.code;
      }
    }, 20);
    return { jsonBody: state.read() };`,
      }),
    });
    const { app, sharedStates, handlerStates } = await buildApp();

    expect((await request(app).get("/return-late")).body).toEqual({ count: 0 });
    await waitFor(() => handlerStates.entries.get("GET /return-late")?.state.lateError != null);
    expect(handlerStates.entries.get("GET /return-late").state.lateError)
      .toBe("SHARED_STATE_CONTEXT_CLOSED");
    expect(sharedStates.listMetadata().items[0].version).toBe(1);
  });

  test("un disconnect dopo l'avvio conserva callCount ma blocca il commit tardivo", async () => {
    await writeHandler({
      mocksDir,
      folder: "disconnect",
      method: "GET",
      source: handlerSource({
        path: "/disconnect",
        body: `const state = await context.sharedState.open("disconnect", {
      seedKey: "disconnect@v1",
      initialize: () => ({ count: 0 }),
    });
    context.state.started = true;
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      state.mutate((draft) => { draft.count += 1; });
    } catch (error) {
      context.state.lateError = error.code;
    }
    return { jsonBody: { done: true } };`,
      }),
    });
    const { app, logger, sharedStates, handlerStates } = await buildApp({ requestTimeoutMs: 500 });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));

    try {
      const client = http.get({
        host: "127.0.0.1",
        port: server.address().port,
        path: "/disconnect",
      });
      client.on("error", () => {});
      await waitFor(() => handlerStates.entries.get("GET /disconnect")?.state.started === true);
      const clientClosed = new Promise((resolve) => client.once("close", resolve));
      client.destroy();
      await clientClosed;
      await waitFor(() => handlerStates.entries.get("GET /disconnect")?.state.lateError != null);

      const runtime = handlerStates.entries.get("GET /disconnect");
      expect(runtime.callCount).toBe(1);
      expect(runtime.state.lateError).toBe("SHARED_STATE_CONTEXT_CLOSED");
      expect(sharedStates.listMetadata().items[0].version).toBe(1);
      expect(logger.entries.error).toHaveLength(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("il seed da file viene riletto solo dopo reset, mentre il valore live resta stabile", async () => {
    const filesDir = path.join(mocksDir, "files");
    await fs.promises.mkdir(filesDir, { recursive: true });
    const seedPath = path.join(filesDir, "catalog.json");
    await fs.promises.writeFile(seedPath, JSON.stringify([{ id: 1 }]), "utf8");
    await writeHandler({
      mocksDir,
      folder: "file-seed",
      method: "GET",
      source: handlerSource({
        path: "/file-seed",
        body: `const state = await context.sharedState.open("catalog", {
      seedKey: "catalog@v1",
      initialize: () => context.data("catalog"),
    });
    return { jsonBody: state.read() };`,
      }),
    });
    const { app, sharedStates } = await buildApp({ filesDir });

    expect((await request(app).get("/file-seed")).body).toEqual([{ id: 1 }]);
    await fs.promises.writeFile(seedPath, JSON.stringify([{ id: 2 }]), "utf8");
    expect((await request(app).get("/file-seed")).body).toEqual([{ id: 1 }]);

    expect(sharedStates.reset("catalog")).toBe(true);
    expect((await request(app).get("/file-seed")).body).toEqual([{ id: 2 }]);
  });

  test("lo shared state sopravvive al reload degli handler senza rieseguire il seed", async () => {
    await writeHandler({
      mocksDir,
      folder: "hot-get",
      method: "GET",
      source: handlerSource({
        path: "/hot",
        body: `const state = await context.sharedState.open("hot", {
      seedKey: "hot@v1",
      initialize: () => [{ id: 1 }],
    });
    return { jsonBody: { revision: "before", items: state.read() } };`,
      }),
    });
    await writeHandler({
      mocksDir,
      folder: "hot-post",
      method: "POST",
      source: handlerSource({
        path: "/hot",
        body: `const state = await context.sharedState.open("hot", {
      seedKey: "hot@v1",
      initialize: () => [{ id: 1 }],
    });
    state.mutate((draft) => { draft.push(context.jsonBody); });
    return { status: 201, jsonBody: context.jsonBody };`,
      }),
    });
    const { app, registry } = await buildApp();
    await request(app).post("/hot").send({ id: 2 });

    await writeHandler({
      mocksDir,
      folder: "hot-get",
      method: "GET",
      source: handlerSource({
        path: "/hot",
        body: `const state = await context.sharedState.open("hot", {
      seedKey: "hot@v1",
      initialize: () => [{ id: 999 }],
    });
    return { jsonBody: { revision: "after", items: state.read() } };`,
      }),
    });
    const reloaded = await loadEndpointRouteGroups(mocksDir);
    expect(reloaded.loadErrors).toEqual([]);
    registry.setRouteGroups(mergeLocalRouteGroups(reloaded));

    expect((await request(app).get("/hot")).body).toEqual({
      revision: "after",
      items: [{ id: 1 }, { id: 2 }],
    });
  });

  test("uno store chiuso produce 503 sanitizzato", async () => {
    await writeHandler({
      mocksDir,
      folder: "closed",
      method: "GET",
      source: handlerSource({
        path: "/closed",
        body: `await context.sharedState.open("private", {
      seedKey: "private@v1",
      initialize: () => ({ secret: true }),
    });`,
      }),
    });
    const sharedStates = new SharedStateStore();
    const { app } = await buildApp({ sharedStates });
    sharedStates.close();

    const response = await request(app).get("/closed");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "Shared State Unavailable",
      code: "SHARED_STATE_STORE_CLOSED",
      message: "The shared runtime state is unavailable because Mockxy is shutting down. Retry later.",
    });
    expect(JSON.stringify(response.body)).not.toContain("private");
  });
});
