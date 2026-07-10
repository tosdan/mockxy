const fs = require("fs");
const path = require("path");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { mergeLocalRouteGroups } = require("../src/mocks/local-route-groups");

// Scorciatoie di test: la scansione reale è unica (loadEndpointRouteGroups); qui interessano
// le singole viste per tipo.
async function loadHandlerRouteGroups(mocksDir) {
  return (await loadEndpointRouteGroups(mocksDir)).handlerRouteGroups;
}
async function loadMockRouteGroups(mocksDir) {
  return (await loadEndpointRouteGroups(mocksDir)).mockRouteGroups;
}
const { createTempDir, removeDir, writeHandler, writeMock } = require("./helpers");

describe("endpoint scan views (handler)", () => {
  let mocksDir;

  beforeEach(async () => {
    mocksDir = await createTempDir("handler-loader-");
  });

  afterEach(async () => {
    await removeDir(mocksDir);
  });

  test("loads local handlers and ignores disabled definitions", async () => {
    await writeHandler({
      mocksDir,
      folder: "enabled-handler",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/enabled-handler/:id",
  async resolveResponse({ params }) {
    return {
      jsonBody: {
        id: params.id
      }
    };
  }
};
`,
    });

    const disabledDir = path.join(mocksDir, "disabled-handler");
    const responseDir = path.join(disabledDir, "POST.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(disabledDir, "POST.endpoint.json"),
      JSON.stringify(
        {
          method: "POST",
          path: "/disabled-handler",
          enabled: false,
          responseFiles: ["001.response.json"],
          selectedResponseFile: "001.response.json",
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      JSON.stringify(
        {
          type: "handler",
          sourceFile: "001.handler.js",
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.handler.js"),
      `module.exports = {
  async resolveResponse() {
    return {
      jsonBody: {
        ignored: true
      }
    };
  }
};
`,
      "utf8"
    );

    const groups = await loadHandlerRouteGroups(mocksDir);

    expect(groups).toHaveLength(1);
    expect(groups[0].path).toBe("/enabled-handler/:id");
    expect(groups[0].methods.has("GET")).toBe(true);
  });

  test("throws when resolveResponse is missing", async () => {
    const folder = path.join(mocksDir, "invalid-handler");
    const responseDir = path.join(folder, "GET.responses");
    await fs.promises.mkdir(responseDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(folder, "GET.endpoint.json"),
      JSON.stringify(
        {
          method: "GET",
          path: "/invalid-handler",
          enabled: true,
          responseFiles: ["001.response.json"],
          selectedResponseFile: "001.response.json",
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.response.json"),
      JSON.stringify(
        {
          type: "handler",
          sourceFile: "001.handler.js",
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.promises.writeFile(
      path.join(responseDir, "001.handler.js"),
      `module.exports = {};
`,
      "utf8"
    );

    const { loadErrors } = await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].message).toContain("resolveResponse");

    const groups = await loadHandlerRouteGroups(mocksDir);
    expect(groups).toEqual([]);
  });

  test("when a mock and a handler define the same method and path, the first scanned wins", async () => {
    await writeMock({
      mocksDir,
      folder: "mock-dup",
      method: "GET",
      routePath: "/duplicate-endpoint",
      body: { ok: true },
    });
    await writeHandler({
      mocksDir,
      folder: "handler-dup",
      method: "GET",
      source: `module.exports = {
  method: "GET",
  path: "/duplicate-endpoint",
  async resolveResponse() {
    return {
      jsonBody: {
        ok: false
      }
    };
  }
};
`,
    });

    const { loadErrors } = await loadEndpointRouteGroups(mocksDir);
    expect(loadErrors).toHaveLength(1);
    expect(loadErrors[0].message).toContain("Duplicate endpoint definition");

    // In ordine di scansione "handler-dup" precede "mock-dup": vince l'handler.
    const groups = await loadHandlerRouteGroups(mocksDir);
    expect(groups).toHaveLength(1);
    expect(groups[0].path).toBe("/duplicate-endpoint");
  });
});
