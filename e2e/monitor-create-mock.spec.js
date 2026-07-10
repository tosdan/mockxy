const { test, expect } = require("@playwright/test");
const { gotoMonitor, clearMonitor, resetWorkspace, E2E_BACKEND } = require("./helpers");

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

    // Il mock è stato scritto su disco: navigo al catalogo (via view-switcher, non gotoMocks che
    // attende 8 endpoint) e verifico che compaia (8 → 9).
    await monitor.getByRole("button", { name: "Cambia vista" }).click();
    await page.getByRole("menuitem", { name: "Catalogo" }).click();
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("/api/catturato-e2e", { exact: true })).toBeVisible();
    await expect(catalog.getByText(/9\s+endpoint/)).toBeVisible();
  });
});
