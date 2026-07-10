const { createLogger } = require("../src/utils/logger");

// Congela il contratto del logger (punto B4 di archived/PIANO-TEST.md): righe JSON con
// time/level/msg + campi, errori su stderr e tutto il resto su stdout, soglia di livello.

describe("createLogger", () => {
  let stdoutLines;
  let stderrLines;
  let stdoutSpy;
  let stderrSpy;

  beforeEach(() => {
    stdoutLines = [];
    stderrLines = [];
    stdoutSpy = jest.spyOn(process.stdout, "write").mockImplementation((line) => {
      stdoutLines.push(String(line));
      return true;
    });
    stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation((line) => {
      stderrLines.push(String(line));
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  test("scrive una riga JSON con time ISO, level, msg e i campi extra", () => {
    const logger = createLogger("info");
    logger.info("avviato", { port: 3000 });

    expect(stdoutLines).toHaveLength(1);
    expect(stdoutLines[0].endsWith("\n")).toBe(true);
    const parsed = JSON.parse(stdoutLines[0]);
    expect(parsed).toMatchObject({ level: "info", msg: "avviato", port: 3000 });
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time);
  });

  test("gli errori vanno su stderr, il resto su stdout", () => {
    const logger = createLogger("debug");
    logger.error("guasto", { code: "X" });
    logger.warn("attenzione");
    logger.debug("dettaglio");

    expect(stderrLines).toHaveLength(1);
    expect(JSON.parse(stderrLines[0])).toMatchObject({ level: "error", msg: "guasto", code: "X" });
    expect(stdoutLines.map((l) => JSON.parse(l).level)).toEqual(["warn", "debug"]);
  });

  test("la soglia di livello filtra i messaggi meno gravi", () => {
    const logger = createLogger("warn");
    logger.error("e");
    logger.warn("w");
    logger.info("i");
    logger.debug("d");

    expect(stderrLines).toHaveLength(1);
    expect(stdoutLines.map((l) => JSON.parse(l).msg)).toEqual(["w"]);
  });

  test("un livello sconosciuto (di soglia o di scrittura) degrada a info", () => {
    const logger = createLogger("inesistente"); // soglia → info
    logger.debug("sotto soglia");
    logger.info("passa");
    expect(stdoutLines.map((l) => JSON.parse(l).msg)).toEqual(["passa"]);
  });
});
