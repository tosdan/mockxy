const { test, expect } = require("@playwright/test");
const { gotoMocks } = require("./helpers");

// E14 — i18n e navigazione tra le viste. Sola lettura (stato UI/localStorage): il test lingua
// ripristina IT alla fine; gotoMocks rifissa comunque IT a ogni beforeEach.
test.describe("E14 · i18n e viste", () => {
  let catalog;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
  });

  test("cambia lingua IT→EN e i testi si aggiornano, poi torna a IT", async ({ page }) => {
    await expect(catalog.getByText(/attivi/)).toBeVisible(); // IT di partenza

    await page.getByRole("button", { name: "Lingua" }).click();
    await page.getByRole("menuitem", { name: "English" }).click();

    // Il footer passa a EN ("active") e l'italiano sparisce.
    await expect(catalog.getByText(/active/)).toBeVisible();
    await expect(catalog.getByText(/attivi/)).toHaveCount(0);

    // Ritorno a IT (in EN l'aria-label del pulsante è "Language").
    await page.getByRole("button", { name: "Language" }).click();
    await page.getByRole("menuitem", { name: "Italiano" }).click();
    await expect(catalog.getByText(/attivi/)).toBeVisible();
  });

  test("naviga da Catalogo a Monitor e ritorna", async ({ page }) => {
    await page.getByRole("button", { name: "Cambia vista" }).click();
    await page.getByRole("menuitem", { name: "Monitor" }).click();
    await expect(page).toHaveURL(/\/monitor/);

    await page.getByRole("button", { name: "Cambia vista" }).click();
    await page.getByRole("menuitem", { name: "Catalogo" }).click();
    await expect(page).toHaveURL(/\/mocks/);
    await expect(catalog.getByText(/8\s+endpoint/)).toBeVisible();
  });

  test("naviga da Catalogo a Storico dump e ritorna", async ({ page }) => {
    await page.getByRole("button", { name: "Cambia vista" }).click();
    await page.getByRole("menuitem", { name: "Storico" }).click();
    await expect(page).toHaveURL(/\/storico/);

    await page.getByRole("button", { name: "Cambia vista" }).click();
    await page.getByRole("menuitem", { name: "Catalogo" }).click();
    await expect(page).toHaveURL(/\/mocks/);
  });
});
