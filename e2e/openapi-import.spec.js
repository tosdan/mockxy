const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace } = require("./helpers");

// E11 — import OpenAPI: apertura dialog, anteprima (dryRun), import, comparsa nel catalogo.
// Scrittura: l'import crea endpoint → afterEach = resetWorkspace (li rimuove).
test.describe("E11 · import OpenAPI", () => {
  let catalog;

  // Spec minima con 2 path non presenti nelle fixture (→ 2 da creare).
  const SPEC = JSON.stringify({
    openapi: "3.0.0",
    info: { title: "E2E import", version: "1.0.0" },
    paths: {
      "/e2e/imported": { get: { responses: { "200": { description: "ok" } } } },
      "/e2e/altro": { post: { responses: { "201": { description: "created" } } } },
    },
  });

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  async function openDialogAndLoadSpec(page) {
    await page.getByRole("button", { name: "Importa OpenAPI" }).click();
    const dialog = page.locator("cdk-dialog-container");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "spec.json",
      mimeType: "application/json",
      buffer: Buffer.from(SPEC),
    });
    return dialog;
  }

  test("l'anteprima elenca gli endpoint da creare senza importarli", async ({ page }) => {
    const dialog = await openDialogAndLoadSpec(page);

    // Anteprima (dryRun): i due percorsi compaiono con azione "Da creare".
    await expect(dialog.getByText("/e2e/imported")).toBeVisible();
    await expect(dialog.getByText("/e2e/altro")).toBeVisible();
    await expect(dialog.getByText("Da creare").first()).toBeVisible();

    // Annulla: nulla è stato creato nel catalogo.
    await dialog.getByRole("button", { name: "Annulla" }).click();
    await expect(catalog.getByText("/e2e/imported", { exact: true })).toHaveCount(0);
    await expect(catalog.getByText(/8\s+endpoint/)).toBeVisible();
  });

  test("importa gli endpoint e compaiono nel catalogo", async ({ page }) => {
    const dialog = await openDialogAndLoadSpec(page);
    await expect(dialog.getByText("/e2e/imported")).toBeVisible();

    // Il pulsante Importa riporta il numero da creare.
    await dialog.getByRole("button", { name: /Importa/ }).click();

    // Il dialog si chiude e i due endpoint compaiono nel catalogo (8 → 10).
    await expect(catalog.getByText("/e2e/imported", { exact: true })).toBeVisible();
    await expect(catalog.getByText("/e2e/altro", { exact: true })).toBeVisible();
    await expect(catalog.getByText(/10\s+endpoint/)).toBeVisible();
  });
});
