const path = require("path");
const { encodeMockId } = require("./admin/mock-ids");
const { findEntryByConfigFile } = require("./mocks/route-groups");

// Cause di un tentativo di caricamento, nell'ordine fisso con cui vengono riportate.
const RELOAD_REASONS = Object.freeze(["startup", "admin", "watcher"]);

// Esito dei caricamenti del runtime per GET /runtime/status (piano agent/API, §13 C2). Conserva
// soltanto l'ultimo tentativo concluso e gli errori dell'ultimo registro installato: nessuno
// storico dei tentativi. Un tentativo si pubblica quando è concluso, quindi durante un reload
// resta visibile il precedente.
class RuntimeStatusStore {
  constructor({ runtimeId = null, mocksDir } = {}) {
    this.runtimeId = runtimeId;
    this.mocksDir = mocksDir;
    this.lastAttempt = null;
    this.lastAppliedAttemptId = null;
    this.errors = [];
    this.fatalError = null;
    // Revisione della diagnostica: cambia con stato, errori e disponibilità delle rotte in
    // errore, non col solo numero o istante del tentativo.
    this.revision = 1;
    this.nextAttemptId = 1;
    this.diagnosticsFingerprint = null;
  }

  /**
   * Registra un tentativo concluso. `outcome` è l'esito del caricamento (`applied`, `loadErrors`,
   * `fatalError`); `registries` sono i registri installati dopo il tentativo, da cui si legge se
   * una definizione in errore è ancora servita da una versione precedente.
   */
  recordAttempt({ reasons, startedAt, completedAt, outcome, registries }) {
    const id = this.nextAttemptId;
    this.nextAttemptId += 1;
    const applied = outcome?.applied !== false;
    const loadErrors = applied ? outcome?.loadErrors || [] : [];
    this.lastAttempt = {
      id,
      startedAt,
      completedAt,
      reasons: normalizeReasons(reasons),
      status: !applied ? "failed" : loadErrors.length > 0 ? "degraded" : "applied",
    };
    if (applied) {
      // Gli errori descrivono l'ultimo registro installato; un file corretto ne esce.
      this.lastAppliedAttemptId = id;
      this.errors = loadErrors.map((loadError) => this.describeLoadError(loadError, registries));
      this.fatalError = null;
    } else {
      // Un fallimento globale non installa nulla: restano gli errori del registro in uso.
      this.fatalError = { message: outcome?.fatalError?.message || "Runtime reload failed." };
    }
    this.updateRevision();
  }

  describeLoadError(loadError, registries) {
    const filePath = path.resolve(loadError.filePath);
    const relativePath = path.relative(path.resolve(this.mocksDir), filePath).split(path.sep).join("/");
    const insideMocksDir = relativePath !== "" && !relativePath.startsWith("../") && !path.isAbsolute(relativePath);
    const retained = (registries || []).some((registry) => findEntryByConfigFile(registry?.routeGroups || [], filePath) != null);
    return {
      endpointId: insideMocksDir && relativePath.endsWith(".endpoint.json") ? encodeMockId(relativePath) : null,
      filePath: insideMocksDir ? relativePath : loadError.filePath,
      message: loadError.message,
      serving: retained ? "retained" : "missing",
    };
  }

  updateRevision() {
    const fingerprint = JSON.stringify({
      status: this.lastAttempt?.status ?? null,
      errors: [...this.errors].sort((a, b) => a.filePath.localeCompare(b.filePath)),
      fatalError: this.fatalError,
    });
    // Il primo tentativo (l'avvio) fissa lo stato iniziale, che è la revisione 1.
    if (this.diagnosticsFingerprint != null && fingerprint !== this.diagnosticsFingerprint) {
      this.revision += 1;
    }
    this.diagnosticsFingerprint = fingerprint;
  }

  snapshot() {
    return {
      runtimeId: this.runtimeId,
      lastAttempt: this.lastAttempt == null ? null : { ...this.lastAttempt, reasons: [...this.lastAttempt.reasons] },
      lastAppliedAttemptId: this.lastAppliedAttemptId,
      errors: this.errors.map((error) => ({ ...error })),
      fatalError: this.fatalError == null ? null : { ...this.fatalError },
    };
  }
}

// Cause senza duplicati, nell'ordine fisso startup, admin, watcher.
function normalizeReasons(reasons) {
  const unique = new Set(reasons);
  return RELOAD_REASONS.filter((reason) => unique.has(reason));
}

module.exports = {
  RELOAD_REASONS,
  RuntimeStatusStore,
};
