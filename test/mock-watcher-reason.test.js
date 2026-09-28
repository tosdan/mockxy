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
