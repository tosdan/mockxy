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

async function writeEntries(dir, name, entries) {
  await fs.promises.writeFile(path.join(dir, name), `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
}

function captured(id, method, originalUrl, status, source) {
  return { id, method, path: originalUrl.split("?")[0], originalUrl, status, source };
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

  // Lo Storico filtra mentre legge: la ricerca deve vedere tutto l'archivio, non le pagine caricate.
  describe("readDumpPage con filtri", () => {
    beforeEach(async () => {
      await writeEntries(dir, F1, [
        captured("1", "GET", "/api/orders?page=2", 200, "mock"),
        captured("2", "POST", "/api/orders", 201, "backend"),
        captured("3", "GET", "/api/users/9", 404, "backend"),
      ]);
      await writeEntries(dir, F2, [
        captured("4", "GET", "/api/ORDERS/7", 500, "middleware"),
        captured("5", "DELETE", "/api/orders/7", 204, "handler"),
        captured("6", "GET", "/api/health", 200, "mock-only-miss"),
      ]);
    });
    const ids = (page) => page.items.map((item) => item.id);

    test("il testo si cerca in URL e metodo, senza distinguere maiuscole, su tutti i file", async () => {
      expect(ids(await readDumpPage(dir, undefined, 10, { q: "orders" }))).toEqual(["1", "2", "4", "5"]);
      expect(ids(await readDumpPage(dir, undefined, 10, { q: "page=2" }))).toEqual(["1"]);
      expect(ids(await readDumpPage(dir, undefined, 10, { q: "delete" }))).toEqual(["5"]);
    });

    test("metodo, classi di status e provenienza si combinano in AND", async () => {
      expect(ids(await readDumpPage(dir, undefined, 10, { method: "GET", statusClasses: new Set([2, 4]) }))).toEqual(["1", "3", "6"]);
      expect(ids(await readDumpPage(dir, undefined, 10, { source: "backend", statusClasses: new Set([4]) }))).toEqual(["3"]);
    });

    // Stessa partizione del filtro "Backend vero" del Monitor.
    test("'real-backend' tiene cio' che non e' uscito da una response locale", async () => {
      expect(ids(await readDumpPage(dir, undefined, 10, { source: "real-backend" }))).toEqual(["2", "3", "4", "6"]);
    });

    // La richiesta a un endpoint WebSocket la serve l'endpoint stesso: non viene dal backend.
    test("'real-backend' esclude anche le risposte di un endpoint WebSocket", async () => {
      await writeEntries(dir, "dump-2026-01-01T00-02-00-000Z.ndjson", [captured("7", "GET", "/api/chat", 426, "ws")]);
      expect(ids(await readDumpPage(dir, undefined, 10, { source: "real-backend" }))).toEqual(["2", "3", "4", "6"]);
    });

    test("la pagina conta le corrispondenze, e il cursore riprende da dove si era fermata", async () => {
      const first = await readDumpPage(dir, undefined, 2, { q: "orders" });
      expect(ids(first)).toEqual(["1", "2"]);
      expect(first.done).toBe(false);
      const second = await readDumpPage(dir, first.nextCursor, 2, { q: "orders" });
      expect(ids(second)).toEqual(["4", "5"]);
    });

    // Una ricerca rara non deve scorrere l'intero archivio in una risposta sola.
    test("oltre il tetto di righe lette torna una pagina incompleta, col cursore per continuare", async () => {
      const first = await readDumpPage(dir, undefined, 10, { source: "handler" }, 2);
      expect(ids(first)).toEqual([]);
      expect(first.done).toBe(false);
      let page = first;
      const found = [];
      while (!page.done) {
        page = await readDumpPage(dir, page.nextCursor, 10, { source: "handler" }, 2);
        found.push(...ids(page));
      }
      expect(found).toEqual(["5"]);
    });
  });

  // La ripresa dentro un file riapriva il file dall'inizio e ripercorreva le righe gia' lette:
  // il lavoro di una chiamata cresceva col cursore. Ora il cursore porta il byte da cui ripartire.
  describe("ripresa dal byte", () => {
    const lineOf = (i) => JSON.stringify({ id: String(i), method: "GET", path: `/città/${i}`, originalUrl: `/città/${i}`, status: 200, source: "mock" });
    let starts;

    beforeEach(async () => {
      const lines = Array.from({ length: 50 }, (_, i) => lineOf(i));
      await fs.promises.writeFile(path.join(dir, F1), `${lines.join("\n")}\n`, "utf8");
      const original = fs.createReadStream;
      starts = [];
      jest.spyOn(fs, "createReadStream").mockImplementation((file, options) => {
        starts.push(options?.start ?? 0);
        return original(file, options);
      });
    });

    afterEach(() => jest.restoreAllMocks());

    const bytesBefore = (line) =>
      Array.from({ length: line }, (_, i) => Buffer.byteLength(`${lineOf(i)}\n`)).reduce((a, b) => a + b, 0);

    test("il cursore porta il byte dopo l'ultima riga letta, anche con caratteri multibyte", async () => {
      const page = await readDumpPage(dir, undefined, 3);
      expect(page.nextCursor).toEqual({ fileIndex: 0, lineIndex: 3, byteOffset: bytesBefore(3) });
    });

    test("con un cursore avanzato la lettura parte dal suo byte, senza ripercorrere il prefisso", async () => {
      const page = await readDumpPage(dir, { fileIndex: 0, lineIndex: 40, byteOffset: bytesBefore(40) }, 5);

      expect(starts).toEqual([bytesBefore(40)]);
      expect(page.items.map((item) => item.dumpKey)).toEqual([40, 41, 42, 43, 44].map((i) => `${F1}#${i}`));
      expect(page.items[0].originalUrl).toBe("/città/40");
    });

    test("il tetto di righe vale dal cursore in poi: una ricerca rara avanza a passi uguali", async () => {
      let cursor = { fileIndex: 0, lineIndex: 30, byteOffset: bytesBefore(30) };
      const page = await readDumpPage(dir, cursor, 10, { q: "nessuna" }, 5);

      expect(starts).toEqual([bytesBefore(30)]);
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toEqual({ fileIndex: 0, lineIndex: 35, byteOffset: bytesBefore(35) });
      cursor = page.nextCursor;
      await readDumpPage(dir, cursor, 10, { q: "nessuna" }, 5);
      expect(starts[1]).toBe(bytesBefore(35));
    });

    // Un client che non rimanda il byte (o ne manda uno che non cade a inizio riga) funziona come prima.
    test("senza byte, o con un byte a meta' riga, riparte dall'inizio del file e conta le righe", async () => {
      for (const cursor of [{ fileIndex: 0, lineIndex: 10 }, { fileIndex: 0, lineIndex: 10, byteOffset: bytesBefore(10) + 3 }]) {
        starts.length = 0;
        const page = await readDumpPage(dir, cursor, 2);
        expect(starts).toEqual([0]);
        expect(page.items.map((item) => item.id)).toEqual(["10", "11"]);
        expect(page.nextCursor).toEqual({ fileIndex: 0, lineIndex: 12, byteOffset: bytesBefore(12) });
      }
    });

    test("gestisce righe con \\r\\n e un'ultima riga senza a capo", async () => {
      await fs.promises.writeFile(path.join(dir, F2), `${lineOf(100)}\r\n${lineOf(101)}\r\n${lineOf(102)}`, "utf8");
      const first = await readDumpPage(dir, { fileIndex: 1, lineIndex: 0 }, 1);
      expect(first.items.map((item) => item.id)).toEqual(["100"]);
      expect(first.nextCursor.byteOffset).toBe(Buffer.byteLength(`${lineOf(100)}\r\n`));

      const rest = await readDumpPage(dir, first.nextCursor, 10);
      expect(rest.items.map((item) => item.id)).toEqual(["101", "102"]);
      expect(rest.done).toBe(true);
    });
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

  // Lo Storico mostra prima le voci piu' recenti: si legge dall'ultimo file e dalla fine di ogni file.
  describe("readDumpPage dalla voce piu' recente (order desc)", () => {
    // Tutte le pagine di una lettura, concatenate, piu' quante pagine sono servite.
    async function readAll(order, limit, filters, maxScannedLines) {
      const keys = [];
      let cursor;
      let pages = 0;
      for (;;) {
        const page = await readDumpPage(dir, cursor, limit, filters, maxScannedLines, order);
        pages += 1;
        keys.push(...page.items.map((item) => item.dumpKey));
        if (page.done) {
          expect(page.nextCursor).toBeNull();
          return { keys, pages };
        }
        cursor = page.nextCursor;
        expect(pages).toBeLessThan(10_000);
      }
    }

    test("parte dall'ultima riga dell'ultimo file, con le stesse chiavi della lettura in avanti", async () => {
      await writeNdjson(dir, F1, 3, 0);
      await writeNdjson(dir, F2, 2, 100);
      const page = await readDumpPage(dir, undefined, 10, undefined, undefined, "desc");
      expect(page.items.map((item) => item.id)).toEqual(["101", "100", "2", "1", "0"]);
      expect(page.items.map((item) => item.dumpKey)).toEqual([`${F2}#1`, `${F2}#0`, `${F1}#2`, `${F1}#1`, `${F1}#0`]);
      expect(page.done).toBe(true);
    });

    test("a pagine, attraverso i file, e' esattamente la lettura in avanti rovesciata", async () => {
      await writeNdjson(dir, F1, 7, 0);
      await writeNdjson(dir, F2, 5, 100);
      const forward = await readAll("asc", 100);
      for (const limit of [1, 2, 3, 5, 7, 12]) {
        expect((await readAll("desc", limit)).keys).toEqual([...forward.keys].reverse());
      }
    });

    test("con i filtri e il tetto di righe lette per chiamata, le pagine corte non perdono voci", async () => {
      await writeEntries(dir, F1, [
        captured("1", "GET", "/api/a", 200, "mock"),
        captured("2", "POST", "/api/b", 201, "handler"),
        captured("3", "GET", "/api/c", 404, "backend"),
        captured("4", "GET", "/api/d", 200, "handler"),
      ]);
      await writeEntries(dir, F2, [
        captured("5", "GET", "/api/e", 500, "handler"),
        captured("6", "GET", "/api/f", 200, "mock"),
      ]);
      const filters = { source: "handler" };
      const forward = await readAll("asc", 100, filters);
      const backward = await readAll("desc", 10, filters, 1);
      expect(backward.keys).toEqual([...forward.keys].reverse());
      expect(backward.keys).toEqual([`${F2}#0`, `${F1}#3`, `${F1}#1`]);
      expect(backward.pages).toBeGreaterThan(3);
    });

    test("righe vuote, corrotte, con \\r o senza a capo finale: stesse voci e chiavi", async () => {
      await fs.promises.writeFile(
        path.join(dir, F1),
        `\n${JSON.stringify({ id: "1" })}\r\n\nnon-json\n${JSON.stringify({ id: "2" })}\n${JSON.stringify({ id: "3" })}`,
        "utf8"
      );
      const forward = await readAll("asc", 100);
      const backward = await readAll("desc", 1);
      expect(forward.keys).toEqual([`${F1}#1`, `${F1}#4`, `${F1}#5`]);
      expect(backward.keys).toEqual([...forward.keys].reverse());
    });

    test("un file piu' grande di un blocco di lettura si legge intero e nell'ordine giusto", async () => {
      const lines = [];
      for (let i = 0; i < 1500; i += 1) lines.push(JSON.stringify({ id: String(i), payload: "x".repeat(120) }));
      await fs.promises.writeFile(path.join(dir, F1), `${lines.join("\n")}\n`, "utf8");
      const forward = await readAll("asc", 1000);
      const backward = await readAll("desc", 333);
      expect(backward.keys).toHaveLength(1500);
      expect(backward.keys).toEqual([...forward.keys].reverse());
    });

    test("con un byteOffset che non e' l'inizio di una riga riprende dal conteggio delle righe", async () => {
      await writeNdjson(dir, F1, 6, 0);
      const first = await readDumpPage(dir, undefined, 2, undefined, undefined, "desc");
      expect(first.items.map((item) => item.id)).toEqual(["5", "4"]);
      const page = await readDumpPage(dir, { ...first.nextCursor, byteOffset: first.nextCursor.byteOffset - 3 }, 2, undefined, undefined, "desc");
      expect(page.items.map((item) => item.id)).toEqual(["3", "2"]);
    });

    test("le righe aggiunte dopo la prima pagina non entrano: si legge l'archivio di quel momento", async () => {
      await writeNdjson(dir, F1, 4, 0);
      const first = await readDumpPage(dir, undefined, 2, undefined, undefined, "desc");
      await fs.promises.appendFile(path.join(dir, F1), `${JSON.stringify({ id: "nuova" })}\n`, "utf8");
      const second = await readDumpPage(dir, first.nextCursor, 10, undefined, undefined, "desc");
      expect([...first.items, ...second.items].map((item) => item.id)).toEqual(["3", "2", "1", "0"]);
      expect(second.done).toBe(true);
    });

    test("archivio vuoto, o file vuoti: nessuna voce e lettura finita", async () => {
      expect(await readDumpPage(dir, undefined, 10, undefined, undefined, "desc")).toEqual({ items: [], nextCursor: null, done: true });
      await fs.promises.writeFile(path.join(dir, F1), "", "utf8");
      await writeNdjson(dir, F2, 1, 0);
      expect((await readAll("desc", 1)).keys).toEqual([`${F2}#0`]);
    });
  });
});
