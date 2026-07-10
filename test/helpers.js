const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

function createNoopLogger() {
  return {
    error() { },
    warn() { },
    info() { },
    debug() { },
  };
}

function createMemoryLogger() {
  const entries = {
    error: [],
    warn: [],
    info: [],
    debug: [],
  };

  return {
    entries,
    error(message, fields) {
      entries.error.push({ message, fields });
    },
    warn(message, fields) {
      entries.warn.push({ message, fields });
    },
    info(message, fields) {
      entries.info.push({ message, fields });
    },
    debug(message, fields) {
      entries.debug.push({ message, fields });
    },
  };
}

async function createTempDir(prefix = "mockxy-test-") {
  // realpath canonicalizza il percorso (espande gli alias corti 8.3 di Windows, es.
  // MARIOR~1.ROS quando TEMP è ereditata in forma corta): senza, il watcher libuv sulla
  // cartella crasha l'intero processo di test. Vedi docs/sviluppo/TROUBLESHOOTING-DEV.md.
  return fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function writeMock({
  mocksDir,
  folder,
  method,
  routePath,
  enabled = true,
  status = 200,
  headers = {},
  body,
  fileContent,
  fileName,
  delayMs = 0,
}) {
  const mockDir = path.join(mocksDir, folder);
  await fs.promises.mkdir(mockDir, { recursive: true });
  const normalizedMethod = method.toUpperCase();
  const responseDir = path.join(mockDir, `${normalizedMethod}.responses`);
  const responseFile = "001.response.json";
  const servedFileName = fileName || `${normalizedMethod}.file.bin`;
  const configFile = `${normalizedMethod}.endpoint.json`;
  const servesFile = fileContent != null;

  const endpoint = {
    method: normalizedMethod,
    path: routePath,
    description: "",
    enabled,
    responseFiles: [responseFile],
    selectedResponseFile: responseFile,
  };
  const response = {
    type: "mock",
    title: "",
    status,
    headers,
    delayMs,
  };

  if (servesFile) {
    response.file = servedFileName;
  } else {
    response.body = body ?? { ok: true };
  }

  await fs.promises.mkdir(responseDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(mockDir, configFile),
    JSON.stringify(endpoint, null, 2),
    "utf8"
  );
  await fs.promises.writeFile(
    path.join(responseDir, responseFile),
    JSON.stringify(response, null, 2),
    "utf8"
  );

  if (servesFile) {
    await fs.promises.writeFile(path.join(responseDir, servedFileName), fileContent);
    return;
  }
}

function removeEndpointMetadataFromSource(source) {
  return source.replace(
    /^\s*(method|path|disabled)\s*:\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|true|false)\s*,?\r?\n/gm,
    ""
  );
}

// Writes a proxy middleware definition file under the mocks directory for integration tests.
async function writeProxyMiddleware({
  mocksDir,
  folder,
  method,
  source,
}) {
  const middlewareDir = path.join(mocksDir, folder);
  await fs.promises.mkdir(middlewareDir, { recursive: true });
  const normalizedMethod = method.toUpperCase();
  const responseDir = path.join(middlewareDir, `${normalizedMethod}.responses`);
  await fs.promises.mkdir(responseDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(middlewareDir, `${normalizedMethod}.endpoint.json`),
    JSON.stringify({
      method: normalizedMethod,
      path: readRoutePathFromSource(source),
      description: "",
      enabled: !/disabled\s*:\s*true/.test(source),
      responseFiles: ["001.response.json"],
      selectedResponseFile: "001.response.json",
    }, null, 2),
    "utf8"
  );
  await fs.promises.writeFile(
    path.join(responseDir, "001.response.json"),
    JSON.stringify({
      type: "middleware",
      title: "",
      sourceFile: "001.middleware.js",
    }, null, 2),
    "utf8"
  );
  await fs.promises.writeFile(path.join(responseDir, "001.middleware.js"), removeEndpointMetadataFromSource(source), "utf8");
}

// Writes a local dynamic handler definition file under the mocks directory for integration tests.
async function writeHandler({
  mocksDir,
  folder,
  method,
  source,
}) {
  const handlerDir = path.join(mocksDir, folder);
  await fs.promises.mkdir(handlerDir, { recursive: true });
  const normalizedMethod = method.toUpperCase();
  const responseDir = path.join(handlerDir, `${normalizedMethod}.responses`);
  await fs.promises.mkdir(responseDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(handlerDir, `${normalizedMethod}.endpoint.json`),
    JSON.stringify({
      method: normalizedMethod,
      path: readRoutePathFromSource(source),
      description: "",
      enabled: !/disabled\s*:\s*true/.test(source),
      responseFiles: ["001.response.json"],
      selectedResponseFile: "001.response.json",
    }, null, 2),
    "utf8"
  );
  await fs.promises.writeFile(
    path.join(responseDir, "001.response.json"),
    JSON.stringify({
      type: "handler",
      title: "",
      sourceFile: "001.handler.js",
    }, null, 2),
    "utf8"
  );
  await fs.promises.writeFile(path.join(responseDir, "001.handler.js"), removeEndpointMetadataFromSource(source), "utf8");
}

function readRoutePathFromSource(source) {
  const match = source.match(/path\s*:\s*["']([^"']+)["']/);
  if (!match) {
    throw new Error("Test helper source must include a path property.");
  }

  return match[1];
}

async function removeDir(dirPath) {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
}

async function startBackendServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function stopBackendServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function waitFor(checkFn, timeoutMs = 4000, intervalMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const done = await checkFn();
    if (done) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("waitFor timeout");
}

module.exports = {
  createMemoryLogger,
  createNoopLogger,
  createTempDir,
  writeMock,
  writeHandler,
  writeProxyMiddleware,
  removeDir,
  startBackendServer,
  stopBackendServer,
  waitFor,
};
