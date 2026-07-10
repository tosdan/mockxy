const http = require("http");
const {
  buildImportPlan,
  buildResponseBody,
  convertPath,
  firstSuccessStatus,
  parseOpenapi,
  planFromDocument,
  summarizePlan,
} = require("../src/mocks/openapi-import");

describe("parseOpenapi", () => {
  test("interpreta YAML", async () => {
    const document = await parseOpenapi('openapi: 3.0.0\ninfo:\n  title: t\n  version: "1"\npaths:\n  /a:\n    get:\n      responses:\n        "200":\n          description: ok\n');
    expect(document.paths["/a"].get).toBeDefined();
  });

  test("interpreta JSON", async () => {
    const document = await parseOpenapi('{"openapi":"3.0.0","paths":{"/a":{"get":{"responses":{"200":{"description":"ok"}}}}}}');
    expect(document.paths["/a"].get).toBeDefined();
  });

  test("normalizza Swagger 2.0 a 3.x (response.content)", async () => {
    const document = await parseOpenapi('{"swagger":"2.0","info":{"title":"t","version":"1"},"paths":{"/u":{"get":{"responses":{"200":{"schema":{"type":"array"}}}}}}}');
    expect(document.paths["/u"].get.responses["200"].content["application/json"]).toBeDefined();
  });

  test("rifiuta un documento senza paths", async () => {
    await expect(parseOpenapi('{"openapi":"3.0.0"}')).rejects.toThrow(/paths/i);
  });

  // Guardia SSRF (#33): il dereference NON deve seguire i $ref http esterni — altrimenti un
  // documento ostile potrebbe indurre fetch verso host interni. Verificato che la libreria non
  // li risolve di default; questo test congela il comportamento e allerta se un futuro
  // aggiornamento della dipendenza lo cambiasse.
  test("non contatta host esterni referenziati da un $ref http", async () => {
    let contacted = false;
    const target = http.createServer((_req, res) => {
      contacted = true;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ type: "object", properties: { leaked: { type: "string" } } }));
    });
    await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
    const port = target.address().port;
    const externalRef = `http://127.0.0.1:${port}/schema.json`;

    try {
      const document = await parseOpenapi(JSON.stringify({
        openapi: "3.0.0",
        info: { title: "t", version: "1" },
        paths: {
          "/a": {
            get: {
              responses: {
                "200": {
                  description: "ok",
                  content: { "application/json": { schema: { $ref: externalRef } } },
                },
              },
            },
          },
        },
      }));
      // Il documento si carica, ma senza aver contattato l'host: il $ref esterno resta irrisolto.
      expect(document.paths["/a"].get).toBeDefined();
      // Piccola attesa per intercettare un eventuale fetch asincrono in ritardo.
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await new Promise((resolve) => target.close(resolve));
    }

    expect(contacted).toBe(false);
  });

  test("rifiuta testo non valido e vuoto", async () => {
    await expect(parseOpenapi("solo testo")).rejects.toThrow();
    await expect(parseOpenapi("")).rejects.toThrow();
  });
});

describe("convertPath", () => {
  test("converte i parametri {x} in :x", () => {
    expect(convertPath("/users/{id}/posts/{postId}")).toBe("/users/:id/posts/:postId");
    expect(convertPath("/health")).toBe("/health");
  });
});

describe("firstSuccessStatus", () => {
  test("prende il 2xx piu' basso", () => {
    expect(firstSuccessStatus({ "201": {}, "200": {}, "404": {} })).toBe(200);
    expect(firstSuccessStatus({ "204": {}, "500": {} })).toBe(204);
  });

  test("ripiega su 200 senza 2xx", () => {
    expect(firstSuccessStatus({ "404": {}, default: {} })).toBe(200);
    expect(firstSuccessStatus(undefined)).toBe(200);
  });
});

describe("buildResponseBody", () => {
  const doc = { components: { schemas: { User: { type: "object", example: { id: 7 } } } } };

  test("usa l'example del media type", () => {
    const responses = { "200": { content: { "application/json": { example: { ok: true }, schema: { type: "object" } } } } };
    expect(buildResponseBody(doc, responses, 200)).toEqual({ ok: true });
  });

  test("usa il primo named example", () => {
    const responses = { "200": { content: { "application/json": { examples: { primo: { value: [1, 2] } } } } } };
    expect(buildResponseBody(doc, responses, 200)).toEqual([1, 2]);
  });

  test("risolve lo schema via $ref e ne usa l'example", () => {
    const responses = { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } } };
    expect(buildResponseBody(doc, responses, 200)).toEqual({ id: 7 });
  });

  test("ripiega su []/{} per schemi senza contenuto campionabile", () => {
    // Niente items / properties da campionare: il campionatore rende []/{} e il type decide quale.
    expect(buildResponseBody(doc, { "200": { content: { "application/json": { schema: { type: "array" } } } } }, 200)).toEqual([]);
    expect(buildResponseBody(doc, { "200": { content: { "application/json": { schema: { type: "object" } } } } }, 200)).toEqual({});
  });

  test("oggetto vuoto per 204 / content non-JSON / response assente", () => {
    expect(buildResponseBody(doc, { "204": { description: "no content" } }, 204)).toEqual({});
    expect(buildResponseBody(doc, { "200": { content: { "text/plain": {} } } }, 200)).toEqual({});
    expect(buildResponseBody(doc, {}, 200)).toEqual({});
  });

  test("campiona lo schema oggetto quando non c'e' alcun example", () => {
    const responses = {
      "200": {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                created: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
    };
    expect(buildResponseBody(doc, responses, 200)).toEqual({ id: 0, name: "string", created: "2019-08-24T14:15:22Z" });
  });

  test("campiona gli array usando lo schema degli items", () => {
    const responses = {
      "200": { content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "integer" } } } } } } },
    };
    expect(buildResponseBody(doc, responses, 200)).toEqual([{ id: 0 }]);
  });

  test("omette i campi writeOnly dalle response campionate", () => {
    const responses = {
      "200": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" }, password: { type: "string", writeOnly: true } } } } } },
    };
    expect(buildResponseBody(doc, responses, 200)).toEqual({ id: 0 });
  });

  test("usa il primo valore di un enum", () => {
    const responses = { "200": { content: { "application/json": { schema: { type: "string", enum: ["attivo", "sospeso"] } } } } };
    expect(buildResponseBody(doc, responses, 200)).toBe("attivo");
  });

  test("non va in loop sugli schemi ricorsivi (oggetti ciclici dereferenziati)", () => {
    const node = { type: "object", properties: { name: { type: "string" } } };
    node.properties.children = { type: "array", items: node }; // ciclo per riferimento d'oggetto
    const responses = { "200": { content: { "application/json": { schema: node } } } };
    const body = buildResponseBody(doc, responses, 200);
    expect(body.name).toBe("string");
    expect(Array.isArray(body.children)).toBe(true);
  });
});

describe("buildImportPlan", () => {
  const doc = {
    openapi: "3.0.0",
    paths: {
      "/users": {
        get: { tags: ["Users"], responses: { "200": { content: { "application/json": { schema: { type: "array" } } } } } },
        post: { tags: ["Users"], responses: { "201": { content: { "application/json": { example: { id: 1 } } } } } },
        options: { responses: { "200": {} } },
      },
      "/users/{id}": {
        get: { responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } } } },
      },
      "/health": { get: { responses: { "500": { description: "err" } } } },
    },
    components: { schemas: { User: { type: "object", example: { id: 7, name: "Ada" } } } },
  };

  test("mappa le operazioni in voci del piano", () => {
    const plan = buildImportPlan(doc);
    const byKey = Object.fromEntries(plan.map((item) => [`${item.method} ${item.path}`, item]));

    expect(byKey["GET /users"]).toMatchObject({ status: 200, body: [], collection: "Users", action: "create" });
    expect(byKey["POST /users"]).toMatchObject({ status: 201, body: { id: 1 }, collection: "Users" });
    expect(byKey["GET /users/:id"]).toMatchObject({ status: 200, body: { id: 7, name: "Ada" }, collection: undefined });
    expect(byKey["GET /health"]).toMatchObject({ status: 200, body: {} });
  });

  test("ignora i metodi non supportati (es. options)", () => {
    const plan = buildImportPlan(doc);
    expect(plan.some((item) => item.method === "OPTIONS")).toBe(false);
  });

  test("marca skip le operazioni gia' esistenti (per method+path)", () => {
    const plan = buildImportPlan(doc, new Set(["GET /users"]));
    const get = plan.find((item) => item.method === "GET" && item.path === "/users");
    const post = plan.find((item) => item.method === "POST" && item.path === "/users");
    expect(get.action).toBe("skip");
    expect(post.action).toBe("create");
  });
});

describe("planFromDocument + summarizePlan", () => {
  test("conta create/skip/collection", async () => {
    const text = JSON.stringify({
      openapi: "3.0.0",
      paths: {
        "/a": { get: { tags: ["X"], responses: { "200": {} } } },
        "/b": { get: { tags: ["X"], responses: { "200": {} } } },
        "/c": { get: { responses: { "200": {} } } },
      },
    });
    const plan = await planFromDocument(text, new Set(["GET /a"]));
    expect(plan.total).toBe(3);
    expect(plan.create).toBe(2);
    expect(plan.skip).toBe(1);
    expect(plan.collections).toBe(1); // solo "X" (e /c senza tag non conta)

    const counts = summarizePlan(plan.items);
    expect(counts).toEqual({ total: 3, create: 2, skip: 1, collections: 1 });
  });
});
