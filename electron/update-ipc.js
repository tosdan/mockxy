// Canali IPC degli aggiornamenti. Isolati dal resto di app-main per testare il confine renderer/main
// senza caricare Electron né usare la rete reale.

function registerUpdateIpc({ ipcMain, updateService, shell, errorLog }) {
  const reportFailure = (result) => {
    if (result.status === "unavailable") {
      errorLog.logError("update-check", result.reason || "unavailable", {
        httpStatus: result.httpStatus ?? null,
      });
    }
  };

  ipcMain.handle("updates:get", () => updateService.getState());
  ipcMain.handle("updates:check", async () => {
    try {
      const result = await updateService.check();
      reportFailure(result);
      return result;
    } catch (error) {
      errorLog.logError("update-check", error);
      return {
        ...updateService.getState(),
        status: "unavailable",
        reason: "internal-error",
      };
    }
  });
  ipcMain.handle("updates:ignore", (_event, version) =>
    typeof version === "string" ? updateService.ignore(version) : updateService.getState(),
  );
  ipcMain.handle("updates:open", async () => {
    const url = updateService.releaseUrl();
    if (!url) {
      return { opened: false };
    }
    try {
      await shell.openExternal(url);
      return { opened: true };
    } catch (error) {
      errorLog.logError("open-update-release", error);
      return { opened: false };
    }
  });

  return { reportFailure };
}

module.exports = { registerUpdateIpc };
