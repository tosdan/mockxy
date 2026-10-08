const fs = require("fs");
const path = require("path");
const Module = require("module");
const { canonicalRoot, prepareScriptPackage } = require("./script-package");

const ENTRYPOINT_PATTERN = /\.(handler|middleware)\.js$/;

// Caricamento condiviso degli script utente (handler/middleware). Prima questa logica era
// duplicata in endpoint-loader.js e nel modulo admin di validazione; qui è una sola.
//
// Nota sulle API di Node usate. Il caricamento usa `Module.prototype._compile` e
// `Module._nodeModulePaths`, non contrattuali. È una scelta consapevole: l'alternativa pubblica
// (`createRequire`, o `vm` + un require creato con `createRequire`) instrada i require ANNIDATI
// dello script attraverso una cache dei moduli separata quando il module system è sostituito
// (es. Jest), dove la `delete` sulla `.cache` non forza il ricaricamento. Risultato: l'hot
// reload di un helper condiviso — funzione reale del prodotto, coperta dai test — non sarebbe
// più verificabile. `_compile` invece compila nella cache nativa `Module._cache`, l'unica che la
// pulizia qui sotto può invalidare in modo coerente sia in produzione sia sotto i test. Le due
// API sono comunque stabilissime (le usa mezzo ecosistema: ts-node, babel-register, …) e il
// progetto richiede Node >=24. L'unica API *deprecata* — il vecchio `module.parent` passato al
// costruttore — è stata rimossa (il parent non serve: i path di risoluzione sono impostati a
// mano con `_nodeModulePaths`).
//
// La cache CommonJS è l'unica cache degli script: a ogni scansione si svuotano i moduli locali
// del workspace e si ricompilano gli script selezionati. Non esiste una cache delle definizioni:
// il contratto degli script (dipendenze importate in cima al modulo, stato in `state` e
// `sharedState`, nessun effetto al caricamento) rende la ricompilazione sempre sicura, e toglie
// di mezzo ogni confronto di firme.

// Svuota dalla cache dei moduli i file locali del workspace, così il require successivo li
// ricompila freschi. È ciò che rende l'hot reload valido anche per i moduli annidati: un helper
// condiviso nella cartella dei mock, modificato su disco, non resta "congelato" nella cache.
// Si usa `Module._cache` (non `require.cache`): è la cache che i moduli compilati con `_compile`
// consultano davvero; sotto un module system sostituito (es. Jest) `require.cache` può essere
// una cache intercettata diversa da quella reale.
//
// Il confronto copre sia il percorso configurato sia quello reale: Node registra i moduli
// annidati con il percorso reale, quindi con una radice raggiunta da un symlink il solo
// `path.resolve` non troverebbe nulla da svuotare e gli helper resterebbero stantii. I pacchetti
// in `node_modules` restano fuori: il loro ciclo di vita non è quello del workspace.
function purgeModuleCacheUnder(rootDir) {
  const roots = [...new Set([path.resolve(rootDir), canonicalRoot(rootDir)])];
  for (const cachedPath of Object.keys(Module._cache)) {
    if (roots.some((root) => isLocalModulePath(root, cachedPath))) {
      delete Module._cache[cachedPath];
    }
  }
}

function isLocalModulePath(root, filePath) {
  const relativePath = path.relative(root, filePath);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return false;
  }
  return !relativePath.split(path.sep).includes("node_modules");
}

// Scansioni in corso, per radice canonica. Una compilazione fuori scansione (validazione admin)
// vuole dipendenze fresche, ma non deve svuotare la cache nel mezzo di una scansione: i require
// di uno stesso giro devono vedere le stesse istanze degli helper.
const activeScans = new Map();

function beginScan(rootDir) {
  const root = canonicalRoot(rootDir);
  activeScans.set(root, (activeScans.get(root) || 0) + 1);
  purgeModuleCacheUnder(rootDir);
  return () => {
    const remaining = (activeScans.get(root) || 1) - 1;
    if (remaining > 0) {
      activeScans.set(root, remaining);
    } else {
      activeScans.delete(root);
    }
  };
}

// Prima di una compilazione fuori scansione: svuota la cache dei moduli locali, a meno che una
// scansione dello stesso workspace sia in corso (che l'ha appena svuotata e la sta riempiendo).
function refreshModulesForValidation(rootDir) {
  if (!activeScans.has(canonicalRoot(rootDir))) {
    purgeModuleCacheUnder(rootDir);
  }
}

// Compila uno script CommonJS e ne restituisce la definizione esportata più il record del
// modulo (per ispezionarne le dipendenze). La freschezza dipende dalla cache: il chiamante che
// vuole l'hot reload svuota prima con beginScan o refreshModulesForValidation.
// Interop con export ES default: `module.exports.default` ha la precedenza se presente.
//
// `mocksDir` è obbligatorio: individua il package degli script, che va preparato PRIMA del
// primo script di quel workspace nel processo (vedi script-package.js). Farlo qui, nell'unico
// punto che compila, vale per ogni ingresso: scansione, salvataggio admin, validazione. Gli
// helper condivisi si importano con l'alias nativo `#shared/`, che Node risolve per ogni modulo
// sotto la radice: lo script non riceve percorsi di risoluzione speciali.
function loadScriptModule(filePath, mocksDir) {
  if (typeof mocksDir !== "string" || mocksDir.trim() === "") {
    throw new Error("loadScriptModule requires the mocks directory of the workspace");
  }
  prepareScriptPackage(mocksDir);
  const source = fs.readFileSync(filePath, "utf8");
  const scriptModule = new Module(filePath);
  scriptModule.filename = filePath;
  scriptModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  scriptModule._compile(source, filePath);
  const loadedModule = scriptModule.exports;
  const definition = loadedModule?.default || loadedModule;
  return { definition, moduleRecord: scriptModule };
}

// Elenca i file locali (esclusi node_modules) richiesti in cascata dal modulo.
function collectLocalDependencyFiles(moduleRecord) {
  const files = [];
  const visited = new Set();
  const walk = (currentModule) => {
    for (const child of currentModule?.children || []) {
      if (child.filename == null || visited.has(child.filename)) {
        continue;
      }
      visited.add(child.filename);
      if (child.filename.includes(`${path.sep}node_modules${path.sep}`)) {
        continue;
      }
      files.push(child.filename);
      walk(child);
    }
  };
  walk(moduleRecord);
  return files;
}

// Handler e middleware sono punti di ingresso: importarli come dipendenze è una violazione del
// contratto degli script (la logica riusabile va in un helper). Restituisce quelli raggiunti.
function findImportedEntrypoints(moduleRecord) {
  return collectLocalDependencyFiles(moduleRecord).filter((filePath) => ENTRYPOINT_PATTERN.test(filePath));
}

module.exports = {
  purgeModuleCacheUnder,
  beginScan,
  refreshModulesForValidation,
  loadScriptModule,
  collectLocalDependencyFiles,
  findImportedEntrypoints,
};
