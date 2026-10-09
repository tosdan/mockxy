const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./config");
const { PACKAGE_FILE, SHARED_DIR, consumeCreatedNotice } = require("./mocks/script-package");
const { SCRIPT_PATTERN, validateWorkspaceScripts } = require("./mocks/workspace-validation");

// `node index.js validate [cartella] [--mocks-dir <cartella>] [--json]`: la validazione completa
// degli script senza avviare il server. Stessa implementazione della rotta admin
// `POST /scripts/validate`.
//
// Senza argomenti vale la cartella dei mock della configurazione. L'esito è leggibile dagli
// strumenti: con `--json` il rapporto su stdout; codice di uscita 1 se ci sono errori, 2 se il
// bersaglio non è utilizzabile (e allora non c'è nessun rapporto).

const WORKSPACE_MARKER = "mockxy.json";
const ENDPOINT_SUFFIX = ".endpoint.json";
const MOCKS_FOLDER = "mocks";

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

// Primo file che il motore leggerebbe se `rootDir` fosse la cartella dei mock, cercato fuori da
// `skippedDir`. Segue le stesse cartelle del motore, senza eccezioni proprie: il loader degli
// endpoint le attraversa tutte, anche quelle nascoste; la validazione degli script tutte tranne
// `node_modules`. Una cartella saltata qui e letta là sarebbe contenuto validato a metà.
function findMocksContent(rootDir, skippedDir) {
  const stack = [{ dir: rootDir, insideNodeModules: false }];
  while (stack.length > 0) {
    const { dir, insideNodeModules } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entryPath !== skippedDir) {
          stack.push({ dir: entryPath, insideNodeModules: insideNodeModules || entry.name === "node_modules" });
        }
      } else if (entry.isFile()) {
        if (entry.name.endsWith(ENDPOINT_SUFFIX) || (!insideNodeModules && SCRIPT_PATTERN.test(entry.name))) {
          return entryPath;
        }
      }
    }
  }
  return null;
}

// Ciò che in una cartella appartiene a una cartella dei mock e non a una radice di workspace,
// fuori dalla sua sottocartella `mocks`. Restituisce il primo indizio trovato, o null.
function findMocksFolderSign(folder) {
  for (const name of [".collections.json", SHARED_DIR]) {
    if (fs.existsSync(path.join(folder, name))) {
      return name;
    }
  }
  const imports = readJsonOrNull(path.join(folder, PACKAGE_FILE))?.imports;
  if (imports != null && typeof imports === "object" && Object.keys(imports).some((key) => key.startsWith("#shared"))) {
    return `${PACKAGE_FILE} with the #shared alias`;
  }
  const mocksContent = findMocksContent(folder, path.join(folder, MOCKS_FOLDER));
  return mocksContent == null ? null : path.relative(folder, mocksContent);
}

// Quale cartella dei mock indica l'argomento. L'argomento posizionale può essere la radice di un
// workspace (la cartella che contiene `mocks/`) o la cartella dei mock stessa, e una cartella dei
// mock può contenere a sua volta una cartella `mocks`: quella dell'endpoint `/mocks`. Leggerla
// come radice vorrebbe dire validare solo quell'endpoint e dichiarare conforme tutto il resto
// senza averlo guardato. Perciò si decide solo su fatti certi, e nel dubbio si rifiuta:
// `--mocks-dir` nomina la cartella dei mock senza interpretazioni.
function resolveValidationTarget({ target, mocksDirOption }) {
  if (mocksDirOption != null) {
    return target == null
      ? { mocksDir: path.resolve(mocksDirOption) }
      : { error: "Pass either a folder or --mocks-dir, not both." };
  }
  if (target == null) {
    return { mocksDir: loadConfig().mocksDir };
  }

  const resolved = path.resolve(target);
  const nested = path.join(resolved, MOCKS_FOLDER);
  if (fs.existsSync(path.join(resolved, WORKSPACE_MARKER))) {
    return { mocksDir: nested };
  }
  // La cartella `mocks` di un workspace marcato: è la cartella dei mock, qualunque cosa contenga.
  if (path.basename(resolved) === MOCKS_FOLDER && fs.existsSync(path.join(path.dirname(resolved), WORKSPACE_MARKER))) {
    return { mocksDir: resolved };
  }
  if (!isDirectory(nested)) {
    return { mocksDir: resolved };
  }
  const sign = findMocksFolderSign(resolved);
  if (sign != null) {
    return {
      error: `Ambiguous folder: ${resolved} contains a "${MOCKS_FOLDER}" subfolder, as a workspace root does, but also ${sign}, as a mocks folder does. Pass the workspace root, or --mocks-dir ${resolved} to validate it as the mocks folder.`,
    };
  }
  return { mocksDir: nested };
}

const VALUE_OPTIONS = new Set(["--mocks-dir"]);
const FLAG_OPTIONS = new Set(["--json"]);

function parseValidateArgs(argv) {
  const parsed = { json: false, mocksDirOption: null, target: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const separator = argument.startsWith("--") ? argument.indexOf("=") : -1;
    const name = separator === -1 ? argument : argument.slice(0, separator);
    if (VALUE_OPTIONS.has(name)) {
      const value = separator === -1 ? argv[index + 1] : argument.slice(separator + 1);
      if (value == null || value === "" || (separator === -1 && value.startsWith("--"))) {
        return { error: `Option ${name} needs a value.` };
      }
      parsed.mocksDirOption = value;
      index += separator === -1 ? 1 : 0;
    } else if (FLAG_OPTIONS.has(argument)) {
      parsed.json = true;
    } else if (argument.startsWith("-")) {
      // Un'opzione sconosciuta non si ignora: `--mock-dir x` farebbe passare `x` per posizionale.
      return { error: `Unknown option: ${argument}` };
    } else if (parsed.target == null) {
      parsed.target = argument;
    } else {
      return { error: `Unexpected argument: ${argument}` };
    }
  }
  return parsed;
}

function formatFinding(level, finding) {
  const location = finding.line != null ? `${finding.filePath}:${finding.line}:${finding.column}` : finding.filePath;
  return `${level} ${location} [${finding.code}] ${finding.message}`;
}

const UNUSABLE_TARGET_EXIT_CODE = 2;

function runValidateCommand(argv, output = console) {
  const parsed = parseValidateArgs(argv);
  const resolution = parsed.error != null ? parsed : resolveValidationTarget(parsed);
  if (resolution.error != null) {
    output.error(resolution.error);
    return UNUSABLE_TARGET_EXIT_CODE;
  }
  const { json } = parsed;
  const { mocksDir } = resolution;
  if (!isDirectory(mocksDir)) {
    output.error(`Mocks folder not found: ${mocksDir}`);
    return UNUSABLE_TARGET_EXIT_CODE;
  }

  const report = validateWorkspaceScripts(mocksDir);
  const createdPackagePath = consumeCreatedNotice(mocksDir);
  if (json) {
    output.log(JSON.stringify({ ...report, createdScriptPackagePath: createdPackagePath }, null, 2));
    return report.ok ? 0 : 1;
  }

  if (createdPackagePath != null) {
    output.log(`Created ${createdPackagePath} (it enables the #shared/ alias).`);
  }
  for (const finding of report.errors) {
    output.log(formatFinding("ERROR", finding));
  }
  for (const finding of report.warnings) {
    output.log(formatFinding("WARN ", finding));
  }
  output.log(
    `${report.ok ? "OK" : "FAILED"} — ${report.scripts} script(s) in ${report.mocksDir}, ${report.errors.length} error(s), ${report.warnings.length} warning(s).`
  );
  return report.ok ? 0 : 1;
}

module.exports = {
  resolveValidationTarget,
  runValidateCommand,
};
