const fs = require("fs");
const path = require("path");
const { trackWrites } = require("../src/utils/write-tracking");
const { writeFileAtomic } = require("../src/utils/fs-atomic");
const { createTempDir, removeDir } = require("./helpers");

// Tracciamento esplicito delle scritture di una mutazione (piano agent/API, §13 C2).
describe("trackWrites", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTempDir("write-tracking-");
  });

  afterEach(async () => {
    await removeDir(dir);
  });

  test("raccoglie i file scritti dall'operazione, anche dopo più attese", async () => {
    const written = new Set();

    await trackWrites(written, async () => {
      await writeFileAtomic(path.join(dir, "a.json"), "{}");
      await new Promise((resolve) => setTimeout(resolve, 5));
      await writeFileAtomic(path.join(dir, "b.json"), "{}");
    });

    expect([...written].sort()).toEqual([path.join(dir, "a.json"), path.join(dir, "b.json")]);
  });

  test("fuori da un contesto e in contesti concorrenti non mescola le scritture", async () => {
    const first = new Set();
    const second = new Set();

    await Promise.all([
      trackWrites(first, () => writeFileAtomic(path.join(dir, "first.json"), "{}")),
      trackWrites(second, () => writeFileAtomic(path.join(dir, "second.json"), "{}")),
      writeFileAtomic(path.join(dir, "untracked.json"), "{}"),
    ]);

    expect([...first]).toEqual([path.join(dir, "first.json")]);
    expect([...second]).toEqual([path.join(dir, "second.json")]);
    expect(fs.existsSync(path.join(dir, "untracked.json"))).toBe(true);
  });
});
