const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { execFile } = require("child_process");
const { startServer } = require("../src/server");
const { classifyUpstreamError } = require("../src/proxy/proxy");
const {
  backendTlsOptions,
  isCertificateError,
  readBackendCertificateAuthorities,
} = require("../src/proxy/backend-tls");
const { createMemoryLogger, createTempDir, removeDir } = require("./helpers");

const FIXTURES = path.join(__dirname, "fixtures", "tls");

// Backend in https: di chi si fida il proxy, e cosa risponde quando non si fida. Il backend di
// prova presenta un certificato firmato da una CA privata che nessun archivio conosce.
describe("backend https: fiducia nel certificato", () => {
  describe("autorità di certificazione", () => {
    test("alle CA di Node si aggiungono quelle del sistema, senza doppioni", () => {
      const asked = [];
      const source = {
        getCACertificates(type) {
          asked.push(type);
          return type === "default" ? ["node-a", "condivisa"] : ["condivisa", "sistema-b"];
        },
      };

      expect(readBackendCertificateAuthorities(source)).toEqual(["node-a", "condivisa", "sistema-b"]);
      expect(asked).toEqual(["default", "system"]);
    });

    test("se il runtime non le sa elencare, o la lettura fallisce, resta il comportamento di Node", () => {
      expect(readBackendCertificateAuthorities({})).toBeUndefined();
      expect(
        readBackendCertificateAuthorities({
          getCACertificates() {
            throw new Error("archivio illeggibile");
          },
        })
      ).toBeUndefined();
    });

    test("su questo runtime l'elenco contiene le CA di sistema", () => {
      const tls = require("tls");
      const authorities = readBackendCertificateAuthorities();

      expect(authorities.length).toBeGreaterThan(0);
      for (const certificate of tls.getCACertificates("system")) {
        expect(authorities).toContain(certificate);
      }
    });
  });

  describe("opzioni della richiesta", () => {
    test("nessuna per un backend http", () => {
      expect(backendTlsOptions({ verifyBackendCertificate: false }, new URL("http://backend"))).toEqual({});
    });

    test("verifica spenta: il certificato non viene controllato", () => {
      expect(backendTlsOptions({ verifyBackendCertificate: false }, new URL("https://backend"))).toEqual({
        rejectUnauthorized: false,
      });
    });

    test("verifica accesa: un contesto con le CA, lo stesso a ogni richiesta", () => {
      const first = backendTlsOptions({}, new URL("https://backend"));
      const second = backendTlsOptions({ verifyBackendCertificate: true }, new URL("https://altro"));

      expect(first.rejectUnauthorized).toBeUndefined();
      expect(first.secureContext).toBeDefined();
      expect(second.secureContext).toBe(first.secureContext);
    });
  });

  test("un certificato rifiutato si distingue da un errore di rete", () => {
    const rejected = Object.assign(new Error("x"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" });

    expect(isCertificateError(rejected)).toBe(true);
    expect(isCertificateError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isCertificateError(null)).toBe(false);
    expect(classifyUpstreamError(rejected)).toBe("certificate_not_verified");
    for (const code of ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"]) {
      expect(classifyUpstreamError(Object.assign(new Error("x"), { code }))).toBe("certificate_not_verified");
    }
  });

  describe("sul motore", () => {
    let mocksDir;
    let backend;
    let runtime;
    let logger;

    beforeEach(async () => {
      mocksDir = await createTempDir("backend-tls-");
      logger = createMemoryLogger();
      backend = https.createServer(
        {
          key: fs.readFileSync(path.join(FIXTURES, "server.key")),
          cert: fs.readFileSync(path.join(FIXTURES, "server.pem")),
        },
        (req, res) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ reached: "https backend", url: req.url }));
        }
      );
      backend.on("upgrade", (_req, socket) => {
        socket.end("HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nx-reached: https backend\r\nconnection: close\r\n\r\n");
      });
      await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
    });

    afterEach(async () => {
      if (runtime) {
        await runtime.shutdown();
        runtime = null;
      }
      await new Promise((resolve) => backend.close(resolve));
      await removeDir(mocksDir);
    });

    async function start(configOverrides = {}) {
      runtime = await startServer({
        configOverrides: {
          port: 0,
          host: "127.0.0.1",
          backendUrl: `https://localhost:${backend.address().port}`,
          mocksDir,
          monitorDumpDir: mocksDir,
          devWatch: false,
          adminApiEnabled: false,
          ...configOverrides,
        },
        logger,
      });
      if (!runtime.server.listening) {
        await new Promise((resolve) => runtime.server.once("listening", resolve));
      }
      return runtime.server.address().port;
    }

    function get(port, requestPath, headers = {}) {
      return new Promise((resolve, reject) => {
        http
          .get({ host: "127.0.0.1", port, path: requestPath, headers }, (res) => {
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null }));
          })
          .on("error", reject);
      });
    }

    const upgradeHeaders = { connection: "Upgrade", upgrade: "websocket" };

    test("CA sconosciuta: 502 che nomina il certificato, non la rete", async () => {
      const port = await start();

      const response = await get(port, "/users");

      expect(response.status).toBe(502);
      expect(response.headers["x-mock-source"]).toBe("backend");
      expect(response.body.error).toBe("Bad Gateway");
      expect(response.body.message).toContain("TLS certificate could not be verified");
      expect(response.body.message).toContain("VERIFY_BACKEND_CERTIFICATE=false");
      expect(response.body.details).toEqual({
        code: "BACKEND_CERTIFICATE_NOT_VERIFIED",
        reason: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      });
      const failure = logger.entries.error.find((entry) => entry.message === "Proxy request failed.");
      expect(failure.fields.errorType).toBe("certificate_not_verified");
    });

    test("CA sconosciuta: anche l'upgrade riceve il 502 che nomina il certificato", async () => {
      const port = await start();

      const response = await get(port, "/live", upgradeHeaders);

      expect(response.status).toBe(502);
      expect(response.body.details.code).toBe("BACKEND_CERTIFICATE_NOT_VERIFIED");
    });

    test("un backend irraggiungibile resta il 502 di sempre", async () => {
      const port = await start({ backendUrl: "https://127.0.0.1:1" });

      const response = await get(port, "/users");

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: "Bad Gateway", message: "Unable to reach upstream backend." });
    });

    test("verifica spenta: la richiesta e l'upgrade arrivano al backend, e l'avvio lo segnala", async () => {
      const port = await start({ verifyBackendCertificate: false });

      const response = await get(port, "/users?x=1");
      const upgrade = await get(port, "/live", upgradeHeaders);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ reached: "https backend", url: "/users?x=1" });
      expect(upgrade.status).toBe(403);
      expect(upgrade.headers["x-reached"]).toBe("https backend");
      expect(
        logger.entries.warn.some((entry) => entry.message.startsWith("Backend certificate verification is off"))
      ).toBe(true);
    });

    test("verifica accesa: nessun avviso all'avvio", async () => {
      await start();

      expect(logger.entries.warn.some((entry) => entry.message.startsWith("Backend certificate verification is off"))).toBe(false);
    });
  });

  // Le CA fidate si fissano all'avvio del processo: ogni caso gira in un processo suo.
  describe("CA conosciuta dal processo", () => {
    function proxyOnce(extraEnv) {
      const env = { ...process.env, ...extraEnv };
      // L'opzione di Node che aggiunge da sé l'archivio di sistema renderebbe il test vuoto.
      delete env.NODE_USE_SYSTEM_CA;
      delete env.NODE_OPTIONS;
      return new Promise((resolve, reject) => {
        execFile(process.execPath, [path.join(FIXTURES, "proxy-once.js")], { env, timeout: 20000 }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`${error.message}\n${stderr}`));
            return;
          }
          resolve(JSON.parse(stdout));
        });
      });
    }

    test("senza la CA il processo figlio riceve 502 (controllo del test)", async () => {
      expect(await proxyOnce({})).toEqual({ status: 502 });
    });

    test("NODE_EXTRA_CA_CERTS continua a valere", async () => {
      expect(await proxyOnce({ NODE_EXTRA_CA_CERTS: path.join(FIXTURES, "ca.pem") })).toEqual({ status: 200 });
    });

    // L'archivio di sistema si può simulare solo dove Node lo legge dai percorsi di OpenSSL.
    const onLinux = process.platform === "linux" ? test : test.skip;
    onLinux("una CA dell'archivio di sistema viene accettata", async () => {
      expect(await proxyOnce({ SSL_CERT_FILE: path.join(FIXTURES, "ca.pem") })).toEqual({ status: 200 });
    });
  });
});
