const {
  LATEST_RELEASE_API_URL,
  GITHUB_API_VERSION,
  UPDATE_CHECK_INTERVAL_MS,
  STATUS,
  compareVersions,
  normalizeRelease,
  isTrustedReleaseUrl,
  checkLatestRelease,
  shouldCheckForUpdates,
} = require("../electron/release-checker");

function release(overrides = {}) {
  return {
    tag_name: "v1.2.0",
    name: "Mockxy 1.2.0",
    draft: false,
    prerelease: false,
    published_at: "2026-07-29T10:00:00Z",
    ...overrides,
  };
}

function response(body, overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: jest.fn(async () => body),
    ...overrides,
  };
}

describe("desktop release checker", () => {
  test("compares stable versions numerically", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  test("rejects malformed or prerelease versions", () => {
    expect(() => compareVersions("1.2", "1.2.0")).toThrow(TypeError);
    expect(() => compareVersions("1.2.3-beta.1", "1.2.3")).toThrow(TypeError);
    expect(() => compareVersions("01.2.3", "1.2.3")).toThrow(TypeError);
  });

  test("reports a newer stable release with a repository-owned URL", () => {
    expect(normalizeRelease(release(), "1.1.0")).toEqual({
      status: STATUS.AVAILABLE,
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      releaseName: "Mockxy 1.2.0",
      releaseUrl: "https://github.com/tosdan/mockxy/releases/tag/v1.2.0",
      publishedAt: "2026-07-29T10:00:00Z",
      reason: null,
      httpStatus: null,
    });
  });

  test("accepts only canonical HTTPS release URLs", () => {
    expect(isTrustedReleaseUrl("https://github.com/tosdan/mockxy/releases/tag/v1.2.0")).toBe(true);
    expect(isTrustedReleaseUrl("http://github.com/tosdan/mockxy/releases/tag/v1.2.0")).toBe(false);
    expect(isTrustedReleaseUrl("https://github.com/other/mockxy/releases/tag/v1.2.0")).toBe(false);
    expect(isTrustedReleaseUrl("https://github.com/tosdan/mockxy/releases/tag/latest")).toBe(false);
    expect(
      isTrustedReleaseUrl("https://github.com/tosdan/mockxy/releases/tag/v1.2.0?redirect=evil"),
    ).toBe(false);
    expect(isTrustedReleaseUrl("https://github.com.evil.test/tosdan/mockxy/releases/tag/v1.2.0")).toBe(
      false,
    );
  });

  test("does not propose the same release or a downgrade", () => {
    expect(normalizeRelease(release(), "1.2.0").status).toBe(STATUS.UP_TO_DATE);
    expect(normalizeRelease(release(), "2.0.0").status).toBe(STATUS.UP_TO_DATE);
  });

  test.each([
    [release({ draft: true }), "unstable-release"],
    [release({ prerelease: true }), "unstable-release"],
    [release({ tag_name: "latest" }), "invalid-release-version"],
    [release({ tag_name: "v1.2.0-beta.1" }), "invalid-release-version"],
    [release({ tag_name: "v9007199254740992.0.0" }), "invalid-release-version"],
    [null, "invalid-response"],
  ])("rejects an unusable release response", (body, reason) => {
    expect(normalizeRelease(body, "1.1.0")).toMatchObject({
      status: STATUS.UNAVAILABLE,
      reason,
    });
  });

  test("queries the canonical public repository without credentials", async () => {
    const fetchImpl = jest.fn(async () => response(release()));

    const result = await checkLatestRelease({ currentVersion: "1.1.0", fetchImpl });

    expect(result.status).toBe(STATUS.AVAILABLE);
    expect(fetchImpl).toHaveBeenCalledWith(
      LATEST_RELEASE_API_URL,
      expect.objectContaining({
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  test.each([403, 404, 429, 500])("classifies HTTP %i without throwing", async (status) => {
    const result = await checkLatestRelease({
      currentVersion: "1.1.0",
      fetchImpl: async () => response(null, { ok: false, status }),
    });

    expect(result).toMatchObject({
      status: STATUS.UNAVAILABLE,
      reason: "http-error",
      httpStatus: status,
    });
  });

  test("classifies an invalid JSON response without throwing", async () => {
    const jsonResult = await checkLatestRelease({
      currentVersion: "1.1.0",
      fetchImpl: async () => response(null, { json: async () => Promise.reject(new Error("bad json")) }),
    });

    expect(jsonResult).toMatchObject({
      status: STATUS.UNAVAILABLE,
      reason: "invalid-json",
    });
  });

  test("classifies a network error without throwing", async () => {
    const result = await checkLatestRelease({
      currentVersion: "1.1.0",
      fetchImpl: async () => Promise.reject(new Error("offline")),
    });

    expect(result).toMatchObject({
      status: STATUS.UNAVAILABLE,
      reason: "network-error",
    });
  });

  test("aborts a request that exceeds the timeout", async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      );
      const pending = checkLatestRelease({
        currentVersion: "1.1.0",
        fetchImpl,
        timeoutMs: 50,
      });

      await jest.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toMatchObject({
        status: STATUS.UNAVAILABLE,
        reason: "timeout",
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test("validates programming inputs instead of hiding configuration errors", async () => {
    await expect(
      checkLatestRelease({ currentVersion: "dev", fetchImpl: jest.fn() }),
    ).rejects.toThrow(TypeError);
    await expect(
      checkLatestRelease({ currentVersion: "1.1.0", fetchImpl: null }),
    ).rejects.toThrow(TypeError);
    await expect(
      checkLatestRelease({ currentVersion: "1.1.0", fetchImpl: jest.fn(), timeoutMs: 0 }),
    ).rejects.toThrow(TypeError);
  });
});

describe("update check interval", () => {
  const now = Date.parse("2026-07-29T12:00:00Z");

  test("checks when there is no valid previous successful check", () => {
    expect(shouldCheckForUpdates({ now })).toBe(true);
    expect(shouldCheckForUpdates({ now, lastSuccessfulCheckAt: "invalid" })).toBe(true);
  });

  test("waits for 24 hours after a successful check", () => {
    expect(
      shouldCheckForUpdates({
        now,
        lastSuccessfulCheckAt: now - UPDATE_CHECK_INTERVAL_MS + 1,
      }),
    ).toBe(false);
    expect(
      shouldCheckForUpdates({
        now,
        lastSuccessfulCheckAt: now - UPDATE_CHECK_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  test("accepts dates and ISO timestamps", () => {
    expect(
      shouldCheckForUpdates({
        now: new Date(now),
        lastSuccessfulCheckAt: "2026-07-28T11:59:59Z",
      }),
    ).toBe(true);
  });
});
