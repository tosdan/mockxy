const fs = require("fs");
const yaml = require("js-yaml");

// Client minimo dell'admin API per preparare uno scenario in modo esplicito (piano agent/API, §9
// S6 e §13 C6). È una composizione di chiamate HTTP esistenti, non un'API di scenari: identifica
// l'istanza, prepara i contenuti con la revisione letta, attiva, azzera, e legge il traffico
// successivo a un cursore del Monitor. Non ripristina niente e non ritenta alla cieca: ogni
// problema diventa un errore con un codice diagnostico.

// Capacità usate dal setup, verificate sul contratto servito dal runtime prima di qualunque
// mutazione: nessuna scoperta tramite scritture di prova.
const REQUIRED_PATHS = [
  "/info",
  "/config",
  "/mocks/{id}/responses/{responseFileName}",
  "/mocks/{id}/sequence/reset",
  "/monitoring/requests/{id}",
];

class SetupError extends Error {
  constructor(code, message, details = undefined) {
    super(`[${code}] ${message}`);
    this.name = "SetupError";
    this.code = code;
    this.details = details;
  }
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

class MockxyAdmin {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.runtimeId = null;
  }

  async request(method, path, body) {
    const response = await fetch(`${this.baseUrl}/_admin/api${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text === "" ? null : JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, ok: response.ok, data };
  }

  // Una mutazione riuscita è la barriera di applicazione (§13 C1): un 2xx vuol dire file scritti
  // e runtime che serve l'effetto. Qualunque altro esito ferma il setup con il codice del server.
  async mutate(method, path, body, what) {
    const res = await this.request(method, path, body);
    if (res.ok) {
      return res.data;
    }
    const code = res.data?.details?.code;
    if (code === "REVISION_CONFLICT") {
      throw new SetupError("PRECONDITION_FAILED", `${what}: the resource changed since it was read; read it again and decide, do not overwrite.`, res.data.details);
    }
    throw new SetupError("NOT_APPLIED", `${what}: ${res.status}${code ? ` ${code}` : ""} — ${res.data?.message ?? res.data}`, res.data?.details);
  }

  async read(path, what) {
    const res = await this.request("GET", path);
    if (!res.ok) {
      throw new SetupError("READ_FAILED", `${what}: ${res.status} — ${res.data?.message ?? res.data}`, res.data?.details);
    }
    return res.data;
  }

  /**
   * 1. Identità dell'istanza, contratto e configurazione richiesta, prima di qualunque mutazione.
   * `mocksDir` è la cartella dei mock che il test si aspetta; `requireConfig` i valori effettivi
   * di GET /config da cui dipende (non modificabili via API prima di S8: li prepara l'ambiente).
   */
  async connect({ mocksDir, requireConfig = {} }) {
    const info = await this.request("GET", "/info");
    if (!info.ok || typeof info.data?.runtimeId !== "string") {
      throw new SetupError("CONTRACT_UNVERIFIABLE", `GET /_admin/api/info answered ${info.status}: this runtime predates the explicit-setup contract, so nothing is changed. Update Mockxy.`);
    }
    const spec = await this.request("GET", "/openapi.yaml");
    if (!spec.ok || typeof spec.data !== "string") {
      throw new SetupError("CONTRACT_UNVERIFIABLE", `GET /_admin/api/openapi.yaml answered ${spec.status}: the contract of this runtime cannot be read, so nothing is changed. Update Mockxy.`);
    }
    const paths = Object.keys(yaml.safeLoad(spec.data)?.paths ?? {});
    const missing = REQUIRED_PATHS.filter((path) => !paths.includes(path));
    if (missing.length > 0) {
      throw new SetupError("CONTRACT_UNVERIFIABLE", `The runtime (Mockxy ${info.data.version}) does not declare ${missing.join(", ")}: update Mockxy before running this setup.`);
    }

    const expected = fs.realpathSync(mocksDir);
    if (info.data.workspace?.mocksDir !== expected) {
      throw new SetupError("WRONG_WORKSPACE", `The runtime serves ${info.data.workspace?.mocksDir}, not ${expected}: refusing to change another workspace.`, { workspace: info.data.workspace });
    }

    const config = await this.read("/config", "Reading the effective configuration");
    const mismatches = Object.entries(requireConfig)
      .filter(([key, value]) => !sameValue(config.effective?.[key], value))
      .map(([key, value]) => `${key} is ${JSON.stringify(config.effective?.[key])}, the test needs ${JSON.stringify(value)}`);
    if (mismatches.length > 0) {
      throw new SetupError("CONFIG_MISMATCH", `Start the runtime with the configuration this test needs: ${mismatches.join("; ")}.`, { effective: config.effective });
    }

    this.runtimeId = info.data.runtimeId;
    return info.data;
  }

  /** Un endpoint per metodo e path esatti, dal catalogo: mai per titolo né dalla selezione. */
  async findEndpoint(method, path) {
    const { items } = await this.read("/mocks", "Reading the catalog");
    const matches = items.filter((item) => item.method === method && item.path === path);
    if (matches.length !== 1) {
      throw new SetupError("RESOURCE_NOT_FOUND", `Expected exactly one ${method} ${path} in the catalog, found ${matches.length}.`);
    }
    return matches[0];
  }

  /** Le varianti su cui il setup lavora devono essere elencate dall'endpoint, per filename. */
  async requireVariants(endpointId, fileNames) {
    const detail = await this.read(`/mocks/${endpointId}`, "Reading the endpoint");
    const listed = new Set(detail.endpoint?.responseFiles ?? []);
    const missing = fileNames.filter((file) => !listed.has(file));
    if (missing.length > 0) {
      throw new SetupError("RESOURCE_NOT_FOUND", `${detail.method} ${detail.path} does not list ${missing.join(", ")}.`);
    }
    return detail;
  }

  /** Una variante per filename, selezionata o no, con la sua revisione e `active`. */
  readVariant(endpointId, fileName) {
    return this.read(`/mocks/${endpointId}/responses/${fileName}`, `Reading ${fileName}`);
  }

  /** Scrive una variante con la revisione letta: un 409 ferma il setup, nessuna sovrascrittura. */
  writeVariant(endpointId, fileName, content, revision) {
    return this.mutate("PUT", `/mocks/${endpointId}/responses/${fileName}`, { ...content, expectedRevision: revision }, `Updating ${fileName}`);
  }

  /**
   * 2. Prepara il contenuto di una variante: la legge, controlla se è attiva (la selezionata o uno
   * step della sequence selezionata: "non selezionata" non vuol dire "inattiva") e la scrive con
   * la revisione appena letta. Riscrivere una variante attiva cambia lo scenario in corso: va
   * dichiarato con `allowActive`, per esempio quando il setup la riattiva e azzera subito dopo.
   */
  async prepareVariant(endpointId, fileName, content, { allowActive = false } = {}) {
    const variant = await this.readVariant(endpointId, fileName);
    if (variant.active && !allowActive) {
      throw new SetupError("ACTIVE_VARIANT", `${fileName} is being served (selected or a step of the selected sequence): prepare a separate variant, or pass allowActive when the setup reactivates it.`);
    }
    return this.writeVariant(endpointId, fileName, content, variant.revision);
  }

  /** 3. Modalità mock: server acceso e Proxy All spento. */
  async serveMocks() {
    const state = await this.mutate("PATCH", "/server", { serverEnabled: true, proxyAll: false }, "Enabling mock mode");
    if (state?.serverEnabled !== true || state?.proxyAll !== false) {
      throw new SetupError("NOT_APPLIED", `Mock mode not applied: ${JSON.stringify(state)}.`);
    }
  }

  select(endpointId, fileName) {
    return this.mutate("PUT", `/mocks/${endpointId}`, { selectedResponseFile: fileName }, `Selecting ${fileName}`);
  }

  setEnabled(endpointIds, enabled) {
    return this.mutate("PATCH", "/mocks/enabled", { ids: endpointIds, enabled }, `${enabled ? "Enabling" : "Disabling"} endpoints`);
  }

  /** 4. Riparte dal primo step (e azzera la memoria handler di quell'endpoint), anche se era già selezionata. */
  async resetSequence(endpointId) {
    const result = await this.mutate("POST", `/mocks/${endpointId}/sequence/reset`, {}, "Resetting the sequence");
    if (result?.sequenceState?.stepIndex !== 0 || result?.sequenceState?.servedInStep !== 0) {
      throw new SetupError("NOT_APPLIED", `The sequence did not restart from its first step: ${JSON.stringify(result?.sequenceState)}.`);
    }
    return result;
  }

  /** 6. Cursore del Monitor su "adesso", da prendere prima dell'azione del browser. */
  async monitorCursor(filters = {}) {
    const query = new URLSearchParams({ view: "page", since: "latest", ...filters });
    const page = await this.read(`/monitoring/requests?${query}`, "Reading the monitor cursor");
    return page.cursor;
  }

  /**
   * Il traffico successivo al cursore, con gli stessi filtri, fino a quando `until(items)` è vero
   * o scade `timeoutMs`. Continua dall'ultimo cursore letto, quindi non rilegge né salta voci. Un
   * gap (riavvio, clear, espulsione) ferma la verifica: una lista vuota non vorrebbe dire nulla.
   */
  async readTraffic(cursor, filters = {}, { until = () => true, timeoutMs = 5000, intervalMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs;
    const items = [];
    let current = cursor;
    for (;;) {
      let hasMore = true;
      while (hasMore) {
        const query = new URLSearchParams({
          view: "page",
          limit: "250",
          ...filters,
          since: current.since,
          runtimeId: current.runtimeId,
          generation: String(current.generation),
        });
        const page = await this.read(`/monitoring/requests?${query}`, "Reading the monitor");
        if (page.gap) {
          throw new SetupError("MONITOR_GAP", `Monitor traffic was lost since the cursor (${page.gapReason}): the check cannot conclude.`, { gapReason: page.gapReason, available: page.available });
        }
        items.push(...page.items);
        current = page.cursor;
        hasMore = page.hasMore;
      }
      if (until(items)) {
        return items;
      }
      if (Date.now() >= deadline) {
        throw new SetupError("TRAFFIC_TIMEOUT", `The expected traffic did not show up within ${timeoutMs} ms after the cursor; seen: ${items.map((item) => `${item.method} ${item.path} ${item.status}`).join(", ") || "nothing"}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

module.exports = { MockxyAdmin, SetupError, REQUIRED_PATHS };
