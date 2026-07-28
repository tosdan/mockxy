const { restoreSavedWorkspaces } = require("../electron/workspace-session");

describe("desktop workspace session restore", () => {
  test("reopens every workspace and preserves the active tab", async () => {
    const open = jest.fn(async () => {});
    const result = await restoreSavedWorkspaces({
      savedSession: {
        openWorkspaces: ["a", "b", "c"],
        activeWorkspace: "b",
      },
      exists: () => true,
      open,
    });

    expect(open.mock.calls).toEqual([["a"], ["b"], ["c"]]);
    expect(result).toEqual({
      openedRoots: ["a", "b", "c"],
      activeRoot: "b",
      missingRoots: [],
      failures: [],
    });
  });

  test("continues after missing and failed workspaces", async () => {
    const failure = new Error("broken workspace");
    const result = await restoreSavedWorkspaces({
      savedSession: {
        openWorkspaces: ["missing", "broken", "good"],
        activeWorkspace: "broken",
      },
      exists: (root) => root !== "missing",
      open: async (root) => {
        if (root === "broken") {
          throw failure;
        }
      },
    });

    expect(result).toEqual({
      openedRoots: ["good"],
      activeRoot: "good",
      missingRoots: ["missing"],
      failures: [{ root: "broken", error: failure }],
    });
  });

  test("migrates the last workspace from older preferences", async () => {
    const open = jest.fn(async () => {});
    const result = await restoreSavedWorkspaces({
      savedSession: null,
      legacyLastWorkspace: "legacy",
      exists: () => true,
      open,
    });

    expect(open).toHaveBeenCalledWith("legacy");
    expect(result.activeRoot).toBe("legacy");
  });
});
