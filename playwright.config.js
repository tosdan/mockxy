const { defineConfig, devices } = require("@playwright/test");
const { E2E_PORT, E2E_BACKEND } = require("./e2e/backend-url");

// Config e2e: UN SOLO processo — il backend Node (:3101) serve sia l'API sia la UI compilata sotto
// /_admin/ui (UI_DIST_DIR), come l'app desktop. Niente `ng serve`, niente proxy.
//
// Perché non `ng serve`: collassa intermittentemente (~1 run su 3) durante i run lunghi su Windows,
// indipendentemente da reuse/cleanup — misurato, vedi docs/sviluppo/E2E-ARCHITETTURA-SERVER.md. Il backend `node`
// diretto è stabile e Playwright lo termina pulitamente (nessun orfano). `test:e2e` fa `ng build`
// prima di lanciare Playwright; la UI si apre su /_admin/ui/mocks.
module.exports = defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // I test di scrittura verificano lo stato dopo un update ottimistico + reload async: nel contesto
  // di un run completo il timing è variabile e ~1-2 test/run colgono uno stato transitorio (flaky
  // di timing, non bug). retries è la risposta standard: un test che passa al retry è timing.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 30000,
  expect: { timeout: 8000 },
  use: {
    baseURL: E2E_BACKEND,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node e2e/start-backend.js",
    url: `${E2E_BACKEND}/_admin/api/mocks`,
    env: {
      PORT: String(E2E_PORT),
      HOST: "127.0.0.1",
      MOCKS_DIR: "workspace-test/.run/mocks",
      MONITOR_DUMP_DIR: "workspace-test/.run/dump",
      FILES_DIR: "workspace-test/.run/files",
      UI_DIST_DIR: "mockxy-ui/dist/mockxy-ui/browser",
      ADMIN_API_ENABLED: "true",
      NODE_ENV: "development",
      DEV_WATCH: "true",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
