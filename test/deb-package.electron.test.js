const {
  DEB_MAINTAINER,
  createDebBuildConfig,
} = require("../electron/scripts/deb-package-config");

describe("desktop deb package configuration", () => {
  test("keeps deb separate from the AppImage target and identifies the packaged channel", () => {
    const electronPackage = require("../electron/package.json");
    const config = createDebBuildConfig();

    expect(electronPackage.build.linux.target).toBe("AppImage");
    expect(config.linux.target).toBe("deb");
    expect(config.extraMetadata).toMatchObject({
      mockxyDistributionChannel: "deb",
      desktopName: "mockxy.desktop",
    });
  });

  test("uses stable Debian package metadata and the pinned builder dependencies", () => {
    const config = createDebBuildConfig();

    expect(DEB_MAINTAINER).toBe("Mockxy <3496697+tosdan@users.noreply.github.com>");
    expect(config.linux).toMatchObject({
      executableName: "mockxy",
      maintainer: DEB_MAINTAINER,
      vendor: "Mockxy",
      category: "Development",
      syncDesktopName: true,
      publish: null,
    });
    expect(config.deb).toEqual({
      artifactName: "mockxy_${version}_${arch}.${ext}",
      packageName: "mockxy",
      packageCategory: "devel",
      priority: "optional",
    });
    expect(config.deb.depends).toBeUndefined();
    expect(config.deb.recommends).toBeUndefined();
  });

  test("adds a discoverable recovery action to the desktop entry", () => {
    const desktop = createDebBuildConfig().linux.desktop;

    expect(desktop.entry.Actions).toBe("StartWithoutWorkspaces;");
    expect(desktop.desktopActions.StartWithoutWorkspaces).toEqual({
      Name: "Start without workspaces",
      "Name[it]": "Avvio senza workspace",
      Exec: "/opt/Mockxy/mockxy --no-restore-workspaces",
      Icon: "mockxy",
    });
  });
});
