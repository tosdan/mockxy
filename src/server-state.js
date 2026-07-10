// Runtime, in-memory control of how the Mockxy handles incoming requests.
//
// Two independent switches drive three effective modes:
//   - active    (serverEnabled, !proxyAll): mocks/handlers/middleware are used, monitor records.
//   - proxy all (serverEnabled, proxyAll):  every request is forwarded straight to the backend
//                                           (no mock/handler/middleware), but the monitor still records.
//   - off       (!serverEnabled):           every request is forwarded straight to the backend and
//                                           nothing is monitored — the process stays up as a plain proxy.
//
// The state is intentionally NOT persisted: a restart returns to the default "active" state. It is an
// operational runtime toggle (like a power switch), not catalog data.
class ServerStateStore {
  constructor(initialState = {}) {
    this._serverEnabled = initialState.serverEnabled !== false;
    this._proxyAll = initialState.proxyAll === true;
  }

  getState() {
    return { serverEnabled: this._serverEnabled, proxyAll: this._proxyAll };
  }

  // Applies a partial update; only boolean fields are honored, anything else is ignored.
  setState(patch = {}) {
    if (typeof patch.serverEnabled === "boolean") {
      this._serverEnabled = patch.serverEnabled;
    }
    if (typeof patch.proxyAll === "boolean") {
      this._proxyAll = patch.proxyAll;
    }
    return this.getState();
  }

  // True when requests should be matched against mocks/handlers/middleware.
  // Server off OR "proxy all" → everything is forwarded straight to the backend instead.
  usesMocks() {
    return this._serverEnabled && !this._proxyAll;
  }

  // True when the request monitor should capture and record traffic.
  // Only turning the server off disables monitoring; "proxy all" keeps it on.
  isMonitoring() {
    return this._serverEnabled;
  }
}

module.exports = { ServerStateStore };
