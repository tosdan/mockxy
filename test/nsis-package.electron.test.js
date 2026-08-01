const fs = require("fs");
const path = require("path");
const { createNsisBuildConfig } = require("../electron/scripts/nsis-package-config");

describe("desktop NSIS package configuration", () => {
  test("keeps NSIS separate from the portable target", () => {
    const electronPackage = require("../electron/package.json");
    const config = createNsisBuildConfig();

    expect(electronPackage.author).toBe("Mockxy");
    expect(electronPackage.build.appId).toBe("com.mockxy.desktop");
    expect(electronPackage.build.win.target).toBe("portable");
    expect(config.win.target).toBe("nsis");
    expect(config.extraMetadata.mockxyDistributionChannel).toBe("nsis");
  });

  test("builds a one-click x64 installer for the current user without deleting app data", () => {
    const config = createNsisBuildConfig();

    expect(config.nsis).toEqual({
      artifactName: "Mockxy-${version}-setup-${arch}.${ext}",
      oneClick: true,
      perMachine: false,
      createStartMenuShortcut: true,
      createDesktopShortcut: false,
      shortcutName: "Mockxy",
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
      uninstallDisplayName: "Mockxy",
      include: "build/installer.nsh",
      installerLanguages: ["en_US", "it_IT"],
      differentialPackage: false,
      packElevateHelper: false,
    });
  });

  test("asks for confirmation and manages the recovery Start shortcut", () => {
    const include = fs.readFileSync(
      path.join(__dirname, "..", "electron", "build", "installer.nsh"),
      "utf8",
    );

    expect(include).toContain("!macro customInit");
    expect(include).toContain("MessageBox MB_YESNO");
    expect(include).toContain("!macro customInstall");
    expect(include).toContain('"--no-restore-workspaces"');
    expect(include).toContain('"${APP_ID}.recovery"');
    expect(include).toContain("!macro customUnInstall");
    expect(include).toContain("MockxyRecoveryShortcut");
  });
});
