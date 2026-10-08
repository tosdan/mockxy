const fs = require("fs");
const path = require("path");
const { loadConfig } = require("./config");
const { consumeCreatedNotice } = require("./mocks/script-package");
const { validateWorkspaceScripts } = require("./mocks/workspace-validation");

// `node index.js validate [cartella] [--json]`: la validazione completa degli script senza
// avviare il server. Stessa implementazione della rotta admin `POST /scripts/validate`.
//
// La cartella può essere la radice di un workspace (quella che contiene `mocks/`) o la cartella
// dei mock stessa; senza argomento vale la cartella dei mock della configurazione. L'esito è
// leggibile dagli strumenti: con `--json` il rapporto su stdout, e codice di uscita 1 se ci
// sono errori.

function resolveMocksDir(target) {
  if (target == null) {
    return loadConfig().mocksDir;
  }
  const resolved = path.resolve(target);
  const nested = path.join(resolved, "mocks");
  return fs.existsSync(nested) && fs.statSync(nested).isDirectory() ? nested : resolved;
}

function formatFinding(level, finding) {
  const location = finding.line != null ? `${finding.filePath}:${finding.line}:${finding.column}` : finding.filePath;
  return `${level} ${location} [${finding.code}] ${finding.message}`;
}

function runValidateCommand(argv, output = console) {
  const json = argv.includes("--json");
  const target = argv.find((argument) => !argument.startsWith("--"));
  const mocksDir = resolveMocksDir(target);
  if (!fs.existsSync(mocksDir)) {
    output.error(`Mocks folder not found: ${mocksDir}`);
    return 1;
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
  runValidateCommand,
};
