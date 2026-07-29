const fs = require("fs");
const path = require("path");

const electronDir = path.resolve(__dirname, "..");
const localTestIdentity = Object.freeze({
  identityName: "Mockxy.LocalTest",
  publisher: "CN=ms",
  publisherDisplayName: "Mockxy",
});

function requireIdentityField(identity, field, source) {
  const value = identity?.[field];
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("REPLACE_WITH_")
  ) {
    throw new Error(`${source}: specificare "${field}" con il valore assegnato da Partner Center.`);
  }
  return value.trim();
}

function validateStoreIdentity(identity, source = "Identità Store") {
  const normalized = {
    identityName: requireIdentityField(identity, "identityName", source),
    publisher: requireIdentityField(identity, "publisher", source),
    publisherDisplayName: requireIdentityField(identity, "publisherDisplayName", source),
  };

  if (!/^[A-Za-z0-9.-]{3,50}$/.test(normalized.identityName)) {
    throw new Error(
      `${source}: "identityName" deve contenere 3-50 caratteri alfanumerici, punti o trattini.`,
    );
  }
  return normalized;
}

function loadStoreIdentity(
  identityPath = process.env.MOCKXY_STORE_IDENTITY_FILE ||
    path.join(electronDir, "store-identity.json"),
) {
  const resolvedPath = path.resolve(identityPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      [
        `Identità Partner Center non trovata: ${resolvedPath}`,
        "Copiare electron/store-identity.example.json in electron/store-identity.json,",
        "quindi sostituire i segnaposto con i valori della pagina Product identity.",
      ].join(" "),
    );
  }

  let identity;
  try {
    identity = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(`Impossibile leggere l'identità Store da ${resolvedPath}: ${error.message}`);
  }
  return validateStoreIdentity(identity, resolvedPath);
}

function createAppxBuildConfig(identity) {
  const baseBuild = require("../package.json").build;
  const storeIdentity = validateStoreIdentity(identity);
  return {
    ...baseBuild,
    win: {
      ...baseBuild.win,
      target: "appx",
    },
    appx: {
      applicationId: "Mockxy",
      identityName: storeIdentity.identityName,
      publisher: storeIdentity.publisher,
      publisherDisplayName: storeIdentity.publisherDisplayName,
      displayName: "Mockxy",
      artifactName: "Mockxy-${version}-${arch}-store.${ext}",
      backgroundColor: "#474e60",
      languages: ["en-US", "it-IT"],
      capabilities: ["runFullTrust", "privateNetworkClientServer"],
      setBuildNumber: false,
      minVersion: "10.0.22000.0",
    },
  };
}

module.exports = {
  localTestIdentity,
  validateStoreIdentity,
  loadStoreIdentity,
  createAppxBuildConfig,
};
