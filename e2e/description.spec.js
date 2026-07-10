const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace, reloadStable } = require("./helpers");

// E8 — descrizione endpoint: modifica inline con salva (Enter/✓) e annulla (Esc/✗), persistenza.
// Scrittura (updateEndpoint): l'afterEach ripristina le fixture.
test.describe("E8 · descrizione endpoint", () => {
  let catalog;
  let detail;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    detail = page.locator("mocks-next-detail");
    await catalog.getByText("/api/health", { exact: true }).click();
    await expect(detail.getByText("Liveness check")).toBeVisible();
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  // Matita descrizione = button "plain" (non ui-button, così è distinta da quella della response).
  const editDescription = () => detail.locator('button:not([ui-button]):has(ng-icon[name="lucidePencil"])');
  const descriptionInput = () => detail.getByPlaceholder(/Descrizione endpoint/);

  test("modifica la descrizione e la salva (persiste dopo reload)", async ({ page }) => {
    await editDescription().click();
    await descriptionInput().fill("Descrizione E2E");
    await descriptionInput().press("Enter");

    await expect(detail.getByText("Descrizione E2E")).toBeVisible();
    await expect(detail.getByText("Liveness check")).toHaveCount(0);

    // Persistenza: reload, riseleziona, la nuova descrizione è ancora lì.
    await reloadStable(page);
    await catalog.getByText("/api/health", { exact: true }).click();
    await expect(detail.getByText("Descrizione E2E")).toBeVisible();
  });

  test("annullando con Esc la descrizione resta invariata", async () => {
    await editDescription().click();
    await descriptionInput().fill("Da scartare");
    await descriptionInput().press("Escape");

    await expect(detail.getByText("Liveness check")).toBeVisible();
    await expect(detail.getByText("Da scartare")).toHaveCount(0);
  });

  test("annullando col pulsante ✗ la descrizione resta invariata", async () => {
    await editDescription().click();
    await descriptionInput().fill("Da scartare");
    // pulsante annulla (X) accanto al salva
    await detail.locator('button[ui-button]:has(ng-icon[name="lucideX"])').click();

    await expect(detail.getByText("Liveness check")).toBeVisible();
    await expect(detail.getByText("Da scartare")).toHaveCount(0);
  });

  test("svuotare la descrizione mostra il segnaposto 'Nessuna descrizione'", async ({ page }) => {
    await editDescription().click();
    await descriptionInput().fill("");
    await descriptionInput().press("Enter");

    await expect(detail.getByText("Nessuna descrizione")).toBeVisible();

    await reloadStable(page);
    await catalog.getByText("/api/health", { exact: true }).click();
    await expect(detail.getByText("Nessuna descrizione")).toBeVisible();
  });
});
