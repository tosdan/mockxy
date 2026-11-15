// Processo figlio di test/backend-tls.test.js: le CA di cui Node si fida si decidono all'avvio
// del processo (NODE_EXTRA_CA_CERTS, archivio di sistema), quindi ogni combinazione va provata
// in un processo suo. Avvia un backend https con il certificato di prova, il motore davanti, fa
// una richiesta e stampa lo status ricevuto.
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { startServer } = require("../../../src/server");

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

(async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "mockxy-tls-child-"));
  const backend = https.createServer(
    {
      key: fs.readFileSync(path.join(__dirname, "server.key")),
      cert: fs.readFileSync(path.join(__dirname, "server.pem")),
    },
    (_req, res) => res.end("ok")
  );
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const runtime = await startServer({
    configOverrides: {
      port: 0,
      host: "127.0.0.1",
      backendUrl: `https://localhost:${backend.address().port}`,
      mocksDir: workDir,
      monitorDumpDir: workDir,
      devWatch: false,
      adminApiEnabled: false,
    },
    logger: silentLogger,
  });
  if (!runtime.server.listening) {
    await new Promise((resolve) => runtime.server.once("listening", resolve));
  }
  const status = await new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: runtime.server.address().port, path: "/users" }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      })
      .on("error", reject);
  });
  await runtime.shutdown();
  await new Promise((resolve) => backend.close(resolve));
  fs.rmSync(workDir, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ status }));
  process.exit(0);
})().catch((error) => {
  process.stderr.write(String(error?.stack || error));
  process.exit(1);
});
