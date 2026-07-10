// @scalar/openapi-parser e' ESM: caricato via import() dinamico dentro parseOpenapi (compat CommonJS).

// openapi-sampler e' CommonJS: campiona uno schema JSON/OpenAPI in un valore d'esempio
// deterministico. Lo usiamo per generare il body quando la response non ha un example.
const { sample } = require("openapi-sampler");

// Metodi HTTP che importiamo (gli stessi offerti dalla creazione mock).
const SUPPORTED_METHODS = ["get", "post", "put", "delete", "patch"];

// Errore di import con status 400, gestito dall'error handler dell'app.
function createImportError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

// Interpreta il documento (YAML o JSON: JSON e' un sottoinsieme di YAML) e valida il minimo indispensabile.
async function parseOpenapi(input) {
  if (input == null || (typeof input === "string" && input.trim() === "")) {
    throw createImportError("Documento OpenAPI vuoto.");
  }

  let document;
  try {
    const { dereference, upgrade } = await import("@scalar/openapi-parser");
    // upgrade: Swagger 2.0 / OpenAPI 3.0 -> 3.1 (uniforma la struttura delle response, es. 2.0 -> content);
    // dereference: risolve i $ref (anche annidati / cross-component).
    const upgraded = upgrade(input);
    const result = await dereference(upgraded.specification);
    document = result.schema;
  } catch (error) {
    throw createImportError(`Documento OpenAPI non interpretabile: ${error.message}`);
  }

  if (document == null || typeof document !== "object" || document.paths == null || typeof document.paths !== "object") {
    throw createImportError('Documento OpenAPI non valido o privo di "paths".');
  }

  return document;
}

// Converte un path OpenAPI ("/users/{id}") nella convenzione di matching dell'app ("/users/:id").
function convertPath(openapiPath) {
  return String(openapiPath).replace(/\{([^/}]+)\}/g, ":$1");
}

// Risolve un JSON Pointer interno ("#/components/schemas/User") dentro il documento.
function resolvePointer(document, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    return undefined;
  }

  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current = document;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

// Segue le catene di $ref interni (con guardia anti-ciclo) e restituisce il nodo risolto.
function resolveRef(document, node, seen = new Set()) {
  if (node == null || typeof node !== "object") {
    return node;
  }
  if (typeof node.$ref === "string") {
    if (seen.has(node.$ref)) {
      return undefined;
    }
    seen.add(node.$ref);
    return resolveRef(document, resolvePointer(document, node.$ref), seen);
  }
  return node;
}

// Primo status 2xx documentato (il piu' basso); 200 se non ce ne sono.
function firstSuccessStatus(responses) {
  const codes = Object.keys(responses || {})
    .map((code) => Number(code))
    .filter((code) => Number.isInteger(code) && code >= 200 && code < 300)
    .sort((left, right) => left - right);
  return codes.length > 0 ? codes[0] : 200;
}

// Campiona uno schema in un valore d'esempio (openapi-sampler). Deterministico.
// skipWriteOnly: i campi di sola scrittura non compaiono nelle response (i readOnly si').
// quiet: niente warning in console. Il document e' passato come spec per risolvere eventuali
// $ref residui (di norma il documento e' gia' dereferenziato a monte). Qualsiasi errore del
// campionatore ripiega su undefined: un import non deve mai fallire per uno schema ostico.
function sampleSchema(schema, document) {
  try {
    return sample(schema, { skipWriteOnly: true, quiet: true }, document);
  } catch {
    return undefined;
  }
}

// Corpo della response da generare, nell'ordine: example del media type, primo named example,
// example dello schema, altrimenti un campione generato dallo schema; []/{} come ultimo ripiego.
// Solo application/json nell'MVP: gli altri content-type danno {} (vedi appunto su plain text in TODO).
function buildResponseBody(document, responses, status) {
  const response = responses?.[String(status)];
  if (response == null) {
    return {};
  }

  const jsonContent = response.content?.["application/json"];
  if (jsonContent == null) {
    return {};
  }

  if (jsonContent.example !== undefined) {
    return jsonContent.example;
  }
  if (jsonContent.examples != null && typeof jsonContent.examples === "object") {
    const firstNamed = Object.values(jsonContent.examples)[0];
    if (firstNamed != null && firstNamed.value !== undefined) {
      return firstNamed.value;
    }
  }

  const schema = resolveRef(document, jsonContent.schema);
  if (schema == null) {
    return {};
  }
  if (schema.example !== undefined) {
    return schema.example;
  }

  // Nessun example: genera il corpo campionando lo schema; []/{} solo se il campionatore
  // non produce nulla (schema senza contenuto o errore).
  const sampled = sampleSchema(schema, document);
  if (sampled !== undefined) {
    return sampled;
  }
  return schema.type === "array" ? [] : {};
}

// Prima tag dell'operazione (→ collection); undefined se assente (→ Unsorted).
function firstTag(tags) {
  if (Array.isArray(tags) && tags.length > 0 && typeof tags[0] === "string") {
    const trimmed = tags[0].trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return undefined;
}

/**
 * Costruisce il piano di import da un documento OpenAPI gia' interpretato.
 * `existingKeys` e' un Set di chiavi "METHOD /path" gia' presenti nel catalogo: le operazioni che
 * combaciano vengono marcate `skip`. Ogni voce: { method, path, status, body, collection, action }.
 */
function buildImportPlan(document, existingKeys = new Set()) {
  const paths = document?.paths || {};
  const items = [];

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    if (pathItem == null || typeof pathItem !== "object") {
      continue;
    }

    for (const method of SUPPORTED_METHODS) {
      const operation = pathItem[method];
      if (operation == null || typeof operation !== "object") {
        continue;
      }

      const path = convertPath(rawPath);
      const status = firstSuccessStatus(operation.responses);
      const item = {
        method: method.toUpperCase(),
        path,
        status,
        body: buildResponseBody(document, operation.responses, status),
        collection: firstTag(operation.tags),
        action: existingKeys.has(`${method.toUpperCase()} ${path}`) ? "skip" : "create",
      };
      items.push(item);
    }
  }

  return items;
}

// Conteggi di sintesi per il wizard.
function summarizePlan(items) {
  const create = items.filter((item) => item.action === "create").length;
  const collections = new Set(
    items.filter((item) => item.action === "create" && item.collection).map((item) => item.collection),
  );
  return { total: items.length, create, skip: items.length - create, collections: collections.size };
}

// Comodità per l'endpoint: parse + piano + conteggi in un colpo.
async function planFromDocument(text, existingKeys = new Set()) {
  const document = await parseOpenapi(text);
  const items = buildImportPlan(document, existingKeys);
  return { items, ...summarizePlan(items) };
}

module.exports = {
  SUPPORTED_METHODS,
  buildImportPlan,
  buildResponseBody,
  convertPath,
  createImportError,
  firstSuccessStatus,
  firstTag,
  parseOpenapi,
  planFromDocument,
  resolveRef,
  summarizePlan,
};
