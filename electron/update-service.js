// Orchestrazione del controllo aggiornamenti, senza dipendenze dirette da Electron.
//
// Decide frequenza, cache, versione ignorata e canale di distribuzione. Il main process fornisce
// rete e preferenze; la UI riceve soltanto il contratto pubblico, mai l'URL da aprire.

const {
  STATUS,
  checkLatestRelease,
  compareVersions,
  isTrustedReleaseUrl,
  shouldCheckForUpdates,
} = require("./release-checker");

const PUBLIC_STATUS = Object.freeze({
  NOT_CHECKED: "not-checked",
  AVAILABLE: STATUS.AVAILABLE,
  UP_TO_DATE: STATUS.UP_TO_DATE,
  UNAVAILABLE: STATUS.UNAVAILABLE,
});

function detectDistributionChannel({
  isPackaged,
  platform = process.platform,
  env = process.env,
  windowsStore = process.windowsStore === true,
} = {}) {
  if (windowsStore) return "store";
  if (!isPackaged) return "development";
  if (platform === "win32" && env.PORTABLE_EXECUTABLE_DIR) return "portable";
  if (platform === "linux" && env.APPIMAGE) return "appimage";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "packaged";
}

function createUpdateService({
  currentVersion,
  distributionChannel,
  checksEnabled = distributionChannel !== "store",
  automaticChecksEnabled,
  fetchImpl,
  readPreferences,
  recordSuccessfulCheck,
  setIgnoredVersion,
  now = () => Date.now(),
  checker = checkLatestRelease,
} = {}) {
  let inFlight = null;

  function stateFromPreferences(reason = null) {
    const preferences = readPreferences();
    const release = preferences.latestRelease;
    let status = PUBLIC_STATUS.NOT_CHECKED;
    if (release) {
      status =
        compareVersions(currentVersion, release.version) < 0
          ? PUBLIC_STATUS.AVAILABLE
          : PUBLIC_STATUS.UP_TO_DATE;
    }
    return {
      status,
      currentVersion,
      latestVersion: release?.version ?? null,
      releaseName: release?.name ?? null,
      publishedAt: release?.publishedAt ?? null,
      checkedAt: preferences.lastSuccessfulCheckAt,
      ignored: status === PUBLIC_STATUS.AVAILABLE && preferences.ignoredVersion === release?.version,
      reason,
      checksEnabled,
      automaticChecksEnabled,
      distributionChannel,
    };
  }

  function publicResult(result, checkedAt = null) {
    const preferences = readPreferences();
    return {
      status: result.status,
      currentVersion,
      latestVersion: result.latestVersion,
      releaseName: result.releaseName,
      publishedAt: result.publishedAt,
      checkedAt,
      ignored:
        result.status === STATUS.AVAILABLE &&
        preferences.ignoredVersion === result.latestVersion,
      reason: result.reason,
      httpStatus: result.httpStatus,
      checksEnabled,
      automaticChecksEnabled,
      distributionChannel,
    };
  }

  async function runCheck() {
    const result = await checker({ currentVersion, fetchImpl });
    if (result.status === STATUS.AVAILABLE || result.status === STATUS.UP_TO_DATE) {
      const checkedAt = new Date(now()).toISOString();
      recordSuccessfulCheck(result, checkedAt);
      return publicResult(result, checkedAt);
    }
    return publicResult(result);
  }

  async function check({ automatic = false } = {}) {
    if (!checksEnabled) {
      return stateFromPreferences("checks-disabled");
    }
    if (automatic && !automaticChecksEnabled) {
      return stateFromPreferences("automatic-checks-disabled");
    }
    if (
      automatic &&
      !shouldCheckForUpdates({
        lastSuccessfulCheckAt: readPreferences().lastSuccessfulCheckAt,
        now: now(),
      })
    ) {
      return stateFromPreferences();
    }
    if (!inFlight) {
      inFlight = runCheck().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function ignore(version) {
    const state = stateFromPreferences();
    if (
      state.status !== PUBLIC_STATUS.AVAILABLE ||
      typeof version !== "string" ||
      version !== state.latestVersion
    ) {
      return state;
    }
    setIgnoredVersion(version);
    return stateFromPreferences();
  }

  function releaseUrl() {
    if (!checksEnabled) {
      return null;
    }
    const state = stateFromPreferences();
    if (state.status !== PUBLIC_STATUS.AVAILABLE) {
      return null;
    }
    const url = readPreferences().latestRelease?.url;
    return isTrustedReleaseUrl(url) ? url : null;
  }

  return {
    getState: stateFromPreferences,
    check,
    ignore,
    releaseUrl,
  };
}

module.exports = {
  PUBLIC_STATUS,
  detectDistributionChannel,
  createUpdateService,
};
