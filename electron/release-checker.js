// Controllo delle release desktop disponibile anche ai test senza caricare Electron.
//
// Questo modulo non decide quando mostrare una notifica e non scarica nulla: traduce la
// risposta GitHub in un piccolo contratto stabile. Il main process gli fornirà il trasporto
// HTTP quando la funzionalità verrà collegata all'app.

const RELEASE_REPOSITORY = "tosdan/mockxy";
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;
const RELEASE_PAGE_BASE_URL = `https://github.com/${RELEASE_REPOSITORY}/releases/tag/`;
const GITHUB_API_VERSION = "2026-03-10";
const DEFAULT_TIMEOUT_MS = 5_000;
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const STATUS = Object.freeze({
  AVAILABLE: "available",
  UP_TO_DATE: "up-to-date",
  UNAVAILABLE: "unavailable",
});

function parseNumericVersion(value, pattern) {
  if (typeof value !== "string") {
    return null;
  }
  const match = pattern.exec(value);
  if (!match) {
    return null;
  }
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  const leftParts = parseNumericVersion(left, VERSION_PATTERN);
  const rightParts = parseNumericVersion(right, VERSION_PATTERN);
  if (!leftParts || !rightParts) {
    throw new TypeError(`Versions must use the stable x.y.z format: ${left}, ${right}`);
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

function unavailableResult(currentVersion, reason, httpStatus = null) {
  return {
    status: STATUS.UNAVAILABLE,
    currentVersion,
    latestVersion: null,
    releaseName: null,
    releaseUrl: null,
    publishedAt: null,
    reason,
    httpStatus,
  };
}

function normalizeRelease(release, currentVersion) {
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    return unavailableResult(currentVersion, "invalid-response");
  }
  if (release.draft === true || release.prerelease === true) {
    return unavailableResult(currentVersion, "unstable-release");
  }

  const tagParts = parseNumericVersion(release.tag_name, RELEASE_TAG_PATTERN);
  if (!tagParts) {
    return unavailableResult(currentVersion, "invalid-release-version");
  }

  const latestVersion = tagParts.join(".");
  const releaseName =
    typeof release.name === "string" && release.name.trim().length > 0
      ? release.name.trim()
      : release.tag_name;
  const publishedAt =
    typeof release.published_at === "string" && !Number.isNaN(Date.parse(release.published_at))
      ? release.published_at
      : null;

  return {
    status:
      compareVersions(currentVersion, latestVersion) < 0 ? STATUS.AVAILABLE : STATUS.UP_TO_DATE,
    currentVersion,
    latestVersion,
    releaseName,
    releaseUrl: `${RELEASE_PAGE_BASE_URL}${encodeURIComponent(release.tag_name)}`,
    publishedAt,
    reason: null,
    httpStatus: null,
  };
}

function isTrustedReleaseUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      /^\/tosdan\/mockxy\/releases\/tag\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

async function checkLatestRelease({
  currentVersion,
  fetchImpl = globalThis.fetch,
  apiUrl = LATEST_RELEASE_API_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!parseNumericVersion(currentVersion, VERSION_PATTERN)) {
    throw new TypeError(`Current version must use the stable x.y.z format: ${currentVersion}`);
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`timeoutMs must be a positive number: ${timeoutMs}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(apiUrl, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      signal: controller.signal,
    });

    if (!response || response.ok !== true) {
      const httpStatus = Number.isInteger(response?.status) ? response.status : null;
      return unavailableResult(currentVersion, "http-error", httpStatus);
    }

    let release;
    try {
      release = await response.json();
    } catch {
      return unavailableResult(currentVersion, "invalid-json");
    }
    return normalizeRelease(release, currentVersion);
  } catch {
    return unavailableResult(currentVersion, controller.signal.aborted ? "timeout" : "network-error");
  } finally {
    clearTimeout(timeout);
  }
}

function timestamp(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    return Date.parse(value);
  }
  return Number.NaN;
}

function shouldCheckForUpdates({
  lastSuccessfulCheckAt,
  now = Date.now(),
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
} = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError(`intervalMs must be a positive number: ${intervalMs}`);
  }
  const lastCheck = timestamp(lastSuccessfulCheckAt);
  const currentTime = timestamp(now);
  if (!Number.isFinite(lastCheck) || !Number.isFinite(currentTime)) {
    return true;
  }
  return currentTime - lastCheck >= intervalMs;
}

module.exports = {
  RELEASE_REPOSITORY,
  LATEST_RELEASE_API_URL,
  GITHUB_API_VERSION,
  DEFAULT_TIMEOUT_MS,
  UPDATE_CHECK_INTERVAL_MS,
  STATUS,
  compareVersions,
  normalizeRelease,
  isTrustedReleaseUrl,
  checkLatestRelease,
  shouldCheckForUpdates,
};
