const { planFromDocument } = require("../mocks/openapi-import");
const { runReload } = require("./admin-fs");
const { createAdminCollection, assignAdminCollection } = require("./collection-operations");
const { DEFAULT_COLLECTION_LABEL, compareCollectionLabels } = require("./collections-state");
const { listAdminMocks, listAdminCollections } = require("./mock-catalog");
const { createAdminMock } = require("./endpoint-operations");

// Crea endpoint mock a partire da un documento OpenAPI (vedi openapi-import). `document` puo' essere il
// testo grezzo (YAML/JSON) o un oggetto gia' interpretato. Con `dryRun` ritorna solo piano + conteggi.
async function importAdminOpenapi(mocksDir, document, reloadRuntime, options = {}) {
  const dryRun = options.dryRun === true;
  const existingItems = await listAdminMocks(mocksDir);
  const existingKeys = new Set(existingItems.map((item) => `${item.method} ${item.path}`));
  const plan = await planFromDocument(document, existingKeys);
  if (dryRun) {
    // L'anteprima non usa il body delle response (puo' essere grosso): lo togliamo dal payload.
    return { ...plan, items: plan.items.map(({ body, ...rest }) => rest) };
  }

  const toCreate = plan.items.filter((item) => item.action === "create");

  // Risolvi/crea le collection dai tag, riusando per label quelle gia' presenti. Il confronto
  // usa lo STESSO comparatore della create (case- e accent-insensitive): con una chiave
  // toLowerCase, coppie come "Café"/"Cafe" sfuggirebbero al riuso e finirebbero in una create
  // destinata al 409, abortendo l'import a workspace gia' modificato a meta'.
  const existingCollections = await listAdminCollections(mocksDir, existingItems);
  const knownCollections = existingCollections
    .filter((collection) => collection.id)
    .map((collection) => ({ label: collection.label, id: collection.id }));
  const findCollectionIdByLabel = (label) =>
    knownCollections.find((collection) => compareCollectionLabels(collection.label, label) === 0)?.id;
  const collectionIdByTag = {};
  for (const tag of [...new Set(toCreate.map((item) => item.collection).filter(Boolean))]) {
    // La label della collection virtuale di default e' riservata (la create la rifiuta con
    // 409): un tag con quel nome lascia semplicemente i suoi mock non assegnati.
    if (compareCollectionLabels(tag, DEFAULT_COLLECTION_LABEL) === 0) {
      continue;
    }
    const existingId = findCollectionIdByLabel(tag);
    if (existingId != null) {
      collectionIdByTag[tag] = existingId;
      continue;
    }
    // Stessa degradazione per-elemento dei mock qui sotto: un tag che non si riesce a
    // creare non deve abortire l'import — i suoi mock restano non assegnati.
    try {
      const created = await createAdminCollection(mocksDir, { label: tag });
      collectionIdByTag[tag] = created.id;
      knownCollections.push({ label: tag, id: created.id });
    } catch (_error) {
      /* mock del tag senza collection */
    }
  }

  // Crea i mock; reload una sola volta a fine batch (non per ogni endpoint).
  const noReload = async () => {};
  const failed = [];
  let created = 0;
  for (const item of toCreate) {
    try {
      await createAdminMock(
        mocksDir,
        {
          config: {
            method: item.method,
            path: item.path,
            status: item.status,
            disabled: false,
            headers: {},
            bodyFile: "001.response.json",
            delayMs: 0,
          },
          body: item.body,
        },
        noReload,
      );
      created += 1;
    } catch (_error) {
      failed.push(`${item.method} ${item.path}`);
    }
  }

  // Assegna le collection ai nuovi mock (ri-listo per ricavare gli id per method+path).
  const itemsAfter = await listAdminMocks(mocksDir);
  const idByKey = new Map(itemsAfter.map((item) => [`${item.method} ${item.path}`, item.id]));
  for (const item of toCreate) {
    const collectionId = item.collection ? collectionIdByTag[item.collection] : undefined;
    const id = idByKey.get(`${item.method} ${item.path}`);
    if (id && collectionId) {
      await assignAdminCollection(mocksDir, id, { collectionId });
    }
  }

  await runReload(reloadRuntime);

  return {
    created,
    skipped: plan.skip,
    failed: failed.length,
    total: plan.total,
    collections: Object.keys(collectionIdByTag).length,
  };
}

module.exports = {
  importAdminOpenapi,
};
