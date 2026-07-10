const fs = require("fs");
const path = require("path");
const { eraseAdminCollection } = require("../src/admin/collection-operations");
const { createTempDir, removeDir, writeMock } = require("./helpers");

describe("eraseAdminCollection: rollback atomico del sottoalbero", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("collection-erase-rollback-");
    await writeMock({ mocksDir, folder: "parent", method: "GET", routePath: "/parent", body: { parent: true } });
    await writeMock({ mocksDir, folder: "child", method: "POST", routePath: "/child", body: { child: true } });
    await fs.promises.writeFile(
      path.join(mocksDir, ".collections.json"),
      `${JSON.stringify({
        collections: [
          { id: "collection-parent", label: "Parent" },
          { id: "collection-child", label: "Child", parentId: "collection-parent" },
        ],
        memberships: {
          "parent/GET.endpoint.json": "collection-parent",
          "child/POST.endpoint.json": "collection-child",
        },
        childOrder: {
          root: ["collection-parent"],
          "collection-parent": ["parent/GET.endpoint.json", "collection-child"],
          "collection-child": ["child/POST.endpoint.json"],
        },
      }, null, 2)}\n`,
      "utf8"
    );
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("se il reload fallisce ripristina endpoint, response e metadati", async () => {
    const metadataBefore = await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8");
    const failingReload = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);

    await expect(
      eraseAdminCollection(mocksDir, "collection-parent", failingReload)
    ).rejects.toMatchObject({
      status: 400,
      message: "Collection erase rejected: boom",
    });

    expect(fs.existsSync(path.join(mocksDir, "parent", "GET.endpoint.json"))).toBe(true);
    expect(fs.existsSync(path.join(mocksDir, "parent", "GET.responses", "001.response.json"))).toBe(true);
    expect(fs.existsSync(path.join(mocksDir, "child", "POST.endpoint.json"))).toBe(true);
    expect(fs.existsSync(path.join(mocksDir, "child", "POST.responses", "001.response.json"))).toBe(true);
    expect(await fs.promises.readFile(path.join(mocksDir, ".collections.json"), "utf8")).toBe(metadataBefore);
  });
});
