const { sortRouteGroups } = require("./route-groups");

// Merges every locally served endpoint so exact and dynamic precedence stays stable across types.
function mergeLocalRouteGroups({ mockRouteGroups = [], handlerRouteGroups = [], sequenceRouteGroups = [], sseRouteGroups = [] }) {
  const mergedGroups = new Map();

  function ingestRouteGroups(routeGroups, type) {
    for (const group of routeGroups) {
      const existingGroup = mergedGroups.get(group.path) || {
        path: group.path,
        dynamic: group.dynamic,
        staticSegments: group.staticSegments,
        sortKey: group.sortKey,
        matcher: group.matcher,
        methods: new Map(),
      };

      existingGroup.sortKey =
        existingGroup.sortKey.localeCompare(group.sortKey) <= 0 ? existingGroup.sortKey : group.sortKey;

      for (const [method, entry] of group.methods.entries()) {
        if (existingGroup.methods.has(method)) {
          const previousEntry = existingGroup.methods.get(method);
          throw new Error(
            `Duplicate local endpoint definition for ${method} ${group.path}: ${entry.configFilePath} conflicts with ${previousEntry.configFilePath}`
          );
        }

        existingGroup.methods.set(method, {
          type,
          ...entry,
        });
      }

      mergedGroups.set(group.path, existingGroup);
    }
  }

  ingestRouteGroups(mockRouteGroups, "mock");
  ingestRouteGroups(handlerRouteGroups, "handler");
  ingestRouteGroups(sequenceRouteGroups, "sequence");
  ingestRouteGroups(sseRouteGroups, "sse");

  return sortRouteGroups(Array.from(mergedGroups.values()));
}

module.exports = {
  mergeLocalRouteGroups,
};