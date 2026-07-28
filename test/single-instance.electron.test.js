function loadDesktopEntry({ lockAcquired, windows = [] }) {
  jest.resetModules();

  const secondInstanceHandlers = [];
  const app = {
    requestSingleInstanceLock: jest.fn(() => lockAcquired),
    quit: jest.fn(),
    on: jest.fn((eventName, handler) => {
      if (eventName === "second-instance") {
        secondInstanceHandlers.push(handler);
      }
    }),
  };
  const BrowserWindow = {
    getAllWindows: jest.fn(() => windows),
  };
  const loadApplication = jest.fn();

  jest.doMock("electron", () => ({ app, BrowserWindow }), { virtual: true });
  jest.doMock(
    "../electron/app-main",
    () => {
      loadApplication();
      return {};
    },
    { virtual: true },
  );

  require("../electron/main");

  return { app, BrowserWindow, loadApplication, secondInstanceHandlers };
}

describe("desktop single-instance bootstrap", () => {
  test("the second instance quits before loading the application", () => {
    const result = loadDesktopEntry({ lockAcquired: false });

    expect(result.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(result.app.quit).toHaveBeenCalledTimes(1);
    expect(result.loadApplication).not.toHaveBeenCalled();
    expect(result.secondInstanceHandlers).toHaveLength(0);
  });

  test("the first instance loads the application and owns the second-instance handler", () => {
    const result = loadDesktopEntry({ lockAcquired: true });

    expect(result.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(result.app.quit).not.toHaveBeenCalled();
    expect(result.loadApplication).toHaveBeenCalledTimes(1);
    expect(result.secondInstanceHandlers).toHaveLength(1);
  });

  test("a later launch restores and focuses the existing window", () => {
    const window = {
      isMinimized: jest.fn(() => true),
      restore: jest.fn(),
      show: jest.fn(),
      focus: jest.fn(),
    };
    const result = loadDesktopEntry({ lockAcquired: true, windows: [window] });

    result.secondInstanceHandlers[0]();

    expect(result.BrowserWindow.getAllWindows).toHaveBeenCalledTimes(1);
    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });
});
