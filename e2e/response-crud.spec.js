const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace, reloadStable } = require("./helpers");

// E6 — CRUD response: creare (mock/handler), modificare status e headers, eliminare; ogni
// operazione con round-trip UI→backend. Scrittura pesante: l'afterEach ripristina l'intera run dir
// dalle fixture e attende il reload del backend.
test.describe("E6 · CRUD response", () => {
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

  const select = (p) => catalog.getByText(p, { exact: true }).click();
  const addBtn = () => detail.locator('button[ui-button]:has(ng-icon[name="lucidePlus"])').first();
  const editBtn = () => detail.locator('button[ui-button]:has(ng-icon[name="lucidePencil"])');
  const saveBtn = () => detail.getByRole("button", { name: "Salva", exact: true });

  // Numero di response = numero di opzioni nel selettore titolo (aperto → conta → chiude).
  async function expectResponseOptions(page, n) {
    await detail.locator("ui-select").getByRole("combobox").click();
    await expect(page.getByRole("option")).toHaveCount(n);
    await page.keyboard.press("Escape");
  }

  test("crea una nuova response mock e la seleziona", async ({ page }) => {
    await select("/api/health");
    await addBtn().click();
    await page.getByRole("menuitem", { name: "Nuova response mock", exact: true }).click();
    await detail.getByPlaceholder(/Titolo della response/).fill("E2E mock");
    await saveBtn().click();

    await expect(detail.getByText(/E2E mock/)).toBeVisible();
    await expectResponseOptions(page, 2);
  });

  test("crea una nuova response handler con la sorgente template", async ({ page }) => {
    await select("/api/health");
    await addBtn().click();
    await page.getByRole("menuitem", { name: "Nuova response handler", exact: true }).click();
    await detail.getByPlaceholder(/Titolo della response/).fill("E2E handler");
    await saveBtn().click();

    await expect(detail.getByText(/E2E handler/)).toBeVisible();
    await expect(detail.getByText(/resolveResponse/)).toBeVisible();
    await expectResponseOptions(page, 2);
  });

  test("modifica lo status di una response e persiste dopo reload", async ({ page }) => {
    await select("/api/health");
    await editBtn().click();
    await detail.locator("mocks-next-status-combobox input").fill("418");
    await saveBtn().click();

    await expect(detail.getByText(/418/).first()).toBeVisible();

    // Persistenza: reload, riseleziona, lo status è ancora 418 (scritto su disco).
    await reloadStable(page);
    await select("/api/health");
    await expect(detail.getByText(/418/).first()).toBeVisible();
  });

  test("aggiunge un header alla response e lo mostra in vista", async ({ page }) => {
    await select("/api/health");
    await editBtn().click();
    await detail.getByRole("button", { name: "Aggiungi header" }).click();
    // Su un input Angular appena renderizzato, `fill` (un solo evento) può arrivare prima che
    // l'handler sia agganciato e venire perso, con un re-render che azzera il campo (flaky).
    // `pressSequentially` digita carattere per carattere: ogni tasto aggiorna il signal. Il combobox
    // del nome apre un dropdown di suggerimenti → Escape prima di salvare. Assert = sync point.
    const headerValue = detail.getByPlaceholder(/Valore/).last();
    await headerValue.click();
    await headerValue.pressSequentially("presente");
    await expect(headerValue).toHaveValue("presente");
    const headerName = detail.locator("mocks-next-header-combobox input").last();
    await headerName.click();
    await headerName.pressSequentially("x-e2e");
    await headerName.press("Escape");
    await saveBtn().click();

    await expect(detail.getByText("x-e2e")).toBeVisible();
    await expect(detail.getByText("presente")).toBeVisible();
  });

  test("elimina una response da un endpoint che ne ha due", async ({ page }) => {
    await select("/api/status");
    await expectResponseOptions(page, 2);

    // Cestino della response (icon-only, distinto dall'"Elimina" endpoint che ha testo).
    await detail
      .locator('button[ui-button]:has(ng-icon[name="lucideTrash2"])')
      .filter({ hasNotText: /\w/ })
      .click();
    // La conferma inline è apparsa nella toolbar response.
    await expect(detail.getByText(/Eliminare la response/)).toBeVisible();
    // "Elimina" della conferma (nel div che contiene anche "Annulla"), non quello dell'endpoint.
    await detail
      .locator('div:has(> button:has-text("Annulla"))')
      .getByRole("button", { name: "Elimina", exact: true })
      .click();

    await expectResponseOptions(page, 1);
  });
});
