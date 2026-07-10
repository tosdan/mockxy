const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace } = require("./helpers");

// E13 — robustezza: un'operazione rifiutata dal backend (409 su metodo+path già esistente) produce
// un feedback visibile (toast + errore inline nel dialog) e NON altera lo stato. Le creazioni
// falliscono, quindi lo stato resta quello delle fixture; afterEach reset per sicurezza.
test.describe("E13 · robustezza ed errori", () => {
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

  test("creare un endpoint con metodo+path già esistente mostra un errore e non lo crea", async ({ page }) => {
    await page.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Mock", exact: true }).click();
    // GET /api/health esiste già nelle fixture → il backend rifiuta con 409.
    await page.getByPlaceholder("/es/risorsa/:id").fill("/api/health");
    await page.getByRole("button", { name: "Crea", exact: true }).click();

    const dialog = page.locator("cdk-dialog-container");
    // Creazione fallita: il dialog resta aperto con l'errore inline, e appare il toast d'errore.
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".text-destructive-soft")).toBeVisible();
    await expect(page.locator("ui-toaster").getByText("Errore")).toBeVisible();

    // Nessun endpoint creato: il catalogo resta a 8.
    await dialog.getByRole("button", { name: "Annulla" }).click();
    await expect(catalog.getByText(/8\s+endpoint/)).toBeVisible();
  });

  test("copiare un endpoint verso un path esistente mostra un errore", async ({ page }) => {
    await catalog.getByText("/api/users", { exact: true }).click();
    await detail.getByRole("button", { name: "Copia", exact: true }).click();

    const dialog = page.locator("cdk-dialog-container");
    await expect(dialog).toBeVisible();
    // GET /api/health esiste già → la copia (stesso metodo GET dell'origine) va in conflitto.
    await dialog.locator("input[ui-input]").fill("/api/health");
    await dialog.getByRole("button", { name: "Copia", exact: true }).click();

    // Errore: dialog ancora aperto + toast.
    await expect(dialog).toBeVisible();
    await expect(page.locator("ui-toaster").getByText("Errore")).toBeVisible();

    await dialog.getByRole("button", { name: "Annulla" }).click();
    await expect(catalog.getByText(/8\s+endpoint/)).toBeVisible();
  });
});
