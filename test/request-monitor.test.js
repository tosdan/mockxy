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
