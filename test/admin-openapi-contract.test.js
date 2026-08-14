const { spawnSync } = require("child_process");
const path = require("path");

describe("Admin API OpenAPI contract", () => {
  test("il documento pubblico resta OpenAPI valido", () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "validate-admin-openapi.js")], {
      encoding: "utf8",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
