const fs = require("fs");
const path = require("path");
const {
  readPrefs,
  addRecentWorkspace,
  getRecentWorkspaces,
  getLastWorkspace,
  removeRecentWorkspace,
  prefsFilePath,
  getWindowBounds,
  setWindowBounds,
  getLanguage,
  setLanguage,
} = require("../electron/global-prefs");
const { createTempDir, removeDir } = require("./helpers");

describe("global-prefs (preferenze utente globali)", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTempDir();
  });

  afterEach(async () => {
    if (dir) {
      await removeDir(dir);
      dir = null;
    }
  });

  test("readPrefs su cartella vuota restituisce i default", () => {
    expect(readPrefs(dir)).toEqual({ recentWorkspaces: [] });
  });

  test("addRecentWorkspace aggiunge e getLastWorkspace lo restituisce", () => {
    addRecentWorkspace(dir, path.join(dir, "ws-a"));
    expect(getLastWorkspace(dir)).toBe(path.resolve(dir, "ws-a"));
    expect(fs.existsSync(prefsFilePath(dir))).toBe(true);
  });

  test("i recenti sono ordinati per ultimo aperto", () => {
    addRecentWorkspace(dir, path.join(dir, "a"));
    addRecentWorkspace(dir, path.join(dir, "b"));
    expect(getRecentWorkspaces(dir)).toEqual([path.resolve(dir, "b"), path.resolve(dir, "a")]);
  });

  test("riaprire un workspace lo riporta in cima senza duplicarlo", () => {
    addRecentWorkspace(dir, path.join(dir, "a"));
    addRecentWorkspace(dir, path.join(dir, "b"));
    addRecentWorkspace(dir, path.join(dir, "a"));
    expect(getRecentWorkspaces(dir)).toEqual([path.resolve(dir, "a"), path.resolve(dir, "b")]);
  });

  test("rispetta il limite massimo", () => {
    for (let i = 0; i < 5; i += 1) {
      addRecentWorkspace(dir, path.join(dir, `ws-${i}`), { max: 3 });
    }
    expect(getRecentWorkspaces(dir)).toHaveLength(3);
    expect(getLastWorkspace(dir)).toBe(path.resolve(dir, "ws-4"));
  });

  test("removeRecentWorkspace rimuove la voce", () => {
    addRecentWorkspace(dir, path.join(dir, "a"));
    addRecentWorkspace(dir, path.join(dir, "b"));
    removeRecentWorkspace(dir, path.join(dir, "a"));
    expect(getRecentWorkspaces(dir)).toEqual([path.resolve(dir, "b")]);
  });

  test("le preferenze persistono tra le letture", () => {
    addRecentWorkspace(dir, path.join(dir, "a"));
    expect(readPrefs(dir).recentWorkspaces).toEqual([path.resolve(dir, "a")]);
  });

  test("getLastWorkspace è null senza recenti", () => {
    expect(getLastWorkspace(dir)).toBeNull();
  });

  test("window bounds: default null, poi round-trip", () => {
    expect(getWindowBounds(dir)).toBeNull();
    const bounds = { x: 100, y: 80, width: 1024, height: 720, maximized: false };
    setWindowBounds(dir, bounds);
    expect(getWindowBounds(dir)).toEqual(bounds);
  });

  test("window bounds e workspace recenti coesistono nello stesso file", () => {
    addRecentWorkspace(dir, path.join(dir, "a"));
    setWindowBounds(dir, { x: 0, y: 0, width: 800, height: 600, maximized: true });
    expect(getRecentWorkspaces(dir)).toEqual([path.resolve(dir, "a")]);
    expect(getWindowBounds(dir).maximized).toBe(true);
  });

  test("lingua: default null, poi round-trip", () => {
    expect(getLanguage(dir)).toBeNull();
    setLanguage(dir, "en");
    expect(getLanguage(dir)).toBe("en");
    setLanguage(dir, "it");
    expect(getLanguage(dir)).toBe("it");
  });

  test("lingua: i valori non supportati vengono ignorati", () => {
    setLanguage(dir, "it");
    setLanguage(dir, "fr");
    expect(getLanguage(dir)).toBe("it");
  });

  test("lingua e recenti coesistono nello stesso file", () => {
    addRecentWorkspace(dir, path.join(dir, "a"));
    setLanguage(dir, "en");
    expect(getRecentWorkspaces(dir)).toEqual([path.resolve(dir, "a")]);
    expect(getLanguage(dir)).toBe("en");
  });
});
