const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");
const yaml = require("js-yaml");
const { createAdminApiRouter } = require("../src/admin/admin-api");
const { findSplitFlowMappings } = require("../scripts/validate-admin-openapi");

const SPEC_PATH = path.join(__dirname, "..", "src", "admin", "admin-api.openapi.yaml");
// Tutte le chiavi di operazione di un Path Item OpenAPI 3.1: un'operazione dichiarata solo nello
// spec con un metodo meno comune deve emergere dal confronto, non essere scartata in silenzio.
const SPEC_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

// Router e spec chiamano i parametri in modo diverso (`:parentKey` e `{parentKey}`, ma anche
// `:responseFileName`): il confronto riguarda metodo e forma del percorso, non i nomi.
function normalizeOperation(method, routePath) {
  return `${method.toUpperCase()} ${routePath.replace(/[:{][A-Za-z]+\}?/g, "{}")}`;
}

// Solo i layer con una rotta: il 404 conclusivo del namespace è un middleware, non un'operazione.
function listRouterOperations(router) {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods)
      .map((method) => normalizeOperation(method, layer.route.path)));
}

function listSpecOperations(spec) {
  return Object.entries(spec.paths).flatMap(([routePath, pathItem]) =>
    SPEC_METHODS.filter((method) => pathItem[method])
      .map((method) => normalizeOperation(method, routePath)));
}

function diffOperations(routerOperations, specOperations) {
  const inRouter = new Set(routerOperations);
  const inSpec = new Set(specOperations);
  return {
    missingFromSpec: [...inRouter].filter((operation) => !inSpec.has(operation)).sort(),
    missingFromRouter: [...inSpec].filter((operation) => !inRouter.has(operation)).sort(),
  };
}

describe("Admin API OpenAPI contract", () => {
  test("il documento pubblico resta OpenAPI valido", () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "validate-admin-openapi.js")], {
      encoding: "utf8",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  test("nessuna descrizione spezzata da una virgola in una mappa YAML su una riga", () => {
    // Il caso rilevato: la virgola chiude la descrizione e apre una chiave senza valore.
    const broken = yaml.safeLoad("properties:\n  path: { type: string, description: Request path, without query string. }\n");
    expect(findSplitFlowMappings(broken)).toEqual(["/properties/path/without query string."]);
    expect(findSplitFlowMappings(yaml.safeLoad('properties:\n  path: { type: string, description: "Request path, without query string." }\n'))).toEqual([]);

    expect(findSplitFlowMappings(yaml.safeLoad(fs.readFileSync(SPEC_PATH, "utf8")))).toEqual([]);
  });

  test("i dati di esempi e default restano liberi: una chiave con spazi e valore null è legittima", () => {
    const valid = yaml.safeLoad([
      "components:",
      "  schemas:",
      "    Profile:",
      "      type: object",
      "      description: A profile.",
      '      examples: [{ "display name": null }]',
      '      default: { "display name": null }',
      "      properties:",
      '        tags: { type: array, enum: [{ "a b": null }], example: { "a b": null } }',
      "",
    ].join("\n"));
    expect(findSplitFlowMappings(valid)).toEqual([]);
  });

  test("una proprietà che si chiama come una keyword di dati resta uno schema da controllare", () => {
    const broken = yaml.safeLoad([
      "properties:",
      "  label: { type: string, description: Request path, without query string. }",
      "  example: { type: string, description: Request path, without query string. }",
      "  default: { type: string, description: Request path, without query string. }",
      "",
    ].join("\n"));
    expect(findSplitFlowMappings(broken)).toEqual([
      "/properties/label/without query string.",
      "/properties/example/without query string.",
      "/properties/default/without query string.",
    ]);
  });

  // Guardia su metodi e percorsi: non verifica payload, status o comportamenti, che restano
  // compito dei test di integrazione delle singole rotte.
  test("ogni operazione del router admin è documentata nell'OpenAPI e viceversa", () => {
    const router = createAdminApiRouter({ config: {}, sharedStates: {} });
    const spec = yaml.safeLoad(fs.readFileSync(SPEC_PATH, "utf8"));

    expect(diffOperations(listRouterOperations(router), listSpecOperations(spec))).toEqual({
      missingFromSpec: [],
      missingFromRouter: [],
    });
  });

  test("il confronto rileva un'operazione presente da un solo lato", () => {
    const shared = ["GET /mocks", "PATCH /mocks/{}"];

    expect(diffOperations([...shared, "DELETE /files/{}"], shared)).toEqual({
      missingFromSpec: ["DELETE /files/{}"],
      missingFromRouter: [],
    });
    expect(diffOperations(shared, [...shared, "GET /info"])).toEqual({
      missingFromSpec: [],
      missingFromRouter: ["GET /info"],
    });
    expect(normalizeOperation("patch", "/mocks/collections/:parentKey/children/order"))
      .toBe(normalizeOperation("PATCH", "/mocks/collections/{id}/children/order"));
  });

  test("l'estrazione dallo spec considera ogni metodo OpenAPI", () => {
    const spec = {
      paths: {
        "/probe/{id}": {
          parameters: [],
          summary: "campi non operativi da ignorare",
          get: {}, put: {}, post: {}, delete: {}, options: {}, head: {}, patch: {}, trace: {},
        },
      },
    };

    expect(listSpecOperations(spec).sort()).toEqual(
      ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"].map((method) => `${method} /probe/{}`)
    );
  });

  test("un'operazione HEAD presente solo nello spec reale emerge dal confronto", () => {
    const router = createAdminApiRouter({ config: {}, sharedStates: {} });
    const spec = yaml.safeLoad(fs.readFileSync(SPEC_PATH, "utf8"));
    spec.paths["/spec-only-probe"] = { head: { responses: {} } };

    expect(diffOperations(listRouterOperations(router), listSpecOperations(spec)).missingFromRouter)
      .toEqual(["HEAD /spec-only-probe"]);
  });

  test("l'estrazione dal router considera ogni metodo registrato", () => {
    const router = express.Router();
    router.head("/probe/:id", () => {});
    router.options("/probe/:id", () => {});
    router.get("/probe", () => {});
    router.use(() => {});

    expect(listRouterOperations(router).sort()).toEqual(["GET /probe", "HEAD /probe/{}", "OPTIONS /probe/{}"]);
  });
});
