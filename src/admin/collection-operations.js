const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("../utils/fs-atomic");
const { createAdminError } = require("./admin-errors");
const { readBackup, commitWithRollback } = require("./admin-fs");
const { decodeMockId, resolveAdminFilePath, toPosixRelativePath, isInsideDir } = require("./mock-ids");
const { isEndpointFileName, readEndpointConfig } = require("./endpoint-files");
const {
  UNSORTED_COLLECTION_ID,
  ROOT_ORDER_KEY,
  DEFAULT_COLLECTION_LABEL,
  compareCollectionLabels,
  readCollectionOrderKey,
  readCollectionParentId,
  isCollectionInSubtree,
  readCollectionSubtreeIds,
  normalizeCollectionTargetIndex,
  normalizeStoredDefinitionPath,
  normalizeCollectionLabel,
  normalizeRequestedCollectionId,
  syncChildOrderWithCatalog,
  removeRefFromChildOrder,
  insertRefIntoChildOrder,
  buildCollectionId,
  readCollectionsState,
  writeCollectionsState,
  serializedByWorkspace,
  createCollectionSummary,
} = require("./collections-state");
const { listAdminMocks, listAdminCollections, getAdminMockDetail } = require("./mock-catalog");

// Operazioni admin sulle collection: CRUD, riordini, assegnazione degli endpoint e
// abilitazione di massa. Le mutazioni dello stato passano tutte dalle versioni serializzate
// per workspace (vedi collections-state): sono QUESTE a circolare negli export (le
// dichiarazioni `...Unlocked` più sotto sono raggiungibili qui grazie all'hoisting).
const createAdminCollection = serializedByWorkspace(createAdminCollectionUnlocked);
const deleteAdminCollection = serializedByWorkspace(deleteAdminCollectionUnlocked);
const reparentAdminCollection = serializedByWorkspace(reparentAdminCollectionUnlocked);
const reorderAdminCollections = serializedByWorkspace(reorderAdminCollectionsUnlocked);
const assignAdminCollection = serializedByWorkspace(assignAdminCollectionUnlocked);
const reorderAdminCollectionItems = serializedByWorkspace(reorderAdminCollectionItemsUnlocked);
const reorderAdminCollectionChildren = serializedByWorkspace(reorderAdminCollectionChildrenUnlocked);

async function createAdminCollectionUnlocked(mocksDir, payload) {
  const label = normalizeCollectionLabel(payload?.label);
  const isReservedLabel = compareCollectionLabels(label, DEFAULT_COLLECTION_LABEL) === 0;
  if (isReservedLabel) {
    throw createAdminError(409, "Collection label is reserved.");
  }

  const collectionState = await readCollectionsState(mocksDir);
  const parentId = normalizeRequestedCollectionId(payload?.parentId);
  if (parentId === UNSORTED_COLLECTION_ID) {
    throw createAdminError(400, "Collections cannot be nested under Unsorted.");
  }
  if (parentId != null) {
    const parentExists = collectionState.collections.some((collection) => collection.id === parentId);
    if (!parentExists) {
      throw createAdminError(404, "Parent collection not found.");
    }
  }

  const collectionAlreadyExists = collectionState.collections.some(
    (collection) => readCollectionParentId(collection) === parentId
      && compareCollectionLabels(collection.label, label) === 0
  );
  if (collectionAlreadyExists) {
    throw createAdminError(409, "A collection with this label already exists.");
  }

  const usedIds = new Set(collectionState.collections.map((collection) => collection.id));
  const collection = {
    id: buildCollectionId(label, usedIds),
    label,
  };
  if (parentId != null) {
    collection.parentId = parentId;
  }
  collectionState.collections = [...collectionState.collections, collection];
  // New sub-collections land at the top of their parent's children; top-level collections still append at the end.
  const parentKey = parentId == null ? ROOT_ORDER_KEY : parentId;
  const insertionIndex = parentId == null ? undefined : 0;
  insertRefIntoChildOrder(collectionState, collection.id, parentKey, insertionIndex);
  await writeCollectionsState(mocksDir, collectionState);

  return createCollectionSummary(collection, 0);
}

// Deletes a collection subtree and moves all contained definitions back to the virtual Unsorted collection.
async function deleteAdminCollectionUnlocked(mocksDir, id) {
  const normalizedId = normalizeRequestedCollectionId(id);
  if (normalizedId == null || normalizedId === UNSORTED_COLLECTION_ID) {
    throw createAdminError(400, "Only persisted collections can be deleted.");
  }

  const collectionState = await readCollectionsState(mocksDir);
  const target = collectionState.collections.find((collection) => collection.id === normalizedId);
  if (target == null) {
    throw createAdminError(404, "Collection not found.");
  }

  const deletedCollectionIds = readCollectionSubtreeIds(collectionState.collections, normalizedId);
  const movedDefinitionPaths = [];
  const seenMovedDefinitionPaths = new Set();
  const appendMovedDefinitionPath = (definitionPath) => {
    const normalizedPath = normalizeStoredDefinitionPath(definitionPath);
    if (normalizedPath === "" || seenMovedDefinitionPaths.has(normalizedPath)) {
      return;
    }

    seenMovedDefinitionPaths.add(normalizedPath);
    movedDefinitionPaths.push(normalizedPath);
  };

  const knownCollectionIds = new Set(collectionState.collections.map((collection) => collection.id));
  for (const collectionId of deletedCollectionIds) {
    const refs = collectionState.childOrder[collectionId] || [];
    for (const ref of refs) {
      if (!knownCollectionIds.has(ref)) {
        appendMovedDefinitionPath(ref);
      }
    }
  }

  for (const [definitionPath, collectionId] of Object.entries(collectionState.memberships)) {
    if (!deletedCollectionIds.has(collectionId)) {
      continue;
    }

    appendMovedDefinitionPath(definitionPath);
    delete collectionState.memberships[definitionPath];
  }

  const nextChildOrder = {};
  for (const [parentKey, refs] of Object.entries(collectionState.childOrder || {})) {
    if (deletedCollectionIds.has(parentKey)) {
      continue;
    }

    const nextRefs = refs.filter((ref) => !deletedCollectionIds.has(ref) && !seenMovedDefinitionPaths.has(ref));
    if (nextRefs.length > 0) {
      nextChildOrder[parentKey] = nextRefs;
    }
  }

  const unsortedRefs = nextChildOrder[UNSORTED_COLLECTION_ID] || [];
  const seenUnsortedRefs = new Set(unsortedRefs);
  for (const definitionPath of movedDefinitionPaths) {
    if (seenUnsortedRefs.has(definitionPath)) {
      continue;
    }

    seenUnsortedRefs.add(definitionPath);
    unsortedRefs.push(definitionPath);
  }
  if (unsortedRefs.length > 0) {
    nextChildOrder[UNSORTED_COLLECTION_ID] = unsortedRefs;
  }

  collectionState.collections = collectionState.collections.filter(
    (collection) => !deletedCollectionIds.has(collection.id)
  );
  collectionState.childOrder = nextChildOrder;
  await writeCollectionsState(mocksDir, collectionState);
}

// Moves a collection under a new parent (or to the top level) while preventing cycles.
async function reparentAdminCollectionUnlocked(mocksDir, id, payload) {
  const normalizedId = normalizeRequestedCollectionId(id);
  const collectionState = await readCollectionsState(mocksDir);
  const target = collectionState.collections.find((collection) => collection.id === normalizedId);
  if (target == null) {
    throw createAdminError(404, "Collection not found.");
  }

  const nextParentId = normalizeRequestedCollectionId(payload?.parentId);
  if (nextParentId === UNSORTED_COLLECTION_ID) {
    throw createAdminError(400, "Collections cannot be nested under Unsorted.");
  }
  if (nextParentId != null) {
    const parentExists = collectionState.collections.some((collection) => collection.id === nextParentId);
    if (!parentExists) {
      throw createAdminError(404, "Parent collection not found.");
    }

    const wouldCreateCycle = nextParentId === target.id
      || isCollectionInSubtree(collectionState.collections, target.id, nextParentId);
    if (wouldCreateCycle) {
      throw createAdminError(400, "A collection cannot be nested under itself or one of its descendants.");
    }
  }

  const labelConflict = collectionState.collections.some(
    (collection) => collection.id !== target.id
      && readCollectionParentId(collection) === nextParentId
      && compareCollectionLabels(collection.label, target.label) === 0
  );
  if (labelConflict) {
    throw createAdminError(409, "A collection with this label already exists.");
  }

  const targetIndex = normalizeCollectionTargetIndex(payload?.targetIndex);
  const nextParentKey = nextParentId == null ? ROOT_ORDER_KEY : nextParentId;
  if (nextParentId == null) {
    delete target.parentId;
  } else {
    target.parentId = nextParentId;
  }
  removeRefFromChildOrder(collectionState, target.id);
  insertRefIntoChildOrder(collectionState, target.id, nextParentKey, targetIndex);

  await writeCollectionsState(mocksDir, collectionState);
  return listAdminCollections(mocksDir);
}

// Persists a manual order for the custom collections returned by the admin catalog.
async function reorderAdminCollectionsUnlocked(mocksDir, payload) {
  const collectionState = await readCollectionsState(mocksDir);
  const collectionIds = Array.isArray(payload?.collectionIds) ? payload.collectionIds : undefined;
  if (collectionIds == null) {
    throw createAdminError(400, "collectionIds must be an array.");
  }

  const parentId = normalizeRequestedCollectionId(payload?.parentId);
  if (parentId != null && parentId !== UNSORTED_COLLECTION_ID) {
    const parentExists = collectionState.collections.some((collection) => collection.id === parentId);
    if (!parentExists) {
      throw createAdminError(404, "Parent collection not found.");
    }
  }
  const scopeParentId = parentId === UNSORTED_COLLECTION_ID ? undefined : parentId;

  const normalizedIds = collectionIds.map((collectionId) => {
    const normalizedCollectionId = normalizeRequestedCollectionId(collectionId);
    if (normalizedCollectionId == null || normalizedCollectionId === UNSORTED_COLLECTION_ID) {
      throw createAdminError(400, "collectionIds must contain persisted collection ids only.");
    }

    return normalizedCollectionId;
  });
  const uniqueIds = new Set(normalizedIds);
  const siblingIds = collectionState.collections
    .filter((collection) => readCollectionParentId(collection) === scopeParentId)
    .map((collection) => collection.id);
  const hasExactCoverage = normalizedIds.length === siblingIds.length
    && uniqueIds.size === normalizedIds.length
    && siblingIds.every((collectionId) => uniqueIds.has(collectionId));
  if (!hasExactCoverage) {
    throw createAdminError(400, "collectionIds must include each sibling collection exactly once.");
  }

  const parentKey = scopeParentId == null ? ROOT_ORDER_KEY : scopeParentId;
  const requestedQueue = [...normalizedIds];
  const reorderedRefs = (collectionState.childOrder[parentKey] || []).map(
    (ref) => (uniqueIds.has(ref) ? requestedQueue.shift() : ref)
  );
  for (const remainingId of requestedQueue) {
    reorderedRefs.push(remainingId);
  }
  collectionState.childOrder[parentKey] = reorderedRefs;
  await writeCollectionsState(mocksDir, collectionState);
  return listAdminCollections(mocksDir);
}

async function assignAdminCollectionUnlocked(mocksDir, id, payload) {
  const filePath = resolveAdminFilePath(mocksDir, id);
  if (!fs.existsSync(filePath)) {
    throw createAdminError(404, "Endpoint definition not found.");
  }

  const collectionId = normalizeRequestedCollectionId(payload?.collectionId);
  const collectionState = await readCollectionsState(mocksDir);
  const collectionExists = collectionId == null
    || collectionState.collections.some((collection) => collection.id === collectionId);
  if (!collectionExists) {
    throw createAdminError(404, "Collection not found.");
  }

  const targetIndex = normalizeCollectionTargetIndex(payload?.targetIndex);
  const currentItems = await listAdminMocks(mocksDir);
  syncChildOrderWithCatalog(collectionState, currentItems);

  const relativePath = toPosixRelativePath(path.relative(mocksDir, filePath));
  if (collectionId == null) {
    delete collectionState.memberships[relativePath];
  } else {
    collectionState.memberships[relativePath] = collectionId;
  }

  removeRefFromChildOrder(collectionState, relativePath);
  insertRefIntoChildOrder(collectionState, relativePath, readCollectionOrderKey(collectionId), targetIndex);

  await writeCollectionsState(mocksDir, collectionState);
  return getAdminMockDetail(mocksDir, id);
}

function normalizeRequestedEndpointIds(itemIds) {
  if (!Array.isArray(itemIds)) {
    throw createAdminError(400, "itemIds must be an array.");
  }

  const normalizedPaths = [];
  const seenPaths = new Set();
  for (const itemId of itemIds) {
    if (typeof itemId !== "string" || itemId.trim() === "") {
      throw createAdminError(400, "itemIds must contain valid endpoint ids.");
    }

    const relativePath = normalizeStoredDefinitionPath(decodeMockId(itemId));
    const hasEndpointSuffix = relativePath !== "" && isEndpointFileName(path.basename(relativePath));
    if (!hasEndpointSuffix || seenPaths.has(relativePath)) {
      throw createAdminError(400, "itemIds must contain valid endpoint ids.");
    }

    seenPaths.add(relativePath);
    normalizedPaths.push(relativePath);
  }

  return normalizedPaths;
}

async function reorderAdminCollectionItemsUnlocked(mocksDir, collectionId, payload) {
  const normalizedCollectionId = normalizeRequestedCollectionId(collectionId);
  const targetCollectionId = normalizedCollectionId === UNSORTED_COLLECTION_ID
    ? undefined
    : normalizedCollectionId;
  const collectionState = await readCollectionsState(mocksDir);
  const collectionExists = targetCollectionId == null
    || collectionState.collections.some((collection) => collection.id === targetCollectionId);
  if (!collectionExists) {
    throw createAdminError(404, "Collection not found.");
  }

  const requestedDefinitionPaths = normalizeRequestedEndpointIds(payload?.itemIds);
  const currentItems = await listAdminMocks(mocksDir);
  const collectionOrderKey = readCollectionOrderKey(targetCollectionId);
  const currentCollectionDefinitionPaths = currentItems
    .filter((item) => readCollectionOrderKey(item.collectionId) === collectionOrderKey)
    .map((item) => item.configFilePath);
  const currentDefinitions = new Set(currentCollectionDefinitionPaths);
  const hasExactCoverage = requestedDefinitionPaths.length === currentCollectionDefinitionPaths.length
    && requestedDefinitionPaths.every((definitionPath) => currentDefinitions.has(definitionPath));
  if (!hasExactCoverage) {
    throw createAdminError(400, "itemIds must include each endpoint in the target collection exactly once.");
  }

  syncChildOrderWithCatalog(collectionState, currentItems);
  const requestedQueue = [...requestedDefinitionPaths];
  const reorderedRefs = (collectionState.childOrder[collectionOrderKey] || []).map(
    (ref) => (currentDefinitions.has(ref) ? requestedQueue.shift() : ref)
  );
  for (const remainingPath of requestedQueue) {
    reorderedRefs.push(remainingPath);
  }
  collectionState.childOrder[collectionOrderKey] = reorderedRefs;
  await writeCollectionsState(mocksDir, collectionState);
  return listAdminMocks(mocksDir);
}

// Sets the unified order of a parent's children (endpoints + sub-collections) — the interleaving DnD.
// parentKey is "root", "unsorted" or a collection id; childRefs are endpoint ids and/or collection ids.
async function reorderAdminCollectionChildrenUnlocked(mocksDir, parentKey, payload) {
  const collectionState = await readCollectionsState(mocksDir);
  const collectionIds = new Set(collectionState.collections.map((collection) => collection.id));

  const normalizedParentKey = typeof parentKey === "string" ? parentKey.trim() : "";
  const isValidParentKey = normalizedParentKey === ROOT_ORDER_KEY
    || normalizedParentKey === UNSORTED_COLLECTION_ID
    || collectionIds.has(normalizedParentKey);
  if (!isValidParentKey) {
    throw createAdminError(404, "Parent collection not found.");
  }

  const rawChildRefs = Array.isArray(payload?.childRefs) ? payload.childRefs : undefined;
  if (rawChildRefs == null) {
    throw createAdminError(400, "childRefs must be an array.");
  }

  const requestedRefs = [];
  const seenRefs = new Set();
  for (const rawRef of rawChildRefs) {
    if (typeof rawRef !== "string" || rawRef.trim() === "") {
      throw createAdminError(400, "childRefs must contain valid child ids.");
    }

    let ref;
    if (collectionIds.has(rawRef)) {
      ref = rawRef;
    } else {
      ref = normalizeStoredDefinitionPath(decodeMockId(rawRef));
      if (ref === "" || !isEndpointFileName(path.basename(ref))) {
        throw createAdminError(400, "childRefs must contain valid child ids.");
      }
    }

    if (seenRefs.has(ref)) {
      throw createAdminError(400, "childRefs must include each child exactly once.");
    }
    seenRefs.add(ref);
    requestedRefs.push(ref);
  }

  const currentItems = await listAdminMocks(mocksDir);
  syncChildOrderWithCatalog(collectionState, currentItems);
  const currentRefs = collectionState.childOrder[normalizedParentKey] || [];
  const currentRefSet = new Set(currentRefs);
  const hasExactCoverage = requestedRefs.length === currentRefs.length
    && requestedRefs.every((ref) => currentRefSet.has(ref));
  if (!hasExactCoverage) {
    throw createAdminError(400, "childRefs must include each child of the parent exactly once.");
  }

  collectionState.childOrder[normalizedParentKey] = requestedRefs;
  await writeCollectionsState(mocksDir, collectionState);
  return listAdminMocks(mocksDir);
}

function normalizeCollectionEnabledPayload(payload) {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    throw createAdminError(400, "Collection enabled payload must be an object.");
  }

  const unsupportedFields = Object.keys(payload).filter((fieldName) => fieldName !== "enabled");
  if (unsupportedFields.length > 0) {
    throw createAdminError(400, "Only enabled can be updated for a collection.");
  }

  if (typeof payload.enabled !== "boolean") {
    throw createAdminError(400, "enabled must be a boolean.");
  }

  return payload.enabled;
}

async function updateAdminCollectionEnabled(mocksDir, collectionId, payload, reloadRuntime) {
  const targetCollectionId = normalizeRequestedCollectionId(collectionId);
  if (targetCollectionId == null || targetCollectionId === UNSORTED_COLLECTION_ID) {
    throw createAdminError(400, "Only persisted collections can be mass-updated.");
  }

  const enabled = normalizeCollectionEnabledPayload(payload);
  const collectionState = await readCollectionsState(mocksDir);
  const target = collectionState.collections.find((collection) => collection.id === targetCollectionId);
  if (target == null) {
    throw createAdminError(404, "Collection not found.");
  }

  const subtreeIds = readCollectionSubtreeIds(collectionState.collections, targetCollectionId);
  const currentItems = await listAdminMocks(mocksDir);
  const targetItems = currentItems.filter((item) => item.collectionId != null && subtreeIds.has(item.collectionId));
  const endpointPaths = targetItems.map((item) => {
    const endpointPath = path.resolve(mocksDir, item.configFilePath);
    if (!isInsideDir(mocksDir, endpointPath)) {
      throw createAdminError(400, "Collection endpoint path is invalid.");
    }
    return endpointPath;
  });
  const backups = await Promise.all(endpointPaths.map((endpointPath) => readBackup(endpointPath)));

  await commitWithRollback({
    backups,
    reloadRuntime,
    rejectionLabel: "Collection endpoint update rejected",
    commit: async () => {
      for (const endpointPath of endpointPaths) {
        const endpoint = await readEndpointConfig(endpointPath);
        if (endpoint.enabled === enabled) {
          continue;
        }

        await writeFileAtomic(endpointPath, `${JSON.stringify({ ...endpoint, enabled }, null, 2)}\n`, "utf8");
      }
    },
  });

  return listAdminMocks(mocksDir);
}

module.exports = {
  createAdminCollection,
  deleteAdminCollection,
  reparentAdminCollection,
  reorderAdminCollections,
  assignAdminCollection,
  reorderAdminCollectionItems,
  reorderAdminCollectionChildren,
  updateAdminCollectionEnabled,
};
