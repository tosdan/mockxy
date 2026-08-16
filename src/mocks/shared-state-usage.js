const { normalizeSharedStateName } = require("./shared-state");

// Best-effort authoring diagnostic. It intentionally recognizes only direct literal calls and
// never parses or executes handler code. False positives in comments/strings are acceptable;
// dynamic names and aliases are deliberately outside the MVP contract.
function findLiteralSharedStateReferences(source) {
  if (typeof source !== "string" || source === "") {
    return [];
  }

  const names = new Set();
  const literalCall = /\bsharedState\s*\.\s*open\s*\(\s*(["'`])([a-zA-Z0-9._-]+)\1/g;
  for (const match of source.matchAll(literalCall)) {
    try {
      names.add(normalizeSharedStateName(match[2]));
    } catch (_error) {
      // Invalid literals cannot refer to a usable resource and are diagnosed at runtime.
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

module.exports = {
  findLiteralSharedStateReferences,
};
