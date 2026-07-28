const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function inspectVersions(baseDir = rootDir) {
  const relativeProjectDirs = ["", "mockxy-ui", "electron"];
  const entries = [];

  for (const relativeDir of relativeProjectDirs) {
    const projectDir = path.join(baseDir, relativeDir);
    const packagePath = path.join(projectDir, "package.json");
    const lockPath = path.join(projectDir, "package-lock.json");
    const packageJson = readJson(packagePath);
    const packageLock = readJson(lockPath);
    const label = relativeDir || ".";

    entries.push(
      { file: `${label}/package.json`, field: "version", version: packageJson.version },
      { file: `${label}/package-lock.json`, field: "version", version: packageLock.version },
      {
        file: `${label}/package-lock.json`,
        field: 'packages[""].version',
        version: packageLock.packages?.[""]?.version,
      },
    );
  }

  return entries;
}

function validateVersions(entries) {
  const expectedVersion = entries[0]?.version;
  const errors = [];

  if (!STABLE_VERSION_PATTERN.test(expectedVersion || "")) {
    errors.push(`Root package version is not a stable x.y.z version: ${String(expectedVersion)}`);
  }

  for (const entry of entries) {
    if (entry.version !== expectedVersion) {
      errors.push(`${entry.file} ${entry.field} is ${String(entry.version)}, expected ${expectedVersion}`);
    }
  }

  return { expectedVersion, errors };
}

function checkVersionConsistency(baseDir = rootDir) {
  return validateVersions(inspectVersions(baseDir));
}

if (require.main === module) {
  try {
    const result = checkVersionConsistency();
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.error(error);
      }
      process.exitCode = 1;
    } else {
      console.log(`Mockxy package versions are aligned at ${result.expectedVersion}.`);
    }
  } catch (error) {
    console.error(`Unable to check package versions: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  STABLE_VERSION_PATTERN,
  inspectVersions,
  validateVersions,
  checkVersionConsistency,
};
