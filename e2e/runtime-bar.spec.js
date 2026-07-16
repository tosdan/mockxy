const { test, expect } = require("@playwright/test");
const { gotoMocks, E2E_BACKEND } = require("./helpers");

// Barra runtime: l'indirizzo accanto al toggle del server è quello VERO del motore quando la UI
// è servita sotto /_admin/ui (ramo browser di resolveServerAddress). Il ramo desktop — l'etichetta
// che segue il bind dei settings del workspace (es. 0.0.0.0:porta) — richiede il bridge Electron:
// è coperto dagli unit test di resolveDesktopBindAddress in runtime-bar.spec.ts.
test.describe("barra runtime · indirizzo del server", () => {
  test("mostra host e porta della pagina servita dal motore, non il default cablato", async ({ page }) => {
    await gotoMocks(page);

    const pageHost = new URL(E2E_BACKEND).host; // localhost:3101
    const bar = page.locator("app-runtime-bar");
    await expect(bar.getByText(pageHost, { exact: true })).toBeVisible();
    // Il default di sviluppo (localhost:3000) NON deve comparire: qui la pagina arriva dal motore.
    await expect(bar.getByText("localhost:3000", { exact: true })).toHaveCount(0);
  });
});
