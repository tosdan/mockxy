// "Cervello" del workspace.
//
// Dato il percorso di una cartella, questo modulo sa dov'è la parte CONDIVISA (i mock, che vanno
// in git) e dov'è la parte LOCALE (impostazioni e traffico catturato, fuori da git). Sa
// inizializzare una cartella nuova come workspace, riconoscere una cartella già-workspace, e
// leggere/scrivere le impostazioni locali. Non dipende da Electron: è testabile come desktop-server.

const fs = require("fs");
const path = require("path");

const MARKER_FILE = "mockxy.json"; // condiviso (in git): marca la cartella come workspace
const SERVICE_DIR = ".mockxy"; // locale (fuori da git): impostazioni + dati di lavoro
const SETTINGS_FILE = "settings.json"; // dentro SERVICE_DIR
const MONITOR_DUMP_DIR = "monitor-dump"; // dentro SERVICE_DIR
const MOCKS_DIR = "mocks"; // condiviso (in git)
const FILES_DIR = "files"; // condiviso (in git): file dati JSON per handler/middleware (pagina Dati)
const FORMAT_VERSION = 1;

// Righe che il .gitignore del workspace deve sempre contenere, per tenere fuori da git la parte
// locale.
const GITIGNORE_LINES = [
  "# mockxy: dati locali del workspace, non condividere",
  `${SERVICE_DIR}/`,
];

// Righe scritte da versioni precedenti e non più usate (es. lo stato per-cartella .folder.json,
// mai più generato): all'apertura vengono rimosse, così i .gitignore dei workspace esistenti si
// ripuliscono da soli. Solo match esatto della riga: si tocca ciò che è stato scritto da noi.
const OBSOLETE_GITIGNORE_LINES = ["**/mocks/**/.folder.json"];

// Calcolo puro dei percorsi dentro un workspace (nessun accesso al disco).
function workspacePaths(root) {
  const serviceDir = path.join(root, SERVICE_DIR);
  return {
    root,
    markerFile: path.join(root, MARKER_FILE),
    mocksDir: path.join(root, MOCKS_DIR),
    filesDir: path.join(root, FILES_DIR),
    serviceDir,
    settingsFile: path.join(serviceDir, SETTINGS_FILE),
    monitorDumpDir: path.join(serviceDir, MONITOR_DUMP_DIR),
    gitignoreFile: path.join(root, ".gitignore"),
  };
}

// Una cartella è già un nostro workspace se contiene il file segnaposto condiviso.
function isWorkspace(root) {
  return fs.existsSync(workspacePaths(root).markerFile);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// Assicura che il .gitignore contenga le righe per la parte locale (senza duplicare quelle già
// presenti) e rimuova le righe obsolete delle versioni precedenti. Il resto del file non si tocca.
function ensureGitignore(gitignoreFile) {
  const existing = fs.existsSync(gitignoreFile) ? fs.readFileSync(gitignoreFile, "utf8") : "";
  const cleanedLines = existing
    .split(/\r?\n/)
    .filter((line) => !OBSOLETE_GITIGNORE_LINES.includes(line.trim()));
  const cleaned = cleanedLines.join("\n");
  const existingLines = new Set(cleanedLines.map((line) => line.trim()));
  const missing = GITIGNORE_LINES.filter((line) => !existingLines.has(line.trim()));
  if (missing.length === 0 && cleaned === existing) {
    return;
  }
  const prefix = cleaned.length === 0 || cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`;
  fs.writeFileSync(gitignoreFile, missing.length > 0 ? `${prefix}${missing.join("\n")}\n` : prefix, "utf8");
}

// Legge le impostazioni locali del workspace (porta, ...); undefined se non ci sono ancora.
function readSettings(root) {
  return readJsonIfExists(workspacePaths(root).settingsFile);
}

// Scrive (fondendole) le impostazioni locali del workspace.
function updateSettings(root, patch) {
  const paths = workspacePaths(root);
  fs.mkdirSync(paths.serviceDir, { recursive: true });
  const current = readJsonIfExists(paths.settingsFile) || {};
  const next = { ...current, ...patch };
  writeJson(paths.settingsFile, next);
  return next;
}

// Apre (e se serve inizializza) un workspace, restituendo la configurazione risolta da passare al
// motore: cartella dei mock, cartella del dump locale, porta.
// - cartella nuova → crea la parte condivisa (segnaposto, mocks/, .gitignore) e quella locale;
// - cartella clonata (segnaposto presente, parte locale assente) → ricrea solo la parte locale;
// - workspace già completo → lascia tutto com'è (la porta salvata vince sul default).
// La porta di default la fornisce il chiamante, così il modulo resta senza effetti di rete.
function openWorkspace(root, { defaultPort } = {}) {
  const paths = workspacePaths(root);

  // Parte condivisa: il segnaposto si crea solo se la cartella non è ancora un workspace.
  if (!isWorkspace(root)) {
    fs.mkdirSync(paths.mocksDir, { recursive: true });
    writeJson(paths.markerFile, { formatVersion: FORMAT_VERSION });
  } else {
    fs.mkdirSync(paths.mocksDir, { recursive: true }); // tollerante: garantisce che esista
  }
  fs.mkdirSync(paths.filesDir, { recursive: true }); // condivisa come i mock, garantita sempre
  ensureGitignore(paths.gitignoreFile);

  // Parte locale: sempre garantita (copre anche il caso "cartella clonata").
  fs.mkdirSync(paths.monitorDumpDir, { recursive: true });
  const existing = readSettings(root) || {};
  const port = typeof existing.port === "number" ? existing.port : defaultPort;
  const settings = updateSettings(root, typeof port === "number" ? { port } : {});

  return {
    root,
    mocksDir: paths.mocksDir,
    filesDir: paths.filesDir,
    monitorDumpDir: paths.monitorDumpDir,
    port: settings.port,
    // URL del backend reale (impostazione locale per-workspace); vuoto/assente = solo mock.
    backendUrl: settings.backendUrl,
    // Interfaccia di bind (locale): '127.0.0.1' (loopback) o '0.0.0.0' (rete); assente = default loopback.
    host: settings.host,
    // Filtri automatici case-insensitive (impostazione locale per-workspace); assente = default (true).
    caseInsensitiveFilters: settings.caseInsensitiveFilters,
    // Altre impostazioni comportamentali locali per-workspace; assenti = default del motore.
    proxyFallbackEnabled: settings.proxyFallbackEnabled,
    corsEnabled: settings.corsEnabled,
    adaptProxyCookies: settings.adaptProxyCookies,
    rewriteProxyRedirects: settings.rewriteProxyRedirects,
    globalDelayMs: settings.globalDelayMs,
    delayAllRequests: settings.delayAllRequests,
    requestTimeoutMs: settings.requestTimeoutMs,
    monitorDumpIntervalMs: settings.monitorDumpIntervalMs,
    monitorDumpThreshold: settings.monitorDumpThreshold,
    monitorDumpMaxFileBytes: settings.monitorDumpMaxFileBytes,
    monitorDumpMaxTotalBytes: settings.monitorDumpMaxTotalBytes,
  };
}

// Segnaposto condiviso (mockxy.json, in git): può contenere un titolo personalizzato.
function readMarker(root) {
  return readJsonIfExists(workspacePaths(root).markerFile) || {};
}

// Titolo personalizzato del workspace (condiviso), o null se non impostato.
function getWorkspaceTitle(root) {
  const title = readMarker(root).title;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : null;
}

// Nome da mostrare: il titolo personalizzato se c'è, altrimenti il nome della cartella.
function getWorkspaceName(root) {
  return getWorkspaceTitle(root) || path.basename(root);
}

// Imposta (o azzera, se vuoto) il titolo personalizzato nel segnaposto condiviso.
function setWorkspaceName(root, title) {
  const marker = readMarker(root);
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (trimmed === "") {
    delete marker.title;
  } else {
    marker.title = trimmed;
  }
  if (typeof marker.formatVersion !== "number") {
    marker.formatVersion = FORMAT_VERSION;
  }
  writeJson(workspacePaths(root).markerFile, marker);
  return getWorkspaceName(root);
}

module.exports = {
  MARKER_FILE,
  SERVICE_DIR,
  workspacePaths,
  isWorkspace,
  readSettings,
  updateSettings,
  openWorkspace,
  getWorkspaceTitle,
  getWorkspaceName,
  setWorkspaceName,
};
