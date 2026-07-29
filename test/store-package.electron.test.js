const fs = require("fs");
const path = require("path");
const {
  localTestIdentity,
  validateStoreIdentity,
  loadStoreIdentity,
  createAppxBuildConfig,
} = require("../electron/scripts/store-package-config");
const { createTempDir, removeDir } = require("./helpers");

describe("desktop AppX package configuration", () => {
  test("keeps the AppX target separate from the portable target", () => {
    const electronPackage = require("../electron/package.json");
    const config = createAppxBuildConfig(localTestIdentity);

    expect(electronPackage.build.win.target).toBe("portable");
    expect(config.win.target).toBe("appx");
    expect(config.appx).toMatchObject({
      applicationId: "Mockxy",
      identityName: "Mockxy.LocalTest",
      publisher: "CN=ms",
      displayName: "Mockxy",
      artifactName: "Mockxy-${version}-${arch}-store.${ext}",
      languages: ["en-US", "it-IT"],
      capabilities: ["runFullTrust", "privateNetworkClientServer"],
      setBuildNumber: false,
      minVersion: "10.0.22000.0",
    });
    expect(config.files).toContain("!store-identity*.json");
  });

  test("rejects missing or placeholder Partner Center identity fields", () => {
    expect(() => validateStoreIdentity({})).toThrow(/identityName/);
    expect(() =>
      validateStoreIdentity({
        identityName: "REPLACE_WITH_PARTNER_CENTER_PACKAGE_IDENTITY_NAME",
        publisher: "CN=Example",
        publisherDisplayName: "Example",
      }),
    ).toThrow(/identityName/);
    expect(() =>
      validateStoreIdentity({
        identityName: "not valid!",
        publisher: "CN=Example",
        publisherDisplayName: "Example",
      }),
    ).toThrow(/3-50/);
  });

  test("loads a complete identity from the local Partner Center file", async () => {
    const dir = await createTempDir();
    try {
      const identityPath = path.join(dir, "store-identity.json");
      fs.writeFileSync(
        identityPath,
        JSON.stringify({
          identityName: "12345Mockxy.Mockxy",
          publisher: "CN=01234567-89ab-cdef-0123-456789abcdef",
          publisherDisplayName: "Mockxy",
        }),
      );
      expect(loadStoreIdentity(identityPath)).toEqual({
        identityName: "12345Mockxy.Mockxy",
        publisher: "CN=01234567-89ab-cdef-0123-456789abcdef",
        publisherDisplayName: "Mockxy",
      });
    } finally {
      await removeDir(dir);
    }
  });
});
