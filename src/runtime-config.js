const { normalizeString, validateBackendUrl } = require("./config");
const { ObservedRevision } = require("./runtime-info");

// Configurazione effimera del runtime (piano agent/API, §13 C2/C8). Le nove chiavi sotto sono le
// sole modificabili a runtime e le sole esposte da GET /config: nessun'altra variabile d'ambiente
// esce da qui. Flag di /server e opzioni del dump restano sulle rispettive API. Host, porta,
// percorsi, admin API e watcher sono fissati all'avvio.
const RUNTIME_CONFIG_KEYS = Object.freeze([
  "backendUrl",
  "proxyFallbackEnabled",
  "corsEnabled",
  "delayAllRequests",
  "caseInsensitiveFilters",
  "adaptProxyCookies",
  "rewriteProxyRedirects",
  "globalDelayMs",
  "requestTimeoutMs",
]);

const BOOLEAN_KEYS = new Set([
  "proxyFallbackEnabled",
  "corsEnabled",
  "delayAllRequests",
  "caseInsensitiveFilters",
  "adaptProxyCookies",
  "rewriteProxyRedirects",
]);

// Il massimo di un timer di Node: oltre, setTimeout scatterebbe subito.
const MAX_TIMER_MS = 2147483647;
const INTEGER_RANGES = {
  globalDelayMs: [0, MAX_TIMER_MS],
  requestTimeoutMs: [1, MAX_TIMER_MS],
};

class RuntimeConfigError extends Error {
  constructor(message, key) {
    super(message);
    this.status = 400;
    if (key != null) {
      this.details = { key };
    }
  }
}

// Le nove chiavi della configurazione indicata; un valore assente (backend non configurato) è null.
function pickRuntimeConfig(config) {
  const picked = {};
  for (const key of RUNTIME_CONFIG_KEYS) {
    picked[key] = config?.[key] ?? null;
  }
  return picked;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function requireRuntimeKey(key) {
  if (!RUNTIME_CONFIG_KEYS.includes(key)) {
    throw new RuntimeConfigError(
      `${key} cannot change at runtime. The runtime settings are: ${RUNTIME_CONFIG_KEYS.join(", ")}; host, port, folders, the admin API and the watcher are fixed at startup.`,
      key
    );
  }
}

// Il valore di un override, validato come C8 lo richiede: nessuna coercizione da stringhe.
function readOverrideValue(key, value) {
  if (key === "backendUrl") {
    if (value === null) {
      return null;
    }
    const url = typeof value === "string" ? normalizeString(value) : undefined;
    if (url === undefined) {
      throw new RuntimeConfigError("backendUrl must be an absolute http(s) URL, or null to disable the backend.", key);
    }
    try {
      validateBackendUrl(url);
    } catch {
      throw new RuntimeConfigError(`backendUrl must be an absolute http(s) URL, or null to disable the backend: ${url} is not.`, key);
    }
    return url;
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value !== "boolean") {
      throw new RuntimeConfigError(`${key} must be a boolean.`, key);
    }
    return value;
  }
  const [min, max] = INTEGER_RANGES[key];
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RuntimeConfigError(`${key} must be an integer from ${min} to ${max}.`, key);
  }
  return value;
}

// Legge e valida per intero il corpo di PATCH /config: { set?, unset? }. Nessun effetto finché
// tutto il candidato non è valido.
function parseConfigPatch(body) {
  if (!isPlainObject(body)) {
    throw new RuntimeConfigError("The body must be a JSON object: { set?, unset? }.");
  }
  for (const field of Object.keys(body)) {
    if (field !== "set" && field !== "unset") {
      throw new RuntimeConfigError(`Unknown field ${field}: the body takes only set and unset.`);
    }
  }
  const set = Object.hasOwn(body, "set") ? body.set : {};
  const unset = Object.hasOwn(body, "unset") ? body.unset : [];
  if (!isPlainObject(set)) {
    throw new RuntimeConfigError("set must be an object of settings.");
  }
  if (!Array.isArray(unset)) {
    throw new RuntimeConfigError("unset must be an array of setting names.");
  }

  const unsetKeys = new Set();
  for (const key of unset) {
    if (typeof key !== "string") {
      throw new RuntimeConfigError("unset must contain setting names only.");
    }
    requireRuntimeKey(key);
    if (unsetKeys.has(key)) {
      throw new RuntimeConfigError(`${key} appears twice in unset.`, key);
    }
    unsetKeys.add(key);
  }

  const values = {};
  for (const [key, value] of Object.entries(set)) {
    requireRuntimeKey(key);
    if (unsetKeys.has(key)) {
      throw new RuntimeConfigError(`${key} is both in set and in unset.`, key);
    }
    values[key] = readOverrideValue(key, value);
  }

  if (unsetKeys.size === 0 && Object.keys(values).length === 0) {
    throw new RuntimeConfigError("Name at least one setting in set or unset.");
  }
  return { set: values, unset: [...unsetKeys] };
}

/**
 * Configurazione del runtime con gli override effimeri. `current()` è l'oggetto che il serving
 * fotografa all'ingresso di ogni richiesta: non cambia mai dopo la pubblicazione, un PATCH ne
 * pubblica uno nuovo. Senza override è l'oggetto di avvio stesso. Un riavvio riparte senza
 * override: niente viene scritto su disco.
 */
class RuntimeConfigStore {
  constructor(config) {
    this.base = config ?? {};
    this.startup = Object.freeze(pickRuntimeConfig(this.base));
    this.overrides = Object.freeze({});
    this.published = this.base;
    this.revisionTracker = new ObservedRevision(() => JSON.stringify([pickRuntimeConfig(this.published), this.overrides]));
  }

  current() {
    return this.published;
  }

  get revision() {
    return this.revisionTracker.observe();
  }

  describe(runtimeId) {
    return {
      runtimeId,
      startup: { ...this.startup },
      effective: pickRuntimeConfig(this.published),
      overrides: { ...this.overrides },
      persisted: false,
    };
  }

  // Applica un PATCH già validato per intero: un corpo non valido lancia prima di cambiare
  // valori, override o revisione.
  patch(body) {
    const { set, unset } = parseConfigPatch(body);
    const next = { ...this.overrides, ...set };
    for (const key of unset) {
      delete next[key];
    }
    // Ordine fisso delle chiavi: l'impronta della revisione non dipende dall'ordine del PATCH.
    const overrides = {};
    for (const key of RUNTIME_CONFIG_KEYS) {
      if (Object.hasOwn(next, key)) {
        overrides[key] = next[key];
      }
    }
    this.overrides = Object.freeze(overrides);
    this.published = Object.keys(overrides).length === 0 ? this.base : Object.freeze({ ...this.base, ...overrides });
    this.revisionTracker.observe();
  }
}

module.exports = {
  RUNTIME_CONFIG_KEYS,
  RuntimeConfigStore,
  parseConfigPatch,
  pickRuntimeConfig,
};
