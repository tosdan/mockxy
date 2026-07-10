const path = require("path");
const { createAdminError } = require("./admin-errors");

// Identificatori e suffissi dei file del catalogo mock: l'id admin di una definizione è il
// percorso relativo (posix) del suo file di configurazione, codificato in base64url.

const ENDPOINT_SUFFIX = ".endpoint.json";
const RESPONSE_SUFFIX = ".response.json";
const RESPONSES_DIR_SUFFIX = ".responses";

function toPosixRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function encodeMockId(relativePath) {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function decodeMockId(id) {
  try {
    return Buffer.from(String(id || ""), "base64url").toString("utf8");
  } catch (_error) {
    throw createAdminError(400, "Invalid mock id.");
  }
}

function isInsideDir(rootDir, targetPath) {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveAdminFilePath(mocksDir, id) {
  const relativePath = decodeMockId(id);
  // ".." è vietato come SEGMENTO esatto, non come substring: cartelle come "a..b" sono nomi
  // che la creazione accetta (route-folders) — rifiutarle qui renderebbe l'endpoint appena
  // creato ingestibile via API. Il traversal vero resta bloccato anche da isInsideDir dopo
  // la risoluzione.
  const hasRelativeSegments = relativePath
    .split(/[\\/]/)
    .some((segment) => segment === ".." || segment === ".");
  if (!relativePath || path.isAbsolute(relativePath) || hasRelativeSegments) {
    throw createAdminError(400, "Invalid mock id.");
  }

  if (!relativePath.endsWith(ENDPOINT_SUFFIX)) {
    throw createAdminError(400, "Invalid mock id.");
  }

  const filePath = path.resolve(mocksDir, relativePath);
  if (!isInsideDir(mocksDir, filePath)) {
    throw createAdminError(400, "Invalid mock id.");
  }

  return filePath;
}

module.exports = {
  ENDPOINT_SUFFIX,
  RESPONSE_SUFFIX,
  RESPONSES_DIR_SUFFIX,
  toPosixRelativePath,
  encodeMockId,
  decodeMockId,
  isInsideDir,
  resolveAdminFilePath,
};
