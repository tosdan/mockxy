const { test, expect } = require("@playwright/test");
const { gotoMocks, setEndpointEnabled, reloadStable, waitForAdminApiIdle } = require("./helpers");

// E5 — toggle enabled: accendere/spegnere un endpoint dal catalogo o dal dettaglio scrive sul
// backend, aggiorna muted/conteggi, tiene allineati i due pannelli e persiste dopo reload.
// Scrittura: l'afterEach ripristina lo stato delle fixture via API (health attivo, legacy no).
test.describe("E5 · toggle enabled", () => {
  let catalog;
  let detail;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    detail = page.locator("mocks-next-detail");
  });

  test.afterEach(async ({ request }) => {
    await setEndpointEnabled(request, "/api/health", true);
    await setEndpointEnabled(request, "/api/legacy", false);
  });

  const rowSwitch = (path) => catalog.locator(".cdk-drag").filter({ hasText: path }).getByRole("switch");

  test("spegnere un endpoint dal catalogo lo rende muted e abbassa il conteggio attivi", async () => {
    const sw = rowSwitch("/api/health");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(catalog.locator(".mx-muted", { hasText: "/api/health" })).toBeVisible();
    await expect(catalog.getByText(/6\s*\/\s*8\s+attivi/)).toBeVisible();
  });

  test("accendere l'endpoint disabilitato lo toglie da muted e alza il conteggio", async () => {
    const sw = rowSwitch("/api/legacy");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(catalog.locator(".mx-muted", { hasText: "/api/legacy" })).toHaveCount(0);
    await expect(catalog.getByText(/8\s*\/\s*8\s+attivi/)).toBeVisible();
  });

  test("spegnendo dal catalogo, lo switch del dettaglio si allinea", async () => {
    await catalog.getByText("/api/health", { exact: true }).click();
    const detailSwitch = detail.getByRole("switch");
    await expect(detailSwitch).toHaveAttribute("aria-checked", "true");
    await rowSwitch("/api/health").click();
    await expect(detailSwitch).toHaveAttribute("aria-checked", "false");
  });

  test("spegnendo dal dettaglio, la riga del catalogo si allinea (muted + switch)", async ({ page }) => {
    await catalog.getByText("/api/health", { exact: true }).click();
    await detail.getByRole("switch").click();
    await expect(rowSwitch("/api/health")).toHaveAttribute("aria-checked", "false");
    // Il toggle scatena getMock+updateEndpoint+listMocks: attende il reload prima di verificare la
    // classe muted della riga, altrimenti si legge uno stato transitorio (flaky).
    await waitForAdminApiIdle(page);
    await expect(catalog.locator(".mx-muted", { hasText: "/api/health" })).toBeVisible();
  });

  test("il toggle persiste dopo un reload", async ({ page }) => {
    await rowSwitch("/api/health").click();
    await expect(rowSwitch("/api/health")).toHaveAttribute("aria-checked", "false");
    await reloadStable(page);
    await expect(rowSwitch("/api/health")).toHaveAttribute("aria-checked", "false");
  });
});
