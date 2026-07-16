const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("../utils/fs-atomic");
const { validatePathFormat } = require("../mocks/route-groups");
const { createAdminError } = require("./admin-errors");
const {
  readBackup,
  readDirectoryBackup,
  commitWithRollback,
  resolvePayloadPath,
  removeEmptyDirectory,
} = require("./admin-fs");
const {
  resolveAdminFilePath,
  encodeMockId,
  toPosixRelativePath,
  isInsideDir,
  ENDPOINT_SUFFIX,
  RESPONSE_SUFFIX,
} = require("./mock-ids");
const { deriveFolderPathFromRoutePath } = require("./route-folders");
const {
  HTTP_METHOD_PATTERN,
  validateMockConfig,
  validateHandlerDefinition,
  normalizeMockConfig,
  normalizeHandlerDefinition,
  normalizeEndpointSource,
  assertEndpointSourceIsValid,
} = require("./mock-validation");
const {
  getEndpointResponsesDir,
  extractMethodFromEndpointFileName,
  readEndpointConfig,
  readEndpointResponse,
  readEndpointSelectedResponse,
  readEndpointResponseByName,
  resolveEndpointResponseFilePath,
  buildEndpointFilePayload,
  assertEndpointPathUnchanged,
  createNextResponseFileName,
  createClonedResponseAssetFileName,
  assertSafeResponseFileName,
  assertSafeResponseAssetFileName,
  readResponseAssetFileName,
  isResponseAssetReferenced,
} = require("./endpoint-files");
const {
  getCollectionsMetadataFilePath,
  readCollectionsState,
  writeCollectionsState,
  removeRefFromChildOrder,
  serializedByWorkspace,
} = require("./collections-state");
const { getAdminMockDetail } = require("./mock-catalog");
const { normalizeSequenceConfig } = require("../mocks/sequence-config");

// Mutazioni degli endpoint e delle loro response: creazione (mock o script), aggiornamento,
// upload di asset, cancellazione e copia. Ogni mutazione scrive su disco con backup e, se il
// reload del runtime fallisce, ripristina i file originali prima di rilanciare l'errore.

async function createAdminEndpointFromMock(mocksDir, payload, reloadRuntime) {
  const configInput = payload?.config || {};
  const method = String(configInput.method || "").toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(method)) {
    throw createAdminError(400, "config.method must be a valid HTTP method.");
  }

  const config = normalizeMockConfig({
    ...configInput,
    bodyFile: "inline.body.json",
    file: undefined,
  }, method);
  validateMockConfig(config, `${method}${ENDPOINT_SUFFIX}`, { expectedMethod: method });
  const folderPath = deriveFolderPathFromRoutePath(config.path, "config.path");
  const configDir = path.resolve(mocksDir, folderPath);
  if (!isInsideDir(mocksDir, configDir)) {
    throw createAdminError(400, "config.path must derive a folder inside the mocks directory.");
  }

  const endpointPath = path.join(configDir, `${method}${ENDPOINT_SUFFIX}`);
  const responseDir = getEndpointResponsesDir(endpointPath, method);
  const responsePath = path.join(responseDir, "001.response.json");
  if (fs.existsSync(endpointPath)) {
    // L'id dell'endpoint esistente permette al chiamante di proporre un'alternativa
    // (es. il monitor: "aggiungi la response catturata come variante") senza rifare il match.
    throw createAdminError(409, "An endpoint already exists for this folder and method.", {
      existingMockId: encodeMockId(toPosixRelativePath(path.relative(mocksDir, endpointPath))),
    });
  }

  const description = payload?.description;
  if (description != null && typeof description !== "string") {
    throw createAdminError(400, "description must be a string.");
  }
  const endpoint = buildEndpointFilePayload(method, config.path, config.disabled, description || "");
  const response = {
    type: "mock",
    title: "",
    status: config.status,
    headers: config.headers == null ? {} : config.headers,
    delayMs: config.delayMs || 0,
    body: payload?.body ?? {},
  };
  const backups = [await readBackup(endpointPath), await readBackup(responsePath)];

  await fs.promises.mkdir(responseDir, { recursive: true });
  await writeFileAtomic(responsePath, `${JSON.stringify(response, null, 2)}\n`, "utf8");
  await writeFileAtomic(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, "utf8");

  const relativePath = toPosixRelativePath(path.relative(mocksDir, endpointPath));
  await commitWithRollback({ backups, reloadRuntime, rejectionLabel: "Endpoint create rejected" });

  return getAdminMockDetail(mocksDir, encodeMockId(relativePath));
}

async function createAdminEndpointFromScript(mocksDir, payload, reloadRuntime, type) {
  const definitionInput = payload?.definition || {};
  const method = String(definitionInput.method || "").toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(method)) {
    throw createAdminError(400, "definition.method must be a valid HTTP method.");
  }

  const definition = normalizeHandlerDefinition(definitionInput, method);
  validateHandlerDefinition(definition, `${method}${ENDPOINT_SUFFIX}`, { expectedMethod: method });
  const folderPath = deriveFolderPathFromRoutePath(definition.path, "definition.path");
  const configDir = path.resolve(mocksDir, folderPath);
  if (!isInsideDir(mocksDir, configDir)) {
    throw createAdminError(400, "definition.path must derive a folder inside the mocks directory.");
  }

  const endpointPath = path.join(configDir, `${method}${ENDPOINT_SUFFIX}`);
  const responseDir = getEndpointResponsesDir(endpointPath, method);
  const responsePath = path.join(responseDir, "001.response.json");
  const sourceFile = type === "handler" ? "001.handler.js" : "001.middleware.js";
  const sourcePath = path.join(responseDir, sourceFile);
  if (fs.existsSync(endpointPath)) {
    throw createAdminError(409, "An endpoint already exists for this folder and method.", {
      existingMockId: encodeMockId(toPosixRelativePath(path.relative(mocksDir, endpointPath))),
    });
  }

  const endpoint = buildEndpointFilePayload(method, definition.path, definition.disabled);
  const response = {
    type,
    title: "",
    sourceFile,
  };
  const source = normalizeEndpointSource(payload?.source, type);
  const backups = [await readBackup(endpointPath), await readBackup(responsePath), await readBackup(sourcePath)];

  await fs.promises.mkdir(responseDir, { recursive: true });
  await writeFileAtomic(sourcePath, source, "utf8");
  await writeFileAtomic(responsePath, `${JSON.stringify(response, null, 2)}\n`, "utf8");
  await writeFileAtomic(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, "utf8");

  const relativePath = toPosixRelativePath(path.relative(mocksDir, endpointPath));
  await commitWithRollback({
    backups,
    reloadRuntime,
    rejectionLabel: "Endpoint create rejected",
    commit: () => assertEndpointSourceIsValid(sourcePath, type),
  });

  return getAdminMockDetail(mocksDir, encodeMockId(relativePath));
}

async function createAdminMock(mocksDir, payload, reloadRuntime) {
  if (payload?.type === "handler") {
    return createAdminEndpointFromScript(mocksDir, payload, reloadRuntime, "handler");
  }
  if (payload?.type === "middleware") {
    return createAdminEndpointFromScript(mocksDir, payload, reloadRuntime, "middleware");
  }

  return createAdminEndpointFromMock(mocksDir, payload, reloadRuntime);
}

function normalizeNewResponseTitle(title) {
  if (title == null) {
    return "";
  }
  if (typeof title !== "string") {
    throw createAdminError(400, "title must be a string.");
  }

  return title;
}

function cloneJsonSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasExplicitResponseCreatePayload(payload) {
  return payload != null
    && typeof payload === "object"
    && !Array.isArray(payload)
    && Object.keys(payload).some((fieldName) => fieldName !== "title");
}

function buildEndpointResponseClone(responseDir, response, responseFileName, payload) {
  const nextResponse = hasExplicitResponseCreatePayload(payload)
    ? buildUpdatedEndpointResponse(response, payload)
    : cloneJsonSerializable(response);
  delete nextResponse.responseFilePath;
  if (!hasExplicitResponseCreatePayload(payload)) {
    nextResponse.title = normalizeNewResponseTitle(payload?.title);
  }
  const assetCopies = [];
  const assetWrites = [];

  // La sorgente era file-backed, ma conta l'esito del MERGE col payload: se il payload ha
  // portato un body esplicito il clone diventa body-backed e l'asset non va né referenziato
  // né duplicato (body e file sono mutuamente esclusivi nella validazione).
  const cloneKeepsFile = !Object.prototype.hasOwnProperty.call(nextResponse, "body");
  if (response.type === "mock" && response.file != null && cloneKeepsFile) {
    const fileName = assertSafeResponseAssetFileName(response.file, undefined, "response.file");
    const nextFileName = createClonedResponseAssetFileName(responseFileName, fileName, ".bin");
    nextResponse.file = nextFileName;
    assetCopies.push({
      sourcePath: resolvePayloadPath(responseDir, fileName),
      targetPath: resolvePayloadPath(responseDir, nextFileName),
    });
  }

  if (response.type === "handler" || response.type === "middleware") {
    const sourceFile = assertSafeResponseAssetFileName(
      response.sourceFile,
      response.type === "handler" ? ".handler.js" : ".middleware.js",
      "response.sourceFile"
    );
    const nextSourceFile = createClonedResponseAssetFileName(
      responseFileName,
      sourceFile,
      response.type === "handler" ? ".handler.js" : ".middleware.js"
    );
    nextResponse.sourceFile = nextSourceFile;
    const targetPath = resolvePayloadPath(responseDir, nextSourceFile);
    if (Object.prototype.hasOwnProperty.call(payload || {}, "source")) {
      if (typeof payload.source !== "string" || payload.source.trim() === "") {
        throw createAdminError(400, "source must be a non-empty string.");
      }
      assetWrites.push({
        targetPath,
        content: payload.source,
      });
    } else {
      assetCopies.push({
        sourcePath: resolvePayloadPath(responseDir, sourceFile),
        targetPath,
      });
    }
  }

  return {
    nextResponse,
    assetCopies,
    assetWrites,
  };
}

const NEW_RESPONSE_TYPES = new Set(["mock", "handler", "middleware"]);

/**
 * Costruisce una response NUOVA del tipo richiesto (mock/handler/middleware) invece di
 * clonare quella selezionata: abilita endpoint con response di tipi misti. Per gli script
 * scrive il file sorgente (template se `source` assente). Stessa forma di output di
 * buildEndpointResponseClone (nextResponse + assetCopies + assetWrites).
 */
function buildNewTypedResponse(responseDir, responseFileName, payload) {
  const type = payload.type;
  const title = normalizeNewResponseTitle(payload?.title);

  if (type === "mock") {
    const nextResponse = {
      type: "mock",
      title,
      status: payload?.status ?? 200,
      headers: payload?.headers == null ? {} : payload.headers,
      delayMs: payload?.delayMs ?? 0,
      body: Object.prototype.hasOwnProperty.call(payload || {}, "body") ? payload.body : {},
    };
    if (normalizeTemplatedFlag(payload, null)) {
      nextResponse.templated = true;
    }
    return { nextResponse, assetCopies: [], assetWrites: [] };
  }

  const baseName = path.basename(responseFileName, RESPONSE_SUFFIX);
  const sourceFile = `${baseName}${type === "handler" ? ".handler.js" : ".middleware.js"}`;
  const nextResponse = { type, title, sourceFile };
  return {
    nextResponse,
    assetCopies: [],
    assetWrites: [
      { targetPath: resolvePayloadPath(responseDir, sourceFile), content: normalizeEndpointSource(payload?.source, type) },
    ],
  };
}

function normalizeUpdatedResponseTitle(payload, response) {
  if (!Object.prototype.hasOwnProperty.call(payload || {}, "title")) {
    return response.title || "";
  }
  if (payload.title == null) {
    return "";
  }
  if (typeof payload.title !== "string") {
    throw createAdminError(400, "title must be a string.");
  }

  return payload.title;
}

// Flag templated della variante mock: dal payload quando presente (validato), altrimenti
// conservato dalla response esistente — le scritture ricostruiscono il file e perderlo qui
// significherebbe spegnere il templating a ogni salvataggio.
function normalizeTemplatedFlag(payload, response) {
  if (Object.prototype.hasOwnProperty.call(payload || {}, "templated")) {
    if (payload.templated != null && typeof payload.templated !== "boolean") {
      throw createAdminError(400, "templated must be a boolean.");
    }
    return payload.templated === true;
  }
  return response?.templated === true;
}

function buildUpdatedEndpointResponse(response, payload) {
  const requestedType = payload?.type || response.type;
  if (requestedType !== response.type) {
    throw createAdminError(400, "Response type cannot be changed.");
  }

  if (response.type === "mock") {
    const nextResponse = {
      type: "mock",
      title: normalizeUpdatedResponseTitle(payload, response),
      status: payload?.status ?? response.status,
      headers: Object.prototype.hasOwnProperty.call(payload || {}, "headers")
        ? payload.headers
        : response.headers == null ? {} : response.headers,
      delayMs: payload?.delayMs ?? response.delayMs ?? 0,
    };
    if (normalizeTemplatedFlag(payload, response)) {
      nextResponse.templated = true;
    }

    const payloadHasBody = Object.prototype.hasOwnProperty.call(payload || {}, "body");
    if (response.file != null && !payloadHasBody) {
      // response file-backed senza un body esplicito: resta file (modifica solo i metadati).
      nextResponse.file = response.file;
      // I payload file sono serviti in streaming: niente templating (stessa regola del loader).
      delete nextResponse.templated;
    } else {
      // json/text, oppure switch file→body: un body esplicito sgancia il file.
      nextResponse.body = payloadHasBody ? payload.body : response.body ?? {};
    }

    return nextResponse;
  }

  return {
    type: response.type,
    title: normalizeUpdatedResponseTitle(payload, response),
    sourceFile: response.sourceFile,
  };
}

async function createAdminResponse(mocksDir, id, payload, reloadRuntime) {
  const endpointPath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(endpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }

  const { endpoint, response, responseDir } = await readEndpointSelectedResponse(endpointPath);
  const responseFileName = createNextResponseFileName(endpoint.responseFiles);
  const responseFilePath = resolveEndpointResponseFilePath(endpointPath, endpoint, responseFileName);
  if (fs.existsSync(responseFilePath)) {
    throw createAdminError(409, "Generated response file already exists.");
  }

  const wantsNewType = NEW_RESPONSE_TYPES.has(payload?.type) && payload.type !== response.type;
  const { nextResponse, assetCopies, assetWrites } = wantsNewType
    ? buildNewTypedResponse(responseDir, responseFileName, payload)
    : buildEndpointResponseClone(responseDir, response, responseFileName, payload);
  const targetAssetPaths = new Set();
  for (const assetCopy of assetCopies) {
    if (!fs.existsSync(assetCopy.sourcePath)) {
      throw createAdminError(404, "Selected response asset not found.");
    }
    if (fs.existsSync(assetCopy.targetPath)) {
      throw createAdminError(409, "Generated response asset already exists.");
    }
    if (targetAssetPaths.has(assetCopy.targetPath)) {
      throw createAdminError(409, "Generated response asset would be duplicated.");
    }

    targetAssetPaths.add(assetCopy.targetPath);
  }
  for (const assetWrite of assetWrites) {
    if (fs.existsSync(assetWrite.targetPath)) {
      throw createAdminError(409, "Generated response asset already exists.");
    }
    if (targetAssetPaths.has(assetWrite.targetPath)) {
      throw createAdminError(409, "Generated response asset would be duplicated.");
    }

    targetAssetPaths.add(assetWrite.targetPath);
  }

  const backups = [
    await readBackup(endpointPath),
    await readBackup(responseFilePath),
  ];
  for (const assetCopy of assetCopies) {
    backups.push(await readBackup(assetCopy.targetPath));
  }
  for (const assetWrite of assetWrites) {
    backups.push(await readBackup(assetWrite.targetPath));
  }

  await fs.promises.mkdir(responseDir, { recursive: true });
  for (const assetCopy of assetCopies) {
    await fs.promises.copyFile(assetCopy.sourcePath, assetCopy.targetPath);
  }
  for (const assetWrite of assetWrites) {
    await writeFileAtomic(assetWrite.targetPath, assetWrite.content, "utf8");
  }
  await writeFileAtomic(responseFilePath, `${JSON.stringify(nextResponse, null, 2)}\n`, "utf8");

  const nextEndpoint = {
    ...endpoint,
    responseFiles: [...endpoint.responseFiles, responseFileName],
    selectedResponseFile: responseFileName,
  };
  await writeFileAtomic(endpointPath, `${JSON.stringify(nextEndpoint, null, 2)}\n`, "utf8");

  await commitWithRollback({
    backups,
    reloadRuntime,
    rejectionLabel: "Endpoint response create rejected",
    commit: async () => {
      await readEndpointResponse(responseFilePath);
      if (nextResponse.type === "handler" || nextResponse.type === "middleware") {
        const sourcePath = resolvePayloadPath(responseDir, nextResponse.sourceFile);
        assertEndpointSourceIsValid(sourcePath, nextResponse.type);
      }
    },
  });

  return getAdminMockDetail(mocksDir, id);
}

async function updateAdminResponse(mocksDir, id, responseFileName, payload, reloadRuntime) {
  const endpointPath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(endpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }

  const { endpoint, response, responseFilePath, responseDir } = await readEndpointResponseByName(endpointPath, responseFileName);
  const nextResponse = buildUpdatedEndpointResponse(response, payload);
  const backups = [await readBackup(responseFilePath)];
  let sourcePath;

  if (nextResponse.type === "handler" || nextResponse.type === "middleware") {
    sourcePath = resolvePayloadPath(responseDir, nextResponse.sourceFile);
    if (!fs.existsSync(sourcePath)) {
      throw createAdminError(404, "Response source file not found.");
    }
    backups.push(await readBackup(sourcePath));
    if (Object.prototype.hasOwnProperty.call(payload || {}, "source")) {
      if (typeof payload.source !== "string" || payload.source.trim() === "") {
        throw createAdminError(400, "source must be a non-empty string.");
      }
      await writeFileAtomic(sourcePath, payload.source, "utf8");
    }
  }

  await writeFileAtomic(responseFilePath, `${JSON.stringify(nextResponse, null, 2)}\n`, "utf8");

  await commitWithRollback({
    backups,
    reloadRuntime,
    rejectionLabel: "Endpoint response update rejected",
    commit: async () => {
      await readEndpointResponse(responseFilePath);
      if (sourcePath != null) {
        assertEndpointSourceIsValid(sourcePath, nextResponse.type);
      }
    },
  });

  // Switch via dal file (es. file→body): rimuove l'asset orfano se non più referenziato.
  if (response.file != null && response.file !== nextResponse.file) {
    try {
      const referenced = await isResponseAssetReferenced(responseDir, endpoint, responseFileName, response.file);
      if (!referenced) {
        await fs.promises.rm(resolvePayloadPath(responseDir, response.file), { force: true });
      }
    } catch {
      /* pulizia best-effort */
    }
  }

  return getAdminMockDetail(mocksDir, id);
}

function sanitizeUploadExtension(filename) {
  const ext = typeof filename === "string" ? path.extname(filename).toLowerCase() : "";
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ".bin";
}

function setHeaderCaseInsensitive(headers, name, value) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      delete headers[key];
    }
  }
  headers[name] = value;
}

/**
 * Imposta una response (mock) come file-backed caricando i bytes: scrive l'asset nella cartella
 * delle response, riscrive il metadato con `file` al posto di `body` e imposta il content-type
 * dal MIME caricato (sovrascrivibile poi dall'utente con un header). Rimuove il vecchio asset
 * orfano se il nome cambia. Lo switch inverso (file→json/text) passa da updateAdminResponse.
 */
async function setAdminResponseFile(mocksDir, id, responseFileName, fileBuffer, options, reloadRuntime) {
  const endpointPath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(endpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw createAdminError(400, "Uploaded file is empty.");
  }

  const { endpoint, response, responseFilePath, responseDir } = await readEndpointResponseByName(endpointPath, responseFileName);
  if (response.type !== "mock") {
    throw createAdminError(400, "Only mock responses can be backed by a file.");
  }

  const baseName = path.basename(responseFileName, RESPONSE_SUFFIX);
  const assetFile = `${baseName}.file${sanitizeUploadExtension(options?.filename)}`;
  const assetPath = resolvePayloadPath(responseDir, assetFile);

  const headers = { ...(response.headers || {}) };
  if (typeof options?.contentType === "string" && options.contentType.trim() !== "") {
    setHeaderCaseInsensitive(headers, "content-type", options.contentType.trim());
  }
  const nextResponse = {
    type: "mock",
    title: response.title || "",
    status: response.status,
    headers,
    delayMs: response.delayMs ?? 0,
    file: assetFile,
  };

  const oldAsset = response.file && response.file !== assetFile ? response.file : null;
  const backups = [await readBackup(responseFilePath), await readBackup(assetPath)];

  await fs.promises.mkdir(responseDir, { recursive: true });
  await writeFileAtomic(assetPath, fileBuffer);
  await writeFileAtomic(responseFilePath, `${JSON.stringify(nextResponse, null, 2)}\n`, "utf8");

  await commitWithRollback({
    backups,
    reloadRuntime,
    rejectionLabel: "Response file update rejected",
    commit: () => readEndpointResponse(responseFilePath),
  });

  if (oldAsset) {
    try {
      const referenced = await isResponseAssetReferenced(responseDir, endpoint, responseFileName, oldAsset);
      if (!referenced) {
        await fs.promises.rm(resolvePayloadPath(responseDir, oldAsset), { force: true });
      }
    } catch {
      /* pulizia best-effort */
    }
  }

  return getAdminMockDetail(mocksDir, id);
}

async function deleteAdminResponse(mocksDir, id, responseFileName, reloadRuntime) {
  const endpointPath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(endpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }

  const { endpoint, response, responseFileName: normalizedResponseFileName, responseFilePath, responseDir } =
    await readEndpointResponseByName(endpointPath, responseFileName);
  if (endpoint.responseFiles.length <= 1) {
    throw createAdminError(400, "Cannot delete the last response of an endpoint.");
  }

  const remainingResponseFiles = endpoint.responseFiles.filter((candidate) => candidate !== normalizedResponseFileName);
  // Se era selezionata quella cancellata, seleziona la response IMMEDIATAMENTE PRECEDENTE
  // (la prima rimasta se si cancella la prima), non sempre la prima della lista.
  const deletedIndex = endpoint.responseFiles.indexOf(normalizedResponseFileName);
  const nextEndpoint = {
    ...endpoint,
    responseFiles: remainingResponseFiles,
    selectedResponseFile: endpoint.selectedResponseFile === normalizedResponseFileName
      ? remainingResponseFiles[Math.max(0, deletedIndex - 1)]
      : endpoint.selectedResponseFile,
  };
  const assetFileName = readResponseAssetFileName(response);
  const shouldDeleteAsset = assetFileName != null
    && !await isResponseAssetReferenced(responseDir, endpoint, normalizedResponseFileName, assetFileName);
  const assetPath = shouldDeleteAsset ? resolvePayloadPath(responseDir, assetFileName) : undefined;
  const backups = [
    await readBackup(endpointPath),
    await readBackup(responseFilePath),
  ];
  if (assetPath != null) {
    backups.push(await readBackup(assetPath));
  }

  await writeFileAtomic(endpointPath, `${JSON.stringify(nextEndpoint, null, 2)}\n`, "utf8");
  await fs.promises.rm(responseFilePath, { force: true });
  if (assetPath != null) {
    await fs.promises.rm(assetPath, { force: true });
  }

  await commitWithRollback({ backups, reloadRuntime, rejectionLabel: "Endpoint response delete rejected" });

  return getAdminMockDetail(mocksDir, id);
}

function buildUpdatedEndpointConfig(endpoint, payload) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    throw createAdminError(400, "Endpoint update payload must be an object.");
  }

  const allowedFields = new Set(["description", "enabled"]);
  const unsupportedFields = Object.keys(payload).filter((fieldName) => !allowedFields.has(fieldName));
  if (unsupportedFields.length > 0) {
    throw createAdminError(400, "Only endpoint.description and endpoint.enabled can be updated.");
  }

  let description = endpoint.description || "";
  if (Object.prototype.hasOwnProperty.call(payload, "description")) {
    if (payload.description == null) {
      description = "";
    } else if (typeof payload.description !== "string") {
      throw createAdminError(400, "description must be a string.");
    } else {
      description = payload.description;
    }
  }

  let enabled = endpoint.enabled;
  if (Object.prototype.hasOwnProperty.call(payload, "enabled")) {
    if (typeof payload.enabled !== "boolean") {
      throw createAdminError(400, "enabled must be a boolean.");
    }
    enabled = payload.enabled;
  }

  return {
    ...endpoint,
    description,
    enabled,
  };
}

async function updateAdminEndpoint(mocksDir, id, payload, reloadRuntime) {
  const endpointPath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(endpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }

  const endpoint = await readEndpointConfig(endpointPath);
  const nextEndpoint = buildUpdatedEndpointConfig(endpoint, payload);
  const backups = [await readBackup(endpointPath)];

  await writeFileAtomic(endpointPath, `${JSON.stringify(nextEndpoint, null, 2)}\n`, "utf8");

  await commitWithRollback({
    backups,
    reloadRuntime,
    rejectionLabel: "Endpoint update rejected",
    commit: () => readEndpointConfig(endpointPath),
  });

  return getAdminMockDetail(mocksDir, id);
}

async function updateAdminMock(mocksDir, id, payload, reloadRuntime) {
  const endpointPath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(endpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }

  // Aggiornamento della sola sequenza (dialog Sequenza della UI): normalizza la definizione
  // contro le varianti dell'endpoint e valida che ogni step referenzi una response leggibile e
  // di tipo mock/handler (i middleware vivono nel percorso proxy: esclusi dalle sequenze in v1).
  // `sequence: null` rimuove il campo (l'endpoint torna alla sola selezione classica).
  if (Object.prototype.hasOwnProperty.call(payload || {}, "sequence")) {
    const endpoint = await readEndpointConfig(endpointPath);
    const { errors, sequence } = normalizeSequenceConfig(payload.sequence, endpoint.responseFiles);
    if (errors.length > 0) {
      throw createAdminError(400, `${errors.join("; ")}.`);
    }

    if (sequence != null) {
      const stepResponseFiles = [...new Set(sequence.steps.map((step) => step.response))];
      for (const stepResponseFile of stepResponseFiles) {
        const responseFilePath = resolveEndpointResponseFilePath(endpointPath, endpoint, stepResponseFile);
        if (!fs.existsSync(responseFilePath)) {
          throw createAdminError(404, `Sequence step response file not found: ${stepResponseFile}.`);
        }
        const stepResponse = await readEndpointResponse(responseFilePath);
        if (stepResponse.type === "middleware") {
          throw createAdminError(400, "Sequence steps must reference mock or handler responses.");
        }
      }
    }

    const nextEndpoint = { ...endpoint };
    if (sequence != null) {
      nextEndpoint.sequence = sequence;
    } else {
      delete nextEndpoint.sequence;
    }
    const backups = [await readBackup(endpointPath)];
    await writeFileAtomic(endpointPath, `${JSON.stringify(nextEndpoint, null, 2)}\n`, "utf8");

    await commitWithRollback({ backups, reloadRuntime, rejectionLabel: "Endpoint sequence update rejected" });

    return getAdminMockDetail(mocksDir, id);
  }

  if (Object.prototype.hasOwnProperty.call(payload || {}, "selectedResponseFile")) {
    const endpoint = await readEndpointConfig(endpointPath);
    const selectedResponseFile = assertSafeResponseFileName(payload.selectedResponseFile);
    if (!endpoint.responseFiles.includes(selectedResponseFile)) {
      throw createAdminError(400, "selectedResponseFile must be listed in endpoint.responseFiles.");
    }

    const responseFilePath = resolveEndpointResponseFilePath(endpointPath, endpoint, selectedResponseFile);
    if (!fs.existsSync(responseFilePath)) {
      throw createAdminError(404, "Selected response file not found.");
    }

    await readEndpointResponse(responseFilePath);
    const nextEndpoint = {
      ...endpoint,
      selectedResponseFile,
    };
    const backups = [await readBackup(endpointPath)];
    await writeFileAtomic(endpointPath, `${JSON.stringify(nextEndpoint, null, 2)}\n`, "utf8");

    await commitWithRollback({ backups, reloadRuntime, rejectionLabel: "Endpoint response selection rejected" });

    return getAdminMockDetail(mocksDir, id);
  }

  const { endpoint, response, responseFilePath, responseDir } = await readEndpointSelectedResponse(endpointPath);
  const expectedMethod = extractMethodFromEndpointFileName(endpointPath);
  const backups = [
    await readBackup(endpointPath),
    await readBackup(responseFilePath),
  ];
  const nextEndpoint = { ...endpoint };
  let nextResponse;
  let sourcePath;

  const requestedType = payload?.type || response.type;
  if (requestedType === "handler" || requestedType === "middleware") {
    const definition = normalizeHandlerDefinition(payload?.definition || {}, expectedMethod);
    validateHandlerDefinition(definition, endpointPath, { expectedMethod });
    assertEndpointPathUnchanged(endpoint.path, definition.path);
    nextEndpoint.path = endpoint.path;
    nextEndpoint.enabled = definition.disabled !== true;
    // Il nome del sorgente si deriva dalla response SELEZIONATA (come in buildNewTypedResponse):
    // un nome fisso 001.* sovrascriverebbe il sorgente di un'altra response quando la
    // selezionata non è la 001.
    const baseName = path.basename(endpoint.selectedResponseFile, RESPONSE_SUFFIX);
    const defaultSourceFile = `${baseName}${requestedType === "handler" ? ".handler.js" : ".middleware.js"}`;
    const sourceFile = response.type === requestedType && response.sourceFile != null
      ? response.sourceFile
      : defaultSourceFile;
    sourcePath = resolvePayloadPath(responseDir, sourceFile);
    backups.push(await readBackup(sourcePath));
    nextResponse = {
      type: requestedType,
      title: response.title || "",
      sourceFile,
    };
    await writeFileAtomic(sourcePath, normalizeEndpointSource(payload?.source, requestedType), "utf8");
  } else {
    const config = normalizeMockConfig({
      ...(payload?.config || {}),
      bodyFile: "inline.body.json",
      file: undefined,
    }, expectedMethod);
    validateMockConfig(config, endpointPath, { expectedMethod });
    assertEndpointPathUnchanged(endpoint.path, config.path);
    nextEndpoint.path = endpoint.path;
    nextEndpoint.enabled = config.disabled !== true;
    nextResponse = {
      type: "mock",
      title: response.title || "",
      status: config.status,
      headers: config.headers == null ? {} : config.headers,
      delayMs: config.delayMs || 0,
      body: Object.prototype.hasOwnProperty.call(payload || {}, "body") ? payload.body : response.body ?? {},
    };
    if (normalizeTemplatedFlag(payload?.config, response)) {
      nextResponse.templated = true;
    }
  }

  await writeFileAtomic(responseFilePath, `${JSON.stringify(nextResponse, null, 2)}\n`, "utf8");
  await writeFileAtomic(endpointPath, `${JSON.stringify(nextEndpoint, null, 2)}\n`, "utf8");

  await commitWithRollback({
    backups,
    reloadRuntime,
    rejectionLabel: "Endpoint update rejected",
    commit: () => {
      if (sourcePath != null) {
        assertEndpointSourceIsValid(sourcePath, requestedType);
      }
    },
  });

  return getAdminMockDetail(mocksDir, id);
}

// Reset del cursore runtime di una sequenza: la prossima richiesta riparte dal primo step.
// Non tocca i file: è un'azione immediata sullo stato in-memory (pulsante "Riparti dall'inizio").
// "Ripartire dall'inizio" rimette a zero TUTTO lo stato runtime dell'endpoint: anche la memoria
// degli handler (state/callCount/firstRequestAt), altrimenti uno step handler ripartirebbe a metà.
async function resetAdminSequence(mocksDir, id, sequenceStates, handlerStates) {
  const endpointPath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(endpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }

  const endpoint = await readEndpointConfig(endpointPath);
  if (endpoint.sequence == null) {
    throw createAdminError(400, "Endpoint has no sequence to reset.");
  }
  const sequenceKey = `${endpoint.method} ${endpoint.path}`;
  if (sequenceStates != null) {
    sequenceStates.reset(sequenceKey);
  }
  if (handlerStates != null) {
    handlerStates.reset(sequenceKey);
  }
  return {
    sequenceState: sequenceStates != null
      ? sequenceStates.getState(sequenceKey, endpoint.sequence)
      : null,
  };
}

async function deleteAdminMocksUnlocked(
  mocksDir,
  ids,
  reloadRuntime,
  { mutateCollectionState, rejectionLabel = "Endpoint delete rejected" } = {}
) {
  if (!Array.isArray(ids)) {
    throw createAdminError(400, "Endpoint ids must be an array.");
  }

  const targets = [];
  const seenPaths = new Set();
  for (const id of ids) {
    const endpointPath = resolveAdminFilePath(mocksDir, id);
    if (!fs.existsSync(endpointPath)) {
      throw createAdminError(404, "Endpoint definition not found.");
    }
    if (seenPaths.has(endpointPath)) {
      continue;
    }

    seenPaths.add(endpointPath);
    const endpoint = await readEndpointConfig(endpointPath);
    targets.push({
      endpointPath,
      responseDir: getEndpointResponsesDir(endpointPath, endpoint.method),
      relativePath: toPosixRelativePath(path.relative(mocksDir, endpointPath)),
    });
  }

  const collectionState = await readCollectionsState(mocksDir);
  const targetBackups = await Promise.all(
    targets.map(async ({ endpointPath, responseDir }) => [
      await readBackup(endpointPath),
      ...(await readDirectoryBackup(responseDir)),
    ])
  );
  const backups = [
    await readBackup(getCollectionsMetadataFilePath(mocksDir)),
    ...targetBackups.flat(),
  ];

  await commitWithRollback({
    backups,
    reloadRuntime,
    rejectionLabel,
    commit: async () => {
      for (const { endpointPath, responseDir, relativePath } of targets) {
        await fs.promises.rm(endpointPath, { force: true });
        await fs.promises.rm(responseDir, { recursive: true, force: true });
        delete collectionState.memberships[relativePath];
        removeRefFromChildOrder(collectionState, relativePath);
      }

      if (typeof mutateCollectionState === "function") {
        await mutateCollectionState(collectionState);
      }
      await writeCollectionsState(mocksDir, collectionState);

      const candidateDirs = [...new Set(targets.map(({ endpointPath }) => path.dirname(endpointPath)))]
        .sort((left, right) => right.length - left.length);
      for (const candidateDir of candidateDirs) {
        if (fs.existsSync(candidateDir)) {
          await removeEmptyDirectory(candidateDir, mocksDir);
        }
      }
    },
  });

  return { deleted: targets.length };
}

const deleteAdminMocks = serializedByWorkspace(deleteAdminMocksUnlocked);

async function deleteAdminMock(mocksDir, id, reloadRuntime) {
  await deleteAdminMocks(mocksDir, [id], reloadRuntime);
}

// Duplica un endpoint esistente verso un nuovo metodo+path (entrambi modificabili nella dialog "Copia").
// Per default copia la SOLA response selezionata, così il duplicato resta valido e dello stesso tipo;
// con copyResponses=true copia TUTTE le response e i relativi asset, preservando quella selezionata.
// Description ed enabled vengono ereditati dalla sorgente. Errore 409 se al nuovo metodo+path esiste già
// un endpoint (stesso metodo HTTP + stessa path → stessa cartella + file endpoint).
async function copyAdminEndpoint(mocksDir, id, payload, reloadRuntime) {
  const sourceEndpointPath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(sourceEndpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }
  const sourceEndpoint = await readEndpointConfig(sourceEndpointPath);

  const method = String(payload?.method || "").toUpperCase();
  if (!HTTP_METHOD_PATTERN.test(method)) {
    throw createAdminError(400, "method must be a valid HTTP method.");
  }
  const routePath = typeof payload?.path === "string" ? payload.path.trim() : "";
  if (routePath === "") {
    throw createAdminError(400, "path must be a non-empty route path.");
  }
  try {
    validatePathFormat(routePath, `${method}${ENDPOINT_SUFFIX}`, "Endpoint path");
  } catch (error) {
    throw createAdminError(400, error.message);
  }
  const folderPath = deriveFolderPathFromRoutePath(routePath, "path");
  const configDir = path.resolve(mocksDir, folderPath);
  if (!isInsideDir(mocksDir, configDir)) {
    throw createAdminError(400, "path must derive a folder inside the mocks directory.");
  }

  const targetEndpointPath = path.join(configDir, `${method}${ENDPOINT_SUFFIX}`);
  if (fs.existsSync(targetEndpointPath)) {
    throw createAdminError(409, "An endpoint already exists for this folder and method.");
  }
  const targetResponseDir = getEndpointResponsesDir(targetEndpointPath, method);
  if (fs.existsSync(targetResponseDir)) {
    throw createAdminError(409, "The destination folder already contains responses for this endpoint method.");
  }

  const sourceResponseDir = getEndpointResponsesDir(sourceEndpointPath, sourceEndpoint.method);
  const copyAll = payload?.copyResponses === true;
  const selectedResponseFile = sourceEndpoint.selectedResponseFile;
  const responseFiles = copyAll ? [...sourceEndpoint.responseFiles] : [selectedResponseFile];

  // Raccogli i file da copiare: ogni response json + il suo eventuale asset (file/handler/middleware).
  const fileCopies = [];
  for (const responseFile of responseFiles) {
    const sourceResponsePath = resolvePayloadPath(sourceResponseDir, responseFile);
    if (!fs.existsSync(sourceResponsePath)) {
      throw createAdminError(404, `Response file not found: ${responseFile}`);
    }
    fileCopies.push({ sourcePath: sourceResponsePath, targetPath: resolvePayloadPath(targetResponseDir, responseFile) });
    const response = await readEndpointResponse(sourceResponsePath);
    const assetFileName = readResponseAssetFileName(response);
    if (assetFileName != null) {
      const sourceAssetPath = resolvePayloadPath(sourceResponseDir, assetFileName);
      if (!fs.existsSync(sourceAssetPath)) {
        throw createAdminError(404, `Response asset not found: ${assetFileName}`);
      }
      fileCopies.push({ sourcePath: sourceAssetPath, targetPath: resolvePayloadPath(targetResponseDir, assetFileName) });
    }
  }

  const targetEndpoint = {
    method,
    path: routePath,
    description: sourceEndpoint.description ?? "",
    enabled: sourceEndpoint.enabled !== false,
    responseFiles,
    selectedResponseFile,
  };

  const relativePath = toPosixRelativePath(path.relative(mocksDir, targetEndpointPath));
  const backups = [await readBackup(targetEndpointPath)];
  for (const fileCopy of fileCopies) {
    backups.push(await readBackup(fileCopy.targetPath));
  }

  await fs.promises.mkdir(targetResponseDir, { recursive: true });
  for (const fileCopy of fileCopies) {
    await fs.promises.copyFile(fileCopy.sourcePath, fileCopy.targetPath);
  }
  await writeFileAtomic(targetEndpointPath, `${JSON.stringify(targetEndpoint, null, 2)}\n`, "utf8");

  await commitWithRollback({ backups, reloadRuntime, rejectionLabel: "Endpoint copy rejected" });

  return getAdminMockDetail(mocksDir, encodeMockId(relativePath));
}

module.exports = {
  createAdminMock,
  createAdminResponse,
  updateAdminResponse,
  setAdminResponseFile,
  deleteAdminResponse,
  updateAdminEndpoint,
  updateAdminMock,
  resetAdminSequence,
  deleteAdminMock,
  deleteAdminMocksUnlocked,
  copyAdminEndpoint,
};
