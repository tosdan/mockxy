const fs = require("fs");
const path = require("path");
const {
  collectLocalDependencyFiles,
  findImportedEntrypoints,
  loadScriptModule,
  refreshModulesForValidation,
} = require("./script-loader");
const { findContractViolations } = require("./script-contract");
const {
  PACKAGE_FILE,
  canonicalRoot,
  describeImportedEntrypoint,
  describeScriptLoadFailure,
  inspectScriptPackage,
} = require("./script-package");

// Validazione completa degli script di un workspace: l'unica implementazione, esposta dalla
// rotta admin e dalla riga di comando.
//
// A differenza del reload, che carica solo le varianti selezionate degli endpoint abilitati,
// controlla TUTTI gli script handler e middleware, e tratta le violazioni del contratto come
// errori. Compila con lo stesso loader del runtime: eseguire il livello superiore di uno script
// fa parte del caricarlo. Non installa rotte e non tocca lo stato del runtime.
//
// È sincrona di proposito: nel processo del server gira come un blocco unico rispetto alle
// scansioni, quindi nessuna delle due svuota la cache dei moduli nel mezzo dell'altra.

const SCRIPT_PATTERN = /\.(handler|middleware)\.js$/;
// Problemi del package che non impediscono nulla agli script conformi.
const PACKAGE_WARNING_CODES = new Set(["SCRIPT_PACKAGE_EXTRA_ALIAS", "SCRIPT_PACKAGE_NOT_CREATABLE"]);

function walk(rootDir, visitFile) {
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (_error) {
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        walk(entryPath, visitFile);
      }
    } else if (entry.isFile()) {
      visitFile(entryPath, entry.name);
    }
  }
}

function insideRoot(root, filePath) {
  const relativePath = path.relative(root, filePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function requiredFunctionOf(scriptPath) {
  return scriptPath.endsWith(".middleware.js") ? "transformResponse" : "resolveResponse";
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

// Violazioni del contratto di uno script già compilato. Con `includeDependencies` analizza
// anche gli helper locali che raggiunge (validazione completa); senza, solo lo script stesso
// (salvataggio dall'admin: si giudica ciò che l'utente ha appena scritto).
function findScriptContractFindings({ scriptPath, moduleRecord, mocksDir, includeDependencies, analyzedFiles }) {
  const root = canonicalRoot(mocksDir);
  const findings = [];
  const analyze = (filePath) => {
    if (analyzedFiles != null) {
      if (analyzedFiles.has(filePath)) {
        return;
      }
      analyzedFiles.add(filePath);
    }
    let source;
    try {
      source = fs.readFileSync(filePath, "utf8");
    } catch (_error) {
      return;
    }
    for (const violation of findContractViolations(source)) {
      findings.push({ ...violation, filePath });
    }
  };

  analyze(scriptPath);
  for (const entrypointPath of findImportedEntrypoints(moduleRecord)) {
    findings.push({ ...describeImportedEntrypoint(scriptPath, entrypointPath), filePath: scriptPath });
  }
  if (includeDependencies) {
    for (const dependencyPath of collectLocalDependencyFiles(moduleRecord)) {
      if (!insideRoot(root, dependencyPath) && !insideRoot(path.resolve(mocksDir), dependencyPath)) {
        findings.push({
          code: "SCRIPT_DEPENDENCY_OUTSIDE_WORKSPACE",
          filePath: scriptPath,
          message: `${path.basename(scriptPath)} reaches ${dependencyPath}, outside the mocks folder: code outside the workspace is not reloaded; keep local helpers under the mocks folder.`,
        });
      } else if (/\.c?js$/.test(dependencyPath)) {
        analyze(dependencyPath);
      }
    }
  }
  return findings;
}

function validateWorkspaceScripts(mocksDir) {
  const root = canonicalRoot(mocksDir);
  const errors = [];
  const warnings = [];
  const relative = (filePath) => {
    for (const base of [root, path.resolve(mocksDir)]) {
      if (insideRoot(base, filePath)) {
        return path.relative(base, filePath).split(path.sep).join("/");
      }
    }
    return filePath;
  };
  const report = (list, finding) => {
    list.push({
      code: finding.code,
      filePath: relative(finding.filePath),
      ...(finding.line != null ? { line: finding.line, column: finding.column } : {}),
      message: finding.message,
    });
  };

  const scripts = [];
  const nestedPackages = [];
  walk(root, (filePath, name) => {
    if (SCRIPT_PATTERN.test(name)) {
      scripts.push(filePath);
    } else if (name === PACKAGE_FILE && path.dirname(filePath) !== root) {
      nestedPackages.push(filePath);
    }
  });

  refreshModulesForValidation(mocksDir);
  const analyzedFiles = new Set();
  for (const scriptPath of scripts) {
    let loaded;
    try {
      loaded = loadScriptModule(scriptPath, mocksDir);
    } catch (error) {
      report(errors, {
        code: "SCRIPT_LOAD_FAILED",
        filePath: scriptPath,
        message: describeScriptLoadFailure(error, mocksDir, scriptPath),
      });
      continue;
    }

    const requiredFunction = requiredFunctionOf(scriptPath);
    const { definition } = loaded;
    if (!isPlainObject(definition) || typeof definition[requiredFunction] !== "function") {
      report(errors, {
        code: "SCRIPT_INVALID_EXPORT",
        filePath: scriptPath,
        message: `The script must export an object with a ${requiredFunction} function.`,
      });
    } else if (definition.method != null || definition.path != null || definition.disabled != null) {
      report(errors, {
        code: "SCRIPT_INVALID_EXPORT",
        filePath: scriptPath,
        message: "The script must not declare method, path or disabled: routing belongs to the endpoint file.",
      });
    }

    const findings = findScriptContractFindings({
      scriptPath,
      moduleRecord: loaded.moduleRecord,
      mocksDir,
      includeDependencies: true,
      analyzedFiles,
    });
    for (const finding of findings) {
      report(errors, finding);
    }
  }

  for (const packagePath of nestedPackages) {
    report(errors, {
      code: "SCRIPT_PACKAGE_NESTED",
      filePath: packagePath,
      message: `A nested ${PACKAGE_FILE} changes the package scope of the scripts below it, so the #shared/ alias does not apply there: keep a single ${PACKAGE_FILE} at the root of the mocks folder.`,
    });
  }

  // Un package incompatibile è un errore solo se ci sono script che ne dipendono.
  for (const warning of inspectScriptPackage(mocksDir, { strict: true }).warnings) {
    const asWarning = PACKAGE_WARNING_CODES.has(warning.code) || scripts.length === 0;
    report(asWarning ? warnings : errors, warning);
  }

  const byLocation = (left, right) =>
    left.filePath.localeCompare(right.filePath) || (left.line || 0) - (right.line || 0) || left.code.localeCompare(right.code);
  return {
    ok: errors.length === 0,
    mocksDir: root,
    scripts: scripts.length,
    errors: errors.sort(byLocation),
    warnings: warnings.sort(byLocation),
  };
}

module.exports = {
  findScriptContractFindings,
  validateWorkspaceScripts,
};
