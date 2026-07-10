const { validatePathFormat } = require("../mocks/route-groups");
const { isValidHttpStatus } = require("../utils/http-body-utils");
const { loadScriptModule } = require("../mocks/script-loader");
const { createAdminError } = require("./admin-errors");

// Validazione e normalizzazione dei payload admin: config dei mock, definizioni di
// handler/middleware e sorgenti script (template inclusi).

const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;

function validateHeaderValue(value) {
  return typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function validateMockConfig(config, filePath, options = {}) {
  if (config == null || typeof config !== "object" || Array.isArray(config)) {
    throw createAdminError(400, "config must be an object.");
  }

  const method = String(config.method || "").toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(method)) {
    throw createAdminError(400, "config.method must be a valid HTTP method.");
  }

  if (options.expectedMethod && method !== options.expectedMethod) {
    throw createAdminError(400, `config.method must match ${options.expectedMethod}.`);
  }

  if (typeof config.path !== "string" || config.path.trim() === "") {
    throw createAdminError(400, "config.path must be a non-empty string.");
  }
  try {
    validatePathFormat(config.path, filePath, "Mock path");
  } catch (error) {
    throw createAdminError(400, error.message);
  }

  if (!isValidHttpStatus(config.status)) {
    throw createAdminError(400, "config.status must be an integer HTTP status code.");
  }

  if (config.disabled != null && typeof config.disabled !== "boolean") {
    throw createAdminError(400, "config.disabled must be a boolean.");
  }

  if (config.headers != null) {
    const validHeaders = typeof config.headers === "object"
      && !Array.isArray(config.headers)
      && Object.values(config.headers).every(validateHeaderValue);
    if (!validHeaders) {
      throw createAdminError(400, "config.headers must be an object with primitive header values.");
    }
  }

  if (config.delayMs != null && (!Number.isInteger(config.delayMs) || config.delayMs < 0)) {
    throw createAdminError(400, "config.delayMs must be a non-negative integer.");
  }

  const hasBodyFile = config.bodyFile != null;
  const hasFile = config.file != null;
  if (hasBodyFile && (typeof config.bodyFile !== "string" || config.bodyFile.trim() === "")) {
    throw createAdminError(400, "config.bodyFile must be a non-empty string.");
  }
  if (hasFile && (typeof config.file !== "string" || config.file.trim() === "")) {
    throw createAdminError(400, "config.file must be a non-empty string.");
  }
  if (hasBodyFile && hasFile) {
    throw createAdminError(400, "config.bodyFile and config.file are mutually exclusive.");
  }
  if (config.disabled !== true && !hasBodyFile && !hasFile) {
    throw createAdminError(400, "Active mocks must define exactly one of config.bodyFile or config.file.");
  }
}

function validateHandlerDefinition(definition, filePath, options = {}) {
  if (definition == null || typeof definition !== "object" || Array.isArray(definition)) {
    throw createAdminError(400, "definition must be an object.");
  }

  const method = String(definition.method || "").toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(method)) {
    throw createAdminError(400, "definition.method must be a valid HTTP method.");
  }

  if (options.expectedMethod && method !== options.expectedMethod) {
    throw createAdminError(400, `definition.method must match ${options.expectedMethod}.`);
  }

  if (typeof definition.path !== "string" || definition.path.trim() === "") {
    throw createAdminError(400, "definition.path must be a non-empty string.");
  }
  try {
    validatePathFormat(definition.path, filePath, "Handler path");
  } catch (error) {
    throw createAdminError(400, error.message);
  }

  if (definition.disabled != null && typeof definition.disabled !== "boolean") {
    throw createAdminError(400, "definition.disabled must be a boolean.");
  }
}

function normalizeMockConfig(config, expectedMethod) {
  const normalized = {
    method: String(config.method || expectedMethod || "").toUpperCase(),
    path: config.path,
    status: config.status,
    disabled: config.disabled === true,
    headers: config.headers == null ? {} : config.headers,
    delayMs: config.delayMs == null ? 0 : config.delayMs,
  };

  if (config.bodyFile != null) {
    normalized.bodyFile = config.bodyFile;
  }
  if (config.file != null) {
    normalized.file = config.file;
  }

  return normalized;
}

function normalizeHandlerDefinition(definition, expectedMethod) {
  return {
    method: String(definition.method || expectedMethod || "").toUpperCase(),
    path: definition.path,
    disabled: definition.disabled === true,
  };
}

// Validazione di uno script appena scritto: compila con API pubbliche (vedi script-loader) e
// restituisce la definizione esportata. loadScriptModule toglie il file dalla cache prima del
// load, quindi la ri-validazione dello stesso percorso riflette sempre il contenuto attuale.
function loadScriptDefinition(filePath, label) {
  try {
    return loadScriptModule(filePath).definition;
  } catch (error) {
    throw createAdminError(400, `Invalid ${label} ${filePath}: ${error.message}`);
  }
}

function createEndpointSourceTemplate(type) {
  if (type === "middleware") {
    return `module.exports = {
  async transformResponse({ status, headers, jsonBody }) {
    return {
      status,
      headers: {
        ...headers,
        "x-middleware-generated": "true"
      },
      jsonBody: {
        ...jsonBody,
        transformedByMiddleware: true
      }
    };
  }
};
`;
  }

  return `module.exports = {
  // Il contesto include anche data("nome") per leggere un file JSON dalla pagina Dati:
  //   const items = await data("nome-file");
  async resolveResponse({ params, query, requestHeaders, jsonBody }) {
    return {
      status: 200,
      headers: {
        "x-handler-generated": requestHeaders["x-request-id"] || "true"
      },
      jsonBody: {
        params,
        query,
        requestBody: jsonBody
      }
    };
  }
};
`;
}

function normalizeEndpointSource(source, type) {
  if (typeof source === "string" && source.trim() !== "") {
    return source;
  }

  return createEndpointSourceTemplate(type);
}

function assertEndpointSourceIsValid(sourceFilePath, type) {
  const definition = loadScriptDefinition(sourceFilePath, type);
  if (type === "handler" && typeof definition?.resolveResponse !== "function") {
    throw createAdminError(400, "Handler source must export a resolveResponse function.");
  }
  if (type === "middleware" && typeof definition?.transformResponse !== "function") {
    throw createAdminError(400, "Middleware source must export a transformResponse function.");
  }
  if (definition?.method != null || definition?.path != null || definition?.disabled != null) {
    throw createAdminError(400, "Source metadata method, path and disabled must live in the endpoint file.");
  }
}

module.exports = {
  HTTP_METHOD_PATTERN,
  validateHeaderValue,
  validateMockConfig,
  validateHandlerDefinition,
  normalizeMockConfig,
  normalizeHandlerDefinition,
  normalizeEndpointSource,
  assertEndpointSourceIsValid,
};
