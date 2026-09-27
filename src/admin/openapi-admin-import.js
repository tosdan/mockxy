const { planFromDocument } = require("../mocks/openapi-import");
const { finalizeBatch } = require("./admin-fs");
const { resolveAdminFilePath } = require("./mock-ids");
const { createAdminCollection, assignAdminCollection } = require("./collection-operations");
const { DEFAULT_COLLECTION_LABEL, compareCollectionLabels } = require("./collections-state");
const { listAdminMocks, listAdminCollections } = require("./mock-catalog");
const { createAdminMock } = require("./endpoint-operations");

// Crea endpoint mock a partire da un documento OpenAPI (vedi openapi-import). `document` puo' essere il
// testo grezzo (YAML/JSON) o un oggetto gia' interpretato. Con `dryRun` ritorna solo piano + conteggi.
// `options.prefix` antepone un prefisso ai path importati (es. "/be").
async function importAdminOpenapi(mocksDir, document, reloadRuntime, options = {}) {
  const dryRun = options.dryRun === true;
  const existingItems = await listAdminMocks(mocksDir);
  const existingKeys = new Set(existingItems.map((item) => `${item.method} ${item.path}`));
  const plan = await planFromDocument(document, existingKeys, { prefix: options.prefix });
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

  // Crea i mock; reload una sola volta a fine batch (non per ogni endpoint). Ogni elemento del
  // piano diventa un esito: un fallimento in scrittura ripristina i soli file di quell'elemento.
  const noReload = async () => {};
  const failed = [];
  let created = 0;
  // Un elemento il cui ripristino fallisce (ROLLBACK_FAILED) ferma il batch: lo stato del
  // workspace non è più garantito e continuare peggiorerebbe l'incertezza.
  let interruption = null;
  let processed = 0;
  const assignments = [];
  const items = plan.items
    .filter((item) => item.action !== "create")
    .map((item) => ({
      method: item.method,
      path: item.path,
      id: null,
      responseFile: null,
      writeOutcome: "skipped",
      runtimeOutcome: "not_applicable",
      error: null,
    }));
  for (const item of toCreate) {
    if (interruption != null) {
      break;
    }
    processed += 1;
    try {
      const detail = await createAdminMock(
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
      const outcome = {
        method: item.method,
        path: item.path,
        id: detail.id,
        responseFile: "001.response.json",
        writeOutcome: "created",
        runtimeOutcome: "not_applied",
        error: null,
        endpointPath: resolveAdminFilePath(mocksDir, detail.id),
        expectServing: true,
      };
      items.push(outcome);
      const collectionId = item.collection ? collectionIdByTag[item.collection] : undefined;
      if (collectionId != null) {
        assignments.push({ outcome, collectionId });
      }
    } catch (error) {
      failed.push(`${item.method} ${item.path}`);
      items.push({
        method: item.method,
        path: item.path,
        id: null,
        responseFile: null,
        writeOutcome: "failed",
        runtimeOutcome: "not_applicable",
        error: error.message,
      });
      if (error?.details?.code === "ROLLBACK_FAILED") {
        interruption = error;
      }
    }
  }

  // Assegna le collection ai mock creati. Un errore qui non annulla l'endpoint, già scritto:
  // resta nell'esito dell'elemento, e il batch arriva comunque al reload finale.
  for (const { outcome, collectionId } of assignments) {
    try {
      await assignAdminCollection(mocksDir, outcome.id, { collectionId });
    } catch (error) {
      outcome.error = `Created, but the collection could not be assigned: ${error.message}`;
    }
  }

  // I conteggi conservano il significato storico di creazioni su disco; il servizio effettivo
  // lo dicono items[].runtimeOutcome e runtime.status.
  return finalizeBatch({
    reloadRuntime,
    mocksDir,
    rejectionLabel: "OpenAPI import",
    interruption,
    processed,
    total: toCreate.length,
    result: {
      created,
      skipped: plan.skip,
      failed: failed.length,
      total: plan.total,
      collections: Object.keys(collectionIdByTag).length,
      prefix: plan.prefix,
      items,
    },
  });
}

module.exports = {
  importAdminOpenapi,
};
