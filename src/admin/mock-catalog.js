const fs = require("fs");
const path = require("path");
const {
  createPathMatcher,
  isDynamicPath,
  countStaticSegments,
  sortRouteGroups,
} = require("../mocks/route-groups");
const { createAdminError } = require("./admin-errors");
const { listFiles, resolvePayloadPath } = require("./admin-fs");
const { encodeMockId, resolveAdminFilePath, toPosixRelativePath } = require("./mock-ids");
const {
  isEndpointFileName,
  readEndpointSelectedResponse,
  readEndpointResponseSummaries,
} = require("./endpoint-files");
const {
  attachCollectionId,
  listCollectionSummaries,
  readCollectionsState,
  resolveChildOrder,
  sortAdminItems,
} = require("./collections-state");

// Viste in lettura del catalogo admin: elenco degli endpoint con la response selezionata,
// elenco delle collection, childOrder unificato per il frontend e dettaglio di un endpoint.

function createSummary(mocksDir, filePath, type, summary) {
  const relativePath = toPosixRelativePath(path.relative(mocksDir, filePath));
  return {
    id: encodeMockId(relativePath),
    type,
    configFilePath: relativePath,
    ...summary,
  };
}

function summarizeEndpointResponse(endpoint, response) {
  const payloadType = response.type !== "mock"
    ? "none"
    : response.file != null
      ? "file"
      : typeof response.body === "string"
        ? "text"
        : "json";

  return {
    method: endpoint.method,
    path: endpoint.path,
    status: response.type === "mock" ? response.status : null,
    disabled: endpoint.enabled !== true,
    payloadType,
    bodyFile: undefined,
    file: response.file,
    delayMs: response.type === "mock" ? response.delayMs || 0 : undefined,
    selectedResponseFile: endpoint.selectedResponseFile,
    responseTitle: response.title || "",
    responseCount: endpoint.responseFiles.length,
    // Badge di catalogo: l'endpoint sta servendo una sequenza di varianti (non la selezionata).
    sequenceActive: endpoint.sequence != null && endpoint.sequence.enabled === true,
  };
}

async function readAdminMockItems(mocksDir, loadErrors) {
  const files = await listFiles(mocksDir, isEndpointFileName);
  const items = [];
  for (const filePath of files) {
    // Degradazione per-endpoint, come nel loader runtime: un file rotto (JSON invalido,
    // response mancante...) viene saltato e segnalato, senza spegnere l'intero catalogo.
    try {
      const { endpoint, response } = await readEndpointSelectedResponse(filePath);
      items.push(createSummary(mocksDir, filePath, response.type, summarizeEndpointResponse(endpoint, response)));
    } catch (error) {
      if (loadErrors != null) {
        loadErrors.push({
          configFilePath: toPosixRelativePath(path.relative(mocksDir, filePath)),
          message: error.message,
        });
      }
    }
  }

  return items;
}

async function listAdminMocks(mocksDir, loadErrors) {
  const collectionState = await readCollectionsState(mocksDir);
  const items = (await readAdminMockItems(mocksDir, loadErrors)).map((item) => attachCollectionId(item, collectionState));
  return sortAdminItems(items, collectionState);
}

async function listAdminCollections(mocksDir, existingItems) {
  const items = Array.isArray(existingItems) ? existingItems : await listAdminMocks(mocksDir);
  return listCollectionSummaries(mocksDir, items);
}

// Returns the unified child order per parent, with endpoint refs translated to their admin ids so the
// frontend can interleave endpoints and sub-collections. Keys: "root", "unsorted" or a collection id.
async function listAdminChildOrder(mocksDir, existingItems) {
  const items = Array.isArray(existingItems) ? existingItems : await listAdminMocks(mocksDir);
  const collectionState = await readCollectionsState(mocksDir);
  const resolvedChildOrder = resolveChildOrder(collectionState, items);
  const collectionIds = new Set(collectionState.collections.map((collection) => collection.id));

  const payload = {};
  for (const [parentKey, refs] of Object.entries(resolvedChildOrder)) {
    payload[parentKey] = refs.map((ref) => (collectionIds.has(ref) ? ref : encodeMockId(ref)));
  }
  return payload;
}

async function getAdminMockDetail(mocksDir, id) {
  const filePath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(filePath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }

  const collectionState = await readCollectionsState(mocksDir);
  const { endpoint, response, responseFilePath, responseDir } = await readEndpointSelectedResponse(filePath);
  const summary = attachCollectionId(
    createSummary(mocksDir, filePath, response.type, summarizeEndpointResponse(endpoint, response)),
    collectionState
  );
  const responseSummaries = await readEndpointResponseSummaries(filePath, endpoint);
  const detail = {
    ...summary,
    editable: true,
    definitionFilePath: filePath,
    responseFilePath,
    selectedResponseFile: endpoint.selectedResponseFile,
    responses: responseSummaries,
    endpoint: {
      ...endpoint,
    },
    response: {
      ...response,
      responseFilePath: undefined,
    },
  };

  if (response.type === "mock") {
    detail.config = {
      method: endpoint.method,
      path: endpoint.path,
      status: response.status,
      disabled: endpoint.enabled !== true,
      headers: response.headers == null ? {} : response.headers,
      delayMs: response.delayMs || 0,
      templated: response.templated === true,
    };
    if (response.file != null) {
      const payloadPath = resolvePayloadPath(responseDir, response.file);
      detail.payloadFilePath = payloadPath;
      let stat;
      try {
        stat = await fs.promises.stat(payloadPath);
      } catch (error) {
        // Asset sparito da disco (cancellato a mano): 404 esplicito invece di un 500 grezzo.
        if (error.code === "ENOENT") {
          throw createAdminError(404, "Response asset file not found on disk.");
        }
        throw error;
      }
      detail.fileInfo = {
        name: response.file,
        size: stat.size,
      };
    } else {
      detail.payloadFilePath = responseFilePath;
      detail.body = response.body;
    }
    return detail;
  }

  // Variante SSE: niente sorgente su disco, la definizione È il copione (script/onEnd/...).
  if (response.type === "sse") {
    detail.sse = {
      retryMs: response.retryMs,
      script: response.script,
      onEnd: response.onEnd,
      presets: response.presets,
    };
    detail.payloadFilePath = responseFilePath;
    return detail;
  }

  // Variante WS: come la SSE, la definizione è copione + regole (+ presets della console).
  if (response.type === "ws") {
    detail.ws = {
      script: response.script,
      onEnd: response.onEnd,
      closeCode: response.closeCode,
      closeReason: response.closeReason,
      rules: response.rules,
      presets: response.presets,
    };
    detail.payloadFilePath = responseFilePath;
    return detail;
  }

  const sourcePath = resolvePayloadPath(responseDir, response.sourceFile);
  detail.definition = {
    method: endpoint.method,
    path: endpoint.path,
    disabled: endpoint.enabled !== true,
  };
  try {
    detail.source = await fs.promises.readFile(sourcePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw createAdminError(404, "Response source file not found on disk.");
    }
    throw error;
  }
  detail.sourceFilePath = sourcePath;
  detail.payloadFilePath = sourcePath;
  return detail;
}

/**
 * Risolve una richiesta concreta (metodo + path con eventuale query, es. una entry del
 * monitor) nell'endpoint del catalogo che OGGI la coprirebbe. È un fatto derivato,
 * calcolato al momento e mai persistito: la entry del monitor resta il puro fatto storico.
 *
 * Il matching replica la semantica del serving (stesse primitive di route-groups: esatte
 * prima delle dinamiche, specificità, query dichiarate; la prima rotta che matcha decide
 * e un metodo assente non ripiega su rotte meno specifiche) ma opera sul catalogo COMPLETO,
 * endpoint disabilitati inclusi: il caso d'uso è "portami al mock", non "chi risponderebbe".
 */
async function resolveAdminMockForRequest(mocksDir, method, requestPathWithQuery) {
  const normalizedMethod = String(method || "").toUpperCase();
  const queryStartIndex = requestPathWithQuery.indexOf("?");
  const requestPath = queryStartIndex === -1
    ? requestPathWithQuery
    : requestPathWithQuery.slice(0, queryStartIndex);

  const items = await listAdminMocks(mocksDir);
  const groupsByRoutePath = new Map();
  for (const item of items) {
    let group = groupsByRoutePath.get(item.path);
    if (group == null) {
      group = {
        path: item.path,
        sortKey: item.path,
        dynamic: isDynamicPath(item.path),
        staticSegments: countStaticSegments(item.path),
        matcher: createPathMatcher(item.path, item.configFilePath).fn,
        itemsByMethod: new Map(),
      };
      groupsByRoutePath.set(item.path, group);
    }
    if (!group.itemsByMethod.has(item.method)) {
      group.itemsByMethod.set(item.method, item);
    }
  }

  const orderedGroups = sortRouteGroups([...groupsByRoutePath.values()]);
  for (const group of orderedGroups) {
    if (!group.matcher(requestPath, requestPathWithQuery)) {
      continue;
    }

    return group.itemsByMethod.get(normalizedMethod) ?? null;
  }

  return null;
}

module.exports = {
  listAdminMocks,
  listAdminCollections,
  listAdminChildOrder,
  getAdminMockDetail,
  resolveAdminMockForRequest,
};
