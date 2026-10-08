const fs = require("fs");
const Module = require("module");
const path = require("path");
const request = require("supertest");
const { loadEndpointRouteGroups } = require("../src/mocks/endpoint-loader");
const { loadScriptModule } = require("../src/mocks/script-loader");
const { STANDARD_PACKAGE, inspectScriptPackage } = require("../src/mocks/script-package");
const { createServerRuntime } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir } = require("./helpers");

// Script condivisi (docs/progetto/PIANO-SCRIPT-CONDIVISI.md): gli helper stanno in
// `mocks/_shared/` e si importano con l'alias nativo di Node `#shared/`, definito da
// `mocks/package.json`. Nessuna cache delle definizioni: ogni scansione ricompila.

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writePackage(mocksDir, content = STANDARD_PACKAGE) {
  write(path.join(mocksDir, "package.json"), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

function handlerPath(mocksDir, folder, file = "001.handler.js") {
  return path.join(mocksDir, ...folder.split("/"), "GET.responses", file);
}

// Endpoint GET con una sola variante handler; `routePath` è la rotta servita.
function writeHandlerEndpoint(mocksDir, folder, routePath, source, { enabled = true } = {}) {
  const endpointDir = path.join(mocksDir, ...folder.split("/"));
  write(path.join(endpointDir, "GET.endpoint.json"), JSON.stringify({
    method: "GET",
    path: routePath,
    description: "",
    enabled,
    responseFiles: ["001.response.json"],
    selectedResponseFile: "001.response.json",
  }));
  write(path.join(endpointDir, "GET.responses", "001.response.json"), JSON.stringify({ type: "handler", title: "", sourceFile: "001.handler.js" }));
  write(handlerPath(mocksDir, folder), source);
}

const viaShared = (specifier) => `const helper = require(${JSON.stringify(specifier)});
module.exports = { resolveResponse: () => ({ jsonBody: { value: helper.value } }) };
`;

async function call(result, routePath, context = {}) {
  const group = result.handlerRouteGroups.find((entry) => entry.path === routePath);
  if (group == null) {
    throw new Error(`route not loaded: ${routePath} (${JSON.stringify(result.loadErrors)})`);
  }
  return (await group.methods.get("GET").resolveResponse(context)).jsonBody.value;
}

describe("script condivisi: alias #shared", () => {
  let workspaceDir;
  let mocksDir;

  beforeEach(async () => {
    workspaceDir = await createTempDir("shared-scripts-");
    mocksDir = path.join(workspaceDir, "mocks");
    fs.mkdirSync(mocksDir);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await removeDir(workspaceDir);
  });

  describe("risoluzione", () => {
    test("handler -> helper -> helper a profondità diverse, anche se caricato indirettamente per primo", async () => {
      write(path.join(mocksDir, "_shared", "dominio", "dati.js"), "module.exports = { value: 7 };\n");
      write(path.join(mocksDir, "_shared", "flusso.js"), "module.exports = require(\"#shared/dominio/dati.js\");\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/flusso.js"));
      writeHandlerEndpoint(mocksDir, "a/b/c", "/a/b/c", viaShared("#shared/flusso.js"));

      const result = await loadEndpointRouteGroups(mocksDir);
      expect(result.loadErrors).toEqual([]);
      expect(await call(result, "/a")).toBe(7);
      expect(await call(result, "/a/b/c")).toBe(7);

      // Nessuna dipendenza dall'ordine: una variante che riusa un'altra, compilata per prima in
      // un processo che non ha mai caricato direttamente l'originale.
      write(handlerPath(mocksDir, "z", "001.handler.js"), viaShared("#shared/flusso.js"));
      write(handlerPath(mocksDir, "z", "003.handler.js"), "module.exports = require(\"./001.handler.js\");\n");
      const { definition } = loadScriptModule(handlerPath(mocksDir, "z", "003.handler.js"), mocksDir);
      expect(definition.resolveResponse().jsonBody.value).toBe(7);
    });

    test("un progetto contenitore ESM non cambia il formato degli script dei mock", async () => {
      write(path.join(workspaceDir, "package.json"), JSON.stringify({ type: "module" }));
      write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: \"cjs\" };\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/dati.js"));

      const result = await loadEndpointRouteGroups(mocksDir);

      expect(result.loadErrors).toEqual([]);
      expect(await call(result, "/a")).toBe("cjs");
    });

    test("due workspace con alias identici risolvono ciascuno i propri helper", async () => {
      const otherWorkspace = await createTempDir("shared-scripts-other-");
      try {
        const otherMocks = path.join(otherWorkspace, "mocks");
        for (const [dir, value] of [[mocksDir, "primo"], [otherMocks, "secondo"]]) {
          write(path.join(dir, "_shared", "dati.js"), `module.exports = { value: ${JSON.stringify(value)} };\n`);
          writeHandlerEndpoint(dir, "a", "/a", viaShared("#shared/dati.js"));
        }

        const first = await loadEndpointRouteGroups(mocksDir);
        const second = await loadEndpointRouteGroups(otherMocks);

        expect(await call(first, "/a")).toBe("primo");
        expect(await call(second, "/a")).toBe("secondo");
      } finally {
        await removeDir(otherWorkspace);
      }
    });

    test("relativi locali, moduli Node e pacchetti in node_modules continuano a funzionare", async () => {
      write(path.join(mocksDir, "a", "node_modules", "pacchetto", "index.js"), "module.exports = { value: \"npm\" };\n");
      write(path.join(mocksDir, "a", "GET.responses", "locale.js"), "module.exports = { value: \"locale\" };\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", `const nodePath = require("node:path");
const pacchetto = require("pacchetto");
const locale = require("./locale.js");
module.exports = { resolveResponse: () => ({ jsonBody: { value: [pacchetto.value, locale.value, nodePath.sep.length] } }) };
`);

      const result = await loadEndpointRouteGroups(mocksDir);

      expect(result.loadErrors).toEqual([]);
      expect(await call(result, "/a")).toEqual(["npm", "locale", 1]);
    });
  });

  describe("package degli script", () => {
    const readPackage = () => JSON.parse(fs.readFileSync(path.join(mocksDir, "package.json"), "utf8"));

    test("assente: creato prima del primo script e segnalato una volta", async () => {
      write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: 1 };\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/dati.js"));

      const first = await loadEndpointRouteGroups(mocksDir);

      expect(first.loadErrors).toEqual([]);
      expect(await call(first, "/a")).toBe(1);
      expect(readPackage()).toEqual(STANDARD_PACKAGE);
      expect(first.createdScriptPackagePath).toBe(path.join(fs.realpathSync(mocksDir), "package.json"));
      expect(first.loadWarnings).toEqual([]);

      const second = await loadEndpointRouteGroups(mocksDir);
      expect(second.createdScriptPackagePath).toBeNull();
    });

    test("un workspace senza script non riceve nessun package", async () => {
      write(path.join(mocksDir, "a", "GET.endpoint.json"), JSON.stringify({
        method: "GET", path: "/a", description: "", enabled: true, responseFiles: ["001.response.json"], selectedResponseFile: "001.response.json",
      }));
      write(path.join(mocksDir, "a", "GET.responses", "001.response.json"), JSON.stringify({ type: "mock", status: 200, headers: {}, body: {} }));

      const result = await loadEndpointRouteGroups(mocksDir);

      expect(result.loadErrors).toEqual([]);
      expect(result.loadWarnings).toEqual([]);
      expect(fs.existsSync(path.join(mocksDir, "package.json"))).toBe(false);
    });

    test("presente e compatibile: usato senza riscriverlo, con type assente e campi in più", async () => {
      const custom = { name: "i-miei-mock", scripts: { lint: "true" }, imports: { "#shared/*": "./_shared/*" } };
      writePackage(mocksDir, custom);
      write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: 1 };\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/dati.js"));

      const result = await loadEndpointRouteGroups(mocksDir);

      expect(result.loadErrors).toEqual([]);
      expect(result.loadWarnings).toEqual([]);
      expect(result.createdScriptPackagePath).toBeNull();
      expect(readPackage()).toEqual(custom);
    });

    test.each([
      ["type module", { type: "module", imports: { "#shared/*": "./_shared/*" } }, "\"type\" is \"module\""],
      ["alias mancante", { type: "commonjs" }, "\"imports\" must contain"],
      ["alias mappato altrove", { imports: { "#shared/*": "./lib/*" } }, "\"imports\" must contain"],
      ["chiave riservata", { imports: { "#shared/*": "./_shared/*", "#shared/value.js": "./altrove.js" } }, "reserved #shared namespace (#shared/value.js)"],
    ])("presente ma incompatibile (%s): preservato e spiegato", async (_name, content, expected) => {
      writePackage(mocksDir, content);
      writeHandlerEndpoint(mocksDir, "a", "/a", "module.exports = { resolveResponse: () => ({ jsonBody: { value: 1 } }) };\n");

      const result = await loadEndpointRouteGroups(mocksDir);

      expect(readPackage()).toEqual(content);
      expect(result.loadWarnings).toEqual([
        expect.objectContaining({ code: "SCRIPT_PACKAGE_INCOMPATIBLE", message: expect.stringContaining(expected) }),
      ]);
    });

    test("JSON non valido: distinto dall'assenza e non riscritto", async () => {
      writePackage(mocksDir, "{ rotto");
      writeHandlerEndpoint(mocksDir, "a", "/a", "module.exports = { resolveResponse: () => ({ jsonBody: { value: 1 } }) };\n");

      const result = await loadEndpointRouteGroups(mocksDir);

      expect(fs.readFileSync(path.join(mocksDir, "package.json"), "utf8")).toBe("{ rotto");
      expect(result.loadWarnings.map((warning) => warning.code)).toEqual(["SCRIPT_PACKAGE_INVALID"]);
    });

    test("alias fuori contratto: tollerati dal reload, segnalati dalla validazione completa", async () => {
      writePackage(mocksDir, { imports: { "#shared/*": "./_shared/*", "#altro/*": "./altro/*" } });
      writeHandlerEndpoint(mocksDir, "a", "/a", "module.exports = { resolveResponse: () => ({ jsonBody: { value: 1 } }) };\n");

      const result = await loadEndpointRouteGroups(mocksDir);

      expect(result.loadWarnings).toEqual([]);
      expect(inspectScriptPackage(mocksDir, { strict: true }).warnings).toEqual([
        expect.objectContaining({ code: "SCRIPT_PACKAGE_EXTRA_ALIAS", message: expect.stringContaining("#altro/*") }),
      ]);
    });

    test("workspace in sola lettura senza package: avviso, e gli script senza alias caricano", async () => {
      write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: 1 };\n");
      writeHandlerEndpoint(mocksDir, "relativo", "/relativo", viaShared("../../_shared/dati.js"));
      writeHandlerEndpoint(mocksDir, "alias", "/alias", viaShared("#shared/dati.js"));
      const realWrite = fs.writeFileSync;
      const writes = [];
      jest.spyOn(fs, "writeFileSync").mockImplementation((target, ...rest) => {
        if (path.basename(String(target)) === "package.json") {
          writes.push(String(target));
          throw Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" });
        }
        return realWrite(target, ...rest);
      });

      const result = await loadEndpointRouteGroups(mocksDir);

      expect(writes).toHaveLength(1);
      expect(fs.existsSync(path.join(mocksDir, "package.json"))).toBe(false);
      expect(await call(result, "/relativo")).toBe(1);
      expect(result.loadErrors).toEqual([
        expect.objectContaining({ message: expect.stringContaining("is missing and cannot be created (EROFS)") }),
      ]);
      expect(result.loadWarnings.map((warning) => warning.code)).toEqual(["SCRIPT_PACKAGE_NOT_CREATABLE"]);

      // Il file arriva dopo: il processo ha già osservato l'assenza, serve il riavvio. Vale
      // anche per una nuova scansione, cioè per un runtime riaperto nello stesso processo.
      jest.restoreAllMocks();
      writePackage(mocksDir);
      const later = await loadEndpointRouteGroups(mocksDir);
      expect(later.loadWarnings.map((warning) => warning.code)).toEqual(["SCRIPT_PACKAGE_RESTART_REQUIRED"]);
      expect(later.loadErrors).toEqual([
        expect.objectContaining({ message: expect.stringContaining("was added or changed after scripts of this workspace were loaded") }),
      ]);
    });

    test("configurazione cambiata dopo il primo caricamento: riavvio necessario", async () => {
      writePackage(mocksDir);
      writeHandlerEndpoint(mocksDir, "a", "/a", "module.exports = { resolveResponse: () => ({ jsonBody: { value: 1 } }) };\n");
      expect((await loadEndpointRouteGroups(mocksDir)).loadWarnings).toEqual([]);

      // Un campo irrilevante per la risoluzione non richiede nulla.
      writePackage(mocksDir, { ...STANDARD_PACKAGE, name: "rinominato" });
      expect((await loadEndpointRouteGroups(mocksDir)).loadWarnings).toEqual([]);

      writePackage(mocksDir, { ...STANDARD_PACKAGE, imports: { "#shared/*": "./_shared/*", "#altro/*": "./altro/*" } });
      const result = await loadEndpointRouteGroups(mocksDir);
      expect(result.loadWarnings.map((warning) => warning.code)).toEqual(["SCRIPT_PACKAGE_RESTART_REQUIRED"]);
    });
  });

  describe("diagnostica", () => {
    async function loadError(folder = "a") {
      const result = await loadEndpointRouteGroups(mocksDir);
      const error = result.loadErrors.find((entry) => entry.filePath.includes(`${path.sep}${folder}${path.sep}`));
      return error?.message;
    }

    beforeEach(() => {
      writePackage(mocksDir);
      write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: 1 };\n");
    });

    test("file assente", async () => {
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/manca.js"));
      const message = await loadError();
      expect(message).toContain("#shared/manca.js does not exist");
      expect(message).toContain("Original error: Cannot find module");
    });

    test("estensione mancante", async () => {
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/dati"));
      expect(await loadError()).toContain("#shared/dati has no extension: aliases do not add one, write #shared/dati.js");
    });

    test("cartella importata al posto di un file", async () => {
      write(path.join(mocksDir, "_shared", "dominio", "index.js"), "module.exports = { value: 1 };\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/dominio"));
      expect(await loadError()).toContain("#shared/dominio is a folder");
    });

    test("package annidato che cambia l'ambito", async () => {
      write(path.join(mocksDir, "a", "package.json"), "{}");
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/dati.js"));
      const message = await loadError();
      expect(message).toContain(`${path.join("a", "package.json")} changes the package scope`);
      expect(message).toContain("remove the nested package.json");
    });

    test("errore dentro un helper transitivo", async () => {
      write(path.join(mocksDir, "_shared", "via.js"), "module.exports = require(\"#shared/assente.js\");\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/via.js"));
      expect(await loadError()).toContain("#shared/assente.js does not exist");
    });

    test("import legacy dalla radice della 1.5.0", async () => {
      write(path.join(mocksDir, "_lib", "x.js"), "module.exports = { value: 1 };\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("_shared/dati.js"));
      writeHandlerEndpoint(mocksDir, "b", "/b", viaShared("_lib/x.js"));

      const shared = await loadError("a");
      expect(shared).toContain("root import of Mockxy 1.5.0, which was removed: write require(\"#shared/dati.js\")");
      expect(shared).toContain("Original error: Cannot find module '_shared/dati.js'");
      expect(await loadError("b")).toContain("move the helper under _shared/ and import it with #shared/");
    });

    test("un pacchetto npm inesistente resta l'errore di Node, senza spiegazioni inventate", async () => {
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("pacchetto-che-non-esiste"));
      const message = await loadError();
      expect(message).toContain("Cannot find module 'pacchetto-che-non-esiste'");
      expect(message).not.toContain("Original error");
    });
  });

  describe("reload", () => {
    beforeEach(() => {
      writePackage(mocksDir);
    });

    test("helper diretti e transitivi aggiornati; un errore e la sua correzione non lasciano codice vecchio", async () => {
      const datiPath = path.join(mocksDir, "_shared", "dati.js");
      write(datiPath, "module.exports = { value: 1 };\n");
      write(path.join(mocksDir, "_shared", "flusso.js"), "module.exports = require(\"#shared/dati.js\");\n");
      writeHandlerEndpoint(mocksDir, "diretto", "/diretto", viaShared("#shared/dati.js"));
      writeHandlerEndpoint(mocksDir, "transitivo", "/transitivo", viaShared("#shared/flusso.js"));

      let result = await loadEndpointRouteGroups(mocksDir);
      expect([await call(result, "/diretto"), await call(result, "/transitivo")]).toEqual([1, 1]);

      write(datiPath, "module.exports = { value: 2 };\n");
      result = await loadEndpointRouteGroups(mocksDir);
      expect([await call(result, "/diretto"), await call(result, "/transitivo")]).toEqual([2, 2]);

      write(datiPath, "module.exports = { value: ;\n");
      result = await loadEndpointRouteGroups(mocksDir);
      expect(result.loadErrors).toHaveLength(2);

      write(datiPath, "module.exports = { value: 3 };\n");
      result = await loadEndpointRouteGroups(mocksDir);
      expect(result.loadErrors).toEqual([]);
      expect([await call(result, "/diretto"), await call(result, "/transitivo")]).toEqual([3, 3]);
    });

    test("una richiesta in corso conserva i riferimenti; una nuova usa il nuovo codice", async () => {
      const datiPath = path.join(mocksDir, "_shared", "dati.js");
      write(datiPath, "module.exports = { value: 1 };\n");
      writeHandlerEndpoint(mocksDir, "a", "/a", `const dati = require("#shared/dati.js");
module.exports = {
  async resolveResponse({ gate }) {
    const before = dati.value;
    await gate;
    return { jsonBody: { value: [before, dati.value] } };
  },
};
`);
      const first = await loadEndpointRouteGroups(mocksDir);
      let release;
      const running = call(first, "/a", { gate: new Promise((resolve) => { release = resolve; }) });

      write(datiPath, "module.exports = { value: 2 };\n");
      const second = await loadEndpointRouteGroups(mocksDir);
      const fresh = await call(second, "/a", { gate: Promise.resolve() });
      release();

      expect(await running).toEqual([1, 1]);
      expect(fresh).toEqual([2, 2]);
    });

    test("la pulizia non tocca node_modules né gli altri workspace", async () => {
      const otherWorkspace = await createTempDir("shared-scripts-other-");
      try {
        const otherMocks = path.join(otherWorkspace, "mocks");
        writePackage(otherMocks);
        write(path.join(otherMocks, "_shared", "dati.js"), "module.exports = { value: 1 };\n");
        writeHandlerEndpoint(otherMocks, "a", "/a", viaShared("#shared/dati.js"));
        write(path.join(mocksDir, "a", "node_modules", "contatore", "index.js"), "let n = 0;\nmodule.exports = { next: () => ++n };\n");
        write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: 1 };\n");
        writeHandlerEndpoint(mocksDir, "a", "/a", `require("#shared/dati.js");
const contatore = require("contatore");
module.exports = { resolveResponse: () => ({ jsonBody: { value: contatore.next() } }) };
`);
        await loadEndpointRouteGroups(otherMocks);
        const otherHelper = path.join(fs.realpathSync(otherMocks), "_shared", "dati.js");
        const ownHelper = path.join(fs.realpathSync(mocksDir), "_shared", "dati.js");

        expect(await call(await loadEndpointRouteGroups(mocksDir), "/a")).toBe(1);
        const ownInstance = Module._cache[ownHelper];
        expect(ownInstance).toBeDefined();
        // Il pacchetto in node_modules mantiene la sua istanza: il contatore prosegue.
        expect(await call(await loadEndpointRouteGroups(mocksDir), "/a")).toBe(2);

        expect(Module._cache[ownHelper]).not.toBe(ownInstance);
        expect(Module._cache[otherHelper]).toBeDefined();
      } finally {
        await removeDir(otherWorkspace);
      }
    });

    const symlinkTest = process.platform === "win32" ? test.skip : test;
    symlinkTest("radice raggiunta da un symlink: gli helper si aggiornano", async () => {
      const linkedWorkspace = `${workspaceDir}-link`;
      fs.symlinkSync(workspaceDir, linkedWorkspace);
      try {
        const linkedMocks = path.join(linkedWorkspace, "mocks");
        write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: 1 };\n");
        writeHandlerEndpoint(mocksDir, "alias", "/alias", viaShared("#shared/dati.js"));
        writeHandlerEndpoint(mocksDir, "relativo", "/relativo", viaShared("../../_shared/dati.js"));

        let result = await loadEndpointRouteGroups(linkedMocks);
        expect([await call(result, "/alias"), await call(result, "/relativo")]).toEqual([1, 1]);

        write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: 2 };\n");
        result = await loadEndpointRouteGroups(linkedMocks);
        expect([await call(result, "/alias"), await call(result, "/relativo")]).toEqual([2, 2]);
      } finally {
        fs.unlinkSync(linkedWorkspace);
      }
    });
  });

  describe("runtime e admin", () => {
    let runtime;

    async function start() {
      runtime = await createServerRuntime({
        configOverrides: {
          host: "127.0.0.1",
          mocksDir,
          monitorDumpDir: path.join(workspaceDir, "dump"),
          devWatch: false,
          adminApiEnabled: true,
          proxyFallbackEnabled: false,
        },
        logger: createNoopLogger(),
      });
      return runtime.app;
    }

    beforeEach(() => {
      writePackage(mocksDir);
      write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: \"condiviso\" };\n");
    });

    test("copiare un endpoint a un'altra profondità non richiede di cambiare l'import", async () => {
      writeHandlerEndpoint(mocksDir, "orig", "/orig", viaShared("#shared/dati.js"));
      const app = await start();

      const copy = await request(app)
        .post(`/_admin/api/mocks/${encodeMockId("orig/GET.endpoint.json")}/copy`)
        .send({ method: "GET", path: "/x/y/z" });

      expect(copy.status).toBe(201);
      expect((await request(app).get("/x/y/z")).body).toEqual({ value: "condiviso" });
    });

    test("un handler importato come dipendenza: avviso nello stato del runtime, tentativo applied", async () => {
      writeHandlerEndpoint(mocksDir, "base", "/base", viaShared("#shared/dati.js"));
      writeHandlerEndpoint(mocksDir, "riuso", "/riuso", "module.exports = require(\"../../base/GET.responses/001.handler.js\");\n");
      const app = await start();

      expect((await request(app).get("/riuso")).body).toEqual({ value: "condiviso" });
      const status = (await request(app).get("/_admin/api/runtime/status")).body;

      expect(status.lastAttempt.status).toBe("applied");
      expect(status.errors).toEqual([]);
      expect(status.warnings).toEqual([{
        code: "SCRIPT_ENTRYPOINT_IMPORTED",
        endpointId: encodeMockId("riuso/GET.endpoint.json"),
        filePath: "riuso/GET.endpoint.json",
        message: expect.stringContaining("handler and middleware scripts are entry points"),
      }]);
    });

    test("uno script rotto resta sulla versione precedente mentre gli altri si aggiornano", async () => {
      writeHandlerEndpoint(mocksDir, "a", "/a", viaShared("#shared/dati.js"));
      writeHandlerEndpoint(mocksDir, "b", "/b", viaShared("#shared/dati.js"));
      const app = await start();

      write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: \"nuovo\" };\n");
      write(handlerPath(mocksDir, "a"), "module.exports = { resolveResponse: ( => 1 };\n");
      await runtime.reloadRuntime();

      expect((await request(app).get("/a")).body).toEqual({ value: "condiviso" });
      expect((await request(app).get("/b")).body).toEqual({ value: "nuovo" });
      const status = (await request(app).get("/_admin/api/runtime/status")).body;
      expect(status.lastAttempt.status).toBe("degraded");
      expect(status.errors).toEqual([expect.objectContaining({ filePath: "a/GET.endpoint.json", serving: "retained" })]);
    });
  });
});
