const fs = require("fs");
const path = require("path");
const { readBackup, commitWithRollback } = require("../src/admin/admin-fs");
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

  test("se il commit fallisce ripristina i backup, rifà il reload e traduce in 400", async () => {
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

    expect(caught.status).toBe(400);
    expect(caught.message).toBe("Operazione rejected: boom");
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
    expect(await fs.promises.readFile(filePath, "utf8")).toBe("originale");
  });

  test("se il reload fallisce il rollback rimuove i file che prima non esistevano", async () => {
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

    expect(caught.status).toBe(400);
    expect(caught.message).toBe("Operazione rejected: reload rotto");
    expect(fs.existsSync(filePath)).toBe(false);
    expect(reloadRuntime).toHaveBeenCalledTimes(2);
  });
});
