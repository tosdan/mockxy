const { test, expect } = require("@playwright/test");
const { gotoMocks, mockIdByPath, E2E_BACKEND, reloadStable } = require("./helpers");

// E4 — response multiple: il selettore del titolo cambia body e status mostrati, e la scelta
// persiste sul backend (scrive selectedResponseFile nell'endpoint.json). Primo test di SCRITTURA:
// l'afterEach ripristina la response di default via API (deterministico, a prova di fail).
test.describe("E4 · response multiple", () => {
  let catalog;
  let detail;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    detail = page.locator("mocks-next-detail");
    await catalog.getByText("/api/status", { exact: true }).click();
    await expect(detail.getByRole("heading", { name: "/api/status", exact: true })).toBeVisible();
  });

  test.afterEach(async ({ request }) => {
    // Ripristina la prima response come selezionata, così lo stato torna alle fixture.
    const id = await mockIdByPath(request, "/api/status");
    if (id) {
      await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}`, {
        data: { selectedResponseFile: "001.response.json" },
      });
    }
  });

  // Trigger del selettore titolo (l'unico <ui-select> nel dettaglio in modalità vista).
  const responseTrigger = () => detail.locator("ui-select").getByRole("combobox");

  async function pickResponse(page, name) {
    await responseTrigger().click();
    await page.getByRole("option", { name }).click();
  }

  test("all'apertura mostra la response di default (OK, 200)", async () => {
    await expect(detail.getByText(/200/).first()).toBeVisible();
    await expect(detail.getByText(/not found/)).toHaveCount(0);
  });

  test("il selettore elenca entrambe le response", async ({ page }) => {
    await responseTrigger().click();
    await expect(page.getByRole("option", { name: /OK/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Non trovato/ })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("cambiando response, status e body si aggiornano e tornano indietro", async ({ page }) => {
    // → seconda response (Non trovato, 404)
    await pickResponse(page, /Non trovato/);
    await expect(detail.getByText(/404/).first()).toBeVisible();
    await expect(detail.getByText(/not found/)).toBeVisible();

    // ← ritorno alla prima (OK, 200): copre entrambe le direzioni e ripristina
    await pickResponse(page, /OK/);
    await expect(detail.getByText(/200/).first()).toBeVisible();
    await expect(detail.getByText(/not found/)).toHaveCount(0);
  });

  test("la scelta della response persiste sul backend dopo un reload", async ({ page }) => {
    await pickResponse(page, /Non trovato/);
    await expect(detail.getByText(/not found/)).toBeVisible();

    // reload completo: lo stato viene riletto dal disco, non dalla memoria
    await reloadStable(page);
    await catalog.getByText("/api/status", { exact: true }).click();
    await expect(detail.getByRole("heading", { name: "/api/status", exact: true })).toBeVisible();
    await expect(detail.getByText(/not found/)).toBeVisible(); // 404 persistito
    await expect(detail.getByText(/404/).first()).toBeVisible();
  });
});
