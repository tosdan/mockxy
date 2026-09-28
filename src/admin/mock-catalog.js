const fs = require("fs");
const path = require("path");
const {
  createPathMatcher,
  isDynamicPath,
  countStaticSegments,
  sortRouteGroups,
} = require("../mocks/route-groups");
const { createAdminError, isMissingFileError, markMissingFile } = require("./admin-errors");
const { listFiles, resolvePayloadPath } = require("./admin-fs");
const { encodeMockId, resolveAdminFilePath, toPosixRelativePath } = require("./mock-ids");
const {
  isEndpointFileName,
  persistedDefinitionOf,
  readEndpointConfig,
  readEndpointResponseByName,
  readEndpointSelectedResponse,
  readEndpointResponseSummaries,
} = require("./endpoint-files");
const { descriptionRevision, digestBytes, digestFile, responseRevision } = require("./revision-tokens");
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
    // La selezione è l'unico interruttore della sequence; `disabled` resta un'informazione
    // ortogonale già esposta dal catalogo.
    sequenceActive: response.type === "sequence",
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

// Dettaglio di un endpoint. Le GET non entrano nella coda delle mutazioni e non hanno uno
// snapshot atomico fra più file: se durante la costruzione manca un file, l'endpoint può essere
// cambiato mentre lo leggevamo (piano agent/API, §13 C4). Si ricostruisce allora l'intero
// dettaglio una sola volta, rileggendo la definizione e seguendone la selezione; un endpoint
// eliminato nel frattempo è un 404. Se manca ancora un file, la lettura è dichiarata incoerente
// e ripetibile, senza dettaglio parziale. Gli altri errori restano quello che sono.
async function getAdminMockDetail(mocksDir, id) {
  const filePath = resolveAdminFilePath(mocksDir, id);
  return readWithBoundedRetry(filePath, () => buildAdminMockDetail(mocksDir, filePath));
}

// Lettura incompleta, procedura limitata (§13 C4): un file mancante fa ricostruire tutto una sola
// volta, rileggendo la definizione; un endpoint eliminato nel frattempo è un 404, un file ancora
// mancante un 409 ripetibile. Gli altri errori restano quello che sono.
async function readWithBoundedRetry(endpointPath, build) {
  try {
    return await build();
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
  try {
    return await build();
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
    if (!fs.existsSync(endpointPath)) {
      throw createAdminError(404, "Endpoint definition not found.");
    }
    throw createAdminError(409, `The endpoint could not be read consistently: ${error.message}`, {
      code: "READ_INCONSISTENT",
      retryable: true,
    });
  }
}

/**
 * Una variante per filename, attiva o no (piano agent/API, §13 C3): definizione normalizzata,
 * sorgente diretto per handler e middleware, metadati dell'asset per un mock servito da file (mai
 * il contenuto binario). `active` dice se la variante appartiene alla selezione o ai suoi step,
 * indipendentemente dai flag del server. Leggerla non cambia selezione né scenario. Una variante
 * non più elencata dall'endpoint è un 404 anche se il file esiste ancora.
 */
async function getAdminMockResponse(mocksDir, id, responseFileName) {
  const endpointPath = resolveAdminFilePath(mocksDir, id);
  return readWithBoundedRetry(endpointPath, () => buildAdminMockResponse(mocksDir, endpointPath, id, responseFileName));
}

async function buildAdminMockResponse(mocksDir, endpointPath, id, responseFileName) {
  if (!fs.existsSync(endpointPath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }
  const { endpoint, response, responseFileName: name, responseDir } = await readEndpointResponseByName(endpointPath, responseFileName);
  const selected = name === endpoint.selectedResponseFile;

  let sourceBytes = null;
  if (response.type === "handler" || response.type === "middleware") {
    try {
      sourceBytes = await fs.promises.readFile(resolvePayloadPath(responseDir, response.sourceFile));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw markMissingFile(createAdminError(404, "Response source file not found on disk."));
      }
      throw error;
    }
  }

  let fileInfo = null;
  let assetDigest = null;
  if (response.type === "mock" && response.file != null) {
    // Dimensione e impronta dalla stessa lettura (§13 C4).
    const asset = await digestFile(resolvePayloadPath(responseDir, response.file), "Response asset file not found on disk.");
    fileInfo = { name: response.file, size: asset.size };
    assetDigest = asset.sha256;
  }

  return {
    id,
    responseFile: name,
    selected,
    active: selected || await isStepOfSelectedSequence(endpointPath, name),
    response: { ...response, responseFilePath: undefined },
    source: sourceBytes == null ? null : sourceBytes.toString("utf8"),
    fileInfo,
    // Stessa acquisizione dei dati restituiti (§13 C4).
    revision: responseRevisionOf({ mocksDir, endpointId: endpointIdOf(mocksDir, endpointPath), responseFile: name, response, sourceBytes, assetDigest }),
  };
}

// Una variante non selezionata è attiva se la selezionata è una sequence che la usa come step.
// Una selezionata illeggibile non permette di dirlo: il suo errore resta esplicito (400), e un
// file mancante segue la procedura C4. Rispondere `active: false` sarebbe un'indicazione falsa,
// perché il runtime può ancora servire la sequence caricata in precedenza.
async function isStepOfSelectedSequence(endpointPath, responseFileName) {
  const selected = (await readEndpointSelectedResponse(endpointPath)).response;
  return selected.type === "sequence"
    && (selected.steps || []).some((step) => step?.response === responseFileName);
}

async function buildAdminMockDetail(mocksDir, filePath) {
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
  // Byte del sorgente e impronta dell'asset letti qui sotto: i token di revisione (§13 C4) li
  // coprono dalla stessa acquisizione dei dati restituiti, senza rileggere i file.
  let sourceBytes = null;
  let assetDigest = null;

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
      // Dimensione e impronta dalla stessa lettura. Un asset sparito da disco (cancellato a mano)
      // è un file mancante, non un 500 grezzo.
      const asset = await digestFile(payloadPath, "Response asset file not found on disk.");
      detail.fileInfo = {
        name: response.file,
        size: asset.size,
      };
      assetDigest = asset.sha256;
    } else {
      detail.payloadFilePath = responseFilePath;
      detail.body = response.body;
    }
  } else if (response.type === "sse") {
    // Variante SSE: niente sorgente su disco, la definizione È il copione (script/onEnd/...).
    detail.sse = {
      retryMs: response.retryMs,
      script: response.script,
      onEnd: response.onEnd,
      presets: response.presets,
    };
    detail.payloadFilePath = responseFilePath;
  } else if (response.type === "ws") {
    // Variante WS: come la SSE, la definizione è copione + regole (+ presets della console).
    detail.ws = {
      script: response.script,
      onEnd: response.onEnd,
      closeCode: response.closeCode,
      closeReason: response.closeReason,
      rules: response.rules,
      presets: response.presets,
    };
    detail.payloadFilePath = responseFilePath;
  } else if (response.type === "sequence") {
    // Variante sequence: la definizione vive nel file response selezionato, come SSE/WS.
    detail.sequence = {
      steps: response.steps,
      onEnd: response.onEnd,
      resetAfterMs: response.resetAfterMs,
    };
    detail.payloadFilePath = responseFilePath;
  } else {
    const sourcePath = resolvePayloadPath(responseDir, response.sourceFile);
    detail.definition = {
      method: endpoint.method,
      path: endpoint.path,
      disabled: endpoint.enabled !== true,
    };
    try {
      sourceBytes = await fs.promises.readFile(sourcePath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw markMissingFile(createAdminError(404, "Response source file not found on disk."));
      }
      throw error;
    }
    detail.source = sourceBytes.toString("utf8");
    detail.sourceFilePath = sourcePath;
    detail.payloadFilePath = sourcePath;
  }

  const endpointId = summary.id;
  detail.descriptionRevision = descriptionRevision({ mocksDir, endpointId, description: endpoint.description });
  detail.responseRevision = responseRevisionOf({
    mocksDir,
    endpointId,
    responseFile: endpoint.selectedResponseFile,
    response,
    sourceBytes,
    assetDigest,
  });
  return detail;
}

// Token della variante dai dati di un'unica acquisizione: definizione persistita letta insieme
// alla forma normalizzata, byte del sorgente e impronta dell'asset già letti dal chiamante.
function responseRevisionOf({ mocksDir, endpointId, responseFile, response, sourceBytes, assetDigest }) {
  const hasSource = response.type === "handler" || response.type === "middleware";
  const hasAsset = response.type === "mock" && response.file != null;
  return responseRevision({
    mocksDir,
    endpointId,
    responseFile,
    definition: persistedDefinitionOf(response),
    source: hasSource ? { name: response.sourceFile, sha256: digestBytes(sourceBytes) } : null,
    asset: hasAsset ? { name: response.file, sha256: assetDigest } : null,
  });
}

// Revisioni correnti per il controllo delle precondizioni: dentro la coda delle mutazioni si
// rileggono i contenuti effettivi, senza fidarsi di cache di mtime o dimensione (§13 C4).
async function currentDescriptionRevision(mocksDir, endpointPath) {
  const endpoint = await readEndpointConfig(endpointPath);
  return descriptionRevision({ mocksDir, endpointId: endpointIdOf(mocksDir, endpointPath), description: endpoint.description });
}

async function currentResponseRevision(mocksDir, endpointPath, responseFileName) {
  const { response, responseFileName: name, responseDir } = await readEndpointResponseByName(endpointPath, responseFileName);
  let sourceBytes = null;
  let assetDigest = null;
  if (response.type === "handler" || response.type === "middleware") {
    try {
      sourceBytes = await fs.promises.readFile(resolvePayloadPath(responseDir, response.sourceFile));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw markMissingFile(createAdminError(404, "Response source file not found on disk."));
      }
      throw error;
    }
  }
  if (response.type === "mock" && response.file != null) {
    assetDigest = (await digestFile(resolvePayloadPath(responseDir, response.file), "Response asset file not found on disk.")).sha256;
  }
  return responseRevisionOf({ mocksDir, endpointId: endpointIdOf(mocksDir, endpointPath), responseFile: name, response, sourceBytes, assetDigest });
}

function endpointIdOf(mocksDir, endpointPath) {
  return encodeMockId(toPosixRelativePath(path.relative(mocksDir, endpointPath)));
}

// Il dettaglio come CORPO della risposta di una mutazione già scritta su disco e già oltre la
// finestra di rollback. Comporlo può fallire per ragioni che non c'entrano con la mutazione
// (variante selezionata illeggibile, asset o sorgente spariti a mano): a quel punto l'operazione
// è riuscita per definizione, e riportarla come errore lascerebbe il client convinto del
// contrario, con lo stato a schermo ormai stantio. Lo status resta di successo, e il corpo dice
// perché il dettaglio non c'è; sta al client rileggerlo quando l'endpoint torna leggibile.
async function getAdminMockDetailAfterCommit(mocksDir, id) {
  try {
    return await getAdminMockDetail(mocksDir, id);
  } catch (error) {
    return { id, detailUnavailable: { message: error.message } };
  }
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
  getAdminMockDetailAfterCommit,
  getAdminMockResponse,
  currentDescriptionRevision,
  currentResponseRevision,
  endpointIdOf,
  resolveAdminMockForRequest,
};
