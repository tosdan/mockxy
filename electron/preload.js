// Ponte tra il processo principale (lato Node) e la finestra (interfaccia web).
//
// La finestra non tocca il sistema operativo direttamente: chiede al processo principale via questi
// metodi. Espone il marcatore desktop, le operazioni sui workspace (leggere l'attivo, elencare gli
// aperti e i recenti, aprire/cambiare/chiudere) e la lingua condivisa, così l'interfaccia Angular e la
// view di benvenuto possono gestire i workspace e la lingua senza il menu nativo della finestra.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  // Lingua corrente: letta in modo sincrono qui così la UI può usarla già al primo render.
  language: ipcRenderer.sendSync("lang:current"),
  setLanguage: (lang) => ipcRenderer.invoke("lang:set", lang),
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  listWorkspaces: () => ipcRenderer.invoke("workspace:list"),
  listRecent: () => ipcRenderer.invoke("workspace:recent"),
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  switchWorkspace: (root) => ipcRenderer.invoke("workspace:switch", root),
  closeWorkspace: (root) => ipcRenderer.invoke("workspace:close", root),
  removeRecent: (root) => ipcRenderer.invoke("workspace:removeRecent", root),
  updateWorkspace: (root, patch) => ipcRenderer.invoke("workspace:update", root, patch),
  getAppPreferences: () => ipcRenderer.invoke("prefs:get"),
  updateAppPreferences: (patch) => ipcRenderer.invoke("prefs:set", patch),
});
