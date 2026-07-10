const fs = require("fs");
const Module = require("module");
const path = require("path");

const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/;
const LEGACY_MOCK_SUFFIX = ".mock.json";
const LEGACY_HANDLER_SUFFIX = ".handler.js";
const LEGACY_MIDDLEWARE_SUFFIX = ".middleware.js";
const ENDPOINT_SUFFIX = ".endpoint.json";
const RESPONSE_SUFFIX = ".response.json";
const RESPONSES_DIR_SUFFIX = ".responses";
const COLLECTIONS_METADATA_FILE = ".collections.json";

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function walkFiles(rootDir) {
  const results = [];
  if (!fs.existsSync(rootDir)) {
    return results;
  }

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith(RESPONSES_DIR_SUFFIX)) {
          continue;
        }
        walk(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        results.push(absolutePath);
      }
    }
  }

  walk(rootDir);
  return results.sort((a, b) => a.localeCompare(b));
}

function extractMethodFromFileName(filePath) {
  return path.basename(filePath).split(".")[0].toUpperCase();
}

function loadScriptDefinition(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const scriptModule = new Module(filePath, module.parent);
  scriptModule.filename = filePath;
  scriptModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  scriptModule._compile(source, filePath);
  const loadedModule = scriptModule.exports;
  return loadedModule?.default || loadedModule;
}

function removeSourceMetadata(source) {
  return source.replace(
    /^\s*(method|path|disabled)\s*:\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|true|false)\s*,?\r?\n/gm,
    ""
  );
}

function assertMethod(method, filePath) {
  if (!HTTP_METHOD_PATTERN.test(method)) {
    throw new Error(`Invalid method in ${filePath}: ${method}`);
  }
}

function ensureEndpointAvailable(endpointPath, sourcePath) {
  if (fs.existsSync(endpointPath)) {
    throw new Error(`Cannot migrate ${sourcePath}: ${endpointPath} already exists`);
  }
}

function uniqueAssetName(responseDir, preferredName) {
  const parsed = path.parse(preferredName);
  let candidate = preferredName;
  let index = 2;
  while (fs.existsSync(path.join(responseDir, candidate))) {
    candidate = `${parsed.name}-${index}${parsed.ext}`;
    index += 1;
  }
  return candidate;
}

function createEndpoint({ method, routePath, disabled }) {
  return {
    method,
    path: routePath,
    description: "",
    enabled: disabled !== true,
    responseFiles: ["001.response.json"],
    selectedResponseFile: "001.response.json",
  };
}

function migrateMockFile(mocksDir, filePath, pathMap) {
  const config = readJson(filePath);
  const method = String(config.method || extractMethodFromFileName(filePath)).toUpperCase();
  assertMethod(method, filePath);

  const fileMethod = extractMethodFromFileName(filePath);
  if (method !== fileMethod) {
    throw new Error(`Method mismatch in ${filePath}: ${method} does not match ${fileMethod}`);
  }

  const configDir = path.dirname(filePath);
  const endpointPath = path.join(configDir, `${method}${ENDPOINT_SUFFIX}`);
  ensureEndpointAvailable(endpointPath, filePath);

  const responseDir = path.join(configDir, `${method}${RESPONSES_DIR_SUFFIX}`);
  const responsePath = path.join(responseDir, `001${RESPONSE_SUFFIX}`);
  fs.mkdirSync(responseDir, { recursive: true });

  const response = {
    type: "mock",
    title: "",
    status: config.status,
    headers: config.headers || {},
    delayMs: config.delayMs || 0,
  };

  if (config.file != null) {
    const sourcePayloadPath = path.resolve(configDir, config.file);
    const targetFileName = uniqueAssetName(responseDir, path.basename(config.file));
    const targetPayloadPath = path.join(responseDir, targetFileName);
    if (!fs.existsSync(sourcePayloadPath)) {
      throw new Error(`Missing file payload for ${filePath}: ${sourcePayloadPath}`);
    }
    fs.renameSync(sourcePayloadPath, targetPayloadPath);
    response.file = targetFileName;
  } else if (config.bodyFile != null) {
    const sourceBodyPath = path.resolve(configDir, config.bodyFile);
    if (!fs.existsSync(sourceBodyPath)) {
      throw new Error(`Missing body payload for ${filePath}: ${sourceBodyPath}`);
    }
    response.body = readJson(sourceBodyPath);
    fs.rmSync(sourceBodyPath, { force: true });
  } else {
    response.body = null;
  }

  writeJson(responsePath, response);
  writeJson(endpointPath, createEndpoint({ method, routePath: config.path, disabled: config.disabled }));

  const sourceRelativePath = toPosix(path.relative(mocksDir, filePath));
  const targetRelativePath = toPosix(path.relative(mocksDir, endpointPath));
  pathMap.set(sourceRelativePath, targetRelativePath);
  fs.rmSync(filePath, { force: true });
}

function migrateScriptFile(mocksDir, filePath, type, pathMap) {
  const definition = loadScriptDefinition(filePath);
  const method = String(definition.method || extractMethodFromFileName(filePath)).toUpperCase();
  assertMethod(method, filePath);

  const fileMethod = extractMethodFromFileName(filePath);
  if (method !== fileMethod) {
    throw new Error(`Method mismatch in ${filePath}: ${method} does not match ${fileMethod}`);
  }
  if (typeof definition.path !== "string" || definition.path.trim() === "") {
    throw new Error(`Missing path in ${filePath}`);
  }

  const configDir = path.dirname(filePath);
  const endpointPath = path.join(configDir, `${method}${ENDPOINT_SUFFIX}`);
  ensureEndpointAvailable(endpointPath, filePath);

  const responseDir = path.join(configDir, `${method}${RESPONSES_DIR_SUFFIX}`);
  const responsePath = path.join(responseDir, `001${RESPONSE_SUFFIX}`);
  const sourceFile = type === "handler" ? "001.handler.js" : "001.middleware.js";
  const targetSourcePath = path.join(responseDir, sourceFile);
  fs.mkdirSync(responseDir, { recursive: true });

  const source = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(targetSourcePath, removeSourceMetadata(source), "utf8");
  writeJson(responsePath, {
    type,
    title: "",
    sourceFile,
  });
  writeJson(endpointPath, createEndpoint({
    method,
    routePath: definition.path,
    disabled: definition.disabled,
  }));

  const sourceRelativePath = toPosix(path.relative(mocksDir, filePath));
  const targetRelativePath = toPosix(path.relative(mocksDir, endpointPath));
  pathMap.set(sourceRelativePath, targetRelativePath);
  fs.rmSync(filePath, { force: true });
}

function migrateCollections(mocksDir, pathMap) {
  const collectionsPath = path.join(mocksDir, COLLECTIONS_METADATA_FILE);
  if (!fs.existsSync(collectionsPath)) {
    return;
  }

  const state = readJson(collectionsPath);
  const memberships = {};
  for (const [definitionPath, collectionId] of Object.entries(state.memberships || {})) {
    memberships[pathMap.get(definitionPath) || definitionPath] = collectionId;
  }

  const itemOrder = {};
  for (const [collectionId, definitionPaths] of Object.entries(state.itemOrder || {})) {
    if (!Array.isArray(definitionPaths)) {
      continue;
    }
    const seen = new Set();
    const nextPaths = [];
    for (const definitionPath of definitionPaths) {
      const nextPath = pathMap.get(definitionPath) || definitionPath;
      if (seen.has(nextPath)) {
        continue;
      }
      seen.add(nextPath);
      nextPaths.push(nextPath);
    }
    if (nextPaths.length > 0) {
      itemOrder[collectionId] = nextPaths;
    }
  }

  writeJson(collectionsPath, {
    ...state,
    memberships,
    itemOrder,
  });
}

function removeEmptyDirs(rootDir) {
  const dirs = walkFiles(rootDir)
    .map((filePath) => path.dirname(filePath))
    .sort((a, b) => b.length - a.length);
  const seen = new Set(dirs);
  for (const dir of seen) {
    if (path.resolve(dir) === path.resolve(rootDir)) {
      continue;
    }
    try {
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch (_error) {
      // Best-effort cleanup only.
    }
  }
}

function main() {
  const mocksDir = path.resolve(process.argv[2] || path.join(process.cwd(), "mocks"));
  const pathMap = new Map();
  const files = walkFiles(mocksDir);

  for (const filePath of files) {
    if (filePath.endsWith(LEGACY_MOCK_SUFFIX)) {
      migrateMockFile(mocksDir, filePath, pathMap);
    }
  }

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    if (filePath.endsWith(LEGACY_HANDLER_SUFFIX)) {
      migrateScriptFile(mocksDir, filePath, "handler", pathMap);
    } else if (filePath.endsWith(LEGACY_MIDDLEWARE_SUFFIX)) {
      migrateScriptFile(mocksDir, filePath, "middleware", pathMap);
    }
  }

  migrateCollections(mocksDir, pathMap);
  removeEmptyDirs(mocksDir);
  console.log(`Migrated ${pathMap.size} definitions in ${mocksDir}`);
}

main();
