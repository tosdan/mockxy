const { EventEmitter } = require("events");
const { runScript, runWithScriptOrigin } = require("../src/mocks/script-execution");
const { describeCurrentScriptFault, installScriptFaultGuard } = require("../src/script-fault-guard");
const { createMemoryLogger } = require("./helpers");

// Errori lanciati fuori dalla richiesta: quelli di uno script del workspace restano confinati,
// quelli del motore restano fatali.
describe("guardia sugli errori degli script", () => {
  const origin = { kind: "handler", method: "GET", path: "/utenti", filePath: "/ws/mocks/utenti/001.handler.js" };
  let processRef;
  let logger;
  let engineFaults;
  let uninstall;

  beforeEach(() => {
    processRef = new EventEmitter();
    logger = createMemoryLogger();
    engineFaults = [];
    uninstall = installScriptFaultGuard({
      getLogger: () => logger,
      processRef,
      onEngineFault: (reason) => engineFaults.push(reason),
    });
  });

  afterEach(() => uninstall());

  test("describeCurrentScriptFault: script ed endpoint dentro uno script, null fuori", () => {
    expect(describeCurrentScriptFault()).toBeNull();
    expect(runScript(origin, () => describeCurrentScriptFault(), 1000)).toEqual({
      scriptKind: "handler",
      script: "/ws/mocks/utenti/001.handler.js",
      endpoint: "GET /utenti",
    });
    // Il caricamento di un modulo non ha un endpoint.
    expect(runWithScriptOrigin({ kind: "script-load", filePath: "/ws/mocks/a.js" }, () => describeCurrentScriptFault())).toEqual({
      scriptKind: "script-load",
      script: "/ws/mocks/a.js",
    });
  });

  test("un'eccezione che discende da uno script viene registrata e non è fatale", () => {
    const error = new Error("boom nel timer");

    runScript(origin, () => processRef.emit("uncaughtException", error), 1000);

    expect(engineFaults).toEqual([]);
    expect(logger.entries.error).toHaveLength(1);
    expect(logger.entries.error[0].message).toContain("workspace script failed outside its request");
    expect(logger.entries.error[0].fields).toEqual({
      fault: "uncaught_exception",
      scriptKind: "handler",
      script: "/ws/mocks/utenti/001.handler.js",
      endpoint: "GET /utenti",
      error: "boom nel timer",
      errorName: "Error",
      errorStack: error.stack,
    });
  });

  test("una promise rifiutata che discende da uno script: stesso trattamento, anche con un valore qualsiasi", () => {
    runScript(origin, () => processRef.emit("unhandledRejection", "solo una stringa"), 1000);

    expect(engineFaults).toEqual([]);
    expect(logger.entries.error[0].fields).toMatchObject({
      fault: "unhandled_rejection",
      endpoint: "GET /utenti",
      error: "solo una stringa",
    });
  });

  test("un errore del motore resta fatale e non passa dal log degli script", () => {
    const engineError = new Error("stato interno rotto");

    processRef.emit("uncaughtException", engineError);
    processRef.emit("unhandledRejection", engineError);

    expect(engineFaults).toEqual([engineError, engineError]);
    expect(logger.entries.error).toEqual([]);
  });

  test("il logger viene letto a ogni errore: prima dell'avvio può essere un altro", () => {
    const later = createMemoryLogger();
    const replaced = installScriptFaultGuard({
      getLogger: () => logger,
      processRef: new EventEmitter(),
      onEngineFault: () => {},
    });
    replaced();
    uninstall();
    let current = logger;
    uninstall = installScriptFaultGuard({ getLogger: () => current, processRef, onEngineFault: () => {} });

    current = later;
    runScript(origin, () => processRef.emit("uncaughtException", new Error("x")), 1000);

    expect(logger.entries.error).toEqual([]);
    expect(later.entries.error).toHaveLength(1);
  });

  test("tolta la guardia, il processo non ha più i suoi gestori", () => {
    uninstall();

    expect(processRef.listenerCount("uncaughtException")).toBe(0);
    expect(processRef.listenerCount("unhandledRejection")).toBe(0);
  });
});
