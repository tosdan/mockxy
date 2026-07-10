const { test, expect } = require("@playwright/test");
const { gotoMonitor, clearMonitor, E2E_BACKEND } = require("./helpers");

// E15 — Monitor del traffico live. Il monitor cattura le richieste che passano dal server (solo
// /api/*, non /_admin/*). Genero traffico con richieste dirette al backend (fixture context), poi
// lo verifico nel monitor: snapshot all'apertura, stream live, e clear. Isolamento: clearMonitor
// (storico in RAM) nel beforeEach; nessuna scrittura sulle fixture.
test.describe("E15 · monitor", () => {
  let monitor;

  test.beforeEach(async ({ request }) => {
    await clearMonitor(request);
  });

  test("le richieste generate compaiono nel monitor all'apertura (snapshot)", async ({ page, request }) => {
    await request.get(`${E2E_BACKEND}/api/health`);
    await request.get(`${E2E_BACKEND}/api/users`);

    await gotoMonitor(page);
    monitor = page.locator("app-monitor-next");

    // .first(): ogni percorso appare nella riga della lista e nel pannello dettaglio (auto-selezione).
    await expect(monitor.getByText("/api/health").first()).toBeVisible();
    await expect(monitor.getByText("/api/users", { exact: true }).first()).toBeVisible();
    await expect(monitor.getByText("200").first()).toBeVisible();
  });

  test("il traffico live appare via stream mentre il monitor è aperto", async ({ page, request }) => {
    await gotoMonitor(page);
    monitor = page.locator("app-monitor-next");
    // monitor aperto e vuoto; genero traffico ORA → deve arrivare via SSE
    await request.get(`${E2E_BACKEND}/api/health`);
    await expect(monitor.getByText("/api/health").first()).toBeVisible();
  });

  test("una richiesta non mockata compare come miss", async ({ page, request }) => {
    await request.get(`${E2E_BACKEND}/api/percorso-inesistente`);

    await gotoMonitor(page);
    monitor = page.locator("app-monitor-next");
    await expect(monitor.getByText("/api/percorso-inesistente").first()).toBeVisible();
  });

  test("Pulisci svuota il monitor", async ({ page, request }) => {
    await request.get(`${E2E_BACKEND}/api/health`);
    await gotoMonitor(page);
    monitor = page.locator("app-monitor-next");
    await expect(monitor.getByText("/api/health").first()).toBeVisible();

    await monitor.getByRole("button", { name: "Pulisci" }).click();
    await expect(monitor.getByText("nessun traffico")).toBeVisible();
  });
});
