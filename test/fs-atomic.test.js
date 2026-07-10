const fs = require("fs");
const path = require("path");
const { writeFileAtomic } = require("../src/utils/fs-atomic");
const { createTempDir, removeDir } = require("./helpers");

// Scrittura atomica (#27 revisione): temp file + rename, così un crash a metà scrittura non
// lascia mai il file di destinazione troncato.
describe("writeFileAtomic", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTempDir("fs-atomic-");
  });

  afterEach(async () => {
    await removeDir(dir);
  });

  test("scrive un file nuovo senza lasciare temporanei", async () => {
    const target = path.join(dir, "nuovo.json");
    await writeFileAtomic(target, '{"ok":true}', "utf8");

    expect(await fs.promises.readFile(target, "utf8")).toBe('{"ok":true}');
    expect(await fs.promises.readdir(dir)).toEqual(["nuovo.json"]);
  });

  test("sovrascrive un file esistente (rename sopra il target, anche su Windows)", async () => {
    const target = path.join(dir, "esistente.json");
    await fs.promises.writeFile(target, "vecchio", "utf8");

    await writeFileAtomic(target, "nuovo contenuto", "utf8");

    expect(await fs.promises.readFile(target, "utf8")).toBe("nuovo contenuto");
    expect(await fs.promises.readdir(dir)).toEqual(["esistente.json"]);
  });

  test("scrive anche contenuti binari (Buffer)", async () => {
    const target = path.join(dir, "payload.bin");
    const content = Buffer.from([0x00, 0x01, 0xff]);
    await writeFileAtomic(target, content);

    expect((await fs.promises.readFile(target)).equals(content)).toBe(true);
  });

  test("se la scrittura fallisce il target resta intatto", async () => {
    const target = path.join(dir, "sottocartella-inesistente", "file.json");

    await expect(writeFileAtomic(target, "x", "utf8")).rejects.toThrow();
    expect(fs.existsSync(target)).toBe(false);
  });
});
