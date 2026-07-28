const { registerUpdateIpc } = require("../electron/update-ipc");

function setup(overrides = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: jest.fn((channel, handler) => handlers.set(channel, handler)),
  };
  const updateState = {
    status: "available",
    currentVersion: "1.1.0",
    latestVersion: "1.2.0",
    ignored: false,
  };
  const updateService = {
    getState: jest.fn(() => updateState),
    check: jest.fn(async () => updateState),
    ignore: jest.fn(() => ({ ...updateState, ignored: true })),
    releaseUrl: jest.fn(() => "https://github.com/tosdan/mockxy/releases/tag/v1.2.0"),
    ...overrides,
  };
  const shell = { openExternal: jest.fn(async () => undefined) };
  const errorLog = { logError: jest.fn() };

  registerUpdateIpc({ ipcMain, updateService, shell, errorLog });
  return { handlers, updateService, shell, errorLog };
}

describe("update IPC", () => {
  test("registers the minimal update channels and forwards state/check", async () => {
    const { handlers, updateService } = setup();
    expect([...handlers.keys()]).toEqual([
      "updates:get",
      "updates:check",
      "updates:ignore",
      "updates:open",
    ]);

    expect(await handlers.get("updates:get")()).toMatchObject({ currentVersion: "1.1.0" });
    expect(await handlers.get("updates:check")()).toMatchObject({ status: "available" });
    expect(updateService.check).toHaveBeenCalledTimes(1);
  });

  test("validates the ignored version type at the IPC boundary", async () => {
    const { handlers, updateService } = setup();

    await handlers.get("updates:ignore")({}, { malicious: true });
    expect(updateService.ignore).not.toHaveBeenCalled();
    expect(updateService.getState).toHaveBeenCalled();

    await handlers.get("updates:ignore")({}, "1.2.0");
    expect(updateService.ignore).toHaveBeenCalledWith("1.2.0");
  });

  test("opens only the URL selected internally by the service", async () => {
    const { handlers, shell } = setup();

    await expect(
      handlers.get("updates:open")({}, "https://evil.test/ignored-renderer-argument"),
    ).resolves.toEqual({ opened: true });
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://github.com/tosdan/mockxy/releases/tag/v1.2.0",
    );
  });

  test("does not open anything when there is no trusted cached release", async () => {
    const { handlers, shell } = setup({ releaseUrl: jest.fn(() => null) });

    await expect(handlers.get("updates:open")()).resolves.toEqual({ opened: false });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  test("turns internal failures into a non-fatal public result and logs them", async () => {
    const error = new Error("boom");
    const { handlers, errorLog } = setup({
      check: jest.fn(async () => {
        throw error;
      }),
    });

    await expect(handlers.get("updates:check")()).resolves.toMatchObject({
      status: "unavailable",
      reason: "internal-error",
    });
    expect(errorLog.logError).toHaveBeenCalledWith("update-check", error);
  });
});
