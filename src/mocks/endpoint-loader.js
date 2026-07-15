const fs = require("fs");
const path = require("path");
const { isValidHttpStatus } = require("../utils/http-body-utils");
const {
  countStaticSegments,
  createPathMatcher,
  sortRouteGroups,
  validatePathFormat,
} = require("./route-groups");
const {
  purgeModuleCacheUnder,
  loadScriptModule,
  collectLocalDependencyFiles,
} = require("./script-loader");
const { normalizeSequenceConfig } = require("./sequence-config");

const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
const ENDPOINT_SUFFIX = ".endpoint.json";
const RESPONSE_SUFFIX = ".response.json";
const RESPONSES_DIR_SUFFIX = ".responses";

function formatValidationErrors(errors) {
  return errors.join("; ");
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function extractMethodFromEndpointFileName(filePath) {
  const base = path.basename(filePath);
  return base.slice(0, -ENDPOINT_SUFFIX.length).toUpperCase();
}

function isSafeLocalFileName(fileName, suffix) {
  return typeof fileName === "string"
    && fileName.trim() !== ""
    && fileName === path.basename(fileName)
    && fileName.endsWith(suffix);
}

function assertInsideDir(rootDir, targetPath, message) {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(message);
  }
}

function resolveLocalFile(baseDir, fileName, label) {
  const filePath = path.resolve(baseDir, fileName);
  assertInsideDir(baseDir, filePath, `${label} must stay inside ${baseDir}`);
  return filePath;
}

// Esistenza file senza bloccare l'event loop: il reload gira mentre il server serve richieste.
async function fileExists(filePath) {
  try {
    await fs.promises.stat(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function listEndpointFiles(rootDir) {
  const results = [];
  if (!(await fileExists(rootDir))) {
    return results;
  }

  async function walk(currentDir) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(absolutePath);
          return;
        }

        if (entry.isFile() && entry.name.endsWith(ENDPOINT_SUFFIX)) {
          results.push(absolutePath);
        }
      })
    );
  }

  await walk(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

async function readJsonFile(filePath) {
  const raw = await fs.promises.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function validateHeaders(headers, filePath) {
  if (headers == null) {
    return;
  }

  const validHeaders = isPlainObject(headers)
    && Object.values(headers).every((value) =>
      typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
      || (Array.isArray(value) && value.every((item) => typeof item === "string"))
    );
  if (!validHeaders) {
    throw new Error(`Invalid response ${filePath}: headers must be an object with primitive values`);
  }
}

function validateEndpointConfig(endpoint, filePath) {
  const errors = [];
  if (!isPlainObject(endpoint)) {
    throw new Error(`Invalid endpoint ${filePath}: endpoint config must be an object`);
  }

  const method = String(endpoint.method || "").toUpperCase();
  const fileMethod = extractMethodFromEndpointFileName(filePath);
  if (!HTTP_METHOD_PATTERN.test(method)) {
    errors.push("method must be a valid HTTP verb");
  }
  if (method !== fileMethod) {
    errors.push(`method must match endpoint filename ${fileMethod}`);
  }
  if (typeof endpoint.path !== "string" || endpoint.path.trim() === "") {
    errors.push("path must be a non-empty string");
  } else {
    try {
      validatePathFormat(endpoint.path, filePath, "Endpoint path");
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (endpoint.description != null && typeof endpoint.description !== "string") {
    errors.push("description must be a string when provided");
  }
  if (typeof endpoint.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }
  if (!Array.isArray(endpoint.responseFiles) || endpoint.responseFiles.length === 0) {
    errors.push("responseFiles must be a non-empty array");
  }
  const responseFiles = Array.isArray(endpoint.responseFiles) ? endpoint.responseFiles : [];
  const seenResponseFiles = new Set();
  for (const responseFile of responseFiles) {
    if (!isSafeLocalFileName(responseFile, RESPONSE_SUFFIX)) {
      errors.push(`responseFiles contains an invalid response filename: ${responseFile}`);
      continue;
    }
    if (seenResponseFiles.has(responseFile)) {
      errors.push(`responseFiles contains a duplicate response filename: ${responseFile}`);
    }
    seenResponseFiles.add(responseFile);
  }
  if (!isSafeLocalFileName(endpoint.selectedResponseFile, RESPONSE_SUFFIX)) {
    errors.push("selectedResponseFile must be a response filename");
  } else if (!seenResponseFiles.has(endpoint.selectedResponseFile)) {
    errors.push("selectedResponseFile must be listed in responseFiles");
  }

  const sequenceResult = normalizeSequenceConfig(endpoint.sequence, responseFiles);
  errors.push(...sequenceResult.errors);

  if (errors.length > 0) {
    throw new Error(`Invalid endpoint ${filePath}: ${formatValidationErrors(errors)}`);
  }

  return {
    method,
    path: endpoint.path,
    description: endpoint.description || "",
    enabled: endpoint.enabled,
    responseFiles: [...responseFiles],
    selectedResponseFile: endpoint.selectedResponseFile,
    sequence: sequenceResult.sequence,
  };
}

function validateMockResponse(response, filePath, responseDir) {
  if (!isValidHttpStatus(response.status)) {
    throw new Error(`Invalid response ${filePath}: status must be an HTTP status code`);
  }
  if (response.delayMs != null && (!Number.isInteger(response.delayMs) || response.delayMs < 0)) {
    throw new Error(`Invalid response ${filePath}: delayMs must be a non-negative integer`);
  }
  validateHeaders(response.headers, filePath);

  const hasBody = Object.prototype.hasOwnProperty.call(response, "body");
  const hasFile = Object.prototype.hasOwnProperty.call(response, "file");
  if (hasBody && hasFile) {
    throw new Error(`Invalid response ${filePath}: body and file are mutually exclusive`);
  }
  if (!hasBody && !hasFile) {
    throw new Error(`Invalid response ${filePath}: define exactly one of body or file`);
  }
  if (hasFile && (typeof response.file !== "string" || response.file.trim() === "")) {
    throw new Error(`Invalid response ${filePath}: file must be a non-empty string`);
  }

  if (!hasFile) {
    return undefined;
  }

  return resolveLocalFile(responseDir, response.file, "Response file payload");
}

// Firma economica di un file per la cache degli script: mtime+dimensione bastano a rilevare
// una modifica salvata da un editor, senza rileggere il contenuto a ogni scansione.
async function getFileSignature(filePath) {
  const stats = await fs.promises.stat(filePath);
  return `${stats.mtimeMs}:${stats.size}`;
}

// Cache delle definizioni script: percorso sorgente -> { signature, dependencies, definition }.
// Ricompilare ed eseguire il top-level di ogni handler a ogni evento del watcher è il costo
// dominante del reload (e ripete gli eventuali side effect degli script): la cache riusa la
// definizione finché sorgente e dipendenze locali risultano invariati su disco.
const scriptDefinitionCache = new Map();

async function isScriptCacheEntryFresh(entry) {
  try {
    if ((await getFileSignature(entry.sourcePath)) !== entry.signature) {
      return false;
    }
    for (const [dependencyPath, dependencySignature] of entry.dependencies) {
      if ((await getFileSignature(dependencyPath)) !== dependencySignature) {
        return false;
      }
    }
    return true;
  } catch (_error) {
    return false;
  }
}

// Toglie dalla cache gli script (sotto rootDir) il cui sorgente non esiste più su disco, per
// non trattenere in memoria definizioni di file eliminati.
async function pruneScriptDefinitionCacheUnder(resolvedRoot) {
  for (const sourcePath of [...scriptDefinitionCache.keys()]) {
    const relativePath = path.relative(resolvedRoot, sourcePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      continue;
    }
    if (!(await fileExists(sourcePath))) {
      scriptDefinitionCache.delete(sourcePath);
    }
  }
}

async function loadScriptDefinition(filePath, label) {
  const cachedEntry = scriptDefinitionCache.get(filePath);
  if (cachedEntry != null && (await isScriptCacheEntryFresh(cachedEntry))) {
    return cachedEntry.definition;
  }

  try {
    const signature = await getFileSignature(filePath);
    // Compilazione fresca (vedi script-loader): la cache dei moduli sotto la cartella dei mock è
    // già stata svuotata a inizio scansione, quindi script principale e dipendenze locali
    // vengono compilati freschi.
    const { definition, moduleRecord } = loadScriptModule(filePath);

    const dependencies = new Map();
    for (const dependencyFile of collectLocalDependencyFiles(moduleRecord)) {
      dependencies.set(dependencyFile, await getFileSignature(dependencyFile));
    }
    scriptDefinitionCache.set(filePath, { sourcePath: filePath, signature, dependencies, definition });

    return definition;
  } catch (error) {
    scriptDefinitionCache.delete(filePath);
    throw new Error(`Invalid ${label} ${filePath}: ${error.message}`);
  }
}

async function validateScriptResponse(response, filePath, responseDir, type) {
  const expectedSuffix = type === "handler" ? ".handler.js" : ".middleware.js";
  if (!isSafeLocalFileName(response.sourceFile, expectedSuffix)) {
    throw new Error(`Invalid response ${filePath}: sourceFile must be a ${expectedSuffix} filename`);
  }

  const sourcePath = resolveLocalFile(responseDir, response.sourceFile, "Response sourceFile");
  if (!(await fileExists(sourcePath))) {
    throw new Error(`Missing source file referenced by ${filePath}: ${sourcePath}`);
  }

  const definition = await loadScriptDefinition(sourcePath, type);
  const requiredFunction = type === "handler" ? "resolveResponse" : "transformResponse";
  if (!isPlainObject(definition) || typeof definition[requiredFunction] !== "function") {
    throw new Error(`Invalid ${type} ${sourcePath}: export an object with ${requiredFunction}`);
  }
  if (definition.method != null || definition.path != null || definition.disabled != null) {
    throw new Error(`Invalid ${type} ${sourcePath}: method, path and disabled belong to the endpoint file`);
  }

  return {
    definition,
    sourcePath,
  };
}

async function loadSelectedResponse(endpoint, endpointFilePath) {
  const endpointDir = path.dirname(endpointFilePath);
  const responseDir = path.join(endpointDir, `${endpoint.method}${RESPONSES_DIR_SUFFIX}`);
  const responsePath = resolveLocalFile(responseDir, endpoint.selectedResponseFile, "selectedResponseFile");
  if (!(await fileExists(responsePath))) {
    throw new Error(`Missing selected response referenced by ${endpointFilePath}: ${responsePath}`);
  }

  const response = await readJsonFile(responsePath);
  if (!isPlainObject(response)) {
    throw new Error(`Invalid response ${responsePath}: response must be an object`);
  }
  if (response.title != null && typeof response.title !== "string") {
    throw new Error(`Invalid response ${responsePath}: title must be a string when provided`);
  }

  const type = response.type;
  if (type !== "mock" && type !== "handler" && type !== "middleware") {
    throw new Error(`Invalid response ${responsePath}: type must be mock, handler or middleware`);
  }

  if (type === "mock") {
    const filePath = validateMockResponse(response, responsePath, responseDir);
    const result = {
      type,
      title: response.title || "",
      status: response.status,
      headers: response.headers == null ? {} : { ...response.headers },
      delayMs: response.delayMs || 0,
      responseFilePath: responsePath,
      responseFileName: endpoint.selectedResponseFile,
    };
    if (filePath != null) {
      // Il contenuto NON viene letto qui: resta su disco e viene servito in streaming a ogni
      // richiesta, così un payload da centinaia di MB non occupa RAM nel registry. Al load si
      // valida solo che il file esista, per segnalare subito il riferimento rotto.
      if (!(await fileExists(filePath))) {
        throw new Error(`Missing file payload referenced by ${responsePath}: ${filePath}`);
      }
      result.payloadType = "file";
      result.file = response.file;
      result.payloadFilePath = filePath;
      return result;
    }

    result.payloadType = typeof response.body === "string" ? "text" : "json";
    result.body = response.body;
    return result;
  }

  const script = await validateScriptResponse(response, responsePath, responseDir, type);
  return {
    type,
    title: response.title || "",
    sourceFile: response.sourceFile,
    sourceFilePath: script.sourcePath,
    responseFilePath: responsePath,
    responseFileName: endpoint.selectedResponseFile,
    definition: script.definition,
  };
}

function createRouteGroup(routeGroups, endpoint, filePath) {
  const routeKey = endpoint.path;
  const sortKey = filePath;
  const matcher = createPathMatcher(endpoint.path, filePath);
  const existingGroup = routeGroups.get(routeKey) || {
    path: endpoint.path,
    dynamic: matcher.dynamic,
    staticSegments: countStaticSegments(endpoint.path),
    sortKey,
    matcher: matcher.fn,
    methods: new Map(),
  };

  existingGroup.sortKey =
    existingGroup.sortKey.localeCompare(sortKey) <= 0 ? existingGroup.sortKey : sortKey;
  routeGroups.set(routeKey, existingGroup);
  return existingGroup;
}

async function loadEndpointRouteGroups(mocksDir) {
  purgeModuleCacheUnder(mocksDir);
  await pruneScriptDefinitionCacheUnder(path.resolve(mocksDir));
  const endpointFiles = await listEndpointFiles(mocksDir);
  const seenEndpointKeys = new Map();
  const mockRouteGroups = new Map();
  const handlerRouteGroups = new Map();
  const proxyMiddlewareRouteGroups = new Map();
  // Degradazione per-endpoint: un file rotto (JSON invalido, response mancante, duplicato)
  // viene saltato e segnalato qui, senza far fallire il caricamento degli altri. Sta ai
  // chiamanti decidere la policy (warning all'avvio, keep-previous al reload a caldo).
  const loadErrors = [];

  for (const filePath of endpointFiles) {
    try {
      const rawEndpoint = await readJsonFile(filePath);
      const endpoint = validateEndpointConfig(rawEndpoint, filePath);
      const endpointKey = `${endpoint.method} ${endpoint.path}`;
      const previousEndpointFile = seenEndpointKeys.get(endpointKey);
      if (previousEndpointFile != null) {
        throw new Error(`Duplicate endpoint definition for ${endpointKey}: ${filePath} conflicts with ${previousEndpointFile}`);
      }
      seenEndpointKeys.set(endpointKey, filePath);

      if (!endpoint.enabled) {
        continue;
      }

      const response = await loadSelectedResponse(endpoint, filePath);
      if (response.type === "mock") {
        const group = createRouteGroup(mockRouteGroups, endpoint, filePath);
        group.methods.set(endpoint.method, {
          method: endpoint.method,
          path: endpoint.path,
          status: response.status,
          headers: response.headers,
          delayMs: response.delayMs,
          payloadType: response.payloadType,
          body: response.body,
          configFilePath: filePath,
          responseFilePath: response.responseFilePath,
          selectedResponseFile: response.responseFileName,
          payloadFilePath: response.payloadFilePath,
        });
        continue;
      }

      if (response.type === "handler") {
        const group = createRouteGroup(handlerRouteGroups, endpoint, filePath);
        group.methods.set(endpoint.method, {
          method: endpoint.method,
          path: endpoint.path,
          resolveResponse: response.definition.resolveResponse,
          configFilePath: filePath,
          responseFilePath: response.responseFilePath,
          sourceFilePath: response.sourceFilePath,
          selectedResponseFile: response.responseFileName,
        });
        continue;
      }

      const group = createRouteGroup(proxyMiddlewareRouteGroups, endpoint, filePath);
      group.methods.set(endpoint.method, {
        method: endpoint.method,
        path: endpoint.path,
        transformResponse: response.definition.transformResponse,
        configFilePath: filePath,
        responseFilePath: response.responseFilePath,
        sourceFilePath: response.sourceFilePath,
        selectedResponseFile: response.responseFileName,
      });
    } catch (error) {
      loadErrors.push({ filePath, message: error.message });
    }
  }

  return {
    mockRouteGroups: sortRouteGroups(Array.from(mockRouteGroups.values())),
    handlerRouteGroups: sortRouteGroups(Array.from(handlerRouteGroups.values())),
    proxyMiddlewareRouteGroups: sortRouteGroups(Array.from(proxyMiddlewareRouteGroups.values())),
    loadErrors,
  };
}

module.exports = {
  ENDPOINT_SUFFIX,
  RESPONSE_SUFFIX,
  RESPONSES_DIR_SUFFIX,
  extractMethodFromEndpointFileName,
  loadEndpointRouteGroups,
  listEndpointFiles,
};
