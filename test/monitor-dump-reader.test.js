const fs = require("fs");
const path = require("path");
const {
  isSafeDumpFileName,
  parseDumpKey,
  listDumpFiles,
  readDumpPage,
  readDumpFileEntries,
  readDumpEntriesByKeys,
} = require("../src/monitoring/monitor-dump-reader");
const { createTempDir, removeDir } = require("./helpers");

async function writeNdjson(dir, name, count, offset = 0) {
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(JSON.stringify({ id: String(offset + i), method: "GET", path: `/a/${offset + i}`, status: 200 }));
  }
  await fs.promises.writeFile(path.join(dir, name), `${lines.join("\n")}\n`, "utf8");
}

const F1 = "dump-2026-01-01T00-00-00-000Z.ndjson";
const F2 = "dump-2026-01-01T00-01-00-000Z.ndjson";

describe("monitor dump reader", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTempDir("dump-reader-");
  });

  afterEach(async () => {
    await removeDir(dir);
  });

  test("isSafeDumpFileName respinge traversal e nomi non validi", () => {
    expect(isSafeDumpFileName(F1)).toBe(true);
    expect(isSafeDumpFileName("../secret.txt")).toBe(false);
    expect(isSafeDumpFileName("a/b.ndjson")).toBe(false);
    expect(isSafeDumpFileName("dump-..\\x.ndjson")).toBe(false);
    expect(isSafeDumpFileName("notdump.txt")).toBe(false);
    expect(isSafeDumpFileName("dump-x.json")).toBe(false);
  });

  test("parseDumpKey valida file e indice", () => {
    expect(parseDumpKey(`${F1}#3`)).toEqual({ fileName: F1, lineIndex: 3 });
    expect(parseDumpKey("nofile")).toBeNull();
    expect(parseDumpKey("../x#0")).toBeNull();
    expect(parseDumpKey(`${F1}#-1`)).toBeNull();
  });

  test("listDumpFiles elenca solo i dump, ordinati, ignorando il resto", async () => {
    await writeNdjson(dir, F2, 1);
    await writeNdjson(dir, F1, 1);
    await fs.promises.writeFile(path.join(dir, "altro.txt"), "x", "utf8");

    const files = await listDumpFiles(dir);
    expect(files.map((f) => f.name)).toEqual([F1, F2]); // ordine cronologico
    expect(files[0].size).toBeGreaterThan(0);
  });

  test("listDumpFiles ritorna [] se la cartella non esiste", async () => {
    expect(await listDumpFiles(path.join(dir, "manca"))).toEqual([]);
  });

  test("readDumpPage pagina a cursore attraverso più file con chiavi stabili", async () => {
    await writeNdjson(dir, F1, 2, 0);
    await writeNdjson(dir, F2, 2, 100);

    const page1 = await readDumpPage(dir, undefined, 3);
    expect(page1.items).toHaveLength(3);
    expect(page1.done).toBe(false);
    expect(page1.items[0].dumpKey).toBe(`${F1}#0`);
    expect(page1.items[2].dumpKey).toBe(`${F2}#0`);

    const page2 = await readDumpPage(dir, page1.nextCursor, 3);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].dumpKey).toBe(`${F2}#1`);
    expect(page2.done).toBe(true);
    expect(page2.nextCursor).toBeNull();
  });

  test("readDumpPage riprende dal cursore dentro lo stesso file (#35)", async () => {
    await writeNdjson(dir, F1, 5, 0);

    const page1 = await readDumpPage(dir, undefined, 2);
    expect(page1.items.map((i) => i.dumpKey)).toEqual([`${F1}#0`, `${F1}#1`]);
    expect(page1.done).toBe(false);

    const page2 = await readDumpPage(dir, page1.nextCursor, 2);
    expect(page2.items.map((i) => i.dumpKey)).toEqual([`${F1}#2`, `${F1}#3`]);
    expect(page2.done).toBe(false);

    const page3 = await readDumpPage(dir, page2.nextCursor, 2);
    expect(page3.items.map((i) => i.dumpKey)).toEqual([`${F1}#4`]);
    expect(page3.done).toBe(true);
    expect(page3.nextCursor).toBeNull();
  });

  test("readDumpFileEntries e readDumpEntriesByKeys tollerano un file sparito", async () => {
    expect(await readDumpFileEntries(dir, F1)).toEqual([]);
    expect(await readDumpEntriesByKeys(dir, [`${F1}#0`])).toEqual([]);
  });

  test("readDumpPage salta righe vuote o corrotte", async () => {
    await fs.promises.writeFile(
      path.join(dir, F1),
      `${JSON.stringify({ id: "1" })}\n\nnon-json\n${JSON.stringify({ id: "2" })}\n`,
      "utf8"
    );
    const page = await readDumpPage(dir, undefined, 100);
    expect(page.items.map((i) => i.id)).toEqual(["1", "2"]);
    expect(page.done).toBe(true);
  });

  test("readDumpFileEntries ritorna tutte le entry di un file con chiave", async () => {
    await writeNdjson(dir, F1, 3, 0);
    const entries = await readDumpFileEntries(dir, F1);
    expect(entries).toHaveLength(3);
    expect(entries[1].dumpKey).toBe(`${F1}#1`);
  });

  test("readDumpEntriesByKeys risolve chiavi su più file", async () => {
    await writeNdjson(dir, F1, 3, 0);
    await writeNdjson(dir, F2, 3, 100);
    const entries = await readDumpEntriesByKeys(dir, [`${F1}#0`, `${F2}#2`, "chiave-non-valida"]);
    const ids = entries.map((e) => e.id).sort();
    expect(ids).toEqual(["0", "102"].sort());
  });
});
