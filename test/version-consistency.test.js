const { inspectVersions, validateVersions } = require("../scripts/check-version-consistency");

describe("package version consistency", () => {
  test("all package and lockfile versions in the repository are aligned", () => {
    const result = validateVersions(inspectVersions());

    expect(result.errors).toEqual([]);
    expect(result.expectedVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("reports every field that diverges from the root package version", () => {
    const result = validateVersions([
      { file: "./package.json", field: "version", version: "1.2.3" },
      { file: "electron/package.json", field: "version", version: "1.2.4" },
      { file: "electron/package-lock.json", field: "version", version: undefined },
    ]);

    expect(result.errors).toEqual([
      "electron/package.json version is 1.2.4, expected 1.2.3",
      "electron/package-lock.json version is undefined, expected 1.2.3",
    ]);
  });

  test("rejects a non-stable root version", () => {
    const result = validateVersions([
      { file: "./package.json", field: "version", version: "1.2.3-beta.1" },
    ]);

    expect(result.errors).toEqual(["Root package version is not a stable x.y.z version: 1.2.3-beta.1"]);
  });
});
