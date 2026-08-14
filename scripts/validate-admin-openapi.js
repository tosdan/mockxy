const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const OPERATION_KEYS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function inlinePathParameterReferences(document) {
  const parameters = document.components?.parameters || {};
  for (const pathItem of Object.values(document.paths || {})) {
    for (const owner of [pathItem, ...OPERATION_KEYS.map((key) => pathItem[key]).filter(Boolean)]) {
      owner.parameters = (owner.parameters || []).map((parameter) => {
        if (!parameter.$ref) {
          return parameter;
        }
        const match = parameter.$ref.match(/^#\/components\/parameters\/(.+)$/);
        if (!match || !parameters[match[1]]) {
          throw new Error(`Unresolvable path parameter reference: ${parameter.$ref}`);
        }
        return parameters[match[1]];
      });
    }
  }
  return document;
}

async function validateAdminOpenapi() {
  const { validate } = await import("@scalar/openapi-parser");
  const source = await fs.promises.readFile(
    path.join(__dirname, "..", "docs", "admin-api.openapi.yaml"),
    "utf8"
  );
  // Scalar's path-template pass does not follow reusable Parameter Object references. Inline
  // those references before validation; this also rejects a missing component explicitly.
  const document = inlinePathParameterReferences(yaml.safeLoad(source));
  const result = await validate(JSON.stringify(document));
  if (!result.valid || result.errors.length > 0) {
    throw new Error(`Invalid Admin API OpenAPI contract:\n${JSON.stringify(result.errors, null, 2)}`);
  }
}

if (require.main === module) {
  validateAdminOpenapi().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { inlinePathParameterReferences, validateAdminOpenapi };
