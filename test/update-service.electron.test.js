const { createUpdateService, detectDistributionChannel } = require("../electron/update-service");

function releaseResult(version = "1.2.0") {
  return {
    status: "available",
    currentVersion: "1.1.0",
    latestVersion: version,
    releaseName: `Mockxy ${version}`,
    releaseUrl: `https://github.com/tosdan/mockxy/releases/tag/v${version}`,
    publishedAt: "2026-07-29T10:00:00Z",
    reason: null,
    httpStatus: null,
  };
}

function harness(overrides = {}) {
  let preferences = {
    lastSuccessfulCheckAt: null,
    latestRelease: null,
    ignoredVersion: null,
  };
  const checker = overrides.checker ?? jest.fn(async () => releaseResult());
  const service = createUpdateService({
    currentVersion: "1.1.0",
    distributionChannel: "portable",
    checksEnabled: true,
    automaticChecksEnabled: true,
    fetchImpl: jest.fn(),
    readPreferences: () => preferences,
    recordSuccessfulCheck: (result, checkedAt) => {
      preferences = {
        ...preferences,
        lastSuccessfulCheckAt: checkedAt,
        latestRelease: {
          version: result.latestVersion,
          name: result.releaseName,
          url: result.releaseUrl,
          publishedAt: result.publishedAt,
        },
      };
    },
    setIgnoredVersion: (version) => {
      preferences = { ...preferences, ignoredVersion: version };
    },
    now: () => Date.parse("2026-07-29T12:00:00Z"),
    checker,
    ...overrides,
  });
  return { service, checker, getPreferences: () => preferences };
}

describe("desktop update service", () => {
  test("detects the current distribution channel", () => {
    expect(detectDistributionChannel({ isPackaged: false })).toBe("development");
    expect(
      detectDistributionChannel({
        isPackaged: true,
        platform: "win32",
        env: { PORTABLE_EXECUTABLE_DIR: "C:\\Mockxy" },
      }),
    ).toBe("portable");
    expect(
      detectDistributionChannel({
        isPackaged: true,
        platform: "linux",
        env: { APPIMAGE: "/opt/Mockxy.AppImage" },
      }),
    ).toBe("appimage");
    expect(detectDistributionChannel({ isPackaged: true, windowsStore: true })).toBe("store");
    expect(
      detectDistributionChannel({
        isPackaged: true,
        platform: "win32",
        env: {},
        packageChannel: "nsis",
      }),
    ).toBe("nsis");
  });

  test("uses app version and persists a successful manual check", async () => {
    const { service, checker, getPreferences } = harness();

    await expect(service.check()).resolves.toMatchObject({
      status: "available",
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      checkedAt: "2026-07-29T12:00:00.000Z",
    });
    expect(checker).toHaveBeenCalledWith(
      expect.objectContaining({ currentVersion: "1.1.0" }),
    );
    expect(getPreferences().latestRelease.version).toBe("1.2.0");
  });

  test("does not repeat an automatic check within 24 hours", async () => {
    const now = Date.parse("2026-07-29T12:00:00Z");
    const { service, checker } = harness({
      readPreferences: () => ({
        lastSuccessfulCheckAt: new Date(now - 60_000).toISOString(),
        latestRelease: {
          version: "1.2.0",
          name: "Mockxy 1.2.0",
          url: "https://github.com/tosdan/mockxy/releases/tag/v1.2.0",
          publishedAt: null,
        },
        ignoredVersion: null,
      }),
      now: () => now,
    });

    await expect(service.check({ automatic: true })).resolves.toMatchObject({
      status: "available",
      checkedAt: new Date(now - 60_000).toISOString(),
    });
    expect(checker).not.toHaveBeenCalled();
  });

  test("does not run automatic checks in development or Store builds", async () => {
    const development = harness({ automaticChecksEnabled: false });
    await expect(development.service.check({ automatic: true })).resolves.toMatchObject({
      status: "not-checked",
      reason: "automatic-checks-disabled",
    });
    expect(development.checker).not.toHaveBeenCalled();

    const store = harness({ checksEnabled: false, automaticChecksEnabled: false });
    await expect(store.service.check()).resolves.toMatchObject({
      status: "not-checked",
      reason: "checks-disabled",
    });
    expect(store.checker).not.toHaveBeenCalled();
    expect(store.service.releaseUrl()).toBeNull();
  });

  test("ignores only the currently available version and reveals a later one", async () => {
    const { service, checker } = harness();
    await service.check();

    expect(service.ignore("9.9.9").ignored).toBe(false);
    expect(service.ignore("1.2.0").ignored).toBe(true);

    checker.mockResolvedValueOnce(releaseResult("1.3.0"));
    await expect(service.check()).resolves.toMatchObject({
      latestVersion: "1.3.0",
      ignored: false,
    });
  });

  test("opens only the trusted URL of the cached available release", async () => {
    const trusted = harness();
    await trusted.service.check();
    expect(trusted.service.releaseUrl()).toBe(
      "https://github.com/tosdan/mockxy/releases/tag/v1.2.0",
    );

    const tampered = harness({
      readPreferences: () => ({
        lastSuccessfulCheckAt: "2026-07-29T12:00:00Z",
        latestRelease: {
          version: "1.2.0",
          name: "Mockxy 1.2.0",
          url: "https://evil.test/download",
          publishedAt: null,
        },
        ignoredVersion: null,
      }),
    });
    expect(tampered.service.releaseUrl()).toBeNull();
  });

  test("deduplicates simultaneous checks", async () => {
    let resolveCheck;
    const pendingResult = new Promise((resolve) => {
      resolveCheck = resolve;
    });
    const { service, checker } = harness({
      checker: jest.fn(() => pendingResult),
    });

    const first = service.check();
    const second = service.check();
    resolveCheck(releaseResult());

    await Promise.all([first, second]);
    expect(checker).toHaveBeenCalledTimes(1);
  });
});
