const { createAdminError } = require("./admin-errors");
const { listAdminMocks } = require("./mock-catalog");
const { readEndpointConfig, readEndpointResponseByName } = require("./endpoint-files");
const { resolveAdminFilePath } = require("./mock-ids");

/**
 * Attivazioni temporanee viste dall'admin API: lo scenario della sessione in corso.
 *
 * Chi prepara un test, o riproduce un bug, dichiara quali endpoint vuole accesi (o spenti) e con
 * quale variante, senza che i file del workspace cambino. Le operazioni sono tutto-o-niente: se
 * lo scenario richiesto non si lascia installare (una variante che non si carica), resta quello
 * di prima e la risposta dice perché.
 */

const FIELDS = ["enabled", "responseFile"];

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function createActivationApi({ mocksDir, store, reloadRuntime, scenarioStates }) {
  const available = store != null;

  // Catalogo indicizzato per id e per "METHOD /path": un'attivazione si può nominare nei due modi.
  async function readCatalog() {
    const items = await listAdminMocks(mocksDir);
    const byId = new Map(items.map((item) => [item.id, item]));
    const byKey = new Map(items.map((item) => [`${item.method} ${item.path}`, item]));
    return { byId, byKey };
  }

  // Titolo e status della variante servita temporaneamente. Una variante che non si legge non
  // toglie l'attivazione dall'elenco: mancano solo questi due campi.
  async function describeVariant(item, responseFile) {
    try {
      const { response } = await readEndpointResponseByName(resolveAdminFilePath(mocksDir, item.id), responseFile);
      return { responseTitle: response.title || "", responseStatus: response.type === "mock" ? response.status : null };
    } catch {
      return {};
    }
  }

  // Lo scenario com'è ora, con l'id di catalogo di ogni endpoint. Accanto a ciò che è temporaneo
  // c'è ciò che è salvato (`saved`): chi mostra lo scenario li confronta senza leggere altro.
  // Con il file endpoint illeggibile l'id è null e `saved` manca: non c'è nulla da confrontare.
  async function describe() {
    if (!available) {
      return { revision: 1, items: [] };
    }
    const { byKey } = await readCatalog();
    return {
      revision: store.revision,
      items: await Promise.all(store.list().map(async (override) => {
        const item = byKey.get(`${override.method} ${override.path}`);
        if (item == null) {
          return { id: null, ...override };
        }
        return {
          id: item.id,
          ...override,
          ...(override.responseFile === undefined ? {} : await describeVariant(item, override.responseFile)),
          saved: {
            enabled: item.disabled !== true,
            responseFile: item.selectedResponseFile ?? null,
            responseTitle: item.responseTitle ?? "",
            responseStatus: item.status ?? null,
          },
        };
      })),
    };
  }

  // Un elemento della richiesta diventa { method, path, enabled?, responseFile? }. Con
  // `allowNull`, un campo a null chiede di togliere quel campo dall'attivazione (PATCH).
  async function resolveEntry(entry, index, catalog, { allowNull }) {
    const where = `items[${index}]`;
    if (!isPlainObject(entry)) {
      throw createAdminError(400, `${where} must be an object.`);
    }
    const unknown = Object.keys(entry).filter((key) => !["id", "method", "path", ...FIELDS].includes(key));
    if (unknown.length > 0) {
      throw createAdminError(400, `${where} has unknown fields: ${unknown.join(", ")}.`);
    }
    let item;
    if (typeof entry.id === "string") {
      item = catalog.byId.get(entry.id);
    } else if (typeof entry.method === "string" && typeof entry.path === "string") {
      item = catalog.byKey.get(`${entry.method.toUpperCase()} ${entry.path}`);
    } else {
      throw createAdminError(400, `${where} must name an endpoint with "id", or with "method" and "path".`);
    }
    if (item == null) {
      throw createAdminError(404, `${where} does not match any endpoint of the catalog.`, {
        code: "ACTIVATION_ENDPOINT_NOT_FOUND",
      });
    }
    const resolved = { method: item.method, path: item.path };
    if (entry.enabled !== undefined) {
      if (typeof entry.enabled !== "boolean" && !(allowNull && entry.enabled === null)) {
        throw createAdminError(400, `${where}.enabled must be a boolean${allowNull ? " or null" : ""}.`);
      }
      resolved.enabled = entry.enabled === null ? undefined : entry.enabled;
      resolved.touchesEnabled = true;
    }
    if (entry.responseFile !== undefined) {
      if (typeof entry.responseFile !== "string" && !(allowNull && entry.responseFile === null)) {
        throw createAdminError(400, `${where}.responseFile must be a response file name${allowNull ? " or null" : ""}.`);
      }
      if (typeof entry.responseFile === "string") {
        const endpoint = await readEndpointConfig(resolveAdminFilePath(mocksDir, item.id));
        if (!endpoint.responseFiles.includes(entry.responseFile)) {
          throw createAdminError(400, `${where}.responseFile is not a variant of ${item.method} ${item.path}.`, {
            code: "ACTIVATION_VARIANT_NOT_FOUND",
            responseFiles: endpoint.responseFiles,
          });
        }
      }
      resolved.responseFile = entry.responseFile === null ? undefined : entry.responseFile;
      resolved.touchesResponseFile = true;
    }
    if (!resolved.touchesEnabled && !resolved.touchesResponseFile) {
      throw createAdminError(400, `${where} must set "enabled", "responseFile", or both.`);
    }
    return { item, resolved };
  }

  function readItems(body) {
    if (!isPlainObject(body) || !Array.isArray(body.items)) {
      throw createAdminError(400, 'The body must be an object with an "items" array.');
    }
    if (body.items.length > 1000) {
      throw createAdminError(400, "items accepts at most 1000 endpoints.");
    }
    return body.items;
  }

  // Installa lo scenario già scritto nello store. Se il reload non riesce, o un endpoint dello
  // scenario non si carica, rimette quello di prima e rifiuta la richiesta.
  async function install(previous, touchedItems) {
    const outcome = await reloadRuntime();
    const touchedFiles = new Set(touchedItems.map((item) => resolveAdminFilePath(mocksDir, item.id)));
    const failures = (outcome.loadErrors || []).filter((loadError) => touchedFiles.has(loadError.filePath));
    if (outcome.applied !== true || failures.length > 0) {
      store.replaceAll(previous);
      await reloadRuntime();
      throw createAdminError(400, "The requested activation could not be installed: the previous one is still in place.", {
        code: "ACTIVATION_REJECTED",
        errors: failures.map((failure) => failure.message),
        ...(outcome.fatalError ? { fatalError: outcome.fatalError.message } : {}),
      });
    }
    // Un endpoint che cambia variante o torna in servizio riparte da capo: cursore della
    // sequenza e memoria dell'handler appartengono allo scenario di prima.
    for (const item of touchedItems) {
      const key = `${item.method} ${item.path}`;
      scenarioStates?.sequenceStates?.reset(key);
      scenarioStates?.handlerStates?.reset(key);
    }
    return describe();
  }

  function requireStore() {
    if (!available) {
      throw createAdminError(501, "Temporary activation is not available on this runtime.");
    }
  }

  // Sostituisce l'intero scenario: gli endpoint non nominati tornano a come sono salvati.
  async function replace(body) {
    requireStore();
    const catalog = await readCatalog();
    const entries = [];
    for (const [index, entry] of readItems(body).entries()) {
      entries.push(await resolveEntry(entry, index, catalog, { allowNull: false }));
    }
    const seen = new Set();
    for (const { item } of entries) {
      if (seen.has(item.id)) {
        throw createAdminError(400, `${item.method} ${item.path} is listed more than once.`);
      }
      seen.add(item.id);
    }
    const previous = store.snapshot();
    const previousItems = previous.map((override) => catalog.byKey.get(`${override.method} ${override.path}`)).filter(Boolean);
    store.replaceAll(entries.map(({ resolved }) => resolved));
    return install(previous, [...new Set([...previousItems, ...entries.map(({ item }) => item)])]);
  }

  // Aggiunge o ritocca singoli endpoint, lasciando stare il resto dello scenario.
  async function patch(body) {
    requireStore();
    const catalog = await readCatalog();
    const entries = [];
    for (const [index, entry] of readItems(body).entries()) {
      entries.push(await resolveEntry(entry, index, catalog, { allowNull: true }));
    }
    const previous = store.snapshot();
    for (const { resolved } of entries) {
      const current = store.get(resolved.method, resolved.path) || { method: resolved.method, path: resolved.path };
      const next = { ...current };
      if (resolved.touchesEnabled) {
        next.enabled = resolved.enabled;
      }
      if (resolved.touchesResponseFile) {
        next.responseFile = resolved.responseFile;
      }
      store.remove(resolved.method, resolved.path);
      store.apply([next]);
    }
    return install(previous, entries.map(({ item }) => item));
  }

  // Azzera tutto: ogni endpoint torna a come è salvato.
  async function clear() {
    requireStore();
    const catalog = await readCatalog();
    const previous = store.snapshot();
    if (!store.clear()) {
      return describe();
    }
    return install(previous, previous.map((override) => catalog.byKey.get(`${override.method} ${override.path}`)).filter(Boolean));
  }

  /**
   * Dopo un salvataggio esplicito dello stesso stato (accensione o variante, scritti nei file):
   * vince l'ultimo gesto, quindi l'attivazione temporanea su quel campo decade. `refs` sono
   * { method, path }. Restituisce true se serve un reload perché qualcosa è decaduto.
   */
  function forget(refs, fields) {
    if (!available) {
      return false;
    }
    let changed = false;
    for (const ref of refs) {
      changed = store.remove(ref.method, ref.path, fields) || changed;
    }
    return changed;
  }

  return { clear, describe, forget, patch, replace, revision: () => (available ? store.revision : 1) };
}

module.exports = { createActivationApi };
