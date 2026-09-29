const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { gotoMocks, mockIdByPath, resetWorkspace, E2E_BACKEND } = require("./helpers");

// Piano agent/API, §7 S4 — la GUI si sincronizza col runtime senza ricaricare la pagina: cambiamenti
// fatti da un agente via API o visti dal watcher compaiono entro 5 secondi, e una bozza aperta
// resta com'è. Scrittura: l'afterEach ripristina fixture e stato del server.
const RUN_MOCKS = path.join(__dirname, "..", "workspace-test", ".run", "mocks");
const SYNC_TIMEOUT = { timeout: 5000 };

test.describe("E21 · sincronizzazione col runtime", () => {
  let catalog;
  let detail;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    detail = page.locator("mocks-next-detail");
  });

  test.afterEach(async ({ request, page }) => {
    await request.patch(`${E2E_BACKEND}/_admin/api/server`, { data: { proxyAll: false } });
    await resetWorkspace(request, page);
  });

  test("Proxy All cambiato via API compare senza ricaricare", async ({ page, request }) => {
    const runtime = page.locator("app-runtime-status");
    await expect(runtime.getByText("mock attivi")).toBeVisible();

    const res = await request.patch(`${E2E_BACKEND}/_admin/api/server`, { data: { proxyAll: true } });
    expect(res.ok()).toBe(true);

    await expect(runtime.getByText("dritto al backend")).toBeVisible(SYNC_TIMEOUT);
  });

  test("una descrizione cambiata da un agente compare nel dettaglio aperto", async ({ request }) => {
    await catalog.getByText("/api/status", { exact: true }).click();
    await expect(detail.getByText("Due response: OK e Non trovato")).toBeVisible();

    const id = await mockIdByPath(request, "/api/status");
    await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}/endpoint`, { data: { description: "Scritta dall'agente" } });

    await expect(detail.getByText("Scritta dall'agente")).toBeVisible(SYNC_TIMEOUT);
  });

  test("la diagnostica cambia anche con la vecchia rotta ancora servita", async ({ page, request }) => {
    const statusBar = page.locator("app-status-bar");
    await expect(statusBar.getByText(/Runtime:/)).toHaveCount(0);

    // Un handler rotto su disco: il watcher ricarica, il runtime continua a servire la versione
    // precedente e lo dice.
    fs.writeFileSync(path.join(RUN_MOCKS, "api", "echo", "POST.responses", "001.handler.js"), "module.exports = {{{\n");

    const trigger = statusBar.getByRole("button", { name: /Runtime: 1 errore/ });
    await expect(trigger).toBeVisible(SYNC_TIMEOUT);
    await trigger.click();
    await expect(page.getByRole("dialog").getByText("servita la versione precedente")).toBeVisible();

    const served = await request.post(`${E2E_BACKEND}/api/echo`, { data: { ping: 1 } });
    expect(served.status()).toBe(200);
  });

  test("una bozza aperta resta com'è quando la risorsa cambia sul server", async ({ request }) => {
    await catalog.getByText("/api/status", { exact: true }).click();
    await expect(detail.getByText("Due response: OK e Non trovato")).toBeVisible();
    await detail.locator('button:not([ui-button]):has(ng-icon[name="lucidePencil"])').click();
    const input = detail.getByPlaceholder(/Descrizione endpoint/);
    await input.fill("");
    await input.pressSequentially("Scritta nella GUI");

    const id = await mockIdByPath(request, "/api/status");
    await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}/endpoint`, { data: { description: "Scritta dall'agente" } });

    const panel = detail.locator("mocks-next-draft-conflict");
    await expect(panel.getByRole("heading", { name: "La versione sul server è cambiata" })).toBeVisible(SYNC_TIMEOUT);
    await expect(input).toHaveValue("Scritta nella GUI");
    await expect(input).toBeFocused();

    await panel.getByRole("button", { name: "Ricarica" }).click();
    await panel.getByRole("button", { name: "Sostituisci" }).click();
    await expect(input).toHaveValue("Scritta dall'agente");
  });
});
