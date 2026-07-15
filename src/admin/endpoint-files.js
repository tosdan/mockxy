const fs = require("fs");
const path = require("path");
const { isValidHttpStatus } = require("../utils/http-body-utils");
const { validatePathFormat } = require("../mocks/route-groups");
const { createAdminError } = require("./admin-errors");
const { resolvePayloadPath, readJsonFile } = require("./admin-fs");
const { ENDPOINT_SUFFIX, RESPONSE_SUFFIX, RESPONSES_DIR_SUFFIX } = require("./mock-ids");
const { HTTP_METHOD_PATTERN, validateHeaderValue } = require("./mock-validation");
const { normalizeSequenceConfig } = require("../mocks/sequence-config");

// Lettura e normalizzazione dei file su disco di un endpoint: METHOD.endpoint.json, la
// cartella METHOD.responses con le response (NNN.response.json) e i loro asset
// (payload file, sorgenti handler/middleware).

function isEndpointFileName(fileName) {
  return fileName.endsWith(ENDPOINT_SUFFIX);
}

function extractMethodFromEndpointFileName(filePath) {
  const baseName = path.basename(filePath);
  return baseName.slice(0, -ENDPOINT_SUFFIX.length).toUpperCase();
}

function getEndpointResponsesDir(endpointFilePath, method = extractMethodFromEndpointFileName(endpointFilePath)) {
  return path.join(path.dirname(endpointFilePath), `${method}${RESPONSES_DIR_SUFFIX}`);
}

function assertSafeResponseFileName(fileName) {
  if (typeof fileName !== "string" || fileName.trim() === "" || fileName !== path.basename(fileName)) {
    throw createAdminError(400, "Response filenames must be local filenames.");
  }
  if (!fileName.endsWith(RESPONSE_SUFFIX)) {
    throw createAdminError(400, `Response filenames must end with ${RESPONSE_SUFFIX}.`);
  }
  return fileName;
}

function assertSafeResponseAssetFileName(fileName, expectedSuffix, fieldName) {
  if (typeof fileName !== "string" || fileName.trim() === "" || fileName !== path.basename(fileName)) {
    throw createAdminError(400, `${fieldName} must be a local filename.`);
  }
  if (expectedSuffix != null && !fileName.endsWith(expectedSuffix)) {
    throw createAdminError(400, `${fieldName} must end with ${expectedSuffix}.`);
  }
  return fileName;
}

function normalizeEndpointConfig(endpoint, filePath, options = {}) {
  if (endpoint == null || typeof endpoint !== "object" || Array.isArray(endpoint)) {
    throw createAdminError(400, "endpoint config must be an object.");
  }

  const expectedMethod = options.expectedMethod || extractMethodFromEndpointFileName(filePath);
  const method = String(endpoint.method || "").toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(method)) {
    throw createAdminError(400, "endpoint.method must be a valid HTTP method.");
  }
  if (method !== expectedMethod) {
    throw createAdminError(400, `endpoint.method must match ${expectedMethod}.`);
  }
  if (typeof endpoint.path !== "string" || endpoint.path.trim() === "") {
    throw createAdminError(400, "endpoint.path must be a non-empty string.");
  }
  try {
    validatePathFormat(endpoint.path, filePath, "Endpoint path");
  } catch (error) {
    throw createAdminError(400, error.message);
  }
  if (endpoint.description != null && typeof endpoint.description !== "string") {
    throw createAdminError(400, "endpoint.description must be a string.");
  }
  if (typeof endpoint.enabled !== "boolean") {
    throw createAdminError(400, "endpoint.enabled must be a boolean.");
  }
  if (!Array.isArray(endpoint.responseFiles) || endpoint.responseFiles.length === 0) {
    throw createAdminError(400, "endpoint.responseFiles must be a non-empty array.");
  }

  const seenResponseFiles = new Set();
  const responseFiles = endpoint.responseFiles.map((responseFile) => {
    const normalizedResponseFile = assertSafeResponseFileName(responseFile);
    if (seenResponseFiles.has(normalizedResponseFile)) {
      throw createAdminError(400, "endpoint.responseFiles must not contain duplicates.");
    }
    seenResponseFiles.add(normalizedResponseFile);
    return normalizedResponseFile;
  });
  const selectedResponseFile = assertSafeResponseFileName(endpoint.selectedResponseFile);
  if (!seenResponseFiles.has(selectedResponseFile)) {
    throw createAdminError(400, "endpoint.selectedResponseFile must be listed in endpoint.responseFiles.");
  }

  // Il campo sequence va normalizzato e TRASPORTATO: le scritture admin ricostruiscono il file
  // endpoint da questa forma, e perdere qui la sequenza significherebbe cancellarla a ogni
  // salvataggio dalla UI (stesse regole del loader runtime: modulo condiviso sequence-config).
  const sequenceResult = normalizeSequenceConfig(endpoint.sequence, responseFiles);
  if (sequenceResult.errors.length > 0) {
    throw createAdminError(400, `${sequenceResult.errors.join("; ")}.`);
  }

  const normalized = {
    method,
    path: endpoint.path,
    description: endpoint.description || "",
    enabled: endpoint.enabled,
    responseFiles,
    selectedResponseFile,
  };
  // Solo quando presente: un endpoint senza sequenza non deve guadagnare "sequence": null su disco.
  if (sequenceResult.sequence != null) {
    normalized.sequence = sequenceResult.sequence;
  }
  return normalized;
}

function normalizeEndpointResponse(response, responseFilePath) {
  if (response == null || typeof response !== "object" || Array.isArray(response)) {
    throw createAdminError(400, "response must be an object.");
  }
  if (response.type !== "mock" && response.type !== "handler" && response.type !== "middleware") {
    throw createAdminError(400, "response.type must be mock, handler or middleware.");
  }
  if (response.title != null && typeof response.title !== "string") {
    throw createAdminError(400, "response.title must be a string.");
  }

  if (response.type === "mock") {
    if (!isValidHttpStatus(response.status)) {
      throw createAdminError(400, "response.status must be an integer HTTP status code.");
    }
    if (response.delayMs != null && (!Number.isInteger(response.delayMs) || response.delayMs < 0)) {
      throw createAdminError(400, "response.delayMs must be a non-negative integer.");
    }
    if (response.headers != null) {
      const validHeaders = typeof response.headers === "object"
        && !Array.isArray(response.headers)
        && Object.values(response.headers).every(validateHeaderValue);
      if (!validHeaders) {
        throw createAdminError(400, "response.headers must be an object with primitive header values.");
      }
    }

    const hasBody = Object.prototype.hasOwnProperty.call(response, "body");
    const hasFile = Object.prototype.hasOwnProperty.call(response, "file");
    if (hasBody === hasFile) {
      throw createAdminError(400, "Mock responses must define exactly one of response.body or response.file.");
    }
    // Stessa regola del loader runtime (validateMockResponse): sono ammessi anche percorsi
    // relativi in sottocartelle della cartella response — il confinamento viene garantito
    // alla risoluzione (resolvePayloadPath/isInsideDir). Un basename puro qui respingerebbe
    // in lettura file che il runtime carica e serve senza errori.
    if (hasFile && (typeof response.file !== "string" || response.file.trim() === "")) {
      throw createAdminError(400, "response.file must be a non-empty string.");
    }
  }

  if (response.type === "handler") {
    assertSafeResponseAssetFileName(response.sourceFile, ".handler.js", "response.sourceFile");
  }

  if (response.type === "middleware") {
    assertSafeResponseAssetFileName(response.sourceFile, ".middleware.js", "response.sourceFile");
  }

  return {
    ...response,
    title: response.title || "",
    responseFilePath,
  };
}

async function readEndpointConfig(filePath) {
  const endpoint = await readJsonFile(filePath);
  return normalizeEndpointConfig(endpoint, filePath);
}

async function readEndpointResponse(responseFilePath) {
  const response = await readJsonFile(responseFilePath);
  return normalizeEndpointResponse(response, responseFilePath);
}

function resolveEndpointResponseFilePath(endpointFilePath, endpoint, responseFileName) {
  const responseDir = getEndpointResponsesDir(endpointFilePath, endpoint.method);
  return resolvePayloadPath(responseDir, responseFileName);
}

async function readEndpointSelectedResponse(endpointFilePath) {
  const endpoint = await readEndpointConfig(endpointFilePath);
  const responseFilePath = resolveEndpointResponseFilePath(endpointFilePath, endpoint, endpoint.selectedResponseFile);
  if (!fs.existsSync(responseFilePath)) {
    throw createAdminError(404, "Selected response file not found.");
  }

  return {
    endpoint,
    response: await readEndpointResponse(responseFilePath),
    responseFilePath,
    responseDir: getEndpointResponsesDir(endpointFilePath, endpoint.method),
  };
}

async function readEndpointResponseSummaries(endpointFilePath, endpoint) {
  const responseDir = getEndpointResponsesDir(endpointFilePath, endpoint.method);
  const summaries = [];
  for (const responseFile of endpoint.responseFiles) {
    const responseFilePath = resolvePayloadPath(responseDir, responseFile);
    if (!fs.existsSync(responseFilePath)) {
      summaries.push({
        fileName: responseFile,
        missing: true,
      });
      continue;
    }

    const response = await readEndpointResponse(responseFilePath);
    summaries.push({
      fileName: responseFile,
      type: response.type,
      title: response.title || "",
      sourceFile: response.type === "handler" || response.type === "middleware"
        ? response.sourceFile
        : undefined,
      status: response.type === "mock" ? response.status : null,
      selected: responseFile === endpoint.selectedResponseFile,
    });
  }

  return summaries;
}

async function readEndpointResponseByName(endpointPath, responseFileName) {
  const endpoint = await readEndpointConfig(endpointPath);
  const selectedResponseFile = assertSafeResponseFileName(responseFileName);
  if (!endpoint.responseFiles.includes(selectedResponseFile)) {
    throw createAdminError(404, "Response file not found in endpoint.responseFiles.");
  }

  const responseFilePath = resolveEndpointResponseFilePath(endpointPath, endpoint, selectedResponseFile);
  if (!fs.existsSync(responseFilePath)) {
    throw createAdminError(404, "Response file not found.");
  }

  return {
    endpoint,
    response: await readEndpointResponse(responseFilePath),
    responseFileName: selectedResponseFile,
    responseFilePath,
    responseDir: getEndpointResponsesDir(endpointPath, endpoint.method),
  };
}

function readResponseAssetFileName(response) {
  if (response.type === "mock" && response.file != null) {
    return response.file;
  }
  if (response.type === "handler" || response.type === "middleware") {
    return response.sourceFile;
  }

  return undefined;
}

async function isResponseAssetReferenced(responseDir, endpoint, excludedResponseFileName, assetFileName) {
  if (assetFileName == null) {
    return false;
  }

  for (const responseFile of endpoint.responseFiles) {
    if (responseFile === excludedResponseFileName) {
      continue;
    }

    const responseFilePath = resolvePayloadPath(responseDir, responseFile);
    if (!fs.existsSync(responseFilePath)) {
      continue;
    }

    const response = await readEndpointResponse(responseFilePath);
    if (readResponseAssetFileName(response) === assetFileName) {
      return true;
    }
  }

  return false;
}

function buildEndpointFilePayload(method, routePath, disabled, description = "") {
  return {
    method,
    path: routePath,
    description: typeof description === "string" ? description : "",
    enabled: disabled !== true,
    responseFiles: ["001.response.json"],
    selectedResponseFile: "001.response.json",
  };
}

function assertEndpointPathUnchanged(currentPath, requestedPath) {
  if (requestedPath !== currentPath) {
    throw createAdminError(400, "Endpoint path cannot be changed after creation.");
  }
}

function createNextResponseFileName(responseFiles) {
  const RESPONSE_INDEX_PATTERN = /^(\d+)\.response\.json$/;
  const usedResponseFiles = new Set(responseFiles);
  let highestIndex = 0;

  for (const responseFile of responseFiles) {
    const match = RESPONSE_INDEX_PATTERN.exec(responseFile);
    if (match == null) {
      continue;
    }

    highestIndex = Math.max(highestIndex, Number(match[1]));
  }

  let nextIndex = highestIndex + 1;
  while (true) {
    const nextResponseFile = `${String(nextIndex).padStart(3, "0")}${RESPONSE_SUFFIX}`;
    if (!usedResponseFiles.has(nextResponseFile)) {
      return nextResponseFile;
    }

    nextIndex += 1;
  }
}

function createClonedResponseAssetFileName(responseFileName, sourceFileName, fallbackSuffix) {
  const responseBaseName = path.basename(responseFileName, RESPONSE_SUFFIX);
  const sourceBaseName = path.basename(sourceFileName);
  const suffixStartIndex = sourceBaseName.indexOf(".");
  const suffix = suffixStartIndex === -1 ? fallbackSuffix : sourceBaseName.slice(suffixStartIndex);
  return `${responseBaseName}${suffix || fallbackSuffix}`;
}

module.exports = {
  isEndpointFileName,
  extractMethodFromEndpointFileName,
  getEndpointResponsesDir,
  assertSafeResponseFileName,
  assertSafeResponseAssetFileName,
  readEndpointConfig,
  readEndpointResponse,
  resolveEndpointResponseFilePath,
  readEndpointSelectedResponse,
  readEndpointResponseSummaries,
  readEndpointResponseByName,
  readResponseAssetFileName,
  isResponseAssetReferenced,
  buildEndpointFilePayload,
  assertEndpointPathUnchanged,
  createNextResponseFileName,
  createClonedResponseAssetFileName,
};
