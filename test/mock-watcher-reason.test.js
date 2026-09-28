const { EventEmitter } = require("events");

jest.mock("chokidar", () => ({ watch: jest.fn() }));

const chokidar = require("chokidar");
const { startMockWatcher } = require("../src/server");
const { createNoopLogger } = require("./helpers");

// Gli eventi del watcher passano il percorso del file come primo argomento: il reload deve
// comunque dichiarare la causa "watcher" nello stato del runtime (piano agent/API, §13 C2).
test("il watcher ricarica il runtime con la causa watcher", () => {
  const watcher = new EventEmitter();
  chokidar.watch.mockReturnValue(watcher);
  const reloadRuntime = jest.fn();

  startMockWatcher({
    config: { watchEnabled: true, mocksDir: require("os").tmpdir(), watchUsePolling: false },
    logger: createNoopLogger(),
    reloadRuntime,
  });
  for (const event of ["add", "change", "unlink", "unlinkDir", "addDir"]) {
    watcher.emit(event, "/workspace/mocks/a/GET.endpoint.json");
  }

  expect(reloadRuntime.mock.calls).toEqual(Array(5).fill(["watcher"]));
});

// Stato del watcher riportato da GET /info (piano agent/API, §13 C2).
test("lo stato del watcher passa da starting a ready, poi a error con l'ultimo errore", () => {
  const watcher = new EventEmitter();
  chokidar.watch.mockReturnValue(watcher);
  const watcherStatus = { state: "starting", polling: true, lastError: null };

  startMockWatcher({
    config: { watchEnabled: true, mocksDir: require("os").tmpdir(), watchUsePolling: true },
    logger: createNoopLogger(),
    reloadRuntime: jest.fn(),
    watcherStatus,
  });
  expect(watcherStatus.state).toBe("starting");

  watcher.emit("ready");
  expect(watcherStatus).toEqual({ state: "ready", polling: true, lastError: null });

  watcher.emit("error", new Error("EMFILE: too many open files"));
  expect(watcherStatus).toEqual({ state: "error", polling: true, lastError: "EMFILE: too many open files" });
});
