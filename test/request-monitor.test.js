const zlib = require("zlib");
const { RequestMonitorStore, createRequestMonitorEntry } = require("../src/monitoring/request-monitor");

// Builds a monitor entry from a faked response capture so the body-formatting logic can be
// exercised without spinning up a real proxy round-trip.
function buildEntryForResponse({ headers = {}, bodyBuffer = Buffer.alloc(0), truncated = false }) {
  return createRequestMonitorEntry({
    id: 1,
    req: { method: "GET", path: "/api/data", originalUrl: "/api/data", url: "/api/data", headers: {} },
    res: { statusCode: 200, getHeaders: () => headers },
    startedAt: 1000,
    completedAt: 1010,
    source: "backend",
    responseCapture: {
      snapshot: () => ({ bodyBuffer, totalBytes: bodyBuffer.length, truncated }),
    },
  });
}

const JSON_PAYLOAD = { backend: true, items: [1, 2, 3], note: "ciao" };
const JSON_BUFFER = Buffer.from(JSON.stringify(JSON_PAYLOAD), "utf8");

describe("request monitor body decompression", () => {
  test("decomprime una response gzip e mostra il JSON leggibile", () => {
    const entry = buildEntryForResponse({
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      bodyBuffer: zlib.gzipSync(JSON_BUFFER),
    });

    expect(JSON.parse(entry.responseBody)).toEqual(JSON_PAYLOAD);
  });

  test("decomprime una response deflate", () => {
    const entry = buildEntryForResponse({
      headers: { "content-type": "application/json", "content-encoding": "deflate" },
      bodyBuffer: zlib.deflateSync(JSON_BUFFER),
    });

    expect(JSON.parse(entry.responseBody)).toEqual(JSON_PAYLOAD);
  });

  test("decomprime una response brotli", () => {
    const entry = buildEntryForResponse({
      headers: { "content-type": "application/json", "content-encoding": "br" },
      bodyBuffer: zlib.brotliCompressSync(JSON_BUFFER),
    });

    expect(JSON.parse(entry.responseBody)).toEqual(JSON_PAYLOAD);
  });

  test("decomprime testo non-JSON mantenendolo com'è", () => {
    const text = "prima riga\nseconda riga";
    const entry = buildEntryForResponse({
      headers: { "content-type": "text/plain", "content-encoding": "gzip" },
      bodyBuffer: zlib.gzipSync(Buffer.from(text, "utf8")),
    });

    expect(entry.responseBody).toBe(text);
  });

  test("ripiega sul placeholder quando lo stream compresso è troncato", () => {
    const fullGzip = zlib.gzipSync(Buffer.from(JSON.stringify({ filler: "x".repeat(4096) }), "utf8"));
    const partialGzip = fullGzip.subarray(0, 40);
    const entry = buildEntryForResponse({
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      bodyBuffer: partialGzip,
      truncated: true,
    });

    expect(entry.responseBody).toBe(`[compressed payload: ${partialGzip.length} bytes, preview truncated]`);
  });

  test("ripiega sul placeholder per un content-encoding non supportato", () => {
    const entry = buildEntryForResponse({
      headers: { "content-type": "application/json", "content-encoding": "compress" },
      bodyBuffer: JSON_BUFFER,
    });

    expect(entry.responseBody).toBe(`[compressed payload: ${JSON_BUFFER.length} bytes]`);
  });

  test("segnala un payload binario decompresso ma non testuale", () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
    const entry = buildEntryForResponse({
      headers: { "content-type": "application/octet-stream", "content-encoding": "gzip" },
      bodyBuffer: zlib.gzipSync(binary),
    });

    expect(entry.responseBody).toBe(`[binary payload: ${binary.length} bytes]`);
  });

  test("non altera una response non compressa", () => {
    const entry = buildEntryForResponse({
      headers: { "content-type": "application/json" },
      bodyBuffer: JSON_BUFFER,
    });

    expect(JSON.parse(entry.responseBody)).toEqual(JSON_PAYLOAD);
  });
});

describe("request monitor broadcast isolation", () => {
  function recordSampleRequest(store) {
    return store.recordRequest({
      req: { method: "GET", path: "/api/data", originalUrl: "/api/data", url: "/api/data", headers: {} },
      res: { statusCode: 200, getHeaders: () => ({}) },
      startedAt: 1000,
      completedAt: 1010,
      source: "mock",
    });
  }

  test("un subscriber che lancia non propaga l'errore e non blocca gli altri", () => {
    const logger = { error: jest.fn() };
    const store = new RequestMonitorStore(undefined, logger);
    const received = [];
    store.subscribe(() => {
      throw new Error("boom");
    });
    store.subscribe((event) => received.push(event));

    expect(() => recordSampleRequest(store)).not.toThrow();

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("request");
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("l'errore viene inghiottito anche senza logger configurato", () => {
    const store = new RequestMonitorStore();
    store.subscribe(() => {
      throw new Error("boom");
    });

    expect(() => store.clear()).not.toThrow();
  });
});

// L'anteprima resta piccola (viaggia verso l'interfaccia e nei dump); la risposta completa si
// conserva a parte, in memoria, per creare un mock da una voce con l'anteprima troncata.
describe("request monitor: anteprima e risposta completa", () => {
  const { MAX_CAPTURED_BODY_BYTES, startResponseCapture } = require("../src/monitoring/request-monitor");
  const JSON_HEADERS = { "content-type": "application/json" };

  const bigJson = (bytes) => {
    const items = [];
    while (JSON.stringify(items).length < bytes) {
      items.push({ id: items.length + 1, note: "x".repeat(80) });
    }
    return items;
  };

  function record(store, { headers = JSON_HEADERS, bodyBuffer, truncated = false }) {
    return store.recordRequest({
      req: { method: "GET", path: "/api/data", originalUrl: "/api/data", url: "/api/data", headers: {} },
      res: { statusCode: 200, getHeaders: () => headers },
      startedAt: 1000,
      completedAt: 1010,
      source: "backend",
      responseCapture: { snapshot: () => ({ bodyBuffer, totalBytes: bodyBuffer.length, truncated }) },
    });
  }

  test("sotto il cap dell'anteprima la voce è completa e non conserva altro", () => {
    const store = new RequestMonitorStore();
    const payload = bigJson(20 * 1024);

    const entry = record(store, { bodyBuffer: Buffer.from(JSON.stringify(payload)) });

    expect(JSON.parse(entry.responseBody)).toEqual(payload);
    expect(entry).toMatchObject({ responseBodyTruncated: false, responseBodyRetained: false });
    expect(store.retainedBytes).toBe(0);
    expect(store.getCaptureEntry(entry.id)).toBe(entry);
  });

  test("sopra il cap l'anteprima è troncata, ma il mock si crea dalla risposta intera", () => {
    const store = new RequestMonitorStore();
    const payload = bigJson(400 * 1024);
    const bodyBuffer = Buffer.from(JSON.stringify(payload));

    const entry = record(store, { bodyBuffer });

    expect(entry).toMatchObject({ responseBodyTruncated: true, responseBodyRetained: true, responseBodyBytes: bodyBuffer.length });
    expect(entry.responseBody.endsWith("/* preview truncated */")).toBe(true);
    expect(Buffer.byteLength(entry.responseBody)).toBeLessThan(MAX_CAPTURED_BODY_BYTES + 64);

    const capture = store.getCaptureEntry(entry.id);
    expect(capture.responseBodyTruncated).toBe(false);
    expect(JSON.parse(capture.responseBody)).toEqual(payload);
    // La voce nel buffer resta quella con l'anteprima.
    expect(store.getEntry(entry.id).responseBody).toBe(entry.responseBody);
  });

  test("una risposta compressa conta per quanto è grande decompressa", () => {
    const store = new RequestMonitorStore();
    const payload = bigJson(400 * 1024);
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
    expect(compressed.length).toBeLessThan(MAX_CAPTURED_BODY_BYTES);

    const entry = record(store, { headers: { ...JSON_HEADERS, "content-encoding": "gzip" }, bodyBuffer: compressed });

    expect(entry).toMatchObject({ responseBodyTruncated: true, responseBodyRetained: true });
    expect(Buffer.byteLength(entry.responseBody)).toBeLessThan(MAX_CAPTURED_BODY_BYTES + 64);
    expect(JSON.parse(store.getCaptureEntry(entry.id).responseBody)).toEqual(payload);
  });

  test("pochi KB compressi che si gonfiano oltre il cap di cattura non vengono decompressi", () => {
    const store = new RequestMonitorStore(undefined, undefined, { captureMaxBodyBytes: 1024 * 1024 });
    const bomb = zlib.gzipSync(Buffer.alloc(32 * 1024 * 1024, "a"));
    expect(bomb.length).toBeLessThan(MAX_CAPTURED_BODY_BYTES);

    const entry = record(store, { headers: { "content-type": "text/plain", "content-encoding": "gzip" }, bodyBuffer: bomb });

    expect(entry.responseBody).toBe(`[compressed payload: ${bomb.length} bytes]`);
    expect(entry.responseBodyRetained).toBe(false);
    expect(store.retainedBytes).toBe(0);
  });

  test("un payload binario grande resta un segnaposto: non c'è nulla da conservare", () => {
    const store = new RequestMonitorStore();

    const entry = record(store, { headers: { "content-type": "image/png" }, bodyBuffer: Buffer.alloc(400 * 1024, 1) });

    expect(entry.responseBody).toBe(`[binary payload: ${400 * 1024} bytes]`);
    expect(entry.responseBodyRetained).toBe(false);
  });

  test("con il cap di cattura a 0 non si conserva nulla: resta la sola anteprima", () => {
    const store = new RequestMonitorStore(undefined, undefined, { captureMaxBodyBytes: 0 });

    const entry = record(store, { bodyBuffer: Buffer.from(JSON.stringify(bigJson(400 * 1024))) });

    expect(entry).toMatchObject({ responseBodyTruncated: true, responseBodyRetained: false });
    expect(store.getCaptureEntry(entry.id)).toBe(entry);
  });

  test("oltre il tetto si lasciano andare le risposte più vecchie, e la voce lo dichiara", () => {
    const store = new RequestMonitorStore(undefined, undefined, {
      captureMaxBodyBytes: 500 * 1024,
      retainedBudgetBytes: 700 * 1024,
    });
    const body = () => Buffer.from(JSON.stringify(bigJson(300 * 1024)));

    const first = record(store, { bodyBuffer: body() });
    const second = record(store, { bodyBuffer: body() });
    const third = record(store, { bodyBuffer: body() });

    expect(store.getEntry(first.id).responseBodyRetained).toBe(false);
    expect(store.getCaptureEntry(first.id).responseBodyTruncated).toBe(true);
    expect(store.getEntry(second.id).responseBodyRetained).toBe(true);
    expect(store.getCaptureEntry(third.id).responseBodyTruncated).toBe(false);
    expect(store.retainedBytes).toBeLessThanOrEqual(700 * 1024);
  });

  test("una voce espulsa dal buffer o cancellata libera la sua risposta", () => {
    const store = new RequestMonitorStore(2);
    const body = () => Buffer.from(JSON.stringify(bigJson(200 * 1024)));

    record(store, { bodyBuffer: body() });
    record(store, { bodyBuffer: body() });
    const twoBodies = store.retainedBytes;
    record(store, { bodyBuffer: body() });

    expect(store.retainedBodies.size).toBe(2);
    expect(store.retainedBytes).toBe(twoBodies);

    store.clear();
    expect(store.retainedBodies.size).toBe(0);
    expect(store.retainedBytes).toBe(0);
  });

  describe("cattura della risposta in uscita", () => {
    function fakeResponse() {
      return { write() { return true; }, end() {} };
    }

    test("entro il cap di cattura la risposta viene tenuta intera", () => {
      const res = fakeResponse();
      const capture = startResponseCapture(res, 1024 * 1024);

      res.write(Buffer.alloc(100 * 1024, "a"));
      res.write("b".repeat(100 * 1024));
      res.end(Buffer.alloc(100 * 1024, "c"));

      const snapshot = capture.snapshot();
      expect(snapshot).toMatchObject({ totalBytes: 300 * 1024, truncated: false });
      expect(snapshot.bodyBuffer.length).toBe(300 * 1024);
    });

    test("oltre il cap restano solo i byte dell'anteprima, e il conteggio è quello reale", () => {
      const res = fakeResponse();
      const capture = startResponseCapture(res, 200 * 1024);

      res.write(Buffer.alloc(150 * 1024, "a"));
      res.write(Buffer.alloc(150 * 1024, "b"));
      res.end(Buffer.alloc(150 * 1024, "c"));

      const snapshot = capture.snapshot();
      expect(snapshot).toMatchObject({ totalBytes: 450 * 1024, truncated: true });
      expect(snapshot.bodyBuffer.length).toBe(MAX_CAPTURED_BODY_BYTES);
      expect(snapshot.bodyBuffer.subarray(0, 4).toString()).toBe("aaaa");
    });

    test("senza un cap esplicito vale quello dell'anteprima", () => {
      const res = fakeResponse();
      const capture = startResponseCapture(res);

      res.end(Buffer.alloc(MAX_CAPTURED_BODY_BYTES + 1, "a"));

      expect(capture.snapshot()).toMatchObject({ truncated: true });
      expect(capture.snapshot().bodyBuffer.length).toBe(MAX_CAPTURED_BODY_BYTES);
    });
  });
});
