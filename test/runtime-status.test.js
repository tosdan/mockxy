const path = require("path");
const { RuntimeStatusStore } = require("../src/runtime-status");
const { encodeMockId } = require("../src/admin/mock-ids");

// Stato dei caricamenti e revisione della diagnostica (piano agent/API, §13 C2): la revisione
// cambia con stato, errori e disponibilità delle rotte in errore, non col solo tentativo.
describe("RuntimeStatusStore", () => {
  const mocksDir = path.resolve("/workspace/mocks");
  const brokenPath = path.join(mocksDir, "broken", "GET.endpoint.json");
  const loadError = (message = "sintassi") => ({ filePath: brokenPath, message });
  // Un registro che serve (o no) una versione della definizione in errore.
  const registry = (retained) => ({
    routeGroups: retained ? [{ path: "/broken", methods: new Map([["GET", { configFilePath: brokenPath }]]) }] : [],
  });
  let store;
  let clock;

  beforeEach(() => {
    store = new RuntimeStatusStore({ runtimeId: "r", mocksDir });
    clock = 0;
  });

  function record(reasons, outcome, registries = [registry(false)]) {
    clock += 1;
    store.recordAttempt({
      reasons,
      startedAt: new Date(clock * 1000).toISOString(),
      completedAt: new Date(clock * 1000 + 10).toISOString(),
      outcome,
      registries,
    });
  }

  test("l'avvio è la revisione 1; un tentativo identico non la cambia", () => {
    record(["startup"], { applied: true, loadErrors: [loadError()] });
    expect(store.revision).toBe(1);

    record(["watcher"], { applied: true, loadErrors: [loadError()] });
    expect(store.snapshot().lastAttempt.id).toBe(2);
    expect(store.revision).toBe(1);
  });

  test("cambia quando un errore compare, cambia disponibilità, cambia messaggio o sparisce", () => {
    record(["startup"], { applied: true, loadErrors: [] });

    record(["admin"], { applied: true, loadErrors: [loadError()] }, [registry(false)]);
    expect(store.revision).toBe(2);
    record(["admin"], { applied: true, loadErrors: [loadError()] }, [registry(true)]);
    expect(store.revision).toBe(3);
    record(["admin"], { applied: true, loadErrors: [loadError("altro")] }, [registry(true)]);
    expect(store.revision).toBe(4);
    record(["admin"], { applied: true, loadErrors: [] });
    expect(store.revision).toBe(5);
  });

  test("un fallimento globale conserva gli errori installati e la cambia; il recupero la cambia di nuovo", () => {
    record(["startup"], { applied: true, loadErrors: [loadError()] });

    record(["admin", "watcher", "admin"], { applied: false, loadErrors: [], fatalError: new Error("scan failed") });
    expect(store.snapshot()).toEqual({
      runtimeId: "r",
      lastAttempt: expect.objectContaining({ id: 2, reasons: ["admin", "watcher"], status: "failed" }),
      lastAppliedAttemptId: 1,
      errors: [{ endpointId: encodeMockId("broken/GET.endpoint.json"), filePath: "broken/GET.endpoint.json", message: "sintassi", serving: "missing" }],
      fatalError: { message: "scan failed" },
    });
    expect(store.revision).toBe(2);

    record(["admin"], { applied: true, loadErrors: [loadError()] });
    expect(store.snapshot().fatalError).toBeNull();
    expect(store.snapshot().lastAppliedAttemptId).toBe(3);
    expect(store.revision).toBe(3);
  });

  test("un file fuori dalla cartella dei mock non ha endpointId", () => {
    const outside = path.resolve("/elsewhere/GET.endpoint.json");
    record(["startup"], { applied: true, loadErrors: [{ filePath: outside, message: "x" }] });
    expect(store.snapshot().errors).toEqual([{ endpointId: null, filePath: outside, message: "x", serving: "missing" }]);
  });
});
