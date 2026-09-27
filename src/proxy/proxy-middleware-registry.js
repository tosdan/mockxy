const { findEntryByConfigFile } = require("../mocks/route-groups");

class ProxyMiddlewareRegistry {
  constructor(routeGroups = []) {
    this.routeGroups = routeGroups;
  }

  setRouteGroups(routeGroups) {
    this.routeGroups = routeGroups;
  }

  // Definizione installata del file endpoint indicato (vedi findEntryByConfigFile).
  findEndpointByConfigFile(configFilePath) {
    return findEntryByConfigFile(this.routeGroups, configFilePath);
  }

  matchRequest(method, requestPath, requestUrl) {
    const normalizedMethod = String(method || "").toUpperCase();

    for (const group of this.routeGroups) {
      if (!group.matcher(requestPath, requestUrl)) {
        continue;
      }

      if (!group.methods.has(normalizedMethod)) {
        continue;
      }

      return {
        matched: true,
        routePath: group.path,
        middleware: group.methods.get(normalizedMethod),
      };
    }

    return {
      matched: false,
    };
  }
}

module.exports = {
  ProxyMiddlewareRegistry,
};