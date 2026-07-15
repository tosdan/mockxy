const { test, expect } = require("@playwright/test");
const { gotoMocks, gotoDati, clearDataFiles } = require("./helpers");

// E19 — stato delle view preservato navigando: selezione e cartelle del catalogo, file
// selezionato nella pagina Dati. Persistito in localStorage (per-origin), quindi ogni test
// parte comunque pulito: Playwright dà a ciascuno un browser context nuovo.
test.describe("E19 · stato delle view preservato tra le navigazioni", () => {
  test("selezione e cartella collassata del catalogo si ritrovano dopo un giro sul Monitor", async ({ page }) => {
    await gotoMocks(page);
    const catalog = page.locator("mocks-next-catalog");

    // Seleziona un endpoint diverso dal primo e collassa una cartella.
    await catalog.getByText("/api/status", { exact: true }).click();
    await expect(catalog.locator(".mx-selected")).toContainText("/api/status");
    await catalog.getByText("Core API", { exact: true }).click();
    await expect(catalog.getByText("/api/users", { exact: true })).toHaveCount(0);

    // Monitor e ritorno.
    await page.getByRole("button", { name: "Cambia vista" }).click();
    await page.getByRole("menuitem", { name: "Monitor" }).click();
    await expect(page).toHaveURL(/\/monitor/);
    await page.getByRole("button", { name: "Cambia vista" }).click();
    await page.getByRole("menuitem", { name: "Catalogo" }).click();
    await expect(page).toHaveURL(/\/mocks/);

    // Stato ritrovato: stesso selezionato, stessa cartella collassata.
    await expect(catalog.locator(".mx-selected")).toContainText("/api/status");
    await expect(catalog.getByText("Core API", { exact: true })).toBeVisible();
    await expect(catalog.getByText("/api/users", { exact: true })).toHaveCount(0);
  });

  test("il file selezionato nella pagina Dati si ritrova tornando dal Catalogo", async ({ page, request }) => {
    await clearDataFiles(request);
    try {
      await gotoDati(page);
      const dati = page.locator("app-dati");

      // Due file: carica e seleziona esplicitamente il primo (l'upload seleziona l'ultimo).
      for (const name of ["alfa.json", "beta.json"]) {
        await dati.locator('input[type="file"]').setInputFiles({
          name,
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify([{ file: name }])),
        });
        await expect(dati.getByText(name.replace(".json", ""), { exact: true })).toBeVisible();
      }
      await dati.getByText("alfa", { exact: true }).click();
      await expect(dati.locator(".mx-selected")).toContainText("alfa");

      // Catalogo e ritorno.
      await page.getByRole("button", { name: "Cambia vista" }).click();
      await page.getByRole("menuitem", { name: "Catalogo" }).click();
      await expect(page).toHaveURL(/\/mocks/);
      await page.getByRole("button", { name: "Cambia vista" }).click();
      await page.getByRole("menuitem", { name: "Dati" }).click();
      await expect(page).toHaveURL(/\/dati/);

      // Stato ritrovato: stesso file selezionato, con l'anteprima caricata.
      await expect(dati.locator(".mx-selected")).toContainText("alfa");
      await expect(dati.locator("ui-code")).toContainText("alfa.json");
    } finally {
      await clearDataFiles(request);
    }
  });
});
