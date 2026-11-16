const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoMocks, mockIdByPath, reloadStable, E2E_BACKEND } = require("./helpers");

// Stato temporaneo: dal pulsante con l'orologio un endpoint si accende, si spegne o serve
// un'altra variante per la sessione in corso. Il motore risponde subito in modo diverso, ma i
// file del workspace restano com'erano: è la differenza con interruttore e tendina, che salvano.
//
// Le fixture usate: /api/legacy è salvato spento (410 se acceso), /api/status è acceso con due
// varianti (001 «OK» 200, selezionata; 002 «Non trovato» 404).
const ACTIVATION = `${E2E_BACKEND}/_admin/api/activation`;
const RUN_MOCKS = path.resolve(__dirname, "..", "workspace-test", ".run", "mocks");

/** Il file endpoint così com'è su disco: ciò che finirebbe in un commit. */
function savedEndpoint(folder) {
  return JSON.parse(fs.readFileSync(path.join(RUN_MOCKS, "api", folder, "GET.endpoint.json"), "utf8"));
}

test.describe("stato temporaneo", () => {
  let catalog;
  let detail;
  let statusBar;

  const row = (routePath) => catalog.locator('[role="treeitem"]').filter({ hasText: routePath });
  const badge = (routePath) => row(routePath).locator("[data-temporary]");
  const indicator = () => statusBar.locator("[data-activation-indicator]");
  const statusOf = async (request, routePath) => (await request.get(`${E2E_BACKEND}${routePath}`)).status();

  async function openEndpoint(routePath) {
    await catalog.getByText(routePath, { exact: true }).click();
    await expect(detail.getByRole("heading", { name: routePath, exact: true })).toBeVisible();
  }

  async function pickFromTemporaryMenu(page, name) {
    await detail.locator("[data-temporary-menu]").click();
    await page.getByRole("menuitem", { name }).click();
  }

  async function restore(request) {
    await request.delete(ACTIVATION);
    const id = await mockIdByPath(request, "/api/status");
    if (id) {
      await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}`, { data: { selectedResponseFile: "001.response.json" } });
    }
  }

  test.beforeEach(async ({ page, request }) => {
    await restore(request);
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    detail = page.locator("mocks-next-detail");
    statusBar = page.locator("app-status-bar");
  });

  test.afterEach(async ({ request }) => {
    await restore(request);
  });

  test("accendere temporaneamente un endpoint spento lo fa rispondere, e il file resta spento", async ({ page, request }) => {
    expect(await statusOf(request, "/api/legacy")).not.toBe(410);
    await openEndpoint("/api/legacy");
    await expect(indicator()).toHaveCount(0);

    await pickFromTemporaryMenu(page, "Accendi temporaneamente");

    await expect(badge("/api/legacy")).toHaveText("TEMP ON");
    await expect(detail.locator("[data-temporary-state]")).toHaveText("acceso");
    await expect(indicator()).toContainText("1 endpoint in stato temporaneo");
    await expect.poll(() => statusOf(request, "/api/legacy")).toBe(410);

    // Ciò che è salvato non è cambiato: né il file, né l'interruttore che lo rappresenta.
    expect(savedEndpoint("legacy").enabled).toBe(false);
    await expect(detail.getByRole("switch", { name: "Endpoint attivo" })).not.toBeChecked();

    // Vive nel motore, non nella pagina: ricaricando lo si ritrova.
    await reloadStable(page);
    await expect(badge("/api/legacy")).toHaveText("TEMP ON");
    await expect(indicator()).toContainText("1 endpoint in stato temporaneo");
  });

  test("servire temporaneamente un'altra variante, poi tornare a come è salvato", async ({ page, request }) => {
    await openEndpoint("/api/status");

    await pickFromTemporaryMenu(page, /Non trovato/);

    // Nessun ON/OFF: l'accensione è quella salvata, di temporaneo c'è solo la variante.
    await expect(badge("/api/status")).toHaveText("TEMP");
    await expect(detail.locator("[data-temporary-state]")).toHaveText("002.response.json");
    await expect.poll(() => statusOf(request, "/api/status")).toBe(404);
    expect(savedEndpoint("status").selectedResponseFile).toBe("001.response.json");

    await pickFromTemporaryMenu(page, "Torna a come è salvato");

    await expect(badge("/api/status")).toHaveCount(0);
    await expect(indicator()).toHaveCount(0);
    await expect.poll(() => statusOf(request, "/api/status")).toBe(200);
  });

  test("uno scenario impostato via API compare da solo, e «Azzera» lo toglie tutto", async ({ request }) => {
    await expect(indicator()).toHaveCount(0);

    // Come farebbe un test end-to-end nella sua preparazione: la pagina è già aperta e non
    // viene ricaricata.
    const put = await request.put(ACTIVATION, {
      data: {
        items: [
          { method: "GET", path: "/api/legacy", enabled: true },
          { method: "GET", path: "/api/status", enabled: false },
        ],
      },
    });
    expect(put.ok()).toBe(true);

    await expect(indicator()).toContainText("2 endpoint in stato temporaneo");
    await expect(badge("/api/legacy")).toHaveText("TEMP ON");
    await expect(badge("/api/status")).toHaveText("TEMP OFF");

    await indicator().getByRole("button", { name: "Azzera" }).click();

    await expect(indicator()).toHaveCount(0);
    await expect(catalog.locator("[data-temporary]")).toHaveCount(0);
    expect((await (await request.get(ACTIVATION)).json()).items).toEqual([]);
    expect(await statusOf(request, "/api/status")).toBe(200);
  });

  test("selezionare la variante dalla tendina salva, e lo stato temporaneo di quel campo decade", async ({ page, request }) => {
    await openEndpoint("/api/status");
    await pickFromTemporaryMenu(page, /Non trovato/);
    await expect(badge("/api/status")).toHaveText("TEMP");
    expect(savedEndpoint("status").selectedResponseFile).toBe("001.response.json");

    // La tendina del titolo è il gesto che salva: la stessa variante, stavolta nel file.
    await detail.locator("ui-select").getByRole("combobox").click();
    await page.getByRole("option", { name: /Non trovato/ }).click();

    await expect(badge("/api/status")).toHaveCount(0);
    await expect(indicator()).toHaveCount(0);
    await expect.poll(() => savedEndpoint("status").selectedResponseFile).toBe("002.response.json");
    expect(await statusOf(request, "/api/status")).toBe(404);
  });

  // Il menu delle impostazioni esiste solo nell'app desktop: qui il ponte di Electron è simulato
  // quanto basta ad aprire la finestra. Non si salva nulla: si guarda solo l'avviso.
  test("le impostazioni del workspace avvisano che il riavvio elimina lo stato temporaneo", async ({ page, request }) => {
    await request.put(ACTIVATION, { data: { items: [{ method: "GET", path: "/api/legacy", enabled: true }] } });
    await page.addInitScript(() => {
      const workspace = {
        root: "/tmp/ws", name: "Demo", title: null, port: 3000, backendUrl: "http://localhost:8080", host: "127.0.0.1",
        caseInsensitiveFilters: false, proxyFallbackEnabled: true, corsEnabled: true, adaptProxyCookies: true,
        rewriteProxyRedirects: true, verifyBackendCertificate: true, globalDelayMs: 0, delayAllRequests: false, requestTimeoutMs: 30000,
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
    await expect(indicator()).toContainText("1 endpoint in stato temporaneo");

    await page.getByRole("button", { name: "Impostazioni e preferenze" }).click();
    await page.getByRole("menuitem", { name: "Impostazioni workspace" }).click();
    const dialog = page.getByRole("dialog", { name: "Impostazioni workspace", exact: true });
    const warning = dialog.locator('[data-restart-drops="activation"]');
    await expect(dialog).toBeVisible();
    await expect(warning).toHaveCount(0);

    // Il titolo non riavvia il motore: nessun avviso.
    await dialog.getByLabel("Titolo", { exact: true }).fill("Negozio");
    await expect(warning).toHaveCount(0);

    await dialog.getByLabel("Timeout backend (ms)", { exact: true }).fill("20000");
    await expect(warning).toHaveText("Salvando, il motore riparte: l'endpoint in stato temporaneo torna a come è salvato.");

    await dialog.getByRole("button", { name: "Chiudi", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
});
