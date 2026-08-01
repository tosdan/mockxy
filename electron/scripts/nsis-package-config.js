function createNsisBuildConfig() {
  const baseBuild = require("../package.json").build;
  return {
    ...baseBuild,
    // Il campo viene incorporato nel package.json dell'app impacchettata: a runtime distingue
    // l'installer NSIS da futuri formati Windows che non espongono una variabile d'ambiente.
    extraMetadata: {
      ...baseBuild.extraMetadata,
      mockxyDistributionChannel: "nsis",
    },
    win: {
      ...baseBuild.win,
      target: "nsis",
    },
    nsis: {
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
      // Il primo incremento notifica soltanto gli aggiornamenti: blockmap e helper di elevazione
      // verranno abilitati, se necessari, insieme a electron-updater.
      differentialPackage: false,
      packElevateHelper: false,
    },
  };
}

module.exports = { createNsisBuildConfig };
