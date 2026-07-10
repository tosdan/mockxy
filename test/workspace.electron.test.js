const fs = require("fs");
const path = require("path");
const {
  workspacePaths,
  isWorkspace,
  readSettings,
  updateSettings,
  openWorkspace,
  getWorkspaceName,
  getWorkspaceTitle,
  setWorkspaceName,
} = require("../electron/workspace");
const { createTempDir, removeDir } = require("./helpers");

describe("workspace (cervello del workspace)", () => {
  let root;

  beforeEach(async () => {
    root = await createTempDir();
  });

  afterEach(async () => {
    if (root) {
      await removeDir(root);
      root = null;
    }
  });

  test("workspacePaths calcola i sottopercorsi attesi", () => {
    const paths = workspacePaths(root);
    expect(paths.mocksDir).toBe(path.join(root, "mocks"));
    expect(paths.filesDir).toBe(path.join(root, "files"));
    expect(paths.serviceDir).toBe(path.join(root, ".mockxy"));
    expect(paths.settingsFile).toBe(path.join(root, ".mockxy", "settings.json"));
    expect(paths.monitorDumpDir).toBe(path.join(root, ".mockxy", "monitor-dump"));
    expect(paths.markerFile).toBe(path.join(root, "mockxy.json"));
  });

  test("una cartella vuota non è un workspace", () => {
    expect(isWorkspace(root)).toBe(false);
  });

  test("openWorkspace inizializza una cartella nuova", () => {
    const resolved = openWorkspace(root, { defaultPort: 4100 });

    expect(isWorkspace(root)).toBe(true);
    expect(fs.existsSync(path.join(root, "mocks"))).toBe(true);
    expect(fs.existsSync(path.join(root, "files"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".mockxy", "monitor-dump"))).toBe(true);
    expect(resolved.mocksDir).toBe(path.join(root, "mocks"));
    expect(resolved.filesDir).toBe(path.join(root, "files"));
    expect(resolved.monitorDumpDir).toBe(path.join(root, ".mockxy", "monitor-dump"));
    expect(resolved.port).toBe(4100);
    expect(readSettings(root).port).toBe(4100);

    const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain(".mockxy/");
  });

  test("rimuove dal .gitignore le righe obsolete delle versioni precedenti", () => {
    const gitignoreFile = path.join(root, ".gitignore");
    fs.writeFileSync(
      gitignoreFile,
      "dist/\n# mockxy: dati locali del workspace, non condividere\n.mockxy/\n**/mocks/**/.folder.json\n",
      "utf8"
    );

    openWorkspace(root, { defaultPort: 4100 });

    const gitignore = fs.readFileSync(gitignoreFile, "utf8");
    expect(gitignore).toContain("dist/"); // contenuto preesistente preservato
    expect(gitignore).toContain(".mockxy/");
    expect(gitignore).not.toContain(".folder.json"); // riga storica ripulita
  });

  test("la porta salvata è persistente tra le aperture", () => {
    openWorkspace(root, { defaultPort: 5000 });
    const again = openWorkspace(root, { defaultPort: 6000 });
    expect(again.port).toBe(5000); // tiene quella salvata, non la nuova di default
  });

  test("non duplica le righe del .gitignore e preserva il contenuto esistente", () => {
    const gitignoreFile = path.join(root, ".gitignore");
    fs.writeFileSync(gitignoreFile, "dist/\n", "utf8");

    openWorkspace(root, { defaultPort: 4100 });
    openWorkspace(root, { defaultPort: 4100 });

    const gitignore = fs.readFileSync(gitignoreFile, "utf8");
    expect(gitignore).toContain("dist/"); // contenuto preesistente preservato
    const occurrences = gitignore.split(".mockxy/").length - 1;
    expect(occurrences).toBe(1); // niente duplicati
  });

  test("ricrea solo la parte locale per una cartella clonata", () => {
    // Simula un clone: c'è il segnaposto condiviso + i mock, ma manca la parte locale (gitignored).
    fs.mkdirSync(path.join(root, "mocks"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "mockxy.json"),
      JSON.stringify({ formatVersion: 1 }),
      "utf8"
    );
    expect(isWorkspace(root)).toBe(true);
    expect(fs.existsSync(path.join(root, ".mockxy"))).toBe(false);

    const resolved = openWorkspace(root, { defaultPort: 7000 });

    expect(fs.existsSync(path.join(root, ".mockxy", "monitor-dump"))).toBe(true);
    expect(resolved.port).toBe(7000); // nuova porta locale di default
  });

  test("updateSettings fonde e persiste", () => {
    openWorkspace(root, { defaultPort: 4100 });
    const next = updateSettings(root, { port: 4242 });
    expect(next.port).toBe(4242);
    expect(readSettings(root).port).toBe(4242);
  });

  test("titolo: default = nome cartella, poi impostazione e azzeramento", () => {
    openWorkspace(root, { defaultPort: 4100 });
    expect(getWorkspaceTitle(root)).toBeNull();
    expect(getWorkspaceName(root)).toBe(path.basename(root));

    setWorkspaceName(root, "  API staging  ");
    expect(getWorkspaceTitle(root)).toBe("API staging"); // viene ripulito dagli spazi
    expect(getWorkspaceName(root)).toBe("API staging");

    // persiste nel segnaposto condiviso, senza perdere formatVersion
    const marker = JSON.parse(fs.readFileSync(path.join(root, "mockxy.json"), "utf8"));
    expect(marker.title).toBe("API staging");
    expect(marker.formatVersion).toBe(1);

    setWorkspaceName(root, "   "); // vuoto → azzera il titolo
    expect(getWorkspaceTitle(root)).toBeNull();
    expect(getWorkspaceName(root)).toBe(path.basename(root));
    const cleared = JSON.parse(fs.readFileSync(path.join(root, "mockxy.json"), "utf8"));
    expect(cleared.title).toBeUndefined();
  });
});
