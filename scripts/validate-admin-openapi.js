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

// In una mappa YAML su una riga (`{ type: string, description: A, B }`) una virgola non quotata
// chiude la descrizione e apre una chiave nuova senza valore: lo schema resta valido, ma la
// descrizione pubblicata è troncata. Una chiave con spazi e valore null ne è il segno.
function findSplitFlowMappings(node, location = "") {
  if (node == null || typeof node !== "object") {
    return [];
  }
  return Object.entries(node).flatMap(([key, value]) => {
    const here = `${location}/${key}`;
    if (value === null && /\s/.test(key)) {
      return [here];
    }
    return findSplitFlowMappings(value, here);
  });
}

async function validateAdminOpenapi() {
  const { validate } = await import("@scalar/openapi-parser");
  const source = await fs.promises.readFile(
    path.join(__dirname, "..", "src", "admin", "admin-api.openapi.yaml"),
    "utf8"
  );
  // Scalar's path-template pass does not follow reusable Parameter Object references. Inline
  // those references before validation; this also rejects a missing component explicitly.
  const parsed = yaml.safeLoad(source);
  const split = findSplitFlowMappings(parsed);
  if (split.length > 0) {
    throw new Error(`Admin API OpenAPI contract: descriptions split by an unquoted comma in a one-line mapping (quote them):\n${split.join("\n")}`);
  }
  const document = inlinePathParameterReferences(parsed);
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

module.exports = { findSplitFlowMappings, inlinePathParameterReferences, validateAdminOpenapi };
