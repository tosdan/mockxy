const fs = require("fs");
const path = require("path");
const Module = require("module");

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

// Svuota dalla cache dei moduli tutti i file sotto rootDir, così il require successivo li
// ricompila freschi. È ciò che rende l'hot reload valido anche per i moduli annidati: un helper
// condiviso nella cartella dei mock, modificato su disco, non resta "congelato" nella cache.
// Si usa `Module._cache` (non `require.cache`): è la cache che i moduli compilati con `_compile`
// consultano davvero; sotto un module system sostituito (es. Jest) `require.cache` può essere
// una cache intercettata diversa da quella reale.
function purgeModuleCacheUnder(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  for (const cachedPath of Object.keys(Module._cache)) {
    const relativePath = path.relative(resolvedRoot, cachedPath);
    if (relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      delete Module._cache[cachedPath];
    }
  }
}

// Compila uno script CommonJS e ne restituisce la definizione esportata più il record del
// modulo (per ispezionarne le dipendenze). La freschezza dipende dalla cache: il chiamante che
// vuole l'hot reload svuota prima con purgeModuleCacheUnder.
// Interop con export ES default: `module.exports.default` ha la precedenza se presente.
//
// `mocksDir` è obbligatorio: viene accodato ai percorsi di risoluzione, così lo script può
// importare dalla radice dei mock (`require("_shared/helper")`) con la stessa stringa a
// qualsiasi profondità; un mock copiato o spostato non rompe il riferimento. Sta in coda, dopo
// i node_modules: i pacchetti npm mantengono la precedenza (npm non ammette nomi che iniziano
// con `_`, quindi `_shared` non può collidere con un pacchetto pubblicato). Vale solo per lo
// script di primo livello: i moduli che richiede risolvono con le regole standard di Node, e
// gli helper si importano tra loro con path relativi. Nessun fallback alla directory corrente:
// un chiamante che dimentica la radice deve fallire subito, non risolvere a metà.
function loadScriptModule(filePath, mocksDir) {
  if (typeof mocksDir !== "string" || mocksDir.trim() === "") {
    throw new Error("loadScriptModule requires the mocks directory as resolution root");
  }
  const source = fs.readFileSync(filePath, "utf8");
  const scriptModule = new Module(filePath);
  scriptModule.filename = filePath;
  scriptModule.paths = [...Module._nodeModulePaths(path.dirname(filePath)), path.resolve(mocksDir)];
  scriptModule._compile(source, filePath);
  const loadedModule = scriptModule.exports;
  const definition = loadedModule?.default || loadedModule;
  return { definition, moduleRecord: scriptModule };
}

// Elenca i file locali (esclusi node_modules) richiesti in cascata dal modulo: le dipendenze la
// cui modifica deve invalidare la cache dello script.
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

module.exports = {
  purgeModuleCacheUnder,
  loadScriptModule,
  collectLocalDependencyFiles,
};
