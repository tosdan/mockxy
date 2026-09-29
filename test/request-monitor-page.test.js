const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { parseMonitorPageQuery, readMonitorEntry, readMonitorPage } = require("../src/monitoring/request-monitor-page");

// Monitor interrogabile (piano agent/API, §8 S5 e §13 C5): pagine, cursore, filtri e gap.
const RUNTIME = "runtime-1";

function record(store, { method = "GET", path = "/items", status = 200, source = "mock", body } = {}) {
  const headers = { "content-type": "application/json" };
  return store.recordRequest({
    req: { method, path, originalUrl: `${path}?q=1`, headers },
    res: { statusCode: status, getHeaders: () => ({ "content-type": "application/json" }) },
    startedAt: Date.now(),
    completedAt: Date.now() + 3,
    source,
    capture: body == null ? undefined : { snapshot: () => ({ bodyBuffer: Buffer.from(body), totalBytes: body.length, truncated: false }) },
  });
}

function page(store, query) {
  return readMonitorPage(store, RUNTIME, parseMonitorPageQuery({ view: "page", ...query }));
}

function ids(result) {
  return result.items.map((item) => item.id);
}

describe("Monitor interrogabile — pagine e cursore", () => {
  // L'esempio del contratto: buffer 11–15, filtro che corrisponde a 12, 14 e 15.
  function exampleStore() {
    const store = new RequestMonitorStore(5);
    for (let id = 1; id <= 15; id += 1) {
      record(store, { path: [12, 14, 15].includes(id) ? "/match" : "/other" });
    }
    return store;
  }
  const cursorOf = (result) => ({ since: result.cursor.since, runtimeId: result.cursor.runtimeId, generation: String(result.cursor.generation) });

  test("l'esempio del contratto: due pagine senza buchi né duplicati", () => {
    const store = exampleStore();
    const first = page(store, { path: "/match", since: "10", runtimeId: RUNTIME, generation: "1", limit: "2" });
    expect(ids(first)).toEqual(["12", "14"]);
    expect(first).toMatchObject({ hasMore: true, gap: false, gapReason: null, cursor: { runtimeId: RUNTIME, generation: 1, since: "14" } });
    expect(first.available).toEqual({ oldestId: "11", newestId: "15", highWatermark: "15" });

    const second = page(store, { path: "/match", limit: "2", ...cursorOf(first) });
    expect(ids(second)).toEqual(["15"]);
    expect(second).toMatchObject({ hasMore: false, gap: false, cursor: { since: "15" } });
  });

  test("senza corrispondenze il cursore avanza comunque fino all'ultimo ID assegnato", () => {
    const store = exampleStore();
    const result = page(store, { path: "/nessuna", since: "10", runtimeId: RUNTIME, generation: "1" });
    expect(result.items).toEqual([]);
    expect(result).toMatchObject({ hasMore: false, gap: false, cursor: { since: "15" } });
  });

  test("se il cursore è stato superato dall'espulsione la risposta lo dichiara, anche senza corrispondenze perse", () => {
    const store = exampleStore();
    const first = page(store, { path: "/match", since: "10", runtimeId: RUNTIME, generation: "1", limit: "2" });
    for (let i = 0; i < 5; i += 1) record(store, { path: "/other" });

    const second = page(store, { path: "/match", limit: "2", ...cursorOf(first) });
    expect(second).toMatchObject({ gap: true, gapReason: "evicted", items: [], hasMore: false, cursor: { since: "20" } });
    expect(second.available).toEqual({ oldestId: "16", newestId: "20", highWatermark: "20" });
  });

  test("la prima lettura parte dal più vecchio disponibile senza dichiarare il passato espulso; latest parte da adesso", () => {
    const store = exampleStore();
    const first = page(store, {});
    expect(ids(first)).toEqual(["11", "12", "13", "14", "15"]);
    expect(first).toMatchObject({ gap: false, hasMore: false, cursor: { since: "15" } });

    const latest = page(store, { since: "latest" });
    expect(latest).toMatchObject({ items: [], gap: false, hasMore: false, cursor: { runtimeId: RUNTIME, generation: 1, since: "15" } });
  });

  test("il traffico arrivato durante la lettura appartiene alla pagina successiva, non si perde", () => {
    const store = new RequestMonitorStore(250);
    for (let i = 0; i < 3; i += 1) record(store);
    let result = page(store, { limit: "2" });
    const seen = [...ids(result)];
    for (let i = 0; i < 4; i += 1) record(store);
    while (true) {
      result = page(store, { limit: "2", ...cursorOf(result) });
      seen.push(...ids(result));
      if (!result.hasMore) break;
      record(store);
    }
    const all = store.snapshot().entries.map((entry) => entry.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("un altro runtime o un clear, anche a buffer vuoto, sono un gap riconoscibile", () => {
    const store = new RequestMonitorStore(250);
    record(store);
    const cursor = { since: "1", runtimeId: RUNTIME, generation: "1" };

    const restarted = readMonitorPage(store, "runtime-2", parseMonitorPageQuery({ view: "page", ...cursor }));
    expect(restarted).toMatchObject({ gap: true, gapReason: "runtime_changed", cursor: { runtimeId: "runtime-2" } });

    store.clear();
    const cleared = page(store, cursor);
    expect(cleared).toMatchObject({ gap: true, gapReason: "cleared", items: [], cursor: { generation: 2, since: "1" } });
    expect(cleared.available).toEqual({ oldestId: null, newestId: null, highWatermark: "1" });

    // Il clear non riutilizza gli ID e cresce anche a buffer già vuoto.
    store.clear();
    expect(page(store, { since: "1", runtimeId: RUNTIME, generation: "2" }).gapReason).toBe("cleared");
    expect(record(store).id).toBe("2");
  });

  test("un cursore oltre l'ultimo ID assegnato nello stesso runtime è un 400 CURSOR_AHEAD", () => {
    const store = exampleStore();
    expect(() => page(store, { since: "16", runtimeId: RUNTIME, generation: "1" })).toThrow(
      expect.objectContaining({ status: 400, details: expect.objectContaining({ code: "CURSOR_AHEAD" }) }),
    );
  });
});

describe("Monitor interrogabile — filtri e proiezione", () => {
  test("i filtri si applicano in AND, con metodo normalizzato e path senza query", () => {
    const store = new RequestMonitorStore(250);
    record(store, { method: "GET", path: "/a", status: 200, source: "mock" });
    record(store, { method: "POST", path: "/a", status: 201, source: "mock" });
    record(store, { method: "POST", path: "/a", status: 201, source: "proxy" });
    record(store, { method: "POST", path: "/b", status: 201, source: "mock" });

    expect(ids(page(store, { method: "post", path: "/a", status: "201", source: "mock" }))).toEqual(["2"]);
    expect(ids(page(store, { method: "POST" }))).toEqual(["2", "3", "4"]);
  });

  test("il sommario non contiene body né header; full è la voce completa", () => {
    const store = new RequestMonitorStore(250);
    record(store, { body: '{"secret":1}' });

    const [summary] = page(store, {}).items;
    expect(Object.keys(summary).sort()).toEqual(
      ["id", "latencyMs", "matchedRoutePath", "method", "originalUrl", "path", "sequenceStep", "sharedStateError", "source", "status", "timestamp"].sort(),
    );
    expect(summary).toMatchObject({ matchedRoutePath: null, sequenceStep: null, sharedStateError: null });
    expect(JSON.stringify(summary)).not.toContain("secret");

    const [full] = page(store, { fields: "full" }).items;
    expect(full.requestBody).toContain("secret");
    expect(full).toHaveProperty("requestBodyTruncated", false);
    expect(full).toHaveProperty("requestHeaders");
  });

  test("limit predefinito 50, massimo 250", () => {
    const store = new RequestMonitorStore(250);
    for (let i = 0; i < 60; i += 1) record(store);
    const result = page(store, {});
    expect(result.items).toHaveLength(50);
    expect(result).toMatchObject({ hasMore: true, cursor: { since: "50" } });
    expect(page(store, { limit: "250" }).items).toHaveLength(60);
  });
});

describe("Monitor interrogabile — validazione della query", () => {
  const invalid = (query) => {
    try {
      parseMonitorPageQuery(query);
    } catch (error) {
      return { status: error.status, code: error.details?.code, parameter: error.details?.parameter };
    }
    return null;
  };

  test("senza query resta la vista storica", () => {
    expect(parseMonitorPageQuery({})).toBeNull();
  });

  test("il metodo è un token HTTP qualunque, normalizzato in maiuscolo", () => {
    expect(parseMonitorPageQuery({ view: "page", method: "m-search" }).filters.method).toBe("M-SEARCH");
    expect(parseMonitorPageQuery({ view: "page", method: "PropFind" }).filters.method).toBe("PROPFIND");
  });

  test.each([
    [{ limit: "10" }, "view"],
    [{ view: "list" }, "view"],
    [{ view: "page", foo: "1" }, "foo"],
    [{ view: "page", limit: "0" }, "limit"],
    [{ view: "page", limit: "251" }, "limit"],
    [{ view: "page", limit: "1.5" }, "limit"],
    [{ view: "page", fields: "all" }, "fields"],
    [{ view: "page", method: "" }, "method"],
    [{ view: "page", method: "M SEARCH" }, "method"],
    [{ view: "page", path: "items" }, "path"],
    [{ view: "page", path: "/items?x=1" }, "path"],
    [{ view: "page", status: "99" }, "status"],
    [{ view: "page", status: "600" }, "status"],
    [{ view: "page", source: "" }, "source"],
    [{ view: "page", since: "-1" }, "since"],
    [{ view: "page", since: "abc" }, "since"],
    [{ view: "page", since: "3" }, "runtimeId"],
    [{ view: "page", since: "3", runtimeId: "r" }, "generation"],
    [{ view: "page", since: "3", runtimeId: "r", generation: "0" }, "generation"],
    [{ view: "page", runtimeId: "r" }, "runtimeId"],
    [{ view: "page", since: "latest", generation: "1" }, "generation"],
    [{ view: "page", limit: ["1", "2"] }, "limit"],
  ])("%j è un 400 su %s", (query, parameter) => {
    expect(invalid(query)).toEqual({ status: 400, code: "INVALID_QUERY", parameter });
  });
});

describe("Monitor interrogabile — voce per ID", () => {
  test("voce completa del runtime indicato; 409 se il runtime è un altro; 404 se espulsa o cancellata", () => {
    const store = new RequestMonitorStore(2);
    record(store, { body: '{"a":1}' });

    expect(readMonitorEntry(store, RUNTIME, "1", { runtimeId: RUNTIME })).toMatchObject({ runtimeId: RUNTIME, item: { id: "1" } });
    expect(readMonitorEntry(store, RUNTIME, "1", { runtimeId: RUNTIME }).item.requestBody).toContain('"a"');

    expect(() => readMonitorEntry(store, RUNTIME, "1", { runtimeId: "altro" })).toThrow(
      expect.objectContaining({ status: 409, details: expect.objectContaining({ code: "RUNTIME_CHANGED", runtimeId: RUNTIME }) }),
    );

    record(store);
    record(store);
    const notAvailable = expect.objectContaining({ status: 404, details: expect.objectContaining({ code: "REQUEST_NOT_AVAILABLE" }) });
    expect(() => readMonitorEntry(store, RUNTIME, "1", { runtimeId: RUNTIME })).toThrow(notAvailable);
    store.clear();
    expect(() => readMonitorEntry(store, RUNTIME, "3", { runtimeId: RUNTIME })).toThrow(notAvailable);
    expect(() => readMonitorEntry(store, RUNTIME, "99", { runtimeId: RUNTIME })).toThrow(notAvailable);
  });

  test("runtimeId è obbligatorio, l'ID è decimale e non si accettano altri parametri", () => {
    const store = new RequestMonitorStore(2);
    const badRequest = expect.objectContaining({ status: 400, details: expect.objectContaining({ code: "INVALID_QUERY" }) });
    expect(() => readMonitorEntry(store, RUNTIME, "1", {})).toThrow(badRequest);
    expect(() => readMonitorEntry(store, RUNTIME, "uno", { runtimeId: RUNTIME })).toThrow(badRequest);
    expect(() => readMonitorEntry(store, RUNTIME, "1", { runtimeId: RUNTIME, fields: "full" })).toThrow(badRequest);
  });
});
