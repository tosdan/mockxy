const { test, expect } = require("@playwright/test");
const { gotoMonitor, clearMonitor, mockIdByPath, resetWorkspace, E2E_BACKEND } = require("./helpers");

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

  // La riga aperta si segna a destra, verso il dettaglio: la barra ambra delle non mockate, a
  // sinistra, prima spariva quando la riga era aperta, ora resta.
  test("la riga aperta ha il bordo a destra, e una non mockata tiene la barra ambra a sinistra", async ({ page, request }) => {
    await request.get(`${E2E_BACKEND}/api/health`);
    await request.get(`${E2E_BACKEND}/api/percorso-inesistente`);
    await gotoMonitor(page);
    monitor = page.locator("app-monitor-next");
    const row = (text) => monitor.getByRole("option").filter({ hasText: text }).first();
    // Le righe hanno una transizione: si aspetta che le ombre arrivino al valore finale.
    const edges = (locator, expected) =>
      expect
        .poll(() =>
          locator.evaluate((el) => {
            const shadow = getComputedStyle(el).boxShadow;
            return { left: /\) 2px 0px 0px 0px inset/.test(shadow), right: /\) -2px 0px 0px 0px inset/.test(shadow) };
          }),
        )
        .toEqual(expected);

    await row("/api/percorso-inesistente").click();
    await expect(row("/api/percorso-inesistente")).toHaveClass(/mx-open/);
    await edges(row("/api/percorso-inesistente"), { left: true, right: true });
    await edges(row("/api/health"), { left: false, right: false });

    await row("/api/health").click();
    await expect(row("/api/health")).toHaveClass(/mx-open/);
    await edges(row("/api/health"), { left: false, right: true });
    await edges(row("/api/percorso-inesistente"), { left: true, right: false });
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

// Il badge SEQ di un passo di sequenza ha un fondo suo: aperta e spuntata, la riga somma la tinta
// della selezione e la sfumatura chiara, e il testo del badge scendeva sotto 4.5:1. Scrive una
// variante su disco: il workspace si ripristina alla fine.
test.describe("E15 · monitor, badge SEQ sulla riga spuntata", () => {
  test.beforeEach(async ({ request }) => {
    await clearMonitor(request);
  });
  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  test("aperta e spuntata, il badge SEQ resta leggibile nel punto più chiaro", async ({ page, request }) => {
    const id = await mockIdByPath(request, "/api/status");
    const created = await request.post(`${E2E_BACKEND}/_admin/api/mocks/${id}/responses`, {
      data: { type: "sequence", title: "Polling", steps: [{ response: "001.response.json", times: 2 }, { response: "002.response.json" }], onEnd: "stay" },
    });
    expect(created.ok()).toBeTruthy();
    const { selectedResponseFile } = await created.json();
    expect((await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}`, { data: { selectedResponseFile } })).ok()).toBeTruthy();
    await request.get(`${E2E_BACKEND}/api/status`);

    await gotoMonitor(page);
    const monitor = page.locator("app-monitor-next");
    const row = monitor.getByRole("option").filter({ hasText: "/api/status" }).first();
    const badge = row.locator(".mx-seq-badge");
    await expect(badge).toContainText("SEQ 1/");
    await row.click();
    await row.click({ modifiers: ["ControlOrMeta"] });
    await expect(row).toHaveClass(/mx-open/);
    await expect(row).toHaveClass(/mx-checked/);
    await page.mouse.move(1200, 850);

    // Fondo sotto il testo: gli strati fino al primo opaco, di ogni sfumatura il colore piu' chiaro.
    const ratio = () =>
      badge.evaluate((el) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const paint = (colors) => {
          context.clearRect(0, 0, 1, 1);
          for (const color of colors) {
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
          }
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const layers = [];
        for (let node = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          const stops = style.backgroundImage.match(/(?:rgba?|oklab|oklch|color)\([^)]*\)/g);
          if (stops) layers.unshift(stops[stops.length - 1]);
          layers.unshift(style.backgroundColor);
          if (paint([style.backgroundColor])[3] === 255) break;
        }
        const luminance = ([r, g, b]) => {
          const [lr, lg, lb] = [r, g, b].map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        };
        const back = luminance(paint(layers));
        const text = luminance(paint([...layers, getComputedStyle(el).color]));
        return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
      });
    // Le righe hanno una transizione: a meta' la tinta non c'e' ancora e il contrasto sembra alto,
    // quindi si misura una volta sola, a transizione finita.
    await page.waitForTimeout(400);
    expect(await ratio()).toBeGreaterThanOrEqual(4.5);
  });
});
