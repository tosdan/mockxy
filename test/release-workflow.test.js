const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const {
  RELEASE_TAG_PATTERN,
  validateReleaseTag,
  checkReleaseTag,
} = require("../scripts/check-release-tag");
const { createTempDir, removeDir } = require("./helpers");

const rootDir = path.resolve(__dirname, "..");

describe("release tag validation", () => {
  test("accepts only a stable tag matching the package version", () => {
    expect(RELEASE_TAG_PATTERN.test("v1.2.3")).toBe(true);
    expect(validateReleaseTag("v1.2.3", "1.2.3")).toEqual([]);
    expect(validateReleaseTag("1.2.3", "1.2.3")).toHaveLength(1);
    expect(validateReleaseTag("v1.2.3-beta.1", "1.2.3")).toHaveLength(1);
    expect(validateReleaseTag("v1.2.4", "1.2.3")).toContain(
      "Release tag v1.2.4 does not match package version 1.2.3.",
    );
  });

  test("checks all package versions as part of release validation", async () => {
    const dir = await createTempDir();
    try {
      for (const relativeDir of ["", "mockxy-ui", "electron"]) {
        const projectDir = path.join(dir, relativeDir);
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ version: "1.2.3" }));
        fs.writeFileSync(
          path.join(projectDir, "package-lock.json"),
          JSON.stringify({ version: "1.2.3", packages: { "": { version: "1.2.3" } } }),
        );
      }
      expect(checkReleaseTag("v1.2.3", dir).errors).toEqual([]);

      const electronPackage = path.join(dir, "electron", "package.json");
      fs.writeFileSync(electronPackage, JSON.stringify({ version: "1.2.4" }));
      expect(checkReleaseTag("v1.2.3", dir).errors).toContain(
        "electron/package.json version is 1.2.4, expected 1.2.3",
      );
    } finally {
      await removeDir(dir);
    }
  });
});

describe("desktop release workflow", () => {
  const workflowPath = path.join(rootDir, ".github", "workflows", "release.yml");
  const workflowText = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(workflowText);

  test("runs only for version tags and defaults to read-only contents", () => {
    expect(workflow.on.push.tags).toEqual(["v*.*.*"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  test("gates both builds behind tests and the draft behind both builds", () => {
    expect(workflow.jobs["windows-portable"].needs).toEqual(["engine", "ui-e2e"]);
    expect(workflow.jobs["linux-appimage"].needs).toEqual(["engine", "ui-e2e"]);
    expect(workflow.jobs["draft-release"].needs).toEqual([
      "windows-portable",
      "linux-appimage",
    ]);
  });

  test("grants write only to the final draft job", () => {
    expect(workflow.jobs["draft-release"].permissions).toEqual({ contents: "write" });
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== "draft-release") {
        expect(job.permissions).toBeUndefined();
      }
    }
  });

  test("publishes only the expected binaries and their checksums as a draft", () => {
    expect(workflowText).toContain("Mockxy-${version}-portable.exe");
    expect(workflowText).toContain("Mockxy-${version}-x86_64.AppImage");
    expect(workflowText).toContain("SHA256SUMS.txt");
    expect(workflowText).toContain("--draft");
    expect(workflowText).toContain("--verify-tag");
    expect(workflowText).toContain("npm run dist:electron:win");
    expect(workflowText).toContain("npm run dist:electron:linux");

    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
    );
    expect(rootPackage.scripts["dist:electron:win"]).toContain("--publish never");
    expect(rootPackage.scripts["dist:electron:linux"]).toContain("--publish never");
  });

  test("defines the matching AppImage target in electron-builder", () => {
    const electronPackage = JSON.parse(
      fs.readFileSync(path.join(rootDir, "electron", "package.json"), "utf8"),
    );
    expect(electronPackage.build.linux).toMatchObject({
      target: "AppImage",
      category: "Development",
    });
    expect(electronPackage.build.appImage.artifactName).toBe(
      "Mockxy-${version}-x86_64.AppImage",
    );
  });
});
