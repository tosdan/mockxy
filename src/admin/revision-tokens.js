const crypto = require("crypto");
const fs = require("fs");
const { createAdminError, markMissingFile } = require("./admin-errors");
const { describeWorkspace } = require("../runtime-info");
const { canonicalPath } = require("../utils/canonical-path");

// Token di revisione delle risorse modificabili da bozza (piano agent/API, §13 C4): opachi,
// `rev-v1:` più lo SHA-256 della serializzazione deterministica di formato, workspace, endpoint,
// tipo di risorsa, filename della variante e contenuto coperto. Descrivono il contenuto corrente,
// non la cronologia: A → B → A torna al token di A, e un riavvio a contenuto invariato conserva
// il token. Non sono le revisioni informative di GET /info.
const REVISION_FORMAT = "rev-v1";
const REVISION_PATTERN = /^rev-v1:[0-9a-f]{64}$/;

// Identità del workspace per mocksDir canonico, registrata dal router (che conosce anche filesDir):
// le letture del catalogo ricevono solo mocksDir.
const workspaceIds = new Map();

function registerWorkspaceId(mocksDir, workspaceId) {
  workspaceIds.set(canonicalPath(mocksDir), workspaceId);
}

function workspaceIdFor(mocksDir) {
  return workspaceIds.get(canonicalPath(mocksDir)) ?? describeWorkspace({ mocksDir }).id;
}

// Chiavi degli oggetti ordinate ricorsivamente; ordine degli array e valori conservati.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function revisionToken({ mocksDir, endpointId, resource, responseFile, content }) {
  const serialized = JSON.stringify(canonicalize({
    format: REVISION_FORMAT,
    workspaceId: workspaceIdFor(mocksDir),
    endpointId,
    resource,
    responseFile,
    content,
  }));
  return `${REVISION_FORMAT}:${crypto.createHash("sha256").update(serialized, "utf8").digest("hex")}`;
}

// Descrizione: solo il valore persistito, con l'assenza normalizzata a stringa vuota. Un toggle o
// un cambio di selezione non la cambiano.
function descriptionRevision({ mocksDir, endpointId, description }) {
  return revisionToken({ mocksDir, endpointId, resource: "description", responseFile: null, content: description ?? "" });
}

// Variante: definizione JSON persistita e impronta dei byte del sorgente e dell'asset diretti, con
// i loro nomi. Non comprende selezione, `enabled`, descrizione né le varianti usate come step da
// una sequence.
function responseRevision({ mocksDir, endpointId, responseFile, definition, source, asset }) {
  return revisionToken({
    mocksDir,
    endpointId,
    resource: "response",
    responseFile,
    content: {
      definition,
      source: source == null ? null : { name: source.name, sha256: source.sha256 },
      asset: asset == null ? null : { name: asset.name, sha256: asset.sha256 },
    },
  });
}

function digestBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Impronta dei byte di un file letto in streaming (asset anche grandi); un file assente è un file
// mancante per la procedura di lettura incompleta.
function digestFile(filePath, missingMessage) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", (error) => reject(error.code === "ENOENT" ? markMissingFile(createAdminError(404, missingMessage)) : error))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

// `expectedRevision` (o l'header dell'upload): assente conserva il comportamento legacy.
function readExpectedRevision(value, label = "expectedRevision") {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
    throw createAdminError(400, `${label} must be a revision token (rev-v1:<sha256>).`);
  }
  return value;
}

function assertRevision({ resource, expectedRevision, currentRevision }) {
  if (expectedRevision == null || expectedRevision === currentRevision) {
    return;
  }
  throw createAdminError(409, "The resource changed since it was read: reload it before saving.", {
    code: "REVISION_CONFLICT",
    resource,
    expectedRevision,
    currentRevision,
  });
}

module.exports = {
  REVISION_PATTERN,
  assertRevision,
  descriptionRevision,
  digestBytes,
  digestFile,
  readExpectedRevision,
  registerWorkspaceId,
  responseRevision,
  workspaceIdFor,
};
