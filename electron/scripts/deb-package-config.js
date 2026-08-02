// TODO(distribution): sostituire il noreply con un contatto pubblico dedicato al progetto;
// la decisione differita è tracciata anche in docs/progetto/TODO.md.
const DEB_MAINTAINER = "Mockxy <3496697+tosdan@users.noreply.github.com>";

function createDebBuildConfig() {
  const baseBuild = require("../package.json").build;
  return {
    ...baseBuild,
    // Questi campi finiscono nel package.json impacchettato: il canale evita tentativi di
    // scrittura sotto /opt e desktopName associa correttamente finestra e launcher Linux.
    extraMetadata: {
      ...baseBuild.extraMetadata,
      mockxyDistributionChannel: "deb",
      desktopName: "mockxy.desktop",
    },
    linux: {
      ...baseBuild.linux,
      target: "deb",
      executableName: "mockxy",
      maintainer: DEB_MAINTAINER,
      vendor: "Mockxy",
      synopsis: "Desktop mock API server with proxy fallback",
      description:
        "Mockxy runs multiple mock API workspaces in a desktop app, with editable responses, request monitoring, and backend proxy fallback.",
      category: "Development",
      syncDesktopName: true,
      // L'aggiornamento del deb resta manuale: evita app-update.yml e package-type generati
      // automaticamente da electron-builder quando riconosce un repository GitHub.
      publish: null,
      desktop: {
        entry: {
          Actions: "StartWithoutWorkspaces;",
          Keywords: "mock;API;proxy;server;workspace;",
          "Comment[it]":
            "Server API mock desktop con risposte modificabili e fallback verso il backend",
        },
        desktopActions: {
          StartWithoutWorkspaces: {
            Name: "Start without workspaces",
            "Name[it]": "Avvio senza workspace",
            Exec: "/opt/Mockxy/mockxy --no-restore-workspaces",
            Icon: "mockxy",
          },
        },
      },
    },
    deb: {
      artifactName: "mockxy_${version}_${arch}.${ext}",
      packageName: "mockxy",
      packageCategory: "devel",
      priority: "optional",
      // Le dipendenze restano intenzionalmente quelle predefinite della versione bloccata di
      // electron-builder. Verranno ispezionate nel control file e cambiate solo se i collaudi
      // Debian/Ubuntu dimostrano una reale incompatibilità.
    },
  };
}

module.exports = { DEB_MAINTAINER, createDebBuildConfig };
