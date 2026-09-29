const { buildMockFromCapture, captureResponseHeaders, INCOMPLETE_DESCRIPTION } = require("../src/admin/capture-to-mock");

// Fixture della trasformazione condivisa fra Monitor e Storico (piano agent/API, §13 C7): la GUI
// la sostituisce con quella del server, quindi il comportamento è fissato qui, input e output.
function capture(overrides = {}) {
  return {
    id: "7",
    timestamp: "2026-09-29T10:11:12.000Z",
    method: "GET",
    path: "/api/users/42",
    matchedRoutePath: "/api/users/:id",
    status: 200,
    responseHeaders: { "content-type": "application/json; charset=utf-8" },
    responseBody: '{\n  "id": 42\n}',
    responseBodyTruncated: false,
    ...overrides,
  };
}

describe("trasformazione cattura → mock", () => {
  test("JSON: valore parsato, percorso della rotta servita, status invariato, nessun ritardo", () => {
    expect(buildMockFromCapture(capture())).toEqual({
      method: "GET",
      path: "/api/users/:id",
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      delayMs: 0,
      body: { id: 42 },
      incomplete: false,
      issue: null,
    });
  });

  test("testo non JSON: stringa così com'è", () => {
    const mock = buildMockFromCapture(capture({ responseHeaders: { "content-type": "text/plain" }, responseBody: "ciao, mondo" }));
    expect(mock).toMatchObject({ body: "ciao, mondo", incomplete: false });
  });

  test("body vuoto: oggetto vuoto, ma completo", () => {
    expect(buildMockFromCapture(capture({ status: 204, responseBody: undefined }))).toMatchObject({ status: 204, body: {}, incomplete: false });
    expect(buildMockFromCapture(capture({ responseBody: "" }))).toMatchObject({ body: {}, incomplete: false });
  });

  test("binario o compresso: oggetto vuoto e bozza incompleta, non una riproduzione fedele", () => {
    for (const placeholder of ["[binary payload: 2048 bytes]", "[compressed payload: 512 bytes, preview truncated]"]) {
      expect(buildMockFromCapture(capture({ responseBody: placeholder }))).toMatchObject({ body: {}, incomplete: true, issue: "binary" });
    }
  });

  test("troncato: oggetto vuoto e bozza incompleta anche se il testo parziale è leggibile", () => {
    expect(buildMockFromCapture(capture({ responseBody: '{"items": [1, 2', responseBodyTruncated: true }))).toMatchObject({
      body: {},
      incomplete: true,
      issue: "truncated",
    });
  });

  test("percorso: la rotta servita se c'è e non è n/d, altrimenti il path richiesto; nessuna inferenza di parametri", () => {
    expect(buildMockFromCapture(capture({ matchedRoutePath: "n/d" })).path).toBe("/api/users/42");
    expect(buildMockFromCapture(capture({ matchedRoutePath: undefined })).path).toBe("/api/users/42");
  });

  test("metodo in maiuscolo", () => {
    expect(buildMockFromCapture(capture({ method: "post" })).method).toBe("POST");
  });

  test("header: esclusi quelli di trasporto, i vuoti e i mascherati; gli array uniti con virgola e spazio", () => {
    expect(captureResponseHeaders({
      "Content-Type": "application/json",
      "content-length": "12",
      "Content-Encoding": "gzip",
      "transfer-encoding": "chunked",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      date: "Tue, 29 Sep 2026 10:11:12 GMT",
      "set-cookie": "***",
      "x-api-key": "***",
      "x-empty": "",
      vary: ["Origin", "Accept-Encoding"],
      "x-count": 3,
    })).toEqual({
      "Content-Type": "application/json",
      vary: "Origin, Accept-Encoding",
      "x-count": "3",
    });
  });

  test("la descrizione di una bozza incompleta porta il marcatore condiviso", () => {
    expect(INCOMPLETE_DESCRIPTION.startsWith("[da completare]")).toBe(true);
  });
});
