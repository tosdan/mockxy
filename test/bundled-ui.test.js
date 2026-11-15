const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { findBundledUi, resolveBundledUi } = require("../src/bundled-ui");
const { createTempDir, removeDir, waitFor } = require("./helpers");

const REPO_ROOT = path.join(__dirname, "..");
const BUILD_LOCATION = path.join("mockxy-ui", "dist", "mockxy-ui", "browser");

// Una build finta dell'interfaccia: basta index.html con il suo <base href>.
function writeUi(root, location, baseHref = "/_admin/ui/") {
  const dir = path.join(root, location);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><base href="${baseHref}"><title>interfaccia di prova</title></head><body>${location}</body></html>`
  );
  fs.writeFileSync(path.join(dir, "main.js"), "console.log('ui');");
  return dir;
}

// L'interfaccia compilata che sta accanto al motore si serve da sé, quando il motore parte da
// riga di comando e nessuno ha impostato UI_DIST_DIR.
describe("interfaccia compilata accanto al motore", () => {
  let root;

  beforeEach(async () => {
    root = await createTempDir("bundled-ui-");
  });

  afterEach(async () => {
    await removeDir(root);
  });

  describe("ricerca della build", () => {
    test("niente accanto al motore: nessuna build", () => {
      expect(findBundledUi(root)).toEqual({ dir: null });
    });

    test("la build lasciata da `npm run build:ui` in un clone", () => {
      const dir = writeUi(root, BUILD_LOCATION);

      expect(findBundledUi(root)).toEqual({ dir });
    });

    test("`ui/`, dove la portano le distribuzioni, ha la precedenza", () => {
      writeUi(root, BUILD_LOCATION);
      const dir = writeUi(root, "ui");

      expect(findBundledUi(root)).toEqual({ dir });
    });

    test("una build per un altro percorso base non si può servire, e lo si dice", () => {
      const dir = writeUi(root, BUILD_LOCATION, "/");

      expect(findBundledUi(root)).toEqual({ dir: null, unusable: { dir, baseHref: "/" } });
    });

    test("una build inservibile non nasconde quella buona che viene dopo", () => {
      writeUi(root, "ui", "/");
      const dir = writeUi(root, BUILD_LOCATION);

      expect(findBundledUi(root)).toEqual({ dir });
    });

    test("una cartella senza index.html non è una build", () => {
      fs.mkdirSync(path.join(root, "ui"));

      expect(findBundledUi(root)).toEqual({ dir: null });
    });
  });

  describe("decisione all'avvio", () => {
    const config = (overrides = {}) => ({ adminApiEnabled: true, uiDistDir: undefined, ...overrides });

    test("admin accesa e build presente: la si serve", () => {
      const dir = writeUi(root, "ui");

      expect(resolveBundledUi({ config: config(), engineRoot: root })).toEqual({ uiDistDir: dir });
    });

    test("UI_DIST_DIR impostata: decide chi configura, non si cerca nulla", () => {
      writeUi(root, "ui");

      expect(resolveBundledUi({ config: config({ uiDistDir: "/altrove" }), engineRoot: root })).toEqual({ uiDistDir: undefined });
    });

    test("admin spenta: senza API l'interfaccia non serve, e non se ne parla", () => {
      writeUi(root, "ui");

      expect(resolveBundledUi({ config: config({ adminApiEnabled: false }), engineRoot: root })).toEqual({ uiDistDir: undefined });
    });

    test("nessuna build: si dice come ottenerla", () => {
      const resolved = resolveBundledUi({ config: config(), engineRoot: root });

      expect(resolved.uiDistDir).toBeUndefined();
      expect(resolved.hint).toContain("npm run build:ui");
      expect(resolved.hint).toContain("npm run dev:frontend");
    });

    test("build per un altro percorso base: si dice di rifarla", () => {
      const dir = writeUi(root, BUILD_LOCATION, "/");

      const resolved = resolveBundledUi({ config: config(), engineRoot: root });

      expect(resolved.uiDistDir).toBeUndefined();
      expect(resolved.hint).toContain(dir);
      expect(resolved.hint).toContain('base path "/"');
      expect(resolved.hint).toContain("npm run build:ui");
    });
  });

  // L'avvio vero, come lo fa chi usa il motore senza app desktop. La radice del motore è una
  // cartella di prova: index.js copiato, `src` collegato a quello del repository, e accanto la
  // build finta. Così l'esito non dipende da cosa c'è nel clone di chi esegue i test.
  describe("node index.js", () => {
    let engine;

    afterEach(() => {
      if (engine && engine.exitCode === undefined) {
        engine.child.kill("SIGKILL");
      }
      engine = null;
    });

    function prepareEngineRoot() {
      fs.copyFileSync(path.join(REPO_ROOT, "index.js"), path.join(root, "index.js"));
      // "junction" su Windows non richiede privilegi; altrove è un normale collegamento.
      fs.symlinkSync(path.join(REPO_ROOT, "src"), path.join(root, "src"), "junction");
    }

    function freePort() {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address();
          server.close(() => resolve(port));
        });
      });
    }

    async function startEngine(extraEnv = {}) {
      const port = await freePort();
      const state = { output: "", exitCode: undefined, child: null, port };
      engine = state;
      const env = {
        ...process.env,
        NODE_ENV: "development",
        PORT: String(port),
        HOST: "127.0.0.1",
        MOCKS_DIR: path.join(root, "mocks"),
        FILES_DIR: path.join(root, "files"),
        MONITOR_DUMP_DIR: path.join(root, "dump"),
        BACKEND_URL: "",
        DEV_WATCH: "false",
        LOG_LEVEL: "info",
        ...extraEnv,
      };
      delete env.UI_DIST_DIR;
      delete env.ADMIN_API_ENABLED;
      Object.assign(env, extraEnv);
      state.child = spawn(process.execPath, ["index.js"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
      state.child.stdout.on("data", (chunk) => {
        state.output += chunk;
      });
      state.child.stderr.on("data", (chunk) => {
        state.output += chunk;
      });
      state.child.on("exit", (code, signal) => {
        state.exitCode = signal || code;
      });
      await waitFor(() => state.output.includes("Mockxy started."), 15000, 50);
      return state;
    }

    function get(port, requestPath) {
      return new Promise((resolve) => {
        http
          .get({ host: "127.0.0.1", port, path: requestPath }, (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] || "", body }));
          })
          .on("error", (error) => resolve({ status: null, error: error.code }));
      });
    }

    const logLines = (state) =>
      state.output
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line));

    test("con la build accanto al motore l'interfaccia risponde sotto /_admin/ui/, e il log dice dove", async () => {
      prepareEngineRoot();
      writeUi(root, "ui");

      const state = await startEngine();
      const index = await get(state.port, "/_admin/ui/");
      const deepLink = await get(state.port, "/_admin/ui/monitor");
      const asset = await get(state.port, "/_admin/ui/main.js");

      expect(index.status).toBe(200);
      expect(index.type).toContain("text/html");
      expect(index.body).toContain("interfaccia di prova");
      // Una rotta dell'interfaccia ricaricata a mano torna index.html.
      expect(deepLink.status).toBe(200);
      expect(deepLink.body).toContain("interfaccia di prova");
      expect(asset.status).toBe(200);
      await waitFor(() => state.output.includes("Web interface available."), 5000, 50);
      const announcement = logLines(state).find((line) => line.msg === "Web interface available.");
      expect(announcement.url).toBe(`http://127.0.0.1:${state.port}/_admin/ui/`);
    }, 30000);

    test("senza build l'interfaccia non c'è, e il log dice come ottenerla", async () => {
      prepareEngineRoot();

      const state = await startEngine();
      const index = await get(state.port, "/_admin/ui/");

      // Nessun backend configurato: la richiesta, non essendo dell'interfaccia, cade lì.
      expect(index.status).toBe(501);
      await waitFor(() => state.output.includes("npm run build:ui"), 5000, 50);
      expect(state.output).not.toContain("Web interface available.");
    }, 30000);

    test("con l'admin spenta la build accanto al motore non viene servita", async () => {
      prepareEngineRoot();
      writeUi(root, "ui");

      const state = await startEngine({ NODE_ENV: "production" });
      const index = await get(state.port, "/_admin/ui/");

      expect(index.status).not.toBe(200);
      expect(state.output).not.toContain("Web interface available.");
      expect(state.output).not.toContain("npm run build:ui");
    }, 30000);

    test("UI_DIST_DIR continua a comandare, anche con una build accanto al motore", async () => {
      prepareEngineRoot();
      writeUi(root, "ui");
      const explicit = writeUi(root, "altrove");

      const state = await startEngine({ UI_DIST_DIR: explicit });
      const index = await get(state.port, "/_admin/ui/");

      expect(index.status).toBe(200);
      expect(index.body).toContain("altrove");
    }, 30000);
  });
});
