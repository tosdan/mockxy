const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpmVersion(projectDir, version) {
  const result = spawnSync(
    npmCommand,
    ["version", version, "--no-git-tag-version", "--allow-same-version"],
    { cwd: projectDir, stdio: "inherit" }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`npm version failed in ${path.relative(rootDir, projectDir) || "."}`);
  }
}

try {
  runNpmVersion(rootDir, releaseType);
  const targetVersion = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
  ).version;
  for (const projectDir of projects.slice(1)) {
    runNpmVersion(projectDir, targetVersion);
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
