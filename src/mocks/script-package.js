const fs = require("fs");
const path = require("path");
const Module = require("module");

// Package degli script di un workspace: `mocks/package.json`.
//
// Gli helper condivisi si importano con l'alias nativo di Node `#shared/` (campo `imports` del
// package più vicino al file che importa). Node risolve l'alias per ogni modulo sotto la radice
// dei mock, chiunque lo carichi: nessun resolver nostro, nessun registro di workspace.
//
// Due fatti di Node governano questo modulo:
//
// 1. Node legge il package una volta per processo e ne conserva l'esito, ANCHE quando il file
//    non c'è. Aggiungerlo o cambiarlo dopo aver caricato uno script di quel workspace non ha
//    effetto fino al riavvio del processo, e svuotare `Module._cache` non basta. Per questo il
//    package va preparato PRIMA del primo script (prepareScriptPackage, chiamata dal loader) e
//    quello che il processo ha osservato va ricordato per processo, non per runtime: nell'app
//    desktop il runtime si ricrea a ogni cambio di workspace, il processo no.
// 2. Tutti i fallimenti dell'alias (package assente, annidato, estensione mancante) producono
//    lo stesso `MODULE_NOT_FOUND`. explainScriptLoadError li distingue verificando le condizioni
//    sul disco; il testo dell'errore di Node serve solo da indizio.

const PACKAGE_FILE = "package.json";
const SHARED_DIR = "_shared";
const SHARED_ALIAS = "#shared/*";
const SHARED_TARGET = `./${SHARED_DIR}/*`;
const SHARED_PREFIX = "#shared/";

const STANDARD_PACKAGE = Object.freeze({
  private: true,
  type: "commonjs",
  imports: { [SHARED_ALIAS]: SHARED_TARGET },
});

// Radice canonica -> { loaded, snapshot, createError, createdNotice }. Per processo.
const observedRoots = new Map();

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

// Stessa forma che Node dà ai nomi dei moduli annidati: realpath "JS", non `.native`.
function canonicalRoot(mocksDir) {
  try {
    return fs.realpathSync(mocksDir);
  } catch (_error) {
    return path.resolve(mocksDir);
  }
}

function getRootEntry(mocksDir) {
  const root = canonicalRoot(mocksDir);
  let entry = observedRoots.get(root);
  if (entry == null) {
    entry = { root, loaded: false, snapshot: null, createError: null, createdNotice: false };
    observedRoots.set(root, entry);
  }
  return entry;
}

function readPackageState(packagePath) {
  let raw;
  try {
    raw = fs.readFileSync(packagePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return { exists: false };
    }
    return { exists: true, unreadable: error.code || error.message };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { exists: true, invalidJson: error.message };
  }
  if (!isPlainObject(parsed)) {
    return { exists: true, invalidJson: "the content is not a JSON object" };
  }
  return { exists: true, type: parsed.type, imports: parsed.imports };
}

// Solo ciò che cambia la risoluzione degli script: `type` e `imports`. L'ordine delle chiavi di
// `imports` non conta per Node, quindi non deve contare nemmeno qui.
function fingerprint(state) {
  if (!state.exists) {
    return "absent";
  }
  if (state.unreadable != null || state.invalidJson != null) {
    return `broken:${state.unreadable || state.invalidJson}`;
  }
  const imports = isPlainObject(state.imports)
    ? Object.keys(state.imports).sort().map((key) => [key, state.imports[key]])
    : state.imports ?? null;
  return JSON.stringify({ type: state.type ?? null, imports });
}

function isReservedSharedKey(key) {
  return key !== SHARED_ALIAS && (key === "#shared" || key.startsWith(SHARED_PREFIX));
}

// Problemi che rendono il package incompatibile con il contratto. Un file presente ma
// illeggibile o non valido non equivale a uno assente: va distinto e non riscritto.
function findPackageIssues(state) {
  if (!state.exists) {
    return [];
  }
  if (state.unreadable != null) {
    return [{ code: "SCRIPT_PACKAGE_UNREADABLE", detail: `the file cannot be read (${state.unreadable})` }];
  }
  if (state.invalidJson != null) {
    return [{ code: "SCRIPT_PACKAGE_INVALID", detail: `the file is not valid JSON (${state.invalidJson})` }];
  }

  const issues = [];
  if (state.type != null && state.type !== "commonjs") {
    issues.push({
      code: "SCRIPT_PACKAGE_INCOMPATIBLE",
      detail: `"type" is ${JSON.stringify(state.type)}: set it to "commonjs" or remove it`,
    });
  }
  if (!isPlainObject(state.imports) || state.imports[SHARED_ALIAS] !== SHARED_TARGET) {
    issues.push({
      code: "SCRIPT_PACKAGE_INCOMPATIBLE",
      detail: `"imports" must contain ${JSON.stringify(SHARED_ALIAS)}: ${JSON.stringify(SHARED_TARGET)}`,
    });
  }
  if (isPlainObject(state.imports)) {
    const reserved = Object.keys(state.imports).filter(isReservedSharedKey);
    if (reserved.length > 0) {
      issues.push({
        code: "SCRIPT_PACKAGE_INCOMPATIBLE",
        detail: `"imports" redefines the reserved #shared namespace (${reserved.join(", ")}): remove those keys`,
      });
    }
  }
  return issues;
}

// Alias diversi da `#shared/*`: Node li risolve, ma restano fuori dal contratto.
function findExtraAliases(state) {
  if (!state.exists || !isPlainObject(state.imports)) {
    return [];
  }
  return Object.keys(state.imports).filter((key) => key !== SHARED_ALIAS && !isReservedSharedKey(key));
}

function packagePathOf(root) {
  return path.join(root, PACKAGE_FILE);
}

// Da chiamare prima di compilare uno script del workspace. Al primo script del processo per
// quella radice crea il package standard se manca, e fotografa ciò che Node osserverà. Una
// radice in sola lettura non blocca nulla: resta registrato che il file non era creabile.
function prepareScriptPackage(mocksDir) {
  const entry = getRootEntry(mocksDir);
  if (entry.loaded) {
    return entry;
  }

  const packagePath = packagePathOf(entry.root);
  let state = readPackageState(packagePath);
  if (!state.exists) {
    try {
      // `wx`: mai sovrascrivere un file comparso nel frattempo.
      fs.writeFileSync(packagePath, `${JSON.stringify(STANDARD_PACKAGE, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      entry.createdNotice = true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        entry.createError = error.code || error.message;
      }
    }
    state = readPackageState(packagePath);
  }
  entry.snapshot = state;
  entry.loaded = true;
  return entry;
}

function toWarning(packagePath, code, detail) {
  return { code, filePath: packagePath, message: `${PACKAGE_FILE}: ${detail}.` };
}

// Stato del package e avvisi relativi. Senza `strict` (reload ordinario) parla solo dei
// workspace che hanno già caricato script: un package irrilevante in un workspace senza script
// non è un problema. Con `strict` (validazione completa) giudica comunque il file presente e
// segnala anche gli alias fuori contratto.
function inspectScriptPackage(mocksDir, { strict = false } = {}) {
  const entry = getRootEntry(mocksDir);
  const packagePath = packagePathOf(entry.root);
  const current = readPackageState(packagePath);
  const warnings = [];

  if (entry.loaded && fingerprint(current) !== fingerprint(entry.snapshot)) {
    warnings.push(toWarning(
      packagePath,
      "SCRIPT_PACKAGE_RESTART_REQUIRED",
      "the configuration changed after scripts of this workspace were loaded; Node keeps the one it read first, so restart Mockxy (the whole desktop app, not only the workspace) to apply it"
    ));
  }
  if (entry.loaded && !current.exists && entry.createError != null) {
    warnings.push(toWarning(
      packagePath,
      "SCRIPT_PACKAGE_NOT_CREATABLE",
      `the file is missing and cannot be created (${entry.createError}); scripts load normally, but #shared/ imports are unavailable`
    ));
  }
  if (entry.loaded || strict) {
    for (const issue of findPackageIssues(current)) {
      warnings.push(toWarning(packagePath, issue.code, issue.detail));
    }
  }
  if (strict) {
    const extraAliases = findExtraAliases(current);
    if (extraAliases.length > 0) {
      warnings.push(toWarning(
        packagePath,
        "SCRIPT_PACKAGE_EXTRA_ALIAS",
        `aliases outside the script contract (${extraAliases.join(", ")}); only #shared/ is supported`
      ));
    }
  }

  return { root: entry.root, packagePath, exists: current.exists, loaded: entry.loaded, warnings };
}

// Restituisce una volta sola il percorso del package appena creato, per segnalarlo nel log.
function consumeCreatedNotice(mocksDir) {
  const entry = getRootEntry(mocksDir);
  if (!entry.createdNotice) {
    return null;
  }
  entry.createdNotice = false;
  return packagePathOf(entry.root);
}

function insideRoot(root, filePath) {
  const relativePath = path.relative(root, filePath);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return relativePath;
}

// Perché l'alias non è disponibile per questa radice, secondo ciò che il processo ha osservato.
function describeAliasConfiguration(entry) {
  const packagePath = packagePathOf(entry.root);
  const current = readPackageState(packagePath);
  const effective = entry.loaded ? entry.snapshot : current;

  if (entry.loaded && fingerprint(current) !== fingerprint(effective)) {
    return `${packagePath} was added or changed after scripts of this workspace were loaded: restart Mockxy (the whole desktop app, not only the workspace) to apply it`;
  }
  if (!effective.exists) {
    return entry.createError != null
      ? `${packagePath} is missing and cannot be created (${entry.createError}), so the #shared/ alias is unavailable`
      : `${packagePath} is missing, so the #shared/ alias is unavailable`;
  }
  const issues = findPackageIssues(effective);
  return issues.length > 0 ? `${packagePath} does not define the standard alias: ${issues.map((issue) => issue.detail).join("; ")}` : null;
}

// Un `package.json` fra il file che importa e la radice dei mock ridefinisce l'ambito: per quel
// file il package più vicino non è più quello che contiene l'alias.
function findNestedPackage(root, importerPath) {
  let current = path.dirname(importerPath);
  while (insideRoot(root, current) != null) {
    const candidate = path.join(current, PACKAGE_FILE);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    current = path.dirname(current);
  }
  return null;
}

function existsAs(filePath, kind) {
  try {
    const stats = fs.statSync(filePath);
    return kind === "file" ? stats.isFile() : stats.isDirectory();
  } catch (_error) {
    return false;
  }
}

// Destinazione di un import `#shared/<resto>` che Node non ha trovato.
function describeMissingSharedTarget(root, rest) {
  const target = path.join(root, SHARED_DIR, rest);
  const alias = `${SHARED_PREFIX}${rest.split(path.sep).join("/")}`;
  if (existsAs(target, "file")) {
    return null;
  }
  if (existsAs(`${target}.js`, "file")) {
    return `${alias} has no extension: aliases do not add one, write ${alias}.js`;
  }
  if (existsAs(target, "directory")) {
    return `${alias} is a folder: aliases do not resolve index files, import the file explicitly (for example ${alias}/index.js)`;
  }
  return `${alias} does not exist: no file at ${target}`;
}

function isBareSpecifier(specifier) {
  return !/^(\.{1,2}([\\/]|$)|[\\/]|[a-zA-Z]:[\\/]|#|node:|file:|data:)/.test(specifier) && !Module.isBuiltin(specifier);
}

// Spiega un fallimento di caricamento dovuto alla risoluzione degli helper, oppure restituisce
// null. La causa originale resta nell'errore: questa è la spiegazione da affiancarle.
function explainScriptLoadError(error, mocksDir, scriptPath) {
  const code = error?.code;
  const entry = getRootEntry(mocksDir);
  if (code === "ERR_INVALID_PACKAGE_CONFIG") {
    return describeAliasConfiguration(entry);
  }
  if (code !== "MODULE_NOT_FOUND" && code !== "ERR_PACKAGE_IMPORT_NOT_DEFINED") {
    return null;
  }

  // Indizio: il primo testo fra apici del messaggio è lo specificatore o il percorso risolto.
  const hint = /['"]([^'"]+)['"]/.exec(String(error.message || ""))?.[1];
  if (hint == null) {
    return null;
  }
  const importer = Array.isArray(error.requireStack) && error.requireStack.length > 0 ? error.requireStack[0] : scriptPath;

  if (hint.startsWith(SHARED_PREFIX)) {
    const configurationProblem = describeAliasConfiguration(entry);
    if (configurationProblem != null) {
      return configurationProblem;
    }
    const nestedPackage = importer != null ? findNestedPackage(entry.root, importer) : null;
    if (nestedPackage != null && path.resolve(nestedPackage) !== packagePathOf(entry.root)) {
      return `${nestedPackage} changes the package scope of ${importer}, so the #shared/ alias of ${packagePathOf(entry.root)} does not apply there: remove the nested package.json`;
    }
    return describeMissingSharedTarget(entry.root, hint.slice(SHARED_PREFIX.length).split("/").join(path.sep));
  }

  if (path.isAbsolute(hint)) {
    const relativePath = insideRoot(path.join(entry.root, SHARED_DIR), hint);
    return relativePath != null ? describeMissingSharedTarget(entry.root, relativePath) : null;
  }

  // Import dalla radice della 1.5.0: `require("_shared/x.js")`, ritirato.
  if (isBareSpecifier(hint)) {
    const candidate = path.join(entry.root, hint.split("/").join(path.sep));
    if (existsAs(candidate, "file") || existsAs(`${candidate}.js`, "file") || existsAs(candidate, "directory")) {
      const rest = hint.split("/").slice(1).join("/");
      return hint.startsWith(`${SHARED_DIR}/`)
        ? `require("${hint}") used the root import of Mockxy 1.5.0, which was removed: write require("${SHARED_PREFIX}${rest}") with an explicit extension`
        : `require("${hint}") used the root import of Mockxy 1.5.0, which was removed: move the helper under ${SHARED_DIR}/ and import it with ${SHARED_PREFIX}, or use a relative path`;
    }
  }
  return null;
}

// Messaggio di un fallimento di caricamento: la spiegazione, quando c'è, più la causa originale.
function describeScriptLoadFailure(error, mocksDir, scriptPath) {
  const original = String(error?.message || error);
  let explanation = null;
  try {
    explanation = mocksDir == null ? null : explainScriptLoadError(error, mocksDir, scriptPath);
  } catch (_error) {
    // La diagnostica non deve mai nascondere l'errore che sta spiegando.
  }
  return explanation == null ? original : `${explanation}. Original error: ${original}`;
}

function describeImportedEntrypoint(scriptPath, entrypointPath) {
  return {
    code: "SCRIPT_ENTRYPOINT_IMPORTED",
    message: `${path.basename(scriptPath)} imports ${entrypointPath}: handler and middleware scripts are entry points and must not be imported by other scripts; move the shared logic to a helper under ${SHARED_DIR}/ and import it with ${SHARED_PREFIX}.`,
  };
}

// Solo per i test: il registro è per processo e i test condividono lo stesso processo.
function resetScriptPackageRegistry() {
  observedRoots.clear();
}

module.exports = {
  PACKAGE_FILE,
  SHARED_DIR,
  SHARED_PREFIX,
  STANDARD_PACKAGE,
  canonicalRoot,
  prepareScriptPackage,
  inspectScriptPackage,
  consumeCreatedNotice,
  explainScriptLoadError,
  describeScriptLoadFailure,
  describeImportedEntrypoint,
  findNestedPackage,
  resetScriptPackageRegistry,
};
