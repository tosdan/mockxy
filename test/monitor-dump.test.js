const fs = require("fs");
const path = require("path");
const { MonitorDumpWriter } = require("../src/monitoring/monitor-dump");
const { RequestMonitorStore } = require("../src/monitoring/request-monitor");
const { createTempDir, removeDir, waitFor } = require("./helpers");

// Registra `count` request sintetiche nel monitor (capture nulli → entry senza body, schema reale).
function recordRequests(store, count, source = "backend") {
  for (let i = 0; i < count; i += 1) {
    store.recordRequest({
      req: { headers: {}, method: "GET", path: `/x/${i}`, url: `/x/${i}` },
      res: { statusCode: 200, getHeaders: () => ({ "content-type": "application/json" }) },
      startedAt: 0,
      completedAt: 1,
      source,
      capture: null,
      responseCapture: null,
    });
  }
}

async function readDump(dumpDir) {
  let files = [];
  try {
    files = (await fs.promises.readdir(dumpDir)).filter((f) => f.endsWith(".ndjson")).sort();
  } catch {
    return { files: [], entries: [] };
  }
  const entries = [];
  for (const file of files) {
    const text = await fs.promises.readFile(path.join(dumpDir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      entries.push(JSON.parse(line));
    }
  }
  return { files, entries };
}

describe("monitor dump writer", () => {
  let dumpDir;
  let store;
  let dumper;

  beforeEach(async () => {
    dumpDir = await createTempDir("monitor-dump-");
    store = new RequestMonitorStore();
    dumper = null;
  });

  afterEach(async () => {
    if (dumper) {
      await dumper.stop();
    }
    await removeDir(dumpDir);
  });

  test("appende le entry come NDJSON valido con i dati della response", async () => {
    dumper = new MonitorDumpWriter({ dumpDir, threshold: 1000 });
    dumper.start(store);
    recordRequests(store, 2);
    await dumper.flush();

    const { entries } = await readDump(dumpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ method: "GET", status: 200 });
    expect(entries[0].responseHeaders).toMatchObject({ "content-type": "application/json" });
  });

  test("ignora l'evento clear: non aggiunge entry e non svuota il pending", async () => {
    dumper = new MonitorDumpWriter({ dumpDir, threshold: 1000 });
    dumper.start(store);
    recordRequests(store, 1);
    store.clear(); // broadcast { type: "clear" } → deve essere ignorato dal dumper
    recordRequests(store, 1);
    await dumper.flush();

    const { entries } = await readDump(dumpDir);
    expect(entries).toHaveLength(2);
  });

  test("flush automatico al raggiungimento della soglia", async () => {
    dumper = new MonitorDumpWriter({ dumpDir, threshold: 3 });
    dumper.start(store);
    recordRequests(store, 3); // raggiunge la soglia → flush automatico (fire-and-forget)
    await dumper.flush(); // drena la scrittura in corso (pending già vuoto)

    const { entries } = await readDump(dumpDir);
    expect(entries).toHaveLength(3);
    expect(dumper.getStatus().pendingCount).toBe(0);
  });

  test("flush periodico allo scadere dell'intervallo", async () => {
    dumper = new MonitorDumpWriter({ dumpDir, intervalMs: 50, threshold: 1000 });
    dumper.start(store);
    recordRequests(store, 2); // sotto soglia: niente flush immediato, ci pensa l'intervallo
    await waitFor(async () => (await readDump(dumpDir)).entries.length === 2);

    const { entries } = await readDump(dumpDir);
    expect(entries).toHaveLength(2);
  });

  test("rotazione su più file al superare il cap di dimensione", async () => {
    dumper = new MonitorDumpWriter({ dumpDir, threshold: 1, maxFileBytes: 50 });
    dumper.start(store);
    recordRequests(store, 4); // ogni riga supera 50 byte → ogni flush ruota file
    await dumper.flush();

    const { files, entries } = await readDump(dumpDir);
    expect(files.length).toBeGreaterThan(1);
    expect(entries).toHaveLength(4);
  });

  test("nessuna perdita nonostante il cap della vista live del monitor", async () => {
    store = new RequestMonitorStore(5); // vista live capata a 5
    dumper = new MonitorDumpWriter({ dumpDir, threshold: 1000 });
    dumper.start(store);
    recordRequests(store, 20);
    await dumper.flush();

    const { entries } = await readDump(dumpDir);
    expect(entries).toHaveLength(20); // il dump ha tutte e 20
    expect(store.listEntries()).toHaveLength(5); // la vista live solo 5
  });

  // Prepara nella cartella dei dump 3 archivi "di sessioni vecchie" da 40 byte l'uno,
  // con date crescenti, più un file estraneo che il pruning non deve mai toccare.
  async function seedOldDumpFiles() {
    const oldNames = [
      "dump-2020-01-01T00-00-00-000Z.ndjson",
      "dump-2021-01-01T00-00-00-000Z.ndjson",
      "dump-2022-01-01T00-00-00-000Z.ndjson",
    ];
    await fs.promises.mkdir(dumpDir, { recursive: true });
    for (const [index, name] of oldNames.entries()) {
      const filePath = path.join(dumpDir, name);
      await fs.promises.writeFile(filePath, "x".repeat(40), "utf8");
      const when = new Date(2020 + index, 0, 1);
      await fs.promises.utimes(filePath, when, when);
    }
    await fs.promises.writeFile(path.join(dumpDir, "note.txt"), "estraneo", "utf8");
    return oldNames;
  }

  test("oltre il tetto elimina i dump più vecchi, mai il file attivo né file estranei", async () => {
    const oldNames = await seedOldDumpFiles(); // 3 × 40 byte = 120

    dumper = new MonitorDumpWriter({ dumpDir, threshold: 1000, maxTotalBytes: 100 });
    dumper.start(store);
    recordRequests(store, 1);
    await dumper.flush(); // attende la coda di scrittura, che include la potatura d'avvio

    const names = await fs.promises.readdir(dumpDir);
    expect(names).toContain("note.txt");
    expect(names).not.toContain(oldNames[0]); // il più vecchio eliminato: 120 → 80 ≤ 100
    expect(names).toContain(oldNames[1]);
    expect(names).toContain(oldNames[2]);
    expect(names).toContain(dumper.getStatus().currentFile);
  });

  test("con il tetto a 0 il pruning è disattivato", async () => {
    const oldNames = await seedOldDumpFiles();

    dumper = new MonitorDumpWriter({ dumpDir, threshold: 1000, maxTotalBytes: 0 });
    dumper.start(store);
    recordRequests(store, 1);
    await dumper.flush();

    const names = await fs.promises.readdir(dumpDir);
    for (const name of oldNames) {
      expect(names).toContain(name);
    }
  });

  test("stop fa il flush finale e disabilita", async () => {
    dumper = new MonitorDumpWriter({ dumpDir, threshold: 1000 });
    dumper.start(store);
    recordRequests(store, 2);
    await dumper.stop();

    const { entries } = await readDump(dumpDir);
    expect(entries).toHaveLength(2);
    expect(dumper.getStatus().enabled).toBe(false);
    dumper = null; // già fermato
  });
});
