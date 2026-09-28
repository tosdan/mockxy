// Configurazione effettiva esposta in sola lettura da GET /config (piano agent/API, §13 C2/C8).
// Sono soltanto le nove chiavi che S8 renderà modificabili a runtime: nessun'altra variabile
// d'ambiente esce da qui. Flag di /server e opzioni del dump restano sulle rispettive API.
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

// Le nove chiavi della configurazione indicata; un valore assente (backend non configurato) è null.
function pickRuntimeConfig(config) {
  const picked = {};
  for (const key of RUNTIME_CONFIG_KEYS) {
    picked[key] = config?.[key] ?? null;
  }
  return picked;
}

// Risposta di GET /config. `startup` è fotografata alla creazione del runtime; finché non
// esistono override (S8), la configurazione effettiva coincide con quella di avvio.
function describeRuntimeConfig({ runtimeId, startup, config }) {
  return {
    runtimeId,
    startup,
    effective: pickRuntimeConfig(config),
    overrides: {},
    persisted: false,
  };
}

module.exports = {
  RUNTIME_CONFIG_KEYS,
  describeRuntimeConfig,
  pickRuntimeConfig,
};
