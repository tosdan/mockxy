const { test, expect } = require("@playwright/test");
const { gotoMocks, gotoMonitor, clearMonitor, E2E_BACKEND } = require("./helpers");

// Le finestre si chiamano come il loro titolo (aria-labelledby) e la X si chiama «Chiudi»: prima
// i dialog del CDK erano senza nome, e la X era un pulsante muto. Sola lettura: le finestre si
// aprono e si chiudono senza salvare.
test.describe("finestre · nome e chiusura", () => {
  // Una finestra si trova per ruolo e nome, e la sua X la chiude.
  async function closesByName(page, name) {
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Chiudi", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }

  test("creazione endpoint: nome, tendina del metodo e campo del path con il loro nome", async ({ page }) => {
    await gotoMocks(page);
    await page.locator("mocks-next-catalog").getByRole("button", { name: /Nuovo/ }).click();
    await page.getByRole("menuitem", { name: "Mock", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nuovo mock", exact: true });
    await expect(dialog.getByRole("combobox", { name: "Metodo" })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Path" })).toBeVisible();
    await closesByName(page, "Nuovo mock");
  });

  test("import OpenAPI", async ({ page }) => {
    await gotoMocks(page);
    await page.locator("mocks-next-catalog").getByRole("button", { name: /Nuovo/ }).click();
    await page.getByRole("menuitem", { name: "Importa OpenAPI" }).click();
    await closesByName(page, "Importa OpenAPI");
  });

  test("sequenza e duplicazione, dal dettaglio", async ({ page }) => {
    await gotoMocks(page);
    const detail = page.locator("mocks-next-detail");
    await detail.getByRole("button", { name: "Aggiungi una variante" }).click();
    await page.getByRole("menuitem", { name: /Sequenza/ }).click();
    await closesByName(page, "Nuova response sequence");

    await detail.getByRole("button", { name: "Duplica in…" }).click();
    await closesByName(page, "Duplica endpoint");
  });

  test("«Il mock esiste già», dal Monitor", async ({ page, request }) => {
    await clearMonitor(request);
    await request.get(`${E2E_BACKEND}/api/health`);
    await gotoMonitor(page);
    const monitor = page.locator("app-monitor-next");
    await monitor.getByRole("option").filter({ hasText: "/api/health" }).first().click();
    await monitor.getByRole("button", { name: "Crea mock da questa" }).click();
    await closesByName(page, "Il mock esiste già");
  });

  // Il menu delle impostazioni esiste solo nell'app desktop: qui il ponte di Electron e' simulato,
  // con quanto basta ad aprire le due finestre.
  test("impostazioni del workspace e preferenze dell'app, con i campi etichettati", async ({ page }) => {
    await page.addInitScript(() => {
      const workspace = {
        root: "/tmp/ws", name: "Demo", title: null, port: 3000, backendUrl: "http://localhost:8080", host: "127.0.0.1",
        caseInsensitiveFilters: false, proxyFallbackEnabled: true, corsEnabled: true, adaptProxyCookies: true,
        rewriteProxyRedirects: true, globalDelayMs: 0, delayAllRequests: false, requestTimeoutMs: 30000,
        monitorDumpIntervalMs: 30000, monitorDumpThreshold: 100, monitorDumpMaxFileBytes: 52428800, monitorDumpMaxTotalBytes: 1073741824,
      };
      window.desktop = {
        isDesktop: true,
        getWorkspace: async () => workspace,
        listWorkspaces: async () => [{ root: workspace.root, name: workspace.name, port: workspace.port, active: true }],
        listRecent: async () => [],
        getAppPreferences: async () => ({ errorLogEnabled: false, logsDir: "/tmp/logs" }),
      };
    });
    await gotoMocks(page);
    const settings = page.getByRole("button", { name: "Impostazioni e preferenze" });

    await settings.click();
    await page.getByRole("menuitem", { name: "Impostazioni workspace" }).click();
    const dialog = page.getByRole("dialog", { name: "Impostazioni workspace", exact: true });
    for (const label of ["Titolo", "Porta", "Backend URL", "Ritardo globale (ms)", "Timeout backend (ms)", "Cadenza flush (ms)", "Soglia flush (voci)", "Dimensione max per file (byte)", "Tetto totale cartella (byte)"]) {
      await expect(dialog.getByLabel(label, { exact: true }), label).toBeVisible();
    }
    await closesByName(page, "Impostazioni workspace");

    await settings.click();
    await page.getByRole("menuitem", { name: "Preferenze dell'app" }).click();
    await closesByName(page, "Preferenze dell'app");
  });
});
