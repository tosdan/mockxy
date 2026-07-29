const fs = require("fs");
const path = require("path");
const {
  STABLE_VERSION_PATTERN,
  checkVersionConsistency,
} = require("./check-version-consistency");

const rootDir = path.resolve(__dirname, "..");
const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function validateReleaseTag(tag, version) {
  const errors = [];
  const validTag = typeof tag === "string" && RELEASE_TAG_PATTERN.test(tag);
  const validVersion = typeof version === "string" && STABLE_VERSION_PATTERN.test(version);
  if (!validTag) {
    errors.push(`Release tag must use the stable v<major>.<minor>.<patch> format: ${String(tag)}`);
  }
  if (!validVersion) {
    errors.push(`Package version must use the stable x.y.z format: ${String(version)}`);
  } else if (validTag && tag !== `v${version}`) {
    errors.push(`Release tag ${String(tag)} does not match package version ${version}.`);
  }
  return errors;
}

function checkReleaseTag(tag, baseDir = rootDir) {
  const versionResult = checkVersionConsistency(baseDir);
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(baseDir, "package.json"), "utf8"),
  ).version;
  return {
    tag,
    version: packageVersion,
    errors: [
      ...versionResult.errors,
      ...validateReleaseTag(tag, packageVersion),
    ],
  };
}

if (require.main === module) {
  try {
    const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
    const result = checkReleaseTag(tag);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.error(error);
      }
      process.exitCode = 1;
    } else {
      console.log(`Release tag ${result.tag} matches Mockxy ${result.version}.`);
    }
  } catch (error) {
    console.error(`Unable to validate the release tag: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  RELEASE_TAG_PATTERN,
  validateReleaseTag,
  checkReleaseTag,
};
