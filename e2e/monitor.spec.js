const { test, expect } = require("@playwright/test");
const { gotoMonitor, clearMonitor, resetWorkspace, E2E_BACKEND } = require("./helpers");

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

  // La barra ambra delle righe non mockate ha un chip che la spiega e le filtra; gli errori si
  // contano sui chip di stato, divisi in 4xx e 5xx.
  test("chip delle non mockate, conteggi sui chip di stato e densita' compatta", async ({ page, request }) => {
    await request.get(`${E2E_BACKEND}/api/health`);
    await request.get(`${E2E_BACKEND}/api/users`);
    await request.get(`${E2E_BACKEND}/api/percorso-inesistente`);

    await gotoMonitor(page);
    monitor = page.locator("app-monitor-next");
    const rows = monitor.getByRole("option");
    await expect(rows).toHaveCount(3);
    await expect(monitor.getByRole("button", { name: /^2xx/ })).toHaveText(/2xx\s*2/);

    const unmocked = monitor.getByRole("button", { name: /non mockate/ });
    await expect(unmocked).toHaveText(/1\s*non mockate/);
    await unmocked.click();
    await expect(unmocked).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("/api/percorso-inesistente");
    await expect(monitor.locator("ui-page-header ui-badge")).toHaveText("1 di 3");
    await unmocked.click();
    await expect(rows).toHaveCount(3);

    // Densita' compatta dal menu della testata; resta dopo un ricaricamento.
    await monitor.getByRole("button", { name: "Opzioni di vista" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Densità compatta" }).click();
    await expect(monitor.getByRole("listbox")).toHaveClass(/mx-compact/);
    await page.reload();
    await expect(page.locator("app-monitor-next").getByRole("listbox")).toHaveClass(/mx-compact/);
  });

  // La GET a un endpoint WebSocket la serve l'endpoint (426): non e' una richiesta non mockata.
  test("la risposta di un endpoint WebSocket non e' fra le non mockate", async ({ page, request }) => {
    try {
      const created = await request.post(`${E2E_BACKEND}/_admin/api/mocks`, {
        data: { config: { method: "GET", path: "/api/live", status: 200, headers: {} }, body: {} },
      });
      const id = (await created.json()).id;
      const added = await request.post(`${E2E_BACKEND}/_admin/api/mocks/${id}/responses`, { data: { type: "ws", title: "Canale live", script: [] } });
      const wsFile = (await added.json()).responses.find((entry) => entry.type === "ws").fileName;
      await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}`, { data: { selectedResponseFile: wsFile } });
      expect((await request.get(`${E2E_BACKEND}/api/live`)).status()).toBe(426);
      await request.get(`${E2E_BACKEND}/api/percorso-inesistente`);

      await gotoMonitor(page);
      monitor = page.locator("app-monitor-next");
      await expect(monitor.getByRole("option")).toHaveCount(2);
      await expect(monitor.getByRole("option", { name: /\/api\/live/ })).toContainText("WS");
      await expect(monitor.getByRole("button", { name: /non mockate/ })).toHaveText(/1\s*non mockate/);
    } finally {
      await resetWorkspace(request, page);
    }
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
