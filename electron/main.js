// Bootstrap Electron: acquisisce il lock prima di caricare qualunque modulo applicativo.
// Vale per ogni formato di distribuzione (portable, installer e sviluppo desktop).

const { app, BrowserWindow } = require("electron");

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  // Non caricare app-main: evita che la seconda istanza inizializzi log, preferenze,
  // workspace, server o IPC mentre Electron completa la chiusura.
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existingWindow] = BrowserWindow.getAllWindows();
    if (!existingWindow) {
      return;
    }

    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.show();
    existingWindow.focus();
  });

  require("./app-main");
}
