const { defineConfig, devices } = require("@playwright/test");

// Config SOLO PER L'INDAGINE sul collasso di `ng serve` (vedi docs/sviluppo/E2E-ARCHITETTURA-SERVER.md e
// e2e/investigation/). Replica fedelmente l'architettura A dell'epoca dei guasti: backend :3101 +
// `ng serve` :4301 con proxy, retries 0 (segnale grezzo), stessi 61 test (esclusi i 3 spec
// monitor/storico nati DOPO il passaggio all'architettura B: usano percorsi /_admin/ui/*).
// L'unica differenza: ng serve è avviato dal wrapper strumentato che ne osserva morte e memoria.
// La config di produzione della suite resta playwright.config.js (architettura B).

// I percorsi della UI sotto ng serve sono alla radice (/mocks), non /_admin/ui/mocks. La config è
// caricata anche nei worker: l'assegnazione vale per gli helper a runtime.
process.env.E2E_UI_PATH = "/mocks";

module.exports = defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/monitor.spec.js", "**/monitor-create-mock.spec.js", "**/storico-dump.spec.js"],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  timeout: 30000,
  expect: { timeout: 8000 },
  use: {
    baseURL: "http://localhost:4301",
    trace: "off",
    screenshot: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "node e2e/start-backend.js",
      url: "http://localhost:3101/_admin/api/mocks",
      env: {
        PORT: "3101",
        HOST: "127.0.0.1",
        MOCKS_DIR: "workspace-test/.run/mocks",
        MONITOR_DUMP_DIR: "workspace-test/.run/dump",
        ADMIN_API_ENABLED: "true",
        NODE_ENV: "development",
        DEV_WATCH: "true",
      },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "node e2e/investigation/ng-serve-instrumented.js",
      url: "http://localhost:4301",
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
});
