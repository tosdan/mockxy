const { test, expect } = require("@playwright/test");
const { gotoMonitor, clearMonitor, mockIdByPath, resetWorkspace, E2E_BACKEND } = require("./helpers");

// E16 — scenario "cattura → mock" dal Monitor: una richiesta non mockata viene catturata, la si
// seleziona nel monitor e la si converte in un mock, che compare nel catalogo. È uno dei due usi
// centrali di Mockxy. Scrittura: afterEach reset (rimuove il mock creato) + clear monitor.
test.describe("E16 · monitor → crea mock", () => {
  test.beforeEach(async ({ request }) => {
    await clearMonitor(request);
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
    await clearMonitor(request);
  });

  test("converte una richiesta catturata in un mock che compare nel catalogo", async ({ page, request }) => {
    // Richiesta verso un percorso non mockato → catturata come miss.
    await request.get(`${E2E_BACKEND}/api/catturato-e2e`);

    await gotoMonitor(page);
    const monitor = page.locator("app-monitor-next");
    await expect(monitor.getByText("/api/catturato-e2e").first()).toBeVisible();

    // Modalità selezione → spunta la richiesta → crea mock.
    await monitor.getByRole("button", { name: "Seleziona" }).click();
    await monitor.getByText("/api/catturato-e2e").first().click();
    await monitor.getByRole("button", { name: "Crea mock" }).first().click();

    // Feedback di successo.
    await expect(page.locator("ui-toaster").getByText("Mock creati")).toBeVisible();

    // Il mock è stato scritto su disco: navigo al catalogo (dal rail, non con gotoMocks che
    // attende 8 endpoint) e verifico che compaia (8 → 9).
    await page.getByRole("navigation", { name: "Viste" }).getByRole("link", { name: "Catalogo" }).click();
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("/api/catturato-e2e", { exact: true })).toBeVisible();
    await expect(page.locator("app-status-bar").getByText(/9\s+endpoint/)).toBeVisible();
  });

  // Piano agent/API, §13 C7: la creazione la fa il server, e l'attivazione va dichiarata.
  test("senza «Attiva subito» il nuovo endpoint nasce disattivato", async ({ page, request }) => {
    await request.get(`${E2E_BACKEND}/api/preparato-e2e`);
    await gotoMonitor(page);
    const monitor = page.locator("app-monitor-next");
    await monitor.getByText("/api/preparato-e2e").first().click();

    await monitor.getByRole("checkbox", { name: "Attiva subito" }).click();
    await monitor.getByRole("button", { name: "Crea mock da questa" }).click();

    await expect(page.locator("ui-toaster").getByText("Mock creato senza attivarlo")).toBeVisible();
    const id = await mockIdByPath(request, "/api/preparato-e2e");
    const detail = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks/${id}`)).json();
    expect(detail.disabled).toBe(true);
  });

  test("su un endpoint esistente la cattura si aggiunge come variante senza cambiare quella servita", async ({ page, request }) => {
    const id = await mockIdByPath(request, "/api/health");
    const before = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks/${id}`)).json();
    await request.get(`${E2E_BACKEND}/api/health`);

    await gotoMonitor(page);
    const monitor = page.locator("app-monitor-next");
    await monitor.getByText("/api/health").first().click();
    await monitor.getByRole("button", { name: "Crea mock da questa" }).click();
    await page.getByRole("button", { name: "Aggiungi senza attivare" }).click();

    await expect(page.locator("ui-toaster").getByText("Variante aggiunta senza attivarla")).toBeVisible();
    const after = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks/${id}`)).json();
    expect(after.responses).toHaveLength(before.responses.length + 1);
    expect(after.selectedResponseFile).toBe(before.selectedResponseFile);
  });
});
