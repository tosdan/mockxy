const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace } = require("./helpers");

// E7 — CRUD endpoint: crea via dialog "Nuovo" (mock/handler), elimina dal dettaglio, copia verso
// un nuovo metodo+path. Scrittura: l'afterEach ripristina la run dir dalle fixture.
test.describe("E7 · CRUD endpoint", () => {
  let catalog;
  let detail;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    detail = page.locator("mocks-next-detail");
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  test("crea un nuovo endpoint mock dal dialog Nuovo", async ({ page }) => {
    await page.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Mock", exact: true }).click();
    await page.getByPlaceholder("/es/risorsa/:id").fill("/api/nuovo-mock");
    await page.getByRole("button", { name: "Crea", exact: true }).click();

    await expect(catalog.getByText("/api/nuovo-mock", { exact: true })).toBeVisible();
    await expect(catalog.getByText(/9\s+endpoint/)).toBeVisible();
  });

  test("crea un nuovo endpoint handler dal dialog Nuovo", async ({ page }) => {
    await page.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Handler", exact: true }).click();
    await page.getByPlaceholder("/es/risorsa/:id").fill("/api/nuovo-handler");
    await page.getByRole("button", { name: "Crea", exact: true }).click();

    await expect(catalog.getByText("/api/nuovo-handler", { exact: true })).toBeVisible();
    // appare come handler (tipo etichettato sulla riga)
    await expect(
      catalog.locator(".cdk-drag").filter({ hasText: "/api/nuovo-handler" }).getByText("handler", { exact: true }),
    ).toBeVisible();
  });

  test("elimina un endpoint dal dettaglio", async () => {
    await catalog.getByText("/api/health", { exact: true }).click();
    await detail.getByRole("button", { name: "Elimina", exact: true }).click();
    await expect(detail.getByText(/Eliminare l'endpoint/)).toBeVisible();
    await detail.getByRole("button", { name: "Elimina", exact: true }).click();

    await expect(catalog.getByText("/api/health", { exact: true })).toHaveCount(0);
    await expect(catalog.getByText(/7\s+endpoint/)).toBeVisible();
  });

  test("copia un endpoint verso un nuovo path", async ({ page }) => {
    await catalog.getByText("/api/users", { exact: true }).click();
    // "Copia" esatto: il blocco codice ha un bottone "Copia il codice" da escludere.
    await detail.getByRole("button", { name: "Copia", exact: true }).click();

    const dialog = page.locator("cdk-dialog-container");
    await expect(dialog).toBeVisible();
    await dialog.locator("input[ui-input]").fill("/api/users-copia");
    await dialog.getByRole("button", { name: "Copia", exact: true }).click();

    await expect(catalog.getByText("/api/users-copia", { exact: true })).toBeVisible();
    await expect(catalog.getByText(/9\s+endpoint/)).toBeVisible();
  });
});
