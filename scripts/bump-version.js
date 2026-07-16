const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const releaseType = process.argv[2];
const supportedReleaseTypes = new Set(["patch", "minor", "major"]);
const projects = [rootDir, path.join(rootDir, "mockxy-ui"), path.join(rootDir, "electron")];
const versionFiles = projects.flatMap((projectDir) => [
  path.join(projectDir, "package.json"),
  path.join(projectDir, "package-lock.json"),
]);

if (!supportedReleaseTypes.has(releaseType)) {
  console.error("Usage: node scripts/bump-version.js <patch|minor|major>");
  process.exit(1);
}

for (const filePath of versionFiles) {
  if (!fs.existsSync(filePath)) {
    console.error(`Required version file not found: ${path.relative(rootDir, filePath)}`);
    process.exit(1);
  }
}

const snapshots = new Map(versionFiles.map((filePath) => [filePath, fs.readFileSync(filePath)]));

function nextVersion(currentVersion, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);
  if (!match) {
    throw new Error(`Unsupported current version: ${currentVersion}`);
  }

  let [, major, minor, patch] = match.map(Number);
  if (type === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

function writeJson(filePath, value) {
  const original = snapshots.get(filePath).toString("utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2).replace(/\n/g, eol)}${eol}`);
}

function updateProjectVersion(projectDir, version) {
  const packagePath = path.join(projectDir, "package.json");
  const lockPath = path.join(projectDir, "package-lock.json");
  const packageJson = JSON.parse(snapshots.get(packagePath).toString("utf8"));
  const packageLock = JSON.parse(snapshots.get(lockPath).toString("utf8"));

  packageJson.version = version;
  packageLock.version = version;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }

  writeJson(packagePath, packageJson);
  writeJson(lockPath, packageLock);
}

try {
  const currentVersion = JSON.parse(snapshots.get(path.join(rootDir, "package.json"))).version;
  const targetVersion = nextVersion(currentVersion, releaseType);
  for (const projectDir of projects) {
    updateProjectVersion(projectDir, targetVersion);
  }
  console.log(`Mockxy packages updated to ${targetVersion}.`);
  console.log("Review and commit the six package/package-lock changes, then create the release tag if needed.");
} catch (error) {
  for (const [filePath, content] of snapshots) {
    fs.writeFileSync(filePath, content);
  }
  console.error(`Version bump rolled back: ${error.message}`);
  process.exit(1);
}
