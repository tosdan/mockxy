const { createPathParamsMatcher } = require("./route-groups");

class MockRegistry {
  constructor(routeGroups = []) {
    this.routeGroups = routeGroups;
    this.paramsMatchers = new Map();
  }

  setRouteGroups(routeGroups) {
    this.routeGroups = routeGroups;
    this.paramsMatchers = new Map();
  }

  getParamsForGroup(group, requestPath, requestUrl) {
    let matcher = this.paramsMatchers.get(group.path);
    if (matcher == null) {
      matcher = createPathParamsMatcher(group.path, group.sortKey || group.path).fn;
      this.paramsMatchers.set(group.path, matcher);
    }

    const matchResult = matcher(requestPath, requestUrl);
    return matchResult && typeof matchResult === "object" ? matchResult.params || {} : {};
  }

  matchRequest(method, requestPath, requestUrl) {
    const normalizedMethod = String(method || "").toUpperCase();

    for (const group of this.routeGroups) {
      if (!group.matcher(requestPath, requestUrl)) {
        continue;
      }

      if (group.methods.has(normalizedMethod)) {
        const endpoint = group.methods.get(normalizedMethod);
        if (endpoint.type === "handler") {
          return {
            mode: "handler",
            routePath: group.path,
            handler: endpoint,
            params: this.getParamsForGroup(group, requestPath, requestUrl),
          };
        }

        return {
          mode: "mock",
          routePath: group.path,
          response: endpoint,
        };
      }

      return {
        mode: "proxy",
        reason: "method_not_mocked",
        routePath: group.path,
      };
    }

    return {
      mode: "proxy",
      reason: "path_not_mocked",
    };
  }
}

module.exports = {
  MockRegistry,
};
