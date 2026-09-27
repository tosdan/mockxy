const fs = require("fs");
const path = require("path");
const { readBackup, restoreBackup, commitWithRollback, validateReloadedEndpoints } = require("../src/admin/admin-fs");
const { writeFileAtomic } = require("../src/utils/fs-atomic");
const { createTempDir, removeDir } = require("./helpers");

// Protocollo transazionale delle mutazioni admin (code review 2026-07-09, doc 04 §3):
// la busta backup→commit→reload→(rollback) vive in un solo posto e questi test ne fissano
// la semantica per tutte le 12 operazioni che la attraversano.
describe("commitWithRollback", () => {
  let dir;
  let filePath;

  beforeEach(async () => {
    dir = await createTempDir("admin-fs-");
    filePath = path.join(dir, "GET.endpoint.json");
  });

  afterEach(async () => {
    await removeDir(dir);
  });

  test("a commit riuscito esegue il reload e non tocca i file scritti", async () => {
    await writeFileAtomic(filePath, "originale", "utf8");
    const backups = [await readBackup(filePath)];
    await writeFileAtomic(filePath, "nuovo", "utf8");
    const reloadRuntime = jest.fn();

    await commitWithRollback({ backups, reloadRuntime, rejectionLabel: "Operazione rejected" });

    expect(await fs.promises.readFile(filePath, "utf8")).toBe("nuovo");
    expect(reloadRuntime).toHaveBeenCalledTimes(1);
  });

  test("se il commit fallisce per un errore non tipizzato ripristina i backup e risponde 500 MUTATION_FAILED", async () => {
    await writeFileAtomic(filePath, "originale", "utf8");
    const backups = [await readBackup(filePath)];
    await writeFileAtomic(filePath, "scrittura da annullare", "utf8");
    const reloadRuntime = jest.fn();

    let caught;
    try {
      await commitWithRollback({
        backups,
        reloadRuntime,
        rejectionLabel: "Operazione rejected",
        commit: () => {
          throw new Error("boom");
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught.status).toBe(500);
    expect(caught.message).toBe("Operazione rejected: boom");
    expect(caught.details).toEqual({ code: "MUTATION_FAILED", rollback: "restored" });
    expect(await fs.promises.readFile(filePath, "utf8")).toBe("originale");
    // Il reload post-rollback riallinea il runtime ai file appena ripristinati
    // (quello ordinario non è mai partito: il commit è fallito prima).
    expect(reloadRuntime).toHaveBeenCalledTimes(1);
  });

  test("un errore già tipizzato (status HTTP) propaga invariato dopo il rollback", async () => {
    await writeFileAtomic(filePath, "originale", "utf8");
    const backups = [await readBackup(filePath)];
    await writeFileAtomic(filePath, "scrittura da annullare", "utf8");

    let caught;
    try {
      await commitWithRollback({
        backups,
        reloadRuntime: undefined,
        rejectionLabel: "Operazione rejected",
        commit: () => {
          throw Object.assign(new Error("Collection not found."), { status: 404 });
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught.status).toBe(404);
    expect(caught.message).toBe("Collection not found.");
    expect(caught.details).toEqual({ rollback: "restored" });
    expect(await fs.promises.readFile(filePath, "utf8")).toBe("originale");
  });

  test("se il reload rigetta, il rollback rimuove i file nuovi e risponde 500 RUNTIME_APPLY_FAILED", async () => {
    const backups = [await readBackup(filePath)];
    await writeFileAtomic(filePath, "creato dalla mutazione", "utf8");
    const reloadRuntime = jest
      .fn()
      .mockRejectedValueOnce(new Error("reload rotto"))
      .mockResolvedValueOnce(undefined);

    let caught;
    try {
      await commitWithRollback({ backups, reloadRuntime, rejectionLabel: "Operazione rejected" });
    } catch (error) {
      caught = error;
    }

    expect(caught.status).toBe(500);
    expect(caught.message).toBe("Operazione rejected: runtime reload failed: reload rotto");
    expect(caught.details).toEqual({ code: "RUNTIME_APPLY_FAILED", rollback: "restored" });
    expect(fs.existsSync(filePath)).toBe(false);
    expect(reloadRuntime).toHaveBeenCalledTimes(2);
  });

  test("valida l'esito restituito dal reload e fa rollback quando l'ack viene rifiutato", async () => {
    await writeFileAtomic(filePath, "originale", "utf8");
    const backups = [await readBackup(filePath)];
    await writeFileAtomic(filePath, "nuovo", "utf8");
    const firstOutcome = { applied: true, loadErrors: [{ filePath, message: "endpoint rotto" }] };
    const reloadRuntime = jest.fn().mockResolvedValueOnce(firstOutcome).mockResolvedValueOnce({ applied: true });
    const validateReloadResult = jest.fn(() => {
      throw new Error("endpoint rotto");
    });

    await expect(commitWithRollback({
      backups,
      reloadRuntime,
      rejectionLabel: "Operazione rejected",
      validateReloadResult,
    })).rejects.toMatchObject({
      status: 400,
      message: "Operazione rejected: endpoint rotto",
      details: { code: "MUTATION_REJECTED", rollback: "restored" },
    });

    expect(validateReloadResult).toHaveBeenCalledWith(firstOutcome);
    expect(reloadRuntime).toHaveBeenCalledTimes(2);
    expect(await fs.promises.readFile(filePath, "utf8")).toBe("originale");
  });

  // Il reload non rigetta mai: sul fallimento globale risolve con applied false. Prima questo
  // esito passava inosservato alle mutazioni che non lo validavano esplicitamente.
  test("un reload risolto con applied false è un fallimento globale anche senza validazione", async () => {
    await writeFileAtomic(filePath, "originale", "utf8");
    const backups = [await readBackup(filePath)];
    const reloadRuntime = jest
      .fn()
      .mockResolvedValueOnce({ applied: false, loadErrors: [], fatalError: new Error("scansione fallita") })
      .mockResolvedValueOnce({ applied: true, loadErrors: [], fatalError: null });

    await expect(commitWithRollback({
      backups,
      reloadRuntime,
      rejectionLabel: "Operazione rejected",
      commit: () => writeFileAtomic(filePath, "nuovo", "utf8"),
    })).rejects.toMatchObject({
      status: 500,
      message: "Operazione rejected: runtime reload failed: scansione fallita",
      details: { code: "RUNTIME_APPLY_FAILED", rollback: "restored" },
    });
    expect(await fs.promises.readFile(filePath, "utf8")).toBe("originale");
  });

  test("se anche il reload del ripristino fallisce non dichiara un rollback riuscito", async () => {
    await writeFileAtomic(filePath, "originale", "utf8");
    const backups = [await readBackup(filePath)];
    const failed = { applied: false, loadErrors: [], fatalError: new Error("scansione fallita") };
    const reloadRuntime = jest.fn().mockResolvedValue(failed);

    await expect(commitWithRollback({
      backups,
      reloadRuntime,
      rejectionLabel: "Operazione rejected",
      commit: () => writeFileAtomic(filePath, "nuovo", "utf8"),
    })).rejects.toMatchObject({
      status: 500,
      details: {
        code: "ROLLBACK_FAILED",
        rollback: "failed",
        cause: "scansione fallita",
        recoveryError: "scansione fallita",
      },
    });
    // I file sono comunque ripristinati: è il runtime a non poterlo confermare.
    expect(await fs.promises.readFile(filePath, "utf8")).toBe("originale");
  });

  // Reload col registro delle definizioni installate, come quello del runtime reale: `served`
  // è lo stato prima della mutazione, `outcomes` gli esiti dei reload successivi.
  function createTrackedReload(served, outcomes) {
    const reloadRuntime = jest.fn();
    for (const outcome of outcomes) {
      reloadRuntime.mockResolvedValueOnce(outcome);
    }
    reloadRuntime.installedConfigFilePaths = () => new Set(served);
    return reloadRuntime;
  }

  test("un ripristino che non torna a servire una risorsa servita prima non è un rollback riuscito", async () => {
    await writeFileAtomic(filePath, "originale", "utf8");
    const backups = [await readBackup(filePath)];
    // Il runtime serviva la versione precedente nonostante il sorgente rotto: il reload
    // intermedio la toglie e ricaricare lo stesso sorgente non la ricostruisce.
    const reloadRuntime = createTrackedReload([filePath], [
      { applied: true, loadErrors: [], fatalError: null, installedConfigFilePaths: new Set() },
      { applied: true, loadErrors: [{ filePath, message: "sintassi" }], fatalError: null, installedConfigFilePaths: new Set() },
    ]);

    await expect(commitWithRollback({
      backups,
      reloadRuntime,
      rejectionLabel: "Operazione rejected",
      commit: () => writeFileAtomic(filePath, "nuovo", "utf8"),
      validateReloadResult: () => {
        const error = new Error("rifiutata");
        error.status = 400;
        throw error;
      },
      involved: [filePath],
      baseDir: dir,
    })).rejects.toMatchObject({
      status: 500,
      details: {
        code: "ROLLBACK_FAILED",
        rollback: "failed",
        recoveryError: "GET.endpoint.json was served before the mutation and is not served after the restore.",
      },
    });
    expect(await fs.promises.readFile(filePath, "utf8")).toBe("originale");
  });

  test("un errore preesistente su una risorsa che non era servita non invalida il ripristino", async () => {
    await writeFileAtomic(filePath, "originale", "utf8");
    const backups = [await readBackup(filePath)];
    const brokenBefore = { applied: true, loadErrors: [{ filePath, message: "sintassi" }], fatalError: null, installedConfigFilePaths: new Set() };
    const reloadRuntime = createTrackedReload([], [brokenBefore, brokenBefore]);

    await expect(commitWithRollback({
      backups,
      reloadRuntime,
      rejectionLabel: "Operazione rejected",
      commit: () => writeFileAtomic(filePath, "nuovo", "utf8"),
      validateReloadResult: () => {
        const error = new Error("rifiutata");
        error.status = 400;
        throw error;
      },
      involved: [filePath],
      baseDir: dir,
    })).rejects.toMatchObject({ status: 400, details: { code: "MUTATION_REJECTED", rollback: "restored" } });
  });

  test("restituisce l'esito del reload a chi deve verificarne l'effetto", async () => {
    const outcome = { applied: true, loadErrors: [], fatalError: null };
    const reloadRuntime = jest.fn().mockResolvedValue(outcome);

    await expect(commitWithRollback({ backups: [], reloadRuntime, rejectionLabel: "x" })).resolves.toBe(outcome);
  });
});

describe("restoreBackup", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTempDir("admin-fs-restore-");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await removeDir(dir);
  });

  test("se un ripristino fallisce attende comunque la conclusione degli altri", async () => {
    // Una cartella che non si può creare (il genitore è un file) fa fallire subito un ripristino;
    // l'altro è rallentato. Rigettare prima che finisca libererebbe la coda delle mutazioni
    // mentre una scrittura del ripristino è ancora in corso.
    const blocker = path.join(dir, "blocker");
    await fs.promises.writeFile(blocker, "file, non cartella");
    const unreachable = path.join(blocker, "sub", "GET.endpoint.json");
    const slowPath = path.join(dir, "slow", "GET.endpoint.json");
    const realMkdir = fs.promises.mkdir.bind(fs.promises);
    jest.spyOn(fs.promises, "mkdir").mockImplementation(async (target, options) => {
      if (target === path.dirname(slowPath)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return realMkdir(target, options);
    });

    const failure = await restoreBackup([
      { filePath: unreachable, exists: true, content: "perso" },
      { filePath: slowPath, exists: true, content: "ripristinato" },
    ]).catch((error) => error);

    expect(fs.existsSync(slowPath) && fs.readFileSync(slowPath, "utf8")).toBe("ripristinato");
    expect(failure).toMatchObject({ restoreFailures: [expect.objectContaining({ code: "ENOTDIR" })] });
  });
});

describe("validateReloadedEndpoints", () => {
  const base = path.resolve("/workspace/mocks");
  const endpointA = path.join(base, "a", "GET.endpoint.json");
  const endpointB = path.join(base, "b", "GET.endpoint.json");
  const reloaded = (overrides = {}) => ({
    applied: true,
    loadErrors: [],
    fatalError: null,
    installedConfigFilePaths: new Set([endpointA]),
    ...overrides,
  });

  test("accetta l'effetto richiesto e ignora gli errori di endpoint estranei", () => {
    expect(() => validateReloadedEndpoints(
      reloaded({ loadErrors: [{ filePath: endpointB, message: "rotto" }] }),
      { checked: [endpointA], installed: [endpointA], baseDir: base }
    )).not.toThrow();
  });

  test("un errore di caricamento su una risorsa coinvolta è un rifiuto", () => {
    expect(() => validateReloadedEndpoints(
      reloaded({ loadErrors: [{ filePath: endpointA, message: "handler non compilabile" }] }),
      { checked: [endpointA] }
    )).toThrow("handler non compilabile");
  });

  test("una definizione che doveva essere servita e non lo è è un rifiuto", () => {
    expect(() => validateReloadedEndpoints(reloaded(), { installed: [endpointB], baseDir: base }))
      .toThrow("b/GET.endpoint.json is not served after the reload.");
  });

  test("una definizione che doveva sparire ed è ancora servita è un rifiuto", () => {
    expect(() => validateReloadedEndpoints(reloaded(), { absent: [endpointA], baseDir: base }))
      .toThrow("a/GET.endpoint.json is still served after the reload.");
  });

  test("senza l'elenco delle definizioni installate verifica solo gli errori", () => {
    expect(() => validateReloadedEndpoints(
      { applied: true, loadErrors: [] },
      { installed: [endpointB], absent: [endpointA] }
    )).not.toThrow();
    expect(() => validateReloadedEndpoints(undefined, { checked: [endpointA] })).not.toThrow();
  });
});
