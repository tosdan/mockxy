const { test, expect } = require("@playwright/test");
const { gotoMocks, E2E_BACKEND } = require("./helpers");

// Piano agent/API, §13 C8 — la GUI mostra la configurazione in uso e gli override effimeri
// impostati via API (per esempio da un agente), e riporta una chiave al valore di avvio.
// Scrittura: l'afterEach toglie gli override rimasti.
test.describe("E22 · configurazione runtime", () => {
  test.afterEach(async ({ request }) => {
    const config = await (await request.get(`${E2E_BACKEND}/_admin/api/config`)).json();
    const keys = Object.keys(config.overrides);
    if (keys.length > 0) {
      await request.patch(`${E2E_BACKEND}/_admin/api/config`, { data: { unset: keys } });
    }
  });

  test("un override impostato via API compare nella barra di stato e la GUI torna al valore di avvio", async ({ page, request }) => {
    await gotoMocks(page);
    const statusBar = page.locator("app-status-bar");
    await expect(statusBar.getByRole("button", { name: "Configurazione" })).toBeVisible();
    const startup = (await (await request.get(`${E2E_BACKEND}/_admin/api/config`)).json()).startup;

    const patched = await request.patch(`${E2E_BACKEND}/_admin/api/config`, { data: { set: { globalDelayMs: 1234 } } });
    expect(patched.ok()).toBe(true);

    const trigger = statusBar.getByRole("button", { name: "1 override attivo" });
    await expect(trigger).toBeVisible({ timeout: 5000 });
    await trigger.click();
    const row = page.getByRole("dialog", { name: "Configurazione runtime" }).locator('[data-key="globalDelayMs"]');
    await expect(row).toContainText("1234");
    await expect(row).toContainText(`All'avvio: ${startup.globalDelayMs}`);

    await row.getByRole("button", { name: /Torna al valore di avvio/ }).click();

    await expect(statusBar.getByRole("button", { name: "Configurazione" })).toBeVisible();
    const config = await (await request.get(`${E2E_BACKEND}/_admin/api/config`)).json();
    expect(config.overrides).toEqual({});
    expect(config.effective.globalDelayMs).toBe(startup.globalDelayMs);
  });
});
