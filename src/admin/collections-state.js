const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("../utils/fs-atomic");
const { createAdminError } = require("./admin-errors");
const { readJsonFile } = require("./admin-fs");

// Modello dello stato delle collection persistito in .collections.json: normalizzazione,
// letture/scritture serializzate per workspace, ordinamento del catalogo (childOrder) e
// migrazione del formato legacy. Le OPERAZIONI admin sulle collection vivono in
// collection-operations.js; qui c'è solo il modello dei dati e le sue invarianti.

const COLLECTIONS_METADATA_FILE = ".collections.json";
const UNSORTED_COLLECTION_ID = "unsorted";
// Parent key, in childOrder, that holds the ordered ids of the top-level collections.
const ROOT_ORDER_KEY = "root";
const DEFAULT_COLLECTION_LABEL = "Unsorted";

function compareCollectionLabels(leftLabel, rightLabel) {
  return leftLabel.localeCompare(rightLabel, "it", { sensitivity: "base" });
}

function createEmptyCollectionState() {
  return {
    collections: [],
    memberships: {},
    childOrder: {},
  };
}

// Maps a persisted or virtual collection identifier to the bucket key an ENDPOINT lives under.
function readCollectionOrderKey(collectionId) {
  return collectionId == null ? UNSORTED_COLLECTION_ID : collectionId;
}

// Maps a collection to the childOrder key of the parent that CONTAINS it (top-level → ROOT_ORDER_KEY).
function readCollectionOrderParentKey(collection) {
  const parentId = readCollectionParentId(collection);
  return parentId == null ? ROOT_ORDER_KEY : parentId;
}

// Normalizes the parent reference of a persisted collection (top-level collections have none).
function readCollectionParentId(collection) {
  return collection?.parentId == null ? undefined : collection.parentId;
}

// Resolves a stored parentId to a valid ancestor, dropping references that are missing or cyclic.
function resolveCollectionParentId(collectionId, rawParentIds, collectionIds) {
  const parentId = rawParentIds.get(collectionId);
  const isUnusableParent = parentId == null
    || parentId === ""
    || parentId === UNSORTED_COLLECTION_ID
    || !collectionIds.has(parentId);
  if (isUnusableParent) {
    return undefined;
  }

  const visited = new Set([collectionId]);
  let currentId = parentId;
  while (currentId != null) {
    if (visited.has(currentId)) {
      return undefined;
    }

    visited.add(currentId);
    currentId = rawParentIds.get(currentId);
  }

  return parentId;
}

// Returns true when candidateId equals ancestorId or lives anywhere inside its subtree.
function isCollectionInSubtree(collections, ancestorId, candidateId) {
  const parentById = new Map(
    collections.map((collection) => [collection.id, readCollectionParentId(collection)])
  );
  const visited = new Set();
  let currentId = candidateId;
  while (currentId != null) {
    if (currentId === ancestorId) {
      return true;
    }
    if (visited.has(currentId)) {
      return false;
    }

    visited.add(currentId);
    currentId = parentById.get(currentId);
  }

  return false;
}

function readCollectionSubtreeIds(collections, rootId) {
  const subtreeIds = new Set([rootId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const collection of collections) {
      const parentId = readCollectionParentId(collection);
      if (!subtreeIds.has(collection.id) && subtreeIds.has(parentId)) {
        subtreeIds.add(collection.id);
        changed = true;
      }
    }
  }

  return subtreeIds;
}

// Validates an optional sibling insertion index used when reparenting or reordering collections.
function normalizeCollectionTargetIndex(targetIndex) {
  if (targetIndex == null) {
    return undefined;
  }
  if (typeof targetIndex !== "number" || !Number.isInteger(targetIndex) || targetIndex < 0) {
    throw createAdminError(400, "targetIndex must be a non-negative integer.");
  }

  return targetIndex;
}

function getCollectionsMetadataFilePath(mocksDir) {
  return path.join(mocksDir, COLLECTIONS_METADATA_FILE);
}

function normalizeStoredDefinitionPath(relativePath) {
  if (typeof relativePath !== "string") {
    return "";
  }

  const normalizedPath = relativePath.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalizedPath.split("/").filter((segment) => segment !== "");
  const hasUnsafeSegments = normalizedPath === ""
    || normalizedPath.startsWith("/")
    || segments.length === 0
    || segments.some((segment) => segment === "." || segment === "..");
  if (hasUnsafeSegments) {
    return "";
  }

  return segments.join("/");
}

function normalizeCollectionLabel(label) {
  if (typeof label !== "string") {
    throw createAdminError(400, "label is required.");
  }

  const normalizedLabel = label.trim().replace(/\s+/g, " ");
  if (normalizedLabel === "") {
    throw createAdminError(400, "label is required.");
  }

  return normalizedLabel;
}

function normalizeRequestedCollectionId(collectionId) {
  if (collectionId == null) {
    return undefined;
  }

  if (typeof collectionId !== "string") {
    throw createAdminError(400, "collectionId must be a string.");
  }

  const normalizedCollectionId = collectionId.trim();
  if (normalizedCollectionId === "") {
    return undefined;
  }

  return normalizedCollectionId;
}

// Validates and normalizes the persisted custom order for items inside each collection bucket.
function normalizeCollectionItemOrder(rawItemOrder, collectionIds, memberships) {
  const rawOrder = rawItemOrder == null ? {} : rawItemOrder;
  if (rawOrder == null || typeof rawOrder !== "object" || Array.isArray(rawOrder)) {
    throw createAdminError(400, "Invalid collection metadata file.");
  }

  const allowedCollectionIds = new Set([...collectionIds, UNSORTED_COLLECTION_ID]);
  const itemOrder = {};
  for (const [collectionId, rawDefinitionPaths] of Object.entries(rawOrder)) {
    if (!allowedCollectionIds.has(collectionId)) {
      continue;
    }

    if (!Array.isArray(rawDefinitionPaths)) {
      throw createAdminError(400, "Invalid collection metadata file.");
    }

    const orderedPaths = [];
    const seenPaths = new Set();
    for (const rawDefinitionPath of rawDefinitionPaths) {
      const normalizedPath = normalizeStoredDefinitionPath(rawDefinitionPath);
      if (normalizedPath === "" || seenPaths.has(normalizedPath)) {
        continue;
      }

      const assignedCollectionId = memberships[normalizedPath];
      const belongsToCollection = collectionId === UNSORTED_COLLECTION_ID
        ? assignedCollectionId == null
        : assignedCollectionId === collectionId;
      if (!belongsToCollection) {
        continue;
      }

      seenPaths.add(normalizedPath);
      orderedPaths.push(normalizedPath);
    }

    if (orderedPaths.length > 0) {
      itemOrder[collectionId] = orderedPaths;
    }
  }

  return itemOrder;
}

// Validates the persisted unified child order, dropping unknown parent keys and refs that don't belong.
function normalizeChildOrder(rawChildOrder, collectionIds, memberships, collections) {
  const rawOrder = rawChildOrder == null ? {} : rawChildOrder;
  if (typeof rawOrder !== "object" || Array.isArray(rawOrder)) {
    throw createAdminError(400, "Invalid collection metadata file.");
  }

  const parentKeyByCollectionId = new Map(
    collections.map((collection) => [collection.id, readCollectionOrderParentKey(collection)])
  );
  const allowedParentKeys = new Set([ROOT_ORDER_KEY, UNSORTED_COLLECTION_ID, ...collectionIds]);
  const childOrder = {};
  for (const [parentKey, rawRefs] of Object.entries(rawOrder)) {
    if (!allowedParentKeys.has(parentKey)) {
      continue;
    }
    if (!Array.isArray(rawRefs)) {
      throw createAdminError(400, "Invalid collection metadata file.");
    }

    const orderedRefs = [];
    const seen = new Set();
    for (const rawRef of rawRefs) {
      if (typeof rawRef !== "string") {
        continue;
      }

      if (collectionIds.has(rawRef)) {
        const belongsHere = parentKeyByCollectionId.get(rawRef) === parentKey;
        if (!belongsHere || seen.has(rawRef)) {
          continue;
        }

        seen.add(rawRef);
        orderedRefs.push(rawRef);
        continue;
      }

      const normalizedPath = normalizeStoredDefinitionPath(rawRef);
      const belongsHere = normalizedPath !== "" && readCollectionOrderKey(memberships[normalizedPath]) === parentKey;
      if (!belongsHere || seen.has(normalizedPath)) {
        continue;
      }

      seen.add(normalizedPath);
      orderedRefs.push(normalizedPath);
    }

    if (orderedRefs.length > 0) {
      childOrder[parentKey] = orderedRefs;
    }
  }

  return childOrder;
}

// Migrates the legacy ordering (per-collection itemOrder + collections array position) into childOrder.
// Per parent: endpoints first (legacy itemOrder), then sub-collections in array order; root holds top-level ids.
function deriveLegacyChildOrder(rawItemOrder, collections, memberships) {
  const collectionIds = new Set(collections.map((collection) => collection.id));
  const legacyItemOrder = normalizeCollectionItemOrder(rawItemOrder, collectionIds, memberships);

  const childCollectionIdsByParentKey = new Map();
  for (const collection of collections) {
    const parentKey = readCollectionOrderParentKey(collection);
    const bucket = childCollectionIdsByParentKey.get(parentKey) || [];
    bucket.push(collection.id);
    childCollectionIdsByParentKey.set(parentKey, bucket);
  }

  const childOrder = {};
  const parentKeys = new Set([...Object.keys(legacyItemOrder), ...childCollectionIdsByParentKey.keys()]);
  for (const parentKey of parentKeys) {
    const endpoints = legacyItemOrder[parentKey] || [];
    const childCollections = childCollectionIdsByParentKey.get(parentKey) || [];
    const merged = [...endpoints, ...childCollections];
    if (merged.length > 0) {
      childOrder[parentKey] = merged;
    }
  }

  return childOrder;
}

// Applies the canonical fallback ordering used when no custom catalog order is stored yet.
// Locale pinnato come in compareCollectionLabels: senza, l'ordinamento dipenderebbe dal
// locale ICU della macchina (es. il collator ceco ordina il digramma "ch" dopo "h").
function compareAdminItemsCanonically(leftItem, rightItem) {
  const pathCompare = String(leftItem.path).localeCompare(String(rightItem.path), "it");
  if (pathCompare !== 0) {
    return pathCompare;
  }

  const methodCompare = String(leftItem.method).localeCompare(String(rightItem.method), "it");
  if (methodCompare !== 0) {
    return methodCompare;
  }

  return String(leftItem.configFilePath).localeCompare(String(rightItem.configFilePath), "it");
}

// Sorts catalog items by persisted collection order and persisted per-collection item order.
function sortAdminItems(items, collectionState) {
  const collectionOrderById = new Map([[UNSORTED_COLLECTION_ID, 0]]);
  collectionState.collections.forEach((collection, index) => {
    collectionOrderById.set(collection.id, index + 1);
  });

  const resolvedChildOrder = resolveChildOrder(collectionState, items);
  const itemIndexByBucketKey = new Map(
    Object.entries(resolvedChildOrder).map(([parentKey, refs]) => [
      parentKey,
      new Map(refs.map((ref, index) => [ref, index])),
    ])
  );

  return [...items].sort((leftItem, rightItem) => {
    const leftCollectionKey = readCollectionOrderKey(leftItem.collectionId);
    const rightCollectionKey = readCollectionOrderKey(rightItem.collectionId);
    const leftCollectionIndex = collectionOrderById.get(leftCollectionKey) ?? Number.MAX_SAFE_INTEGER;
    const rightCollectionIndex = collectionOrderById.get(rightCollectionKey) ?? Number.MAX_SAFE_INTEGER;
    if (leftCollectionIndex !== rightCollectionIndex) {
      return leftCollectionIndex - rightCollectionIndex;
    }

    const indexByRef = itemIndexByBucketKey.get(leftCollectionKey);
    const leftItemIndex = indexByRef?.get(leftItem.configFilePath);
    const rightItemIndex = indexByRef?.get(rightItem.configFilePath);
    const leftHasStoredIndex = leftItemIndex != null;
    const rightHasStoredIndex = rightItemIndex != null;
    if (leftHasStoredIndex && rightHasStoredIndex && leftItemIndex !== rightItemIndex) {
      return leftItemIndex - rightItemIndex;
    }
    if (leftHasStoredIndex !== rightHasStoredIndex) {
      return leftHasStoredIndex ? -1 : 1;
    }

    return compareAdminItemsCanonically(leftItem, rightItem);
  });
}

// Builds the complete, pruned child order for every parent: keeps the stored order for refs that still
// exist, appends newly-seen refs (endpoints first, then sub-collections) and drops vanished refs/buckets.
// `items` carry their collectionId; refs are endpoint paths (members) or sub-collection ids.
function resolveChildOrder(collectionState, items) {
  const collections = collectionState.collections;
  const storedChildOrder = collectionState.childOrder || {};

  const desiredByParentKey = new Map();
  const ensureBucket = (parentKey) => {
    let bucket = desiredByParentKey.get(parentKey);
    if (bucket == null) {
      bucket = [];
      desiredByParentKey.set(parentKey, bucket);
    }
    return bucket;
  };
  for (const item of items) {
    const normalizedPath = normalizeStoredDefinitionPath(item.configFilePath);
    if (normalizedPath === "") {
      continue;
    }
    ensureBucket(readCollectionOrderKey(item.collectionId)).push(normalizedPath);
  }
  for (const collection of collections) {
    ensureBucket(readCollectionOrderParentKey(collection)).push(collection.id);
  }

  const resolved = {};
  for (const [parentKey, desiredRefs] of desiredByParentKey.entries()) {
    const desiredSet = new Set(desiredRefs);
    const seen = new Set();
    const orderedRefs = [];
    for (const ref of storedChildOrder[parentKey] || []) {
      if (desiredSet.has(ref) && !seen.has(ref)) {
        seen.add(ref);
        orderedRefs.push(ref);
      }
    }
    for (const ref of desiredRefs) {
      if (!seen.has(ref)) {
        seen.add(ref);
        orderedRefs.push(ref);
      }
    }
    resolved[parentKey] = orderedRefs;
  }

  return resolved;
}

// Persists the resolved (complete + pruned) child order back into the collection state before writing.
function syncChildOrderWithCatalog(collectionState, items) {
  collectionState.childOrder = resolveChildOrder(collectionState, items);
}

// Flattens the resolved child order into a depth-first index per collection id (parent before children).
function computeCollectionDfsOrder(resolvedChildOrder, collectionIds) {
  const indexById = new Map();
  let cursor = 0;
  const visit = (parentKey) => {
    for (const ref of resolvedChildOrder[parentKey] || []) {
      if (collectionIds.has(ref) && !indexById.has(ref)) {
        indexById.set(ref, cursor);
        cursor += 1;
        visit(ref);
      }
    }
  };
  visit(ROOT_ORDER_KEY);
  return indexById;
}

// Removes a ref (endpoint path or sub-collection id) from every childOrder bucket.
function removeRefFromChildOrder(collectionState, ref) {
  if (ref == null || ref === "") {
    return;
  }

  for (const [parentKey, refs] of Object.entries(collectionState.childOrder || {})) {
    const nextRefs = refs.filter((candidate) => candidate !== ref);
    if (nextRefs.length === 0) {
      delete collectionState.childOrder[parentKey];
      continue;
    }

    collectionState.childOrder[parentKey] = nextRefs;
  }
}

// Inserts a ref into a parent's childOrder bucket at targetIndex (defaults to the end), de-duplicating.
function insertRefIntoChildOrder(collectionState, ref, parentKey, targetIndex) {
  if (ref == null || ref === "") {
    return;
  }
  if (collectionState.childOrder == null) {
    collectionState.childOrder = {};
  }

  const refs = (collectionState.childOrder[parentKey] || []).filter((candidate) => candidate !== ref);
  const safeTargetIndex = typeof targetIndex === "number"
    ? Math.max(0, Math.min(targetIndex, refs.length))
    : refs.length;
  refs.splice(safeTargetIndex, 0, ref);
  collectionState.childOrder[parentKey] = refs;
}

function normalizeCollectionState(rawState) {
  if (rawState == null || typeof rawState !== "object" || Array.isArray(rawState)) {
    throw createAdminError(400, "Invalid collection metadata file.");
  }

  const rawCollections = rawState.collections == null ? [] : rawState.collections;
  if (!Array.isArray(rawCollections)) {
    throw createAdminError(400, "Invalid collection metadata file.");
  }

  const collections = [];
  const collectionIds = new Set();
  const rawParentIds = new Map();
  for (const rawCollection of rawCollections) {
    if (rawCollection == null || typeof rawCollection !== "object" || Array.isArray(rawCollection)) {
      throw createAdminError(400, "Invalid collection metadata file.");
    }

    const id = typeof rawCollection.id === "string" ? rawCollection.id.trim() : "";
    let label = "";
    try {
      label = normalizeCollectionLabel(rawCollection.label);
    } catch (_error) {
      throw createAdminError(400, "Invalid collection metadata file.");
    }

    const isInvalidCollection = id === "" || collectionIds.has(id);
    if (isInvalidCollection) {
      throw createAdminError(400, "Invalid collection metadata file.");
    }

    collectionIds.add(id);
    const rawParentId = typeof rawCollection.parentId === "string" ? rawCollection.parentId.trim() : "";
    if (rawParentId !== "") {
      rawParentIds.set(id, rawParentId);
    }
    collections.push({ id, label });
  }

  for (const collection of collections) {
    const parentId = resolveCollectionParentId(collection.id, rawParentIds, collectionIds);
    if (parentId != null) {
      collection.parentId = parentId;
    }
  }

  const rawMemberships = rawState.memberships == null ? {} : rawState.memberships;
  if (rawMemberships == null || typeof rawMemberships !== "object" || Array.isArray(rawMemberships)) {
    throw createAdminError(400, "Invalid collection metadata file.");
  }

  const memberships = {};
  for (const [relativePath, collectionId] of Object.entries(rawMemberships)) {
    const normalizedPath = normalizeStoredDefinitionPath(relativePath);
    const normalizedCollectionId = typeof collectionId === "string" ? collectionId.trim() : "";
    const canPersistMembership = normalizedPath !== "" && normalizedCollectionId !== "" && collectionIds.has(normalizedCollectionId);
    if (!canPersistMembership) {
      continue;
    }

    memberships[normalizedPath] = normalizedCollectionId;
  }

  const childOrder = rawState.childOrder == null
    ? deriveLegacyChildOrder(rawState.itemOrder, collections, memberships)
    : normalizeChildOrder(rawState.childOrder, collectionIds, memberships, collections);

  return {
    collections,
    memberships,
    childOrder,
  };
}

function slugifyCollectionLabel(collectionLabel) {
  return collectionLabel
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildCollectionId(collectionLabel, usedIds) {
  const slug = slugifyCollectionLabel(collectionLabel);
  const baseId = slug === "" ? "collection" : `collection-${slug}`;
  let candidateId = baseId;
  let candidateIndex = 2;

  while (usedIds.has(candidateId)) {
    candidateId = `${baseId}-${candidateIndex}`;
    candidateIndex += 1;
  }

  return candidateId;
}

async function readCollectionsState(mocksDir) {
  const metadataPath = getCollectionsMetadataFilePath(mocksDir);
  if (!fs.existsSync(metadataPath)) {
    return createEmptyCollectionState();
  }

  const rawState = await readJsonFile(metadataPath);
  return normalizeCollectionState(rawState);
}

async function writeCollectionsState(mocksDir, state) {
  const normalizedState = normalizeCollectionState({
    collections: state?.collections || [],
    memberships: state?.memberships || {},
    childOrder: state?.childOrder || {},
  });
  const metadataPath = getCollectionsMetadataFilePath(mocksDir);
  const hasStoredEntries = normalizedState.collections.length > 0
    || Object.keys(normalizedState.memberships).length > 0
    || Object.keys(normalizedState.childOrder).length > 0;
  if (!hasStoredEntries) {
    await fs.promises.rm(metadataPath, { force: true });
    return;
  }

  await fs.promises.mkdir(mocksDir, { recursive: true });
  await writeFileAtomic(metadataPath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
}

// Serializza per workspace le mutazioni dello stato delle collection: la read-modify-write di
// .collections.json non ha altre difese, e due richieste admin concorrenti (es. un riordino
// drag-and-drop mentre parte un'altra mutazione) si perderebbero gli aggiornamenti a vicenda.
// Catena di promise per mocksDir. NON rientrante: una funzione serializzata non deve mai
// chiamarne un'altra serializzata (deadlock) — oggi nessuna lo fa. La coda è unica perché
// questo modulo è l'unico a possederla: tutte le operazioni serializzate passano da qui.
const collectionsStateQueues = new Map();

function withCollectionsStateLock(mocksDir, task) {
  const queueKey = path.resolve(mocksDir);
  const previousTail = collectionsStateQueues.get(queueKey) || Promise.resolve();
  const run = previousTail.then(task);
  const tail = run.catch(() => {});
  collectionsStateQueues.set(queueKey, tail);
  tail.then(() => {
    if (collectionsStateQueues.get(queueKey) === tail) {
      collectionsStateQueues.delete(queueKey);
    }
  });
  return run;
}

function serializedByWorkspace(operation) {
  return (mocksDir, ...args) => withCollectionsStateLock(mocksDir, () => operation(mocksDir, ...args));
}

function readCollectionIdForDefinition(collectionState, configFilePath) {
  const normalizedPath = normalizeStoredDefinitionPath(configFilePath);
  if (normalizedPath === "") {
    return undefined;
  }

  return collectionState.memberships[normalizedPath];
}

function attachCollectionId(item, collectionState) {
  const collectionId = readCollectionIdForDefinition(collectionState, item.configFilePath);
  if (collectionId == null) {
    return item;
  }

  return {
    ...item,
    collectionId,
  };
}

function createCollectionSummary(collection, itemCount) {
  const summary = {
    id: collection.id,
    label: collection.label,
    itemCount,
  };
  const parentId = readCollectionParentId(collection);
  if (parentId != null) {
    summary.parentId = parentId;
  }

  return summary;
}

async function removeCollectionMembershipUnlocked(mocksDir, relativePath) {
  const normalizedPath = normalizeStoredDefinitionPath(relativePath);
  if (normalizedPath === "") {
    return;
  }

  const collectionState = await readCollectionsState(mocksDir);
  const hadMembership = collectionState.memberships[normalizedPath] != null;
  const hadStoredOrder = Object.values(collectionState.childOrder || {}).some(
    (refs) => refs.includes(normalizedPath)
  );
  if (!hadMembership && !hadStoredOrder) {
    return;
  }

  delete collectionState.memberships[normalizedPath];
  removeRefFromChildOrder(collectionState, normalizedPath);
  await writeCollectionsState(mocksDir, collectionState);
}

const removeCollectionMembership = serializedByWorkspace(removeCollectionMembershipUnlocked);

async function listCollectionSummaries(mocksDir, items) {
  const collectionState = await readCollectionsState(mocksDir);
  const itemCountsByCollectionId = new Map();

  for (const item of items) {
    if (item.collectionId == null) {
      continue;
    }

    itemCountsByCollectionId.set(
      item.collectionId,
      (itemCountsByCollectionId.get(item.collectionId) || 0) + 1
    );
  }

  const resolvedChildOrder = resolveChildOrder(collectionState, items);
  const collectionIds = new Set(collectionState.collections.map((collection) => collection.id));
  const dfsOrderById = computeCollectionDfsOrder(resolvedChildOrder, collectionIds);

  return collectionState.collections
    .map((collection) => createCollectionSummary(collection, itemCountsByCollectionId.get(collection.id) || 0))
    .sort((leftSummary, rightSummary) => {
      const leftIndex = dfsOrderById.get(leftSummary.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = dfsOrderById.get(rightSummary.id) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
}

module.exports = {
  UNSORTED_COLLECTION_ID,
  ROOT_ORDER_KEY,
  DEFAULT_COLLECTION_LABEL,
  compareCollectionLabels,
  readCollectionOrderKey,
  readCollectionParentId,
  isCollectionInSubtree,
  readCollectionSubtreeIds,
  normalizeCollectionTargetIndex,
  getCollectionsMetadataFilePath,
  normalizeStoredDefinitionPath,
  normalizeCollectionLabel,
  normalizeRequestedCollectionId,
  sortAdminItems,
  resolveChildOrder,
  syncChildOrderWithCatalog,
  removeRefFromChildOrder,
  insertRefIntoChildOrder,
  buildCollectionId,
  readCollectionsState,
  writeCollectionsState,
  serializedByWorkspace,
  attachCollectionId,
  createCollectionSummary,
  removeCollectionMembership,
  listCollectionSummaries,
};
