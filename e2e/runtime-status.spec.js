const { test, expect } = require("@playwright/test");
const { gotoMocks, E2E_BACKEND } = require("./helpers");

// Stato runtime: l'indirizzo mostrato accanto al server è quello VERO del motore quando la UI
// è servita sotto /_admin/ui (ramo browser di resolveServerAddress). Il ramo desktop — l'etichetta
// che segue il bind dei settings del workspace (es. 0.0.0.0:porta) — richiede il bridge Electron:
// è coperto dagli unit test di resolveDesktopBindAddress in server-address.spec.ts.
test.describe("stato runtime · indirizzo del server", () => {
  test("mostra host e porta della pagina servita dal motore, non il default cablato", async ({ page }) => {
    await gotoMocks(page);

    const pageHost = new URL(E2E_BACKEND).host; // localhost:3101
    const status = page.locator("app-runtime-status");
    await expect(status.getByText(pageHost, { exact: true })).toBeVisible();
    // Il default di sviluppo (localhost:3000) NON deve comparire: qui la pagina arriva dal motore.
    await expect(status.getByText("localhost:3000", { exact: true })).toHaveCount(0);
  });

  test("gli interruttori vivono nel popover, non in barra", async ({ page }) => {
    await gotoMocks(page);

    const status = page.locator("app-runtime-status");
    await expect(status.locator("ui-switch")).toHaveCount(0);

    await status.getByRole("button").first().click();
    const panel = page.getByRole("dialog", { name: "Runtime" });
    await expect(panel).toBeVisible();
    await expect(panel.locator("ui-switch")).toHaveCount(4);
  });
});
