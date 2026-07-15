const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  LOGS_DIR_NAME,
  resolveLogsBaseDir,
  createErrorFileLog,
  teeErrors,
} = require("../electron/error-log");

async function createTempDir(prefix) {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function removeDir(dir) {
  await fs.promises.rm(dir, { recursive: true, force: true });
}

describe("error-log (log errori su file dell'app desktop)", () => {
  describe("resolveLogsBaseDir", () => {
    test("AppImage: accanto al file .AppImage (execPath punta nello squashfs read-only)", () => {
      const dir = resolveLogsBaseDir({
        env: { APPIMAGE: "/home/utente/Applicazioni/Mockxy.AppImage" },
        execPath: "/tmp/.mount_Mockxy/mockxy",
        isPackaged: true,
        devDir: "/repo/electron",
      });
      expect(dir).toBe("/home/utente/Applicazioni");
    });

    test("build Windows portabile: la cartella dell'exe (stessa scelta delle preferenze)", () => {
      const dir = resolveLogsBaseDir({
        env: { PORTABLE_EXECUTABLE_DIR: "C:\\strumenti\\mockxy" },
        execPath: "C:\\Users\\x\\AppData\\Temp\\estratto\\Mockxy.exe",
        isPackaged: true,
        devDir: "/repo/electron",
      });
      expect(dir).toBe("C:\\strumenti\\mockxy");
    });

    test("pacchetto installato: la cartella dell'eseguibile", () => {
      const dir = resolveLogsBaseDir({
        env: {},
        execPath: "/opt/Mockxy/mockxy",
        isPackaged: true,
        devDir: "/repo/electron",
      });
      expect(dir).toBe("/opt/Mockxy");
    });

    test("sviluppo (non impacchettato): la cartella electron/ del repo", () => {
      const dir = resolveLogsBaseDir({
        env: {},
        execPath: "/usr/bin/electron",
        isPackaged: false,
        devDir: "/repo/electron",
      });
      expect(dir).toBe("/repo/electron");
    });
  });

  describe("createErrorFileLog", () => {
    test("scrive un file al giorno in logs/, con contesto, campi e stack indentato", async () => {
      const base = await createTempDir("mockxy-errlog-");
      try {
        const now = () => new Date("2026-07-15T10:20:30.000Z");
        const log = createErrorFileLog({ baseDir: base, now });
        expect(log.logsDir).toBe(path.join(base, LOGS_DIR_NAME));

        const error = new Error("data is not defined");
        expect(log.logError("engine:demo", error, { requestPath: "/dyn" })).toBe(true);
        expect(log.logError("engine:demo", "solo testo")).toBe(true);

        const content = await fs.promises.readFile(
          path.join(log.logsDir, "errors-2026-07-15.log"),
          "utf8"
        );
        expect(content).toContain('2026-07-15T10:20:30.000Z [engine:demo] data is not defined {"requestPath":"/dyn"}');
        expect(content).toContain("    Error: data is not defined"); // stack indentato
        expect(content).toContain("[engine:demo] solo testo");
      } finally {
        await removeDir(base);
      }
    });

    test("posizione primaria non scrivibile: ripiega sulla cartella di fallback", async () => {
      const fallback = await createTempDir("mockxy-errlog-fb-");
      const readOnly = await createTempDir("mockxy-errlog-ro-");
      try {
        await fs.promises.chmod(readOnly, 0o555);
        const log = createErrorFileLog({ baseDir: readOnly, fallbackBaseDir: fallback });
        expect(log.logsDir).toBe(path.join(fallback, LOGS_DIR_NAME));
        expect(log.logError("startup", new Error("boom"))).toBe(true);
      } finally {
        await fs.promises.chmod(readOnly, 0o755);
        await removeDir(readOnly);
        await removeDir(fallback);
      }
    });

    test("preferenza spenta: non scrive, e setEnabled riaccende/spegne a runtime", async () => {
      const base = await createTempDir("mockxy-errlog-off-");
      try {
        const log = createErrorFileLog({ baseDir: base, enabled: false });
        // La destinazione resta pronta (logsDir valorizzato): spento è una scelta, non un guasto.
        expect(log.logsDir).toBe(path.join(base, LOGS_DIR_NAME));
        expect(log.logError("startup", new Error("boom"))).toBe(false);
        expect(await fs.promises.readdir(log.logsDir)).toEqual([]);

        log.setEnabled(true);
        expect(log.logError("startup", new Error("boom"))).toBe(true);
        expect(await fs.promises.readdir(log.logsDir)).toHaveLength(1);

        log.setEnabled(false);
        expect(log.logError("startup", new Error("dopo lo spegnimento"))).toBe(false);
      } finally {
        await removeDir(base);
      }
    });

    test("nessuna posizione scrivibile: il log si disattiva senza lanciare", async () => {
      const readOnly = await createTempDir("mockxy-errlog-ro2-");
      try {
        await fs.promises.chmod(readOnly, 0o555);
        const log = createErrorFileLog({ baseDir: readOnly, fallbackBaseDir: readOnly });
        expect(log.logsDir).toBeNull();
        expect(log.logError("startup", new Error("boom"))).toBe(false);
      } finally {
        await fs.promises.chmod(readOnly, 0o755);
        await removeDir(readOnly);
      }
    });
  });

  describe("teeErrors", () => {
    test("duplica le sole righe error, lasciando intatto il logger di base", () => {
      const calls = { base: [], tee: [] };
      const baseLogger = {
        error: (msg, fields) => calls.base.push(["error", msg, fields]),
        warn: (msg) => calls.base.push(["warn", msg]),
        info: (msg) => calls.base.push(["info", msg]),
        debug: (msg) => calls.base.push(["debug", msg]),
      };
      const logger = teeErrors(baseLogger, (msg, fields) => calls.tee.push([msg, fields]));

      logger.info("avvio");
      logger.warn("attenzione");
      logger.error("Local handler failed.", { error: "data is not defined" });

      expect(calls.base).toEqual([
        ["info", "avvio"],
        ["warn", "attenzione"],
        ["error", "Local handler failed.", { error: "data is not defined" }],
      ]);
      expect(calls.tee).toEqual([["Local handler failed.", { error: "data is not defined" }]]);
    });
  });
});
