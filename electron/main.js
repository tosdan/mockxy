// Processo principale dell'app desktop (lato Node di Electron).
//
// Avvia uno o più motori di Mockxy (uno per workspace, ognuno sulla sua porta — vedi
// server-pool.js) e mostra il workspace attivo in una finestra. La logica testabile sta nei moduli
// desktop-server / workspace / global-prefs / server-pool; qui resta solo ciò che richiede Electron
// e il sistema operativo (finestra, dialoghi nativi, ciclo di vita, canali verso l'interfaccia).
//
// Niente menu nativo: i controlli dei workspace sono nell'interfaccia Angular (barra workspace), che
// chiama i canali IPC qui sotto. L'interfaccia è sempre servita dal motore (anche in sviluppo), così
// più workspace funzionano allo stesso modo in dev e in pacchetto; la UI con ricaricamento automatico
// si sviluppa nel browser (npm run dev:backend + dev:frontend).

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell } = require("electron");
const { findFreePort, isPortFree, startDesktopServer, WORKSPACE_SETTING_DEFAULTS } = require("./desktop-server");
const { decideNavigation, decideWindowOpen } = require("./navigation-guard");
const { getDialogMessages } = require("./dialog-messages");
const {
  openWorkspace,
  isWorkspace,
  readSettings,
  updateSettings,
  getWorkspaceName,
  getWorkspaceTitle,
  setWorkspaceName,
  MARKER_FILE,
} = require("./workspace");
const {
  addRecentWorkspace,
  getRecentWorkspaces,
  getLastWorkspace,
  removeRecentWorkspace,
  getWindowBounds,
  setWindowBounds,
  getLanguage,
  setLanguage,
} = require("./global-prefs");
const { createServerPool } = require("./server-pool");

let mainWindow = null;
let activeRoot = null;
// Lingua corrente dell'interfaccia, condivisa tra app e view di benvenuto (vedi resolveLanguage).
let currentLanguage = "en";

// Stringhe dei dialoghi nativi nella lingua corrente: da leggere al momento dell'uso, mai
// memorizzare il risultato (la lingua può cambiare a runtime dal selettore dell'interfaccia).
function dialogText() {
  return getDialogMessages(currentLanguage);
}

function repoRoot() {
  return path.resolve(__dirname, "..");
}

// Cartella delle preferenze globali: la directory dati utente gestita da Electron su ogni piattaforma.
// La build Windows portabile fa eccezione e le mantiene accanto all'eseguibile.
function prefsConfigDir() {
  if (process.platform === "win32" && process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  return app.getPath("userData");
}

// Lingua dell'interfaccia: quella salvata, oppure — al primo avvio in assoluto — quella di sistema
// (italiano se la locale comincia per "it", inglese per ogni altra), che viene poi salvata.
function resolveLanguage() {
  const stored = getLanguage(prefsConfigDir());
  if (stored) {
    return stored;
  }
  const detected = app.getLocale().toLowerCase().startsWith("it") ? "it" : "en";
  setLanguage(prefsConfigDir(), detected);
  return detected;
}

// Interfaccia compilata servita dal motore: nelle risorse in pacchetto, nella dist del repo in dev.
function uiDistDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "ui")
    : path.join(repoRoot(), "mockxy-ui", "dist", "mockxy-ui", "browser");
}

// Avvia il motore per un workspace sulla sua porta (stabile, dalle impostazioni). Se quella porta è
// occupata, ripiega su una libera e la salva. È la funzione `launch` del pool.
async function launchEngine(root) {
  const ws = openWorkspace(root, { defaultPort: await findFreePort() });
  const base = {
    mocksDir: ws.mocksDir,
    filesDir: ws.filesDir,
    monitorDumpDir: ws.monitorDumpDir,
    uiDistDir: uiDistDir(),
    backendUrl: ws.backendUrl,
    host: ws.host,
    caseInsensitiveFilters: ws.caseInsensitiveFilters,
    proxyFallbackEnabled: ws.proxyFallbackEnabled,
    corsEnabled: ws.corsEnabled,
    adaptProxyCookies: ws.adaptProxyCookies,
    rewriteProxyRedirects: ws.rewriteProxyRedirects,
    globalDelayMs: ws.globalDelayMs,
    delayAllRequests: ws.delayAllRequests,
    requestTimeoutMs: ws.requestTimeoutMs,
    monitorDumpIntervalMs: ws.monitorDumpIntervalMs,
    monitorDumpThreshold: ws.monitorDumpThreshold,
    monitorDumpMaxFileBytes: ws.monitorDumpMaxFileBytes,
    monitorDumpMaxTotalBytes: ws.monitorDumpMaxTotalBytes,
  };
  try {
    return await startDesktopServer({ ...base, port: ws.port });
  } catch (error) {
    if (error && error.code === "EADDRINUSE") {
      const port = await findFreePort();
      updateSettings(root, { port });
      return startDesktopServer({ ...base, port });
    }
    throw error;
  }
}

const pool = createServerPool({ launch: launchEngine });

// Apre (se serve) il workspace, lo rende attivo e lo mostra nella finestra; lo registra tra i recenti.
async function showWorkspace(root) {
  if (!fs.existsSync(root)) {
    // La cartella non esiste più: la tolgo dai recenti e lo segnalo (l'interfaccia rilegge l'elenco).
    removeRecentWorkspace(prefsConfigDir(), root);
    dialog.showErrorBox(dialogText().workspaceNotFoundTitle, dialogText().workspaceNotFoundDetail(root));
    return { ok: false, error: "not-found" };
  }
  try {
    const entry = await pool.open(root);
    activeRoot = root;
    addRecentWorkspace(prefsConfigDir(), root);
    if (mainWindow) {
      await mainWindow.loadURL(entry.url);
    }
    return { ok: true };
  } catch (error) {
    dialog.showErrorBox(dialogText().openFailedTitle, String((error && error.message) || error));
    return { ok: false, error: "open-failed" };
  }
}

// Mostra la view di benvenuto (nessun workspace aperto): pagina statica con apri-cartella, recenti e
// selettore lingua. Non passa dal motore (che richiede un workspace), quindi è caricata come file.
async function showWelcome() {
  activeRoot = null;
  if (mainWindow) {
    await mainWindow.loadFile(path.join(__dirname, "welcome.html"));
  }
}

// Chiude un workspace (ne ferma il motore). Se era quello attivo, passa a un altro aperto; se non ne
// resta nessuno mostra la view di benvenuto (è ammesso non avere alcun workspace aperto).
async function closeWorkspace(root) {
  await pool.close(root);
  if (root !== activeRoot) {
    return;
  }
  activeRoot = null;
  const others = pool.list();
  if (others.length > 0) {
    await showWorkspace(others[0].root);
  } else {
    await showWelcome();
  }
}

async function promptOpenWorkspace() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: dialogText().openDialogTitle,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return;
  }
  const chosen = result.filePaths[0];

  // Se la cartella scelta non è ancora un workspace, chiedi conferma prima di inizializzarla: mostra
  // il nome della cartella così l'utente può accorgersi di averne scelta una sbagliata per sbaglio.
  if (!isWorkspace(chosen)) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: [dialogText().cancel, dialogText().initConfirm],
      defaultId: 1,
      cancelId: 0,
      title: dialogText().initTitle,
      message: dialogText().initMessage(path.basename(chosen)),
      detail: dialogText().initDetail(chosen, MARKER_FILE),
    });
    if (response !== 1) {
      return;
    }
  }

  await showWorkspace(chosen);
}

// Canali verso l'interfaccia: stato dei workspace + operazioni (apri/cambia/chiudi).
function setupIpc() {
  ipcMain.handle("workspace:get", () => {
    if (!activeRoot) {
      return null;
    }
    const entry = pool.get(activeRoot);
    const settings = readSettings(activeRoot) || {};
    // Impostazioni comportamentali: valore del workspace se presente, altrimenti il default del
    // motore (unica fonte: src/config.js). La dialog mostra così il valore effettivo.
    const behavior = {};
    for (const [key, fallback] of Object.entries(WORKSPACE_SETTING_DEFAULTS)) {
      behavior[key] = settings[key] ?? fallback;
    }
    return {
      root: activeRoot,
      name: getWorkspaceName(activeRoot),
      title: getWorkspaceTitle(activeRoot),
      port: entry ? entry.port : null,
      backendUrl: settings.backendUrl ?? null,
      ...behavior,
    };
  });
  ipcMain.handle("workspace:list", () =>
    pool.list().map((entry) => ({
      root: entry.root,
      name: getWorkspaceName(entry.root),
      port: entry.port,
      active: entry.root === activeRoot,
    }))
  );
  ipcMain.handle("workspace:recent", () =>
    getRecentWorkspaces(prefsConfigDir()).map((root) => ({ root, name: getWorkspaceName(root) }))
  );
  ipcMain.handle("workspace:open", async () => {
    await promptOpenWorkspace();
  });
  ipcMain.handle("workspace:switch", async (_event, root) => {
    // Restituisce l'esito: sul cambio riuscito la finestra ricarica (l'interfaccia non vede il
    // ritorno); su workspace inesistente l'interfaccia lo usa per rinfrescare l'elenco dei recenti.
    return await showWorkspace(root);
  });
  ipcMain.handle("workspace:close", async (_event, root) => {
    // Conferma esplicita solo per la chiusura via "×" di una tab. La chiusura dell'app passa invece
    // da pool.closeAll() (window-all-closed) e NON chiede conferma per ogni workspace.
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: [dialogText().cancel, dialogText().closeConfirm],
      defaultId: 1,
      cancelId: 0,
      title: dialogText().closeTitle,
      message: dialogText().closeMessage(getWorkspaceName(root)),
      detail: dialogText().closeDetail,
    });
    if (response === 1) {
      await closeWorkspace(root);
    }
  });
  ipcMain.handle("workspace:removeRecent", async (_event, root) => {
    // Toglie un workspace dall'elenco dei recenti, previa conferma. Non tocca i file su disco
    // (la cartella e i suoi mock restano): sparisce solo dalla lista dei recenti.
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: [dialogText().cancel, dialogText().removeRecentConfirm],
      defaultId: 1,
      cancelId: 0,
      title: dialogText().removeRecentTitle,
      message: dialogText().removeRecentMessage(getWorkspaceName(root)),
      detail: dialogText().removeRecentDetail,
    });
    if (response !== 1) {
      return { removed: false };
    }
    removeRecentWorkspace(prefsConfigDir(), root);
    return { removed: true };
  });
  ipcMain.handle("workspace:update", async (_event, root, patch = {}) => {
    // Applica titolo (condiviso, nel segnaposto) e/o porta + backend URL (locali); riavvia il motore se
    // porta o backend URL cambiano, poi ricarica la finestra se è l'attivo così l'interfaccia rilegge i dati.
    let entry = pool.get(root);
    const requested = Number(patch.port);
    const portChanged =
      Number.isInteger(requested) &&
      requested >= 1024 &&
      requested <= 65535 &&
      (!entry || entry.port !== requested);

    // Cambio porta ESPLICITO verso una porta occupata: non tocchiamo nulla e segnaliamo l'errore, così
    // l'interfaccia può avvisare l'utente. (All'avvio/apertura invece launchEngine ripiega su una libera.)
    if (portChanged && !(await isPortFree(requested))) {
      return { ok: false, error: "port-in-use", port: requested };
    }

    if (typeof patch.name === "string") {
      setWorkspaceName(root, patch.name);
    }

    // Stato locale corrente, letto una volta: ogni confronto "è cambiato?" è rispetto a questo.
    const current = readSettings(root) || {};
    // Valore effettivo corrente di un'impostazione comportamentale (default del motore se assente).
    const effective = (key) => current[key] ?? WORKSPACE_SETTING_DEFAULTS[key];

    // Backend URL (locale): stringa vuota = solo mock per questo workspace.
    const backendUrlChanged =
      typeof patch.backendUrl === "string" && patch.backendUrl.trim() !== (current.backendUrl ?? "");
    if (backendUrlChanged) {
      updateSettings(root, { backendUrl: patch.backendUrl.trim() });
    }
    // host (locale): scelta binaria loopback vs tutta la rete. Accetta SOLO i due valori noti, così un
    // valore malformato non può impedire l'avvio del motore. Esporre su 0.0.0.0 è una scelta a rischio
    // dell'utente (l'admin API esegue codice): il motore logga già un avviso all'avvio su host non-loopback.
    const nextHost = typeof patch.host === "string" ? patch.host.trim() : undefined;
    const hostChanged =
      (nextHost === "0.0.0.0" || nextHost === "127.0.0.1") && nextHost !== effective("host");
    if (hostChanged) {
      updateSettings(root, { host: nextHost });
    }
    // Altre impostazioni comportamentali locali. Vengono accettate solo col tipo giusto, entro il
    // minimo per campo (allineato alla validazione della dialog) e solo se diverse dal valore
    // effettivo corrente: un valore identico non deve costare un riavvio del motore.
    const BOOL_SETTINGS = [
      "caseInsensitiveFilters",
      "proxyFallbackEnabled",
      "corsEnabled",
      "adaptProxyCookies",
      "rewriteProxyRedirects",
      "delayAllRequests",
    ];
    const NUM_SETTINGS_MIN = {
      globalDelayMs: 0,
      requestTimeoutMs: 1,
      monitorDumpIntervalMs: 1,
      monitorDumpThreshold: 1,
      monitorDumpMaxFileBytes: 1,
      monitorDumpMaxTotalBytes: 0,
    };
    const settingsPatch = {};
    for (const key of BOOL_SETTINGS) {
      if (typeof patch[key] === "boolean" && patch[key] !== effective(key)) {
        settingsPatch[key] = patch[key];
      }
    }
    for (const [key, min] of Object.entries(NUM_SETTINGS_MIN)) {
      if (Number.isInteger(patch[key]) && patch[key] >= min && patch[key] !== effective(key)) {
        settingsPatch[key] = patch[key];
      }
    }
    const behaviorSettingsChanged = Object.keys(settingsPatch).length > 0;
    if (behaviorSettingsChanged) {
      updateSettings(root, settingsPatch);
    }
    if (portChanged) {
      updateSettings(root, { port: requested });
    }

    // Porta, backend URL, host e/o impostazioni comportamentali si applicano riavviando il motore.
    if (portChanged || backendUrlChanged || hostChanged || behaviorSettingsChanged) {
      await pool.close(root);
      entry = await pool.open(root);
    }

    if (root === activeRoot && mainWindow && entry) {
      await mainWindow.loadURL(entry.url);
    }
    return { ok: true, name: getWorkspaceName(root), port: entry ? entry.port : null };
  });

  // Lingua: lettura sincrona (il preload la espone alla UI al caricamento) e scrittura persistente
  // (sia l'app sia la view di benvenuto la cambiano e la condividono tramite le preferenze globali).
  ipcMain.on("lang:current", (event) => {
    event.returnValue = currentLanguage;
  });
  ipcMain.handle("lang:set", (_event, lang) => {
    if (lang === "it" || lang === "en") {
      currentLanguage = lang;
      setLanguage(prefsConfigDir(), lang);
    }
    return currentLanguage;
  });
}

// Opzioni di dimensione/posizione dalla finestra salvata (con default, e scartando la posizione se
// non più visibile su nessun display).
function windowOptionsFromSaved(saved) {
  const options = { width: 1280, height: 800 };
  if (saved) {
    if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
      options.width = saved.width;
      options.height = saved.height;
    }
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && positionVisible(saved)) {
      options.x = saved.x;
      options.y = saved.y;
    }
  }
  return options;
}

// La posizione è valida se l'angolo in alto a sinistra cade nell'area di lavoro di un display, così la
// barra del titolo resta afferrabile (evita finestre "perse" fuori schermo dopo un cambio di monitor).
function positionVisible(bounds) {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x >= area.x &&
      bounds.x < area.x + area.width &&
      bounds.y >= area.y &&
      bounds.y < area.y + area.height
    );
  });
}

// Salva dimensione/posizione "normali" (non massimizzate) + lo stato massimizzato.
function saveWindowBounds(win) {
  try {
    if (win.isDestroyed()) {
      return;
    }
    const bounds = win.getNormalBounds();
    setWindowBounds(prefsConfigDir(), {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: win.isMaximized(),
    });
  } catch {
    /* finestra in chiusura o stato non leggibile: ignora */
  }
}

// Icona della finestra: in sviluppo usa il file in build/; in pacchetto su Windows la finestra eredita
// l'icona incisa nell'eseguibile (la cartella build/ non viene impacchettata), quindi qui basta la guardia.
function windowIcon() {
  const icon = path.join(__dirname, "build", "icon.ico");
  return fs.existsSync(icon) ? icon : undefined;
}

async function createMainWindow() {
  const saved = getWindowBounds(prefsConfigDir());
  const win = new BrowserWindow({
    ...windowOptionsFromSaved(saved),
    backgroundColor: "#ffffff",
    icon: windowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  if (saved && saved.maximized) {
    win.maximize();
  }
  win.on("closed", () => {
    mainWindow = null;
  });

  // Hardening navigazione: la finestra resta sull'app. window.open / target="_blank" non aprono
  // mai una finestra Electron; un link web va al browser di sistema. Le navigazioni fuori
  // dall'origin corrente sono bloccate (le aperture programmatiche di workspace/benvenuto passano
  // da loadURL/loadFile e non scatenano questi eventi, quindi non ne sono toccate).
  win.webContents.setWindowOpenHandler(({ url }) => {
    const { openExternal } = decideWindowOpen(url);
    if (openExternal) {
      shell.openExternal(openExternal);
    }
    return { action: "deny" };
  });
  const guardNavigation = (event, url) => {
    const decision = decideNavigation(win.webContents.getURL(), url);
    if (!decision.allow) {
      event.preventDefault();
      if (decision.openExternal) {
        shell.openExternal(decision.openExternal);
      }
    }
  };
  win.webContents.on("will-navigate", guardNavigation);
  win.webContents.on("will-redirect", guardNavigation);

  // Ricorda dimensione/posizione: salva (con debounce) su resize/move e alla chiusura.
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => saveWindowBounds(win), 500);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("close", () => saveWindowBounds(win));

  // Senza menu nativo servono scorciatoie da tastiera per ricarica e strumenti sviluppatore.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }
    if (input.key === "F12") {
      win.webContents.toggleDevTools();
    } else if ((input.control || input.meta) && input.key.toLowerCase() === "r") {
      win.webContents.reload();
    }
  });
  // All'avvio riapri l'ultimo workspace se la sua cartella esiste ancora; altrimenti (primo avvio o
  // cartella rimossa) mostra la view di benvenuto: è ammesso partire senza alcun workspace aperto.
  const last = getLastWorkspace(prefsConfigDir());
  if (last && fs.existsSync(last)) {
    await showWorkspace(last);
  } else {
    await showWelcome();
  }
  return win;
}

app.whenReady().then(async () => {
  // Niente menu nativo della finestra: i controlli dei workspace stanno nell'interfaccia.
  Menu.setApplicationMenu(null);
  currentLanguage = resolveLanguage();
  setupIpc();
  try {
    await createMainWindow();
  } catch (error) {
    console.error("Avvio dell'app desktop fallito:", error.message);
    dialog.showErrorBox(dialogText().startupFailedTitle, String((error && error.message) || error));
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// Alla chiusura della finestra: spegni tutti i motori del pool ed esci.
app.on("window-all-closed", async () => {
  await pool.closeAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  pool.closeAll();
});
