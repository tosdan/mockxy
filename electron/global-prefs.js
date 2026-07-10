// Preferenze utente globali dell'app desktop.
//
// Sono le cose che riguardano TE, indipendentemente dal progetto: l'elenco dei workspace aperti
// di recente (quindi l'ultimo aperto). Per la portabilità vivono accanto all'eseguibile: il
// processo principale di Electron calcola quella cartella e la passa qui come `configDir`.
// Nessuna dipendenza da Electron, quindi testabile come gli altri moduli.

const fs = require("fs");
const path = require("path");

const PREFS_FILE = "mockxy-prefs.json";
const DEFAULT_MAX_RECENT = 10;

function prefsFilePath(configDir) {
  return path.join(configDir, PREFS_FILE);
}

// Normalizza un percorso per confronti coerenti (lo stesso workspace via forme diverse → uguale).
function normalize(workspacePath) {
  return path.resolve(workspacePath);
}

function readPrefs(configDir) {
  const file = prefsFilePath(configDir);
  if (!fs.existsSync(file)) {
    return { recentWorkspaces: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const recentWorkspaces = Array.isArray(parsed.recentWorkspaces) ? parsed.recentWorkspaces : [];
    return { ...parsed, recentWorkspaces };
  } catch {
    return { recentWorkspaces: [] };
  }
}

function writePrefs(configDir, prefs) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(prefsFilePath(configDir), `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
  return prefs;
}

// Porta un workspace in cima all'elenco dei recenti (dedup per percorso + cap al massimo).
function addRecentWorkspace(configDir, workspacePath, { max = DEFAULT_MAX_RECENT } = {}) {
  const target = normalize(workspacePath);
  const prefs = readPrefs(configDir);
  const others = prefs.recentWorkspaces.filter((p) => normalize(p) !== target);
  prefs.recentWorkspaces = [target, ...others].slice(0, max);
  return writePrefs(configDir, prefs);
}

function getRecentWorkspaces(configDir) {
  return readPrefs(configDir).recentWorkspaces;
}

// L'ultimo workspace aperto (la cima dei recenti), oppure null se non ce ne sono.
function getLastWorkspace(configDir) {
  return readPrefs(configDir).recentWorkspaces[0] || null;
}

// Rimuove un workspace dai recenti (utile quando la cartella non esiste più).
function removeRecentWorkspace(configDir, workspacePath) {
  const target = normalize(workspacePath);
  const prefs = readPrefs(configDir);
  prefs.recentWorkspaces = prefs.recentWorkspaces.filter((p) => normalize(p) !== target);
  return writePrefs(configDir, prefs);
}

// Dimensione/posizione (e stato massimizzato) dell'ultima finestra, per riaprirla com'era.
function getWindowBounds(configDir) {
  const bounds = readPrefs(configDir).window;
  return bounds && typeof bounds === "object" ? bounds : null;
}

function setWindowBounds(configDir, bounds) {
  const prefs = readPrefs(configDir);
  prefs.window = bounds;
  return writePrefs(configDir, prefs);
}

// Lingua dell'interfaccia (globale): è condivisa tra l'app (servita dal motore) e la view di benvenuto
// (pagina statica), che hanno localStorage separati e quindi non possono scambiarsela da sole.
function getLanguage(configDir) {
  const lang = readPrefs(configDir).language;
  return lang === "it" || lang === "en" ? lang : null;
}

function setLanguage(configDir, lang) {
  if (lang !== "it" && lang !== "en") {
    return readPrefs(configDir);
  }
  const prefs = readPrefs(configDir);
  prefs.language = lang;
  return writePrefs(configDir, prefs);
}

module.exports = {
  PREFS_FILE,
  prefsFilePath,
  readPrefs,
  writePrefs,
  addRecentWorkspace,
  getRecentWorkspaces,
  getLastWorkspace,
  removeRecentWorkspace,
  getWindowBounds,
  setWindowBounds,
  getLanguage,
  setLanguage,
};
