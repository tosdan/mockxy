const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { createAdminApiRouter } = require("../src/admin/admin-api");

const SPEC_PATH = path.join(__dirname, "..", "docs", "admin-api.openapi.yaml");
const SPEC_METHODS = ["get", "post", "put", "patch", "delete"];

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
});
