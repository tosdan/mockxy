const net = require("net");
const { startServer } = require("../src/server");
const {
  backendPathPrefix,
  resolveBackendTarget,
  stripBackendPathPrefix,
  toOriginForm,
} = require("../src/proxy/backend-target");
const {
  createNoopLogger,
  createTempDir,
  removeDir,
  startBackendServer,
  stopBackendServer,
} = require("./helpers");

// Dove finisce una richiesta proxata: sempre sul backend configurato, sotto il percorso di
// BACKEND_URL. Il request-target lo scrive il client, quindi i casi ostili vanno mandati su un
// socket grezzo: un client HTTP li normalizzerebbe prima di spedirli.
describe("destinazione delle richieste proxate", () => {
  describe("resolveBackendTarget", () => {
    const target = (requestTarget, backendUrl) => resolveBackendTarget(requestTarget, backendUrl).href;

    test("backend alla radice: percorso e query passano com'erano", () => {
      expect(target("/users?page=2&q=a%20b", "http://backend:8080")).toBe("http://backend:8080/users?page=2&q=a%20b");
      expect(target("/", "https://backend/")).toBe("https://backend/");
    });

    test("il percorso di BACKEND_URL fa da prefisso, con o senza slash finale", () => {
      expect(target("/users?x=1", "http://backend/gateway/app")).toBe("http://backend/gateway/app/users?x=1");
      expect(target("/users", "http://backend/gateway/app/")).toBe("http://backend/gateway/app/users");
      expect(target("/", "http://backend/gateway/app")).toBe("http://backend/gateway/app/");
    });

    test("il request-target non sceglie mai l'host", () => {
      for (const hostile of [
        "//evil.example/steal",
        "/\\evil.example/steal",
        "\\\\evil.example/steal",
        "http://evil.example/steal",
        "https://user:pw@evil.example:8443/steal",
      ]) {
        expect(resolveBackendTarget(hostile, "http://backend:8080/api").host).toBe("backend:8080");
      }
      // Il doppio slash resta percorso; della forma assoluta sopravvivono percorso e query.
      expect(target("//evil.example/steal", "http://backend:8080")).toBe("http://backend:8080//evil.example/steal");
      expect(target("http://evil.example/steal?a=1", "http://backend:8080/api")).toBe("http://backend:8080/api/steal?a=1");
      expect(target("http://evil.example", "http://backend:8080/api")).toBe("http://backend:8080/api/");
    });

    test("i segmenti .. non risalgono sopra il percorso di BACKEND_URL", () => {
      expect(target("/../../etc", "http://backend/gateway/app")).toBe("http://backend/gateway/app/etc");
      expect(target("/a/%2e%2e/b", "http://backend/gateway/app")).toBe("http://backend/gateway/app/b");
    });

    test("un request-target senza slash iniziale diventa un percorso", () => {
      expect(toOriginForm("*")).toBe("/*");
      expect(toOriginForm("")).toBe("/");
      expect(toOriginForm(undefined)).toBe("/");
    });
  });

  describe("prefisso del backend", () => {
    test("backendPathPrefix: vuoto alla radice o con un URL non interpretabile", () => {
      expect(backendPathPrefix("http://backend")).toBe("");
      expect(backendPathPrefix("http://backend/")).toBe("");
      expect(backendPathPrefix("http://backend/gateway/app/")).toBe("/gateway/app");
      expect(backendPathPrefix("non un url")).toBe("");
    });

    test("stripBackendPathPrefix: toglie il prefisso solo a segmenti interi", () => {
      expect(stripBackendPathPrefix("/gateway/app/home", "/gateway/app")).toBe("/home");
      expect(stripBackendPathPrefix("/gateway/app", "/gateway/app")).toBe("/");
      expect(stripBackendPathPrefix("/gateway/application", "/gateway/app")).toBeNull();
      expect(stripBackendPathPrefix("/altrove", "/gateway/app")).toBeNull();
      expect(stripBackendPathPrefix("/qualsiasi", "")).toBe("/qualsiasi");
    });
  });

  describe("sul motore", () => {
    let mocksDir;
    let backend;
    let other;
    let runtime;
    let seen;

    // Chi riceve la richiesta la registra: host raggiunto, percorso, credenziali arrivate.
    function recordingHandler(name, respond) {
      return (req, res) => {
        seen.push({ reached: name, url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
        if (respond) {
          respond(req, res);
          return;
        }
        res.end(name);
      };
    }

    async function start({ backendPath = "", respond, configOverrides = {} } = {}) {
      backend = await startBackendServer(recordingHandler("backend", respond));
      other = await startBackendServer(recordingHandler("other"));
      for (const { server, name } of [{ server: backend.server, name: "backend" }, { server: other.server, name: "other" }]) {
        server.on("upgrade", (req, socket) => {
          seen.push({ reached: name, url: req.url, upgrade: true });
          socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
        });
      }
      runtime = await startServer({
        configOverrides: {
          port: 0,
          host: "127.0.0.1",
          backendUrl: `${backend.url}${backendPath}`,
          mocksDir,
          monitorDumpDir: mocksDir,
          devWatch: false,
          adminApiEnabled: false,
          ...configOverrides,
        },
        logger: createNoopLogger(),
      });
      if (!runtime.server.listening) {
        await new Promise((resolve) => runtime.server.once("listening", resolve));
      }
      return runtime.server.address().port;
    }

    // Richiesta su socket grezzo: il request-target parte esattamente com'è scritto.
    function rawRequest(port, requestTarget, extraHeaders = []) {
      return new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => {
          socket.write(
            [
              `GET ${requestTarget} HTTP/1.1`,
              "Host: mockxy.test:3199",
              "Cookie: SESSION=secret",
              "Authorization: Bearer tok",
              "Connection: close",
              ...extraHeaders,
              "",
              "",
            ].join("\r\n")
          );
        });
        let data = "";
        socket.on("data", (chunk) => {
          data += chunk;
        });
        socket.on("close", () => {
          const [statusLine, ...headerLines] = data.split("\r\n\r\n")[0].split("\r\n");
          const headers = {};
          for (const line of headerLines) {
            const separator = line.indexOf(":");
            headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
          }
          resolve({ status: Number(statusLine.split(" ")[1]), headers });
        });
        socket.on("error", reject);
      });
    }

    beforeEach(async () => {
      mocksDir = await createTempDir("proxy-target-");
      seen = [];
    });

    afterEach(async () => {
      if (runtime) {
        await runtime.shutdown();
        runtime = null;
      }
      for (const server of [backend, other]) {
        if (server) {
          await stopBackendServer(server.server);
        }
      }
      backend = null;
      other = null;
      await removeDir(mocksDir);
    });

    test("il percorso di BACKEND_URL precede quello richiesto", async () => {
      const port = await start({ backendPath: "/gateway/app" });

      const response = await rawRequest(port, "/users?x=1");

      expect(response.status).toBe(200);
      expect(seen).toEqual([
        { reached: "backend", url: "/gateway/app/users?x=1", cookie: "SESSION=secret", authorization: "Bearer tok" },
      ]);
    });

    test.each([
      ["doppio slash", (otherHost) => `//${otherHost}/steal`, "//OTHER/steal"],
      ["backslash", (otherHost) => `/\\${otherHost}/steal`, "//OTHER/steal"],
      ["forma assoluta", (otherHost) => `http://${otherHost}/steal`, "/steal"],
    ])("%s: la richiesta resta sul backend, con le sue credenziali", async (_label, buildTarget, expectedPath) => {
      const port = await start();
      const otherHost = `127.0.0.1:${other.server.address().port}`;

      const response = await rawRequest(port, buildTarget(otherHost));

      expect(response.status).toBe(200);
      expect(seen).toHaveLength(1);
      expect(seen[0].reached).toBe("backend");
      expect(seen[0].url).toBe(expectedPath.replace("OTHER", otherHost));
    });

    test("anche l'upgrade resta sul backend e sotto il suo percorso", async () => {
      const port = await start({ backendPath: "/gateway/app" });
      const otherHost = `127.0.0.1:${other.server.address().port}`;
      const upgradeHeaders = ["Connection: Upgrade", "Upgrade: websocket"];

      await rawRequest(port, `//${otherHost}/ws`, upgradeHeaders);
      await rawRequest(port, "/live?room=1", upgradeHeaders);

      expect(seen).toEqual([
        { reached: "backend", url: `/gateway/app//${otherHost}/ws`, upgrade: true },
        { reached: "backend", url: "/gateway/app/live?room=1", upgrade: true },
      ]);
    });

    test("l'upgrade verso /_admin in forma assoluta non raggiunge il backend", async () => {
      const port = await start();

      const response = await rawRequest(port, "http://qualsiasi.example/_admin/api/live", [
        "Connection: Upgrade",
        "Upgrade: websocket",
      ]);

      expect(response.status).toBe(404);
      expect(seen).toEqual([]);
    });

    describe("redirect e cookie con un percorso in BACKEND_URL", () => {
      const redirectTo = (location, cookies) => (_req, res) => {
        res.statusCode = 302;
        res.setHeader("Location", typeof location === "function" ? location() : location);
        if (cookies) {
          res.setHeader("Set-Cookie", cookies);
        }
        res.end();
      };

      test("Location assoluto verso il backend: host di Mockxy e prefisso tolto", async () => {
        const port = await start({
          backendPath: "/gateway/app",
          respond: redirectTo(() => `${backend.url}/gateway/app/home?a=1#top`),
        });

        const response = await rawRequest(port, "/login");

        expect(response.headers.location).toBe("http://mockxy.test:3199/home?a=1#top");
      });

      test("Location relativo dalla radice: prefisso tolto", async () => {
        const port = await start({ backendPath: "/gateway/app", respond: redirectTo("/gateway/app/home?next=%2Fgateway%2Fapp") });

        const response = await rawRequest(port, "/login");

        expect(response.headers.location).toBe("/home?next=%2Fgateway%2Fapp");
      });

      test("Location alla radice del prefisso diventa /", async () => {
        const port = await start({ backendPath: "/gateway/app", respond: redirectTo("/gateway/app") });

        expect((await rawRequest(port, "/login")).headers.location).toBe("/");
      });

      test.each([
        ["fuori dal prefisso, relativo", () => "/altra-app/login"],
        ["fuori dal prefisso, assoluto", () => `${backend.url}/altra-app/login`],
        ["stesso inizio ma altro segmento", () => "/gateway/application"],
        ["relativo al percorso corrente", () => "home"],
        ["verso un altro host senza schema", () => "//cdn.example/gateway/app/x"],
        ["verso un host terzo", () => "https://sso.example/gateway/app/auth"],
      ])("Location %s: intatto", async (_label, location) => {
        let sent;
        const port = await start({
          backendPath: "/gateway/app",
          respond: redirectTo(() => {
            sent = location();
            return sent;
          }),
        });

        expect((await rawRequest(port, "/login")).headers.location).toBe(sent);
      });

      test("con rewriteProxyRedirects spento il Location resta quello del backend", async () => {
        const port = await start({
          backendPath: "/gateway/app",
          respond: redirectTo("/gateway/app/home"),
          configOverrides: { rewriteProxyRedirects: false },
        });

        expect((await rawRequest(port, "/login")).headers.location).toBe("/gateway/app/home");
      });

      test("senza percorso in BACKEND_URL i Location relativi non vengono toccati", async () => {
        const port = await start({ respond: redirectTo("/gateway/app/home") });

        expect((await rawRequest(port, "/login")).headers.location).toBe("/gateway/app/home");
      });

      test("Path dei cookie: il prefisso del backend viene tolto", async () => {
        const port = await start({
          backendPath: "/gateway/app",
          respond: (_req, res) => {
            res.setHeader("Set-Cookie", "JSESSIONID=abc; Path=/gateway/app; HttpOnly");
            res.end();
          },
        });

        expect((await rawRequest(port, "/login")).headers["set-cookie"]).toBe("JSESSIONID=abc; Path=/; HttpOnly");
      });

      test.each([
        ["sotto il prefisso", "a=1; path = /gateway/app/area ; HttpOnly", "a=1; path = /area; HttpOnly"],
        ["fuori dal prefisso", "a=1; Path=/altrove", "a=1; Path=/altrove"],
        ["valore che contiene il prefisso", "back=/gateway/app/home; Path=/", "back=/gateway/app/home; Path=/"],
      ])("Path dei cookie %s", async (_label, original, expected) => {
        const port = await start({
          backendPath: "/gateway/app",
          respond: (_req, res) => {
            res.setHeader("Set-Cookie", original);
            res.end();
          },
        });

        expect((await rawRequest(port, "/login")).headers["set-cookie"]).toBe(expected);
      });

      test("con adaptProxyCookies spento il Path resta quello del backend", async () => {
        const port = await start({
          backendPath: "/gateway/app",
          configOverrides: { adaptProxyCookies: false },
          respond: (_req, res) => {
            res.setHeader("Set-Cookie", "JSESSIONID=abc; Path=/gateway/app");
            res.end();
          },
        });

        expect((await rawRequest(port, "/login")).headers["set-cookie"]).toBe("JSESSIONID=abc; Path=/gateway/app");
      });
    });
  });
});
