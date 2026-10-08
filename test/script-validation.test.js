const fs = require("fs");
const path = require("path");
const request = require("supertest");
const { runValidateCommand } = require("../src/cli-validate");
const { findContractViolations } = require("../src/mocks/script-contract");
const { STANDARD_PACKAGE } = require("../src/mocks/script-package");
const { validateWorkspaceScripts } = require("../src/mocks/workspace-validation");
const { createServerRuntime } = require("../src/server");
const { encodeMockId } = require("../src/admin/mock-ids");
const { createNoopLogger, createTempDir, removeDir, writeMock } = require("./helpers");

// Contratto degli script e validazione completa (docs/progetto/PIANO-SCRIPT-CONDIVISI.md, §5):
// un solo validatore, esposto dalla rotta admin e dalla riga di comando; le violazioni del
// contratto sono errori lì, avvisi al salvataggio dall'admin.

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const codes = (findings) => findings.map((finding) => finding.code);

describe("controllo sintattico del contratto", () => {
  test("dipendenze locali in cima al modulo, con percorso letterale ed esplicito: nessuna violazione", () => {
    const source = `const fs = require("node:fs");
const flusso = require("#shared/flusso.js");
const locale = require("./locale.js");
module.exports = {
  async resolveResponse({ params }) {
    const path = require("path");
    const pacchetto = require("un-pacchetto");
    return { jsonBody: flusso.leggi(params, locale, path, pacchetto, fs) };
  },
};
`;
    expect(findContractViolations(source)).toEqual([]);
  });

  test("require locale dentro una funzione, anche di un helper già importato in cima", () => {
    const source = `const dati = require("#shared/dati.js");
module.exports = {
  resolveResponse() {
    const ancora = require("#shared/dati.js");
    const freccia = () => require("./locale.js");
    return { jsonBody: [dati, ancora, freccia] };
  },
};
`;
    const violations = findContractViolations(source);
    expect(violations).toEqual([
      expect.objectContaining({ code: "SCRIPT_LATE_REQUIRE", line: 4, message: expect.stringContaining("#shared/dati.js") }),
      expect.objectContaining({ code: "SCRIPT_LATE_REQUIRE", line: 5, message: expect.stringContaining("./locale.js") }),
    ]);
  });

  test("percorso calcolato, relativo senza estensione e import() di codice locale", () => {
    const source = `const nome = "dati";
const a = require("./" + nome + ".js");
const b = require(\`./\${nome}.js\`);
const c = require("./helper");
const d = require("../altro/index");
module.exports = { resolveResponse: async () => (await import("./esm.mjs")).default(a, b, c, d) };
`;
    expect(findContractViolations(source).map(({ code, line }) => [code, line])).toEqual([
      ["SCRIPT_DYNAMIC_REQUIRE", 2],
      ["SCRIPT_DYNAMIC_REQUIRE", 3],
      ["SCRIPT_REQUIRE_WITHOUT_EXTENSION", 4],
      ["SCRIPT_REQUIRE_WITHOUT_EXTENSION", 5],
      ["SCRIPT_LOCAL_DYNAMIC_IMPORT", 6],
    ]);
  });

  test("stringhe e commenti non sono scambiati per codice", () => {
    const source = `// function f() { return require("./tardivo.js"); }
/* require(variabile) */
const testo = 'function g() { require("./helper") }';
const modello = \`require(\${testo})\`;
module.exports = { resolveResponse: () => ({ jsonBody: [testo, modello] }) };
`;
    expect(findContractViolations(source)).toEqual([]);
  });

  test("CommonJS come lo accetta il motore: return a livello di modulo, sintassi recente", () => {
    const source = `const dati = require("./dati.js");
if (!dati) { return; }
class Stato { #privato = dati?.valore ?? 1n; static { Stato.pronto = true; } }
module.exports = { resolveResponse: () => ({ jsonBody: new Stato() }) };
`;
    expect(findContractViolations(source)).toEqual([]);
  });

  test("un sorgente con un errore di sintassi non produce violazioni: resta l'errore di compilazione", () => {
    expect(findContractViolations("module.exports = { resolveResponse: ( => 1 };")).toEqual([]);
  });
});

describe("validazione completa degli script", () => {
  let workspaceDir;
  let mocksDir;

  beforeEach(async () => {
    workspaceDir = await createTempDir("script-validation-");
    mocksDir = path.join(workspaceDir, "mocks");
    write(path.join(mocksDir, "package.json"), `${JSON.stringify(STANDARD_PACKAGE, null, 2)}\n`);
    write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: \"condiviso\" };\n");
  });

  afterEach(async () => {
    await removeDir(workspaceDir);
  });

  const OK_HANDLER = `const dati = require("#shared/dati.js");
module.exports = { resolveResponse: () => ({ jsonBody: { value: dati.value } }) };
`;
  const LATE_HANDLER = `module.exports = { resolveResponse: () => ({ jsonBody: { value: require("#shared/dati.js").value } }) };
`;

  // Endpoint con una variante mock selezionata (001) e una variante handler inattiva (002).
  async function writeEndpointWithInactiveHandler(folder, source, { enabled = true } = {}) {
    await writeMock({ mocksDir, folder, method: "GET", routePath: `/${folder}`, body: { mock: true } });
    const endpointPath = path.join(mocksDir, folder, "GET.endpoint.json");
    const endpoint = JSON.parse(fs.readFileSync(endpointPath, "utf8"));
    endpoint.enabled = enabled;
    endpoint.responseFiles.push("002.response.json");
    fs.writeFileSync(endpointPath, JSON.stringify(endpoint));
    write(path.join(mocksDir, folder, "GET.responses", "002.response.json"), JSON.stringify({ type: "handler", title: "", sourceFile: "002.handler.js" }));
    write(path.join(mocksDir, folder, "GET.responses", "002.handler.js"), source);
  }

  test("workspace conforme: nessun errore, script inattivi compresi nel conteggio", async () => {
    await writeEndpointWithInactiveHandler("a", OK_HANDLER);
    await writeEndpointWithInactiveHandler("spento", OK_HANDLER, { enabled: false });

    expect(validateWorkspaceScripts(mocksDir)).toEqual({
      ok: true,
      mocksDir: fs.realpathSync(mocksDir),
      scripts: 2,
      errors: [],
      warnings: [],
    });
  });

  test("individua errori e violazioni in varianti inattive, endpoint disabilitati, middleware e helper", async () => {
    await writeEndpointWithInactiveHandler("rotto", "module.exports = { resolveResponse: ( => 1 };\n");
    await writeEndpointWithInactiveHandler("tardivo", LATE_HANDLER, { enabled: false });
    await writeEndpointWithInactiveHandler("senza-funzione", "module.exports = { altro: true };\n");
    write(path.join(mocksDir, "_shared", "pigro.js"), "module.exports = { leggi: () => require(\"./dati\") };\n");
    await writeEndpointWithInactiveHandler("via-helper", "const pigro = require(\"#shared/pigro.js\");\nmodule.exports = { resolveResponse: () => ({ jsonBody: pigro.leggi() }) };\n");
    write(path.join(mocksDir, "mw", "GET.responses", "001.middleware.js"), "module.exports = { transformResponse: (r) => r, path: \"/x\" };\n");
    await writeEndpointWithInactiveHandler("riuso", "module.exports = require(\"../../via-helper/GET.responses/002.handler.js\");\n");

    const report = validateWorkspaceScripts(mocksDir);

    expect(report.ok).toBe(false);
    expect(report.scripts).toBe(6);
    expect(report.errors.map(({ code, filePath, line }) => [filePath, code, line])).toEqual([
      ["_shared/pigro.js", "SCRIPT_LATE_REQUIRE", 1],
      ["_shared/pigro.js", "SCRIPT_REQUIRE_WITHOUT_EXTENSION", 1],
      ["mw/GET.responses/001.middleware.js", "SCRIPT_INVALID_EXPORT", undefined],
      ["riuso/GET.responses/002.handler.js", "SCRIPT_ENTRYPOINT_IMPORTED", undefined],
      ["rotto/GET.responses/002.handler.js", "SCRIPT_LOAD_FAILED", undefined],
      ["senza-funzione/GET.responses/002.handler.js", "SCRIPT_INVALID_EXPORT", undefined],
      ["tardivo/GET.responses/002.handler.js", "SCRIPT_LATE_REQUIRE", 1],
    ]);
  });

  test("package annidato, helper fuori dal workspace e alias fuori contratto", async () => {
    write(path.join(workspaceDir, "esterno.js"), "module.exports = { value: 1 };\n");
    await writeEndpointWithInactiveHandler("a", "const esterno = require(\"../../../esterno.js\");\nmodule.exports = { resolveResponse: () => ({ jsonBody: esterno }) };\n");
    write(path.join(mocksDir, "a", "package.json"), "{}");
    write(path.join(mocksDir, "package.json"), JSON.stringify({ imports: { "#shared/*": "./_shared/*", "#altro/*": "./altro/*" } }));

    const report = validateWorkspaceScripts(mocksDir);

    expect(codes(report.errors).sort()).toEqual(["SCRIPT_DEPENDENCY_OUTSIDE_WORKSPACE", "SCRIPT_PACKAGE_NESTED"]);
    expect(codes(report.warnings)).toEqual(["SCRIPT_PACKAGE_EXTRA_ALIAS"]);
  });

  test("package che non definisce l'alias standard: errore, con il file preservato", async () => {
    const custom = "{ \"type\": \"commonjs\" }";
    write(path.join(mocksDir, "package.json"), custom);
    await writeEndpointWithInactiveHandler("a", "module.exports = { resolveResponse: () => ({ jsonBody: 1 }) };\n");

    const report = validateWorkspaceScripts(mocksDir);

    expect(codes(report.errors)).toEqual(["SCRIPT_PACKAGE_INCOMPATIBLE"]);
    expect(fs.readFileSync(path.join(mocksDir, "package.json"), "utf8")).toBe(custom);
  });

  describe("riga di comando", () => {
    function run(argv) {
      const lines = [];
      const output = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
      return { exitCode: runValidateCommand(argv, output), lines };
    }

    test("accetta la radice del workspace o la cartella dei mock; esce con 0 se conforme", async () => {
      await writeEndpointWithInactiveHandler("a", OK_HANDLER);

      for (const target of [workspaceDir, mocksDir]) {
        const { exitCode, lines } = run([target]);
        expect(exitCode).toBe(0);
        expect(lines.at(-1)).toMatch(/^OK — 1 script\(s\) in .+, 0 error\(s\), 0 warning\(s\)\.$/);
      }
    });

    test("con errori esce con 1 e li elenca con file, riga e codice; --json dà il rapporto", async () => {
      await writeEndpointWithInactiveHandler("tardivo", LATE_HANDLER);

      const text = run([workspaceDir]);
      expect(text.exitCode).toBe(1);
      expect(text.lines[0]).toMatch(/^ERROR tardivo\/GET\.responses\/002\.handler\.js:1:\d+ \[SCRIPT_LATE_REQUIRE\] /);
      expect(text.lines.at(-1)).toMatch(/^FAILED — /);

      const json = run([workspaceDir, "--json"]);
      expect(json.exitCode).toBe(1);
      expect(JSON.parse(json.lines.join("\n"))).toMatchObject({ ok: false, scripts: 1, errors: [{ code: "SCRIPT_LATE_REQUIRE" }] });
    });

    test("cartella inesistente: errore esplicito", () => {
      const { exitCode, lines } = run([path.join(workspaceDir, "non-esiste")]);
      expect(exitCode).toBe(1);
      expect(lines[0]).toContain("Mocks folder not found");
    });
  });

  describe("admin", () => {
    let app;

    async function start() {
      const runtime = await createServerRuntime({
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
      app = runtime.app;
    }

    test("POST /scripts/validate: stesso rapporto, senza installare rotte né azzerare lo stato", async () => {
      await writeMock({ mocksDir, folder: "conta", method: "GET", routePath: "/conta", body: {} });
      write(path.join(mocksDir, "conta", "GET.responses", "001.response.json"), JSON.stringify({ type: "handler", title: "", sourceFile: "001.handler.js" }));
      write(path.join(mocksDir, "conta", "GET.responses", "001.handler.js"),
        "module.exports = { resolveResponse: ({ state }) => { state.n = (state.n || 0) + 1; return { jsonBody: { n: state.n } }; } };\n");
      await writeEndpointWithInactiveHandler("tardivo", LATE_HANDLER);
      await start();
      expect((await request(app).get("/conta")).body).toEqual({ n: 1 });

      const response = await request(app).post("/_admin/api/scripts/validate");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(validateWorkspaceScripts(mocksDir));
      expect(response.body).toMatchObject({ ok: false, scripts: 2, errors: [{ code: "SCRIPT_LATE_REQUIRE", filePath: "tardivo/GET.responses/002.handler.js" }] });
      // La variante inattiva non è stata installata e la memoria dell'handler prosegue.
      expect((await request(app).get("/tardivo")).body).toEqual({ mock: true });
      expect((await request(app).get("/conta")).body).toEqual({ n: 2 });
    });

    test("una variante inattiva validata si attiva poi correttamente", async () => {
      await writeEndpointWithInactiveHandler("a", OK_HANDLER);
      await start();
      expect((await request(app).post("/_admin/api/scripts/validate")).body.ok).toBe(true);

      const selected = await request(app)
        .put(`/_admin/api/mocks/${encodeMockId("a/GET.endpoint.json")}`)
        .send({ selectedResponseFile: "002.response.json" });

      expect(selected.status).toBe(200);
      expect((await request(app).get("/a")).body).toEqual({ value: "condiviso" });
    });

    test("salvataggio di uno script che viola il contratto: scritto e servito, con avvisi nella risposta", async () => {
      await writeMock({ mocksDir, folder: "a", method: "GET", routePath: "/a", body: { mock: true } });
      await start();
      const id = encodeMockId("a/GET.endpoint.json");

      const created = await request(app).post(`/_admin/api/mocks/${id}/responses`).send({ type: "handler", title: "Tardivo", source: LATE_HANDLER });

      expect(created.status).toBe(201);
      expect(created.body.warnings).toEqual([
        { code: "SCRIPT_LATE_REQUIRE", line: 1, column: expect.any(Number), message: expect.stringContaining("runs inside a function") },
      ]);
      expect((await request(app).get("/a")).body).toEqual({ value: "condiviso" });
      // Lo stesso script è un errore per la validazione completa.
      expect((await request(app).post("/_admin/api/scripts/validate")).body.errors.map((error) => error.code)).toEqual(["SCRIPT_LATE_REQUIRE"]);

      const conforming = await request(app).post(`/_admin/api/mocks/${id}/responses`).send({ type: "handler", title: "Conforme", source: OK_HANDLER });
      expect(conforming.status).toBe(201);
      expect(conforming.body).not.toHaveProperty("warnings");
    });

    test("gli errori di compilazione e di risoluzione restano bloccanti al salvataggio", async () => {
      await writeMock({ mocksDir, folder: "a", method: "GET", routePath: "/a", body: { mock: true } });
      await start();
      const id = encodeMockId("a/GET.endpoint.json");
      const create = (source) => request(app).post(`/_admin/api/mocks/${id}/responses`).send({ type: "handler", title: "x", source });

      const syntax = await create("module.exports = { resolveResponse: ( => 1 };\n");
      const missing = await create("const x = require(\"#shared/manca.js\");\nmodule.exports = { resolveResponse: () => ({ jsonBody: x }) };\n");

      expect(syntax.status).toBe(400);
      expect(missing.status).toBe(400);
      expect(missing.body.message).toContain("#shared/manca.js does not exist");
      expect((await request(app).get("/a")).body).toEqual({ mock: true });
    });

    test("la validazione al salvataggio vede gli helper come li vedrà il reload", async () => {
      await writeEndpointWithInactiveHandler("a", OK_HANDLER);
      // Un handler attivo carica l'helper all'avvio: da qui in poi è nella cache dei moduli.
      await writeMock({ mocksDir, folder: "attivo", method: "GET", routePath: "/attivo", body: {} });
      write(path.join(mocksDir, "attivo", "GET.responses", "001.response.json"), JSON.stringify({ type: "handler", title: "", sourceFile: "001.handler.js" }));
      write(path.join(mocksDir, "attivo", "GET.responses", "001.handler.js"), OK_HANDLER);
      await start();
      expect((await request(app).get("/attivo")).body).toEqual({ value: "condiviso" });
      // L'helper cambia su disco senza che nessuna scansione sia avvenuta (watcher spento).
      write(path.join(mocksDir, "_shared", "dati.js"), "module.exports = { value: \"condiviso\", nuovo: true };\n");

      const created = await request(app)
        .post(`/_admin/api/mocks/${encodeMockId("a/GET.endpoint.json")}/responses`)
        .send({
          type: "handler",
          title: "Usa il nuovo campo",
          source: "const dati = require(\"#shared/dati.js\");\nif (!dati.nuovo) { throw new Error(\"helper vecchio\"); }\nmodule.exports = { resolveResponse: () => ({ jsonBody: { nuovo: dati.nuovo } }) };\n",
        });

      expect(created.status).toBe(201);
      expect((await request(app).get("/a")).body).toEqual({ nuovo: true });
    });
  });
});
