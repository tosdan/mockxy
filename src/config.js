const path = require("path");
const dotenv = require("dotenv");

const DEFAULT_PORT = 3000;
// Default loopback: l'admin API scrive file ed esegue codice, quindi esporre il server sulla
// rete deve essere una scelta esplicita (HOST=0.0.0.0, come `ng serve --host 0.0.0.0`).
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_LOG_LEVEL = "info";
const DEFAULT_GLOBAL_DELAY_MS = 0;
const DEFAULT_DELAY_ALL_REQUESTS = false;
const DEFAULT_PROXY_FALLBACK_ENABLED = true;
const DEFAULT_CASE_INSENSITIVE_FILTERS = true;
// CORS spento di default: il flusso previsto (proxy del dev server, UI same-origin, client
// non-browser) non ne ha bisogno; serve solo a un frontend browser su un'altra origine che
// chiama il server direttamente (es. esposto in LAN).
const DEFAULT_CORS_ENABLED = false;
// Adattamento dei Set-Cookie proxati ATTIVO di default: un cookie con Domain del backend (o
// Secure/SameSite=None su http) verrebbe scartato in silenzio dal browser che parla con Mockxy,
// e la sessione non si stabilirebbe mai. Il caso che l'adattamento può disturbare (cookie
// condiviso tra sottodomini attraverso un alias DNS verso Mockxy) è raro: chi lo vive, o vuole
// osservare i Set-Cookie originali del backend, lo disattiva.
const DEFAULT_ADAPT_PROXY_COOKIES = true;
// Riscrittura dei Location proxati ATTIVA di default: un redirect assoluto verso il backend fa
// uscire il browser da Mockxy (cookie e CORS tornano quelli del backend, il proxy sparisce dal
// giro), mai desiderabile in questa topologia. I Location relativi e quelli verso host terzi
// (SSO esterni, CDN) passano comunque intatti.
const DEFAULT_REWRITE_PROXY_REDIRECTS = true;
const DEFAULT_MONITOR_DUMP_INTERVAL_MS = 30000;
const DEFAULT_MONITOR_DUMP_THRESHOLD = 100;
const DEFAULT_MONITOR_DUMP_MAX_FILE_BYTES = 50 * 1024 * 1024;
// Tetto sul totale della cartella dei dump (1GB): generoso di proposito, 0 = pruning disattivato.
const DEFAULT_MONITOR_DUMP_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

// Unica fonte dei default delle impostazioni per-workspace dell'app desktop: il wrapper Electron
// li importa (via src/server) per mostrare i valori effettivi nella dialog e riconoscere i cambi
// reali. Le chiavi coincidono con quelle di configOverrides / del file di settings del workspace.
const WORKSPACE_SETTING_DEFAULTS = Object.freeze({
  host: DEFAULT_HOST,
  caseInsensitiveFilters: DEFAULT_CASE_INSENSITIVE_FILTERS,
  proxyFallbackEnabled: DEFAULT_PROXY_FALLBACK_ENABLED,
  corsEnabled: DEFAULT_CORS_ENABLED,
  adaptProxyCookies: DEFAULT_ADAPT_PROXY_COOKIES,
  rewriteProxyRedirects: DEFAULT_REWRITE_PROXY_REDIRECTS,
  globalDelayMs: DEFAULT_GLOBAL_DELAY_MS,
  delayAllRequests: DEFAULT_DELAY_ALL_REQUESTS,
  requestTimeoutMs: DEFAULT_TIMEOUT_MS,
  monitorDumpIntervalMs: DEFAULT_MONITOR_DUMP_INTERVAL_MS,
  monitorDumpThreshold: DEFAULT_MONITOR_DUMP_THRESHOLD,
  monitorDumpMaxFileBytes: DEFAULT_MONITOR_DUMP_MAX_FILE_BYTES,
  monitorDumpMaxTotalBytes: DEFAULT_MONITOR_DUMP_MAX_TOTAL_BYTES,
});

// Parses numeric environment values and falls back when the input is empty or invalid.
function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Parses a comma-separated host list (env or override array) into lowercase hostnames.
function parseHostList(value) {
  if (Array.isArray(value)) {
    return value.map((hostName) => String(hostName).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((hostName) => hostName.trim().toLowerCase())
    .filter(Boolean);
}

// Parses boolean-like environment values with support for common truthy and falsy aliases.
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

// Enables file watching only for non-production runtimes when the feature flag is on.
function shouldEnableWatch({ devWatch, nodeEnv }) {
  return devWatch && nodeEnv !== "production";
}

// Enables local admin APIs by default only during development.
function shouldEnableAdminApi({ adminApiEnabled, nodeEnv }) {
  if (adminApiEnabled != null) {
    return adminApiEnabled;
  }

  return nodeEnv !== "production";
}

// Normalizes string configuration values so runtime checks do not fail on accidental whitespace.
function normalizeString(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// Builds a clear message for when the backend base URL is needed at runtime but not configured.
function createMissingBackendUrlMessage() {
  return [
    "BACKEND_URL is not configured.",
    "Set BACKEND_URL to the backend base URL, for example http://localhost:3001, to proxy requests to the backend.",
  ].join(" ");
}

// Builds a clear bootstrap error when the backend base URL is not a valid URL.
function createInvalidBackendUrlMessage(backendUrl) {
  return [
    `Invalid BACKEND_URL: ${backendUrl}.`,
    "Use an absolute URL including protocol, for example http://localhost:3001.",
  ].join(" ");
}

// Builds a clear bootstrap error when the CLI delay parameter is missing or invalid.
function createInvalidDelayMessage(value) {
  const hasValue = value !== undefined && value !== null && value !== "";
  if (!hasValue) {
    return [
      "Missing value for delay parameter.",
      "Use a non-negative integer number of milliseconds, for example --delay=250.",
    ].join(" ");
  }

  return [
    `Invalid delay value: ${value}.`,
    "Use a non-negative integer number of milliseconds, for example --delay=250.",
  ].join(" ");
}

// Validates backend URLs and only accepts absolute HTTP or HTTPS targets.
function validateBackendUrl(backendUrl) {
  const parsedUrl = new URL(backendUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(createInvalidBackendUrlMessage(backendUrl));
  }
}

// Parses a delay value and only accepts non-negative integer milliseconds.
function parseDelayValue(value) {
  const normalizedValue = normalizeString(value);
  if (normalizedValue == null) {
    throw new Error(createInvalidDelayMessage(value));
  }

  const parsedValue = Number(normalizedValue);
  const isIntegerValue = Number.isInteger(parsedValue);
  const isNonNegativeValue = parsedValue >= 0;
  if (!isIntegerValue || !isNonNegativeValue) {
    throw new Error(createInvalidDelayMessage(value));
  }

  return parsedValue;
}

// Reads the last value passed for a launch option, supporting both flag=value and flag value forms.
function readLaunchOptionValue(argv = [], acceptedNames = [], options = {}) {
  const expectsValue = options.expectsValue === true;
  let optionValue;

  for (let index = 0; index < argv.length; index += 1) {
    const currentArg = argv[index];
    if (typeof currentArg !== "string") {
      continue;
    }

    const matchedName = acceptedNames.find(
      (name) => currentArg === name || currentArg.startsWith(`${name}=`)
    );
    if (matchedName == null) {
      continue;
    }

    if (currentArg === matchedName) {
      const nextArg = argv[index + 1];
      const hasValue = typeof nextArg === "string";
      if (expectsValue) {
        optionValue = hasValue ? nextArg : true;
        if (hasValue) {
          index += 1;
        }
        continue;
      }

      const canUseNextArgAsValue = hasValue && !nextArg.startsWith("-");
      optionValue = canUseNextArgAsValue ? nextArg : true;
      if (canUseNextArgAsValue) {
        index += 1;
      }
      continue;
    }

    optionValue = currentArg.slice(`${matchedName}=`.length);
  }

  return optionValue;
}

// Reads launch options from npm config env vars so npm scripts can pass flags without colliding with nodemon.
function readLaunchOptionFromEnv(env = process.env) {
  return {
    delay: env.npm_config_delay,
    delayAll: env.npm_config_delay_all,
  };
}

// Parses the optional CLI and npm launch overrides and returns config overrides for bootstrap.
function parseCliArgs(argv = [], env = process.env) {
  const launchOptionsFromEnv = readLaunchOptionFromEnv(env);
  const delayValue = readLaunchOptionValue(argv, ["delay", "--delay"], { expectsValue: true });
  const delayAllValue = readLaunchOptionValue(argv, ["delay-all", "--delay-all"]);
  const resolvedDelayValue = delayValue ?? launchOptionsFromEnv.delay;
  const resolvedDelayAllValue = delayAllValue ?? launchOptionsFromEnv.delayAll;
  const overrides = {};

  if (resolvedDelayValue != null) {
    overrides.globalDelayMs = parseDelayValue(resolvedDelayValue);
  }

  if (resolvedDelayAllValue != null) {
    overrides.delayAllRequests = parseBoolean(resolvedDelayAllValue, true);
  }

  return overrides;
}

// Il file .env viene letto una volta sola per processo: dotenv muta process.env (stato
// globale) e nell'app desktop — dove il cwd è arbitrario e il runtime si ricrea a ogni cambio
// workspace — rileggerlo a ogni loadConfig significherebbe I/O ripetuto e un esito dipendente
// da quale sia il cwd in quel momento.
let envFileLoaded = false;
function loadEnvFileOnce() {
  if (envFileLoaded) {
    return;
  }
  envFileLoaded = true;
  dotenv.config({ quiet: true });
}

// Loads and validates runtime configuration from environment variables and explicit overrides.
function loadConfig(overrides = {}) {
  loadEnvFileOnce();

  // Radice per i percorsi relativi (mocks, dump, UI): esplicitabile via override; da CLI resta
  // la directory di lancio, che è l'aspettativa naturale.
  const baseDir = overrides.baseDir ?? process.cwd();

  const nodeEnv = overrides.nodeEnv || process.env.NODE_ENV || "development";
  const devWatch = parseBoolean(
    overrides.devWatch ?? process.env.DEV_WATCH,
    true
  );
  const backendUrl = normalizeString(overrides.backendUrl ?? process.env.BACKEND_URL);
  const proxyFallbackEnabled = parseBoolean(
    overrides.proxyFallbackEnabled ?? process.env.PROXY_FALLBACK_ENABLED,
    DEFAULT_PROXY_FALLBACK_ENABLED
  );
  const uiDistDir = normalizeString(overrides.uiDistDir ?? process.env.UI_DIST_DIR);
  const host = normalizeString(overrides.host ?? process.env.HOST) || DEFAULT_HOST;

  const config = {
    nodeEnv,
    port: parseNumber(overrides.port ?? process.env.PORT, DEFAULT_PORT),
    backendUrl,
    proxyFallbackEnabled,
    // Filtri automatici sulle liste (?chiave=valore): confronto del valore senza distinguere
    // maiuscole/minuscole quando true (default). Per-workspace nell'app desktop, via env altrove.
    caseInsensitiveFilters: parseBoolean(
      overrides.caseInsensitiveFilters ?? process.env.CASE_INSENSITIVE_FILTERS,
      DEFAULT_CASE_INSENSITIVE_FILTERS
    ),
    // Gestione CORS del motore (preflight automatici + header sulle risposte generate localmente).
    corsEnabled: parseBoolean(
      overrides.corsEnabled ?? process.env.CORS_ENABLED,
      DEFAULT_CORS_ENABLED
    ),
    // Adattamento dei Set-Cookie inoltrati dal proxy (rimozione di Domain, Secure, SameSite=None).
    adaptProxyCookies: parseBoolean(
      overrides.adaptProxyCookies ?? process.env.ADAPT_PROXY_COOKIES,
      DEFAULT_ADAPT_PROXY_COOKIES
    ),
    // Riscrittura dei Location dei redirect proxati che puntano all'origin del backend.
    rewriteProxyRedirects: parseBoolean(
      overrides.rewriteProxyRedirects ?? process.env.REWRITE_PROXY_REDIRECTS,
      DEFAULT_REWRITE_PROXY_REDIRECTS
    ),
    adminApiEnabled: shouldEnableAdminApi({
      adminApiEnabled:
        overrides.adminApiEnabled == null
          ? parseBoolean(process.env.ADMIN_API_ENABLED, undefined)
          : parseBoolean(overrides.adminApiEnabled, undefined),
      nodeEnv,
    }),
    delayAllRequests: parseBoolean(
      overrides.delayAllRequests,
      DEFAULT_DELAY_ALL_REQUESTS
    ),
    globalDelayMs:
      overrides.globalDelayMs == null
        ? DEFAULT_GLOBAL_DELAY_MS
        : parseDelayValue(overrides.globalDelayMs),
    requestTimeoutMs: parseNumber(
      overrides.requestTimeoutMs ?? process.env.REQUEST_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS
    ),
    logLevel: overrides.logLevel ?? process.env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL,
    mocksDir:
      overrides.mocksDir ?? path.resolve(baseDir, process.env.MOCKS_DIR || "mocks"),
    // Cartella dei file dati JSON referenziabili dagli handler/middleware via data() (pagina Dati).
    filesDir:
      overrides.filesDir ?? path.resolve(baseDir, process.env.FILES_DIR || "files"),
    // Cartella dell'interfaccia compilata da servire (es. app desktop). Assente = non servita.
    uiDistDir: uiDistDir ? path.resolve(baseDir, uiDistDir) : undefined,
    // Interfaccia di rete su cui ascoltare. Default 127.0.0.1 (solo loopback); 0.0.0.0 espone
    // su tutte le interfacce. Le immagini Docker impostano HOST=0.0.0.0 (il loopback del
    // container non è raggiungibile dal port mapping).
    host,
    // Host aggiuntivi ammessi dall'header Host verso l'admin API (guardia DNS-rebinding), oltre
    // ai nomi loopback: es. alias in /etc/hosts o l'IP del server su intranet.
    adminAllowedHosts: parseHostList(
      overrides.adminAllowedHosts ?? process.env.ADMIN_ALLOWED_HOSTS
    ),
    devWatch,
    // Polling del watcher opt-in: chokidar 4 usa eventi nativi affidabili anche su Windows, e
    // il polling su tutta la cartella dei mock è CPU sprecata in idle. Resta attivabile con
    // CHOKIDAR_USEPOLLING=true dove gli eventi nativi non arrivano (Docker, cartelle di rete).
    watchUsePolling: parseBoolean(
      overrides.watchUsePolling ?? process.env.CHOKIDAR_USEPOLLING,
      false
    ),
    monitorDumpDir:
      overrides.monitorDumpDir ?? path.resolve(baseDir, process.env.MONITOR_DUMP_DIR || "monitor-dump"),
    monitorDumpIntervalMs: parseNumber(
      overrides.monitorDumpIntervalMs ?? process.env.MONITOR_DUMP_INTERVAL_MS,
      DEFAULT_MONITOR_DUMP_INTERVAL_MS
    ),
    monitorDumpThreshold: parseNumber(
      overrides.monitorDumpThreshold ?? process.env.MONITOR_DUMP_THRESHOLD,
      DEFAULT_MONITOR_DUMP_THRESHOLD
    ),
    monitorDumpMaxFileBytes: parseNumber(
      overrides.monitorDumpMaxFileBytes ?? process.env.MONITOR_DUMP_MAX_FILE_BYTES,
      DEFAULT_MONITOR_DUMP_MAX_FILE_BYTES
    ),
    monitorDumpMaxTotalBytes: parseNumber(
      overrides.monitorDumpMaxTotalBytes ?? process.env.MONITOR_DUMP_MAX_TOTAL_BYTES,
      DEFAULT_MONITOR_DUMP_MAX_TOTAL_BYTES
    ),
  };

  config.watchEnabled = shouldEnableWatch({ devWatch: config.devWatch, nodeEnv });

  // BACKEND_URL is optional: the server runs in mock-only mode without it and only
  // reports a missing backend when a request actually needs to reach the backend.
  if (config.backendUrl) {
    try {
      validateBackendUrl(config.backendUrl);
    } catch (error) {
      throw new Error(createInvalidBackendUrlMessage(config.backendUrl));
    }
  }

  return config;
}

module.exports = {
  createInvalidBackendUrlMessage,
  createInvalidDelayMessage,
  createMissingBackendUrlMessage,
  loadConfig,
  normalizeString,
  parseCliArgs,
  parseBoolean,
  parseDelayValue,
  parseNumber,
  shouldEnableAdminApi,
  shouldEnableWatch,
  validateBackendUrl,
  WORKSPACE_SETTING_DEFAULTS,
};
