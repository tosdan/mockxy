const { createPathParamsMatcher } = require("./route-groups");

class MockRegistry {
  constructor(routeGroups = [], sequenceStates = null) {
    this.routeGroups = routeGroups;
    this.paramsMatchers = new Map();
    // Cursori delle sequenze di varianti (SequenceStateStore): vive fuori dal registry perché
    // deve sopravvivere alle ricariche a caldo (setRouteGroups). Assente nei contesti senza
    // sequenze (test/usi legacy): lì una sequenza serve sempre il primo step.
    this.sequenceStates = sequenceStates;
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
        let endpoint = group.methods.get(normalizedMethod);
        let sequenceStep;

        // Sequenza di varianti: il cursore sceglie lo step che risponde a QUESTA richiesta, poi
        // la decisione prosegue con la natura dello step (mock o handler) come se fosse la
        // variante registrata. sequenceStep accompagna la decisione per monitor/diagnostica.
        if (endpoint.type === "sequence") {
          const stepIndex = this.sequenceStates != null
            ? this.sequenceStates.resolveStep(`${normalizedMethod} ${group.path}`, endpoint.sequence)
            : 0;
          const step = endpoint.steps[stepIndex];
          sequenceStep = {
            index: stepIndex,
            count: endpoint.steps.length,
            responseFile: step.selectedResponseFile,
            responseTitle: step.title || "",
          };
          endpoint = step;
        }

        if (endpoint.type === "handler") {
          return {
            mode: "handler",
            routePath: group.path,
            handler: endpoint,
            params: this.getParamsForGroup(group, requestPath, requestUrl),
            sequenceStep,
          };
        }

        return {
          mode: "mock",
          routePath: group.path,
          response: endpoint,
          // I params servono solo ai mock templati ({{params.x}}): calcolarli sempre sarebbe
          // costo inutile sul percorso caldo dei mock statici.
          params: endpoint.templated === true
            ? this.getParamsForGroup(group, requestPath, requestUrl)
            : undefined,
          sequenceStep,
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
