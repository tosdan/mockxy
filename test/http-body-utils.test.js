const { PassThrough } = require("stream");
const {
  cloneHeaders,
  getHeaderValue,
  isJsonContentType,
  isTextContentType,
  parseJsonBody,
  readStreamToBuffer,
  readTextBody,
  removeHeader,
  stripBodyDependentHeaders,
} = require("../src/utils/http-body-utils");

// Utility condivise del body (punto B3 di archived/PIANO-TEST.md): sono la base della lettura dei
// payload per handler e monitor, e i loro edge case decidono cosa vede l'utente negli script.

describe("header helpers", () => {
  test("getHeaderValue ignora il case e ritorna undefined se manca", () => {
    expect(getHeaderValue({ "Content-Type": "text/x" }, "content-type")).toBe("text/x");
    expect(getHeaderValue({ a: "1" }, "manca")).toBeUndefined();
    expect(getHeaderValue(null, "x")).toBeUndefined();
  });

  test("removeHeader elimina tutte le varianti di case e tollera headers null", () => {
    const headers = { "X-Doppio": "a", "x-doppio": "b", resta: "1" };
    removeHeader(headers, "X-DOPPIO");
    expect(headers).toEqual({ resta: "1" });
    expect(() => removeHeader(null, "x")).not.toThrow();
  });

  test("cloneHeaders produce una copia mutabile e tollera null", () => {
    const original = { a: "1" };
    const clone = cloneHeaders(original);
    clone.b = "2";
    expect(original).toEqual({ a: "1" });
    expect(cloneHeaders(null)).toEqual({});
  });

  test("stripBodyDependentHeaders toglie i metadati che diventano stantii ricostruendo il body", () => {
    const headers = {
      "Content-Length": "10",
      "content-encoding": "gzip",
      "Transfer-Encoding": "chunked",
      ETag: '"abc"',
      "x-resta": "1",
    };
    stripBodyDependentHeaders(headers);
    expect(headers).toEqual({ "x-resta": "1" });
  });
});

describe("riconoscimento dei content-type", () => {
  test("isTextContentType: testo e formati testuali noti sì, binari e assenza no", () => {
    expect(isTextContentType({ "content-type": "text/html; charset=utf-8" })).toBe(true);
    expect(isTextContentType({ "content-type": "application/x-www-form-urlencoded" })).toBe(true);
    expect(isTextContentType({ "content-type": "application/graphql" })).toBe(true);
    expect(isTextContentType({ "content-type": "application/octet-stream" })).toBe(false);
    expect(isTextContentType({})).toBe(false);
  });

  test("isJsonContentType: application/json e i +json sì, text/json e assenza no", () => {
    expect(isJsonContentType({ "content-type": "application/json; charset=utf-8" })).toBe(true);
    expect(isJsonContentType({ "content-type": "application/problem+json" })).toBe(true);
    expect(isJsonContentType({ "content-type": "text/json" })).toBe(false);
    expect(isJsonContentType({})).toBe(false);
  });
});

describe("parseJsonBody / readTextBody", () => {
  test("body vuoto o assente → undefined", () => {
    expect(parseJsonBody(Buffer.alloc(0), { "content-type": "application/json" })).toBeUndefined();
    expect(parseJsonBody(undefined, {})).toBeUndefined();
    expect(readTextBody(Buffer.alloc(0), { "content-type": "text/plain" })).toBeUndefined();
    expect(readTextBody(undefined, {})).toBeUndefined();
  });

  test("con JSON dichiarato parsa anche gli scalari; senza dichiarazione serve un corpo strutturato", () => {
    expect(parseJsonBody(Buffer.from("42"), { "content-type": "application/json" })).toBe(42);
    expect(parseJsonBody(Buffer.from("42"), { "content-type": "text/plain" })).toBeUndefined();
    expect(parseJsonBody(Buffer.from(' [1,2]'), { "content-type": "text/plain" })).toEqual([1, 2]);
    expect(parseJsonBody(Buffer.from("{rotto"), { "content-type": "application/json" })).toBeUndefined();
  });

  test("readTextBody decodifica solo i formati testuali", () => {
    expect(readTextBody(Buffer.from("ciao"), { "content-type": "text/plain" })).toBe("ciao");
    expect(readTextBody(Buffer.from("ciao"), { "content-type": "application/octet-stream" })).toBeUndefined();
  });
});

describe("readStreamToBuffer", () => {
  function streamOf(...actions) {
    const stream = new PassThrough();
    setImmediate(() => {
      for (const action of actions) action(stream);
    });
    return stream;
  }

  test("bufferizza i chunk (anche stringhe) fino alla fine", async () => {
    const stream = streamOf(
      (s) => s.write("ci"),
      (s) => s.write(Buffer.from("ao")),
      (s) => s.end(),
    );
    await expect(readStreamToBuffer(stream)).resolves.toEqual(Buffer.from("ciao"));
  });

  test("oltre il limite rigetta con BODY_TOO_LARGE e riporta il limite", async () => {
    const stream = streamOf(
      (s) => s.write(Buffer.alloc(8)),
      (s) => s.write(Buffer.alloc(8)),
    );
    await expect(readStreamToBuffer(stream, { maxBytes: 10 })).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
      maxBytes: 10,
    });
  });

  test("un errore dello stream rigetta con l'errore originale", async () => {
    const stream = streamOf((s) => s.emit("error", Object.assign(new Error("boom"), { code: "EPIPE" })));
    await expect(readStreamToBuffer(stream)).rejects.toMatchObject({ message: "boom", code: "EPIPE" });
  });

  test("l'abort del client rigetta con CLIENT_ABORTED", async () => {
    const stream = streamOf((s) => s.emit("aborted"));
    await expect(readStreamToBuffer(stream)).rejects.toMatchObject({ code: "CLIENT_ABORTED" });
  });

  test("dopo il primo esito gli eventi successivi vengono ignorati (nessun double-settle)", async () => {
    const stream = new PassThrough();
    stream.on("error", () => {}); // nella realtà lo stream della richiesta ha altri listener
    const promise = readStreamToBuffer(stream, { maxBytes: 4 });
    stream.write(Buffer.alloc(8)); // supera il limite → rigetta
    stream.emit("error", new Error("tardivo")); // non deve sovrascrivere l'esito
    stream.end(); // né un end tardivo deve risolvere
    await expect(promise).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });
});
