const { shouldRestoreWorkspaces } = require("../electron/startup-options");

describe("desktop startup options", () => {
  test("restores workspaces by default", () => {
    expect(shouldRestoreWorkspaces(["Mockxy.exe"])).toBe(true);
  });

  test("supports a one-shot startup without restoring workspaces", () => {
    expect(shouldRestoreWorkspaces(["Mockxy.exe", "--no-restore-workspaces"])).toBe(false);
  });

  test("only accepts the exact option", () => {
    expect(shouldRestoreWorkspaces(["Mockxy.exe", "--no-restore-workspaces=true"])).toBe(true);
  });
});
