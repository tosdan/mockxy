const { test, expect } = require("@playwright/test");
const { gotoMocks } = require("./helpers");

// E1 — catalogo: lista completa, conteggi, collezioni, Unsorted in cima, endpoint disabilitato
// muted. Sola lettura: non tocca lo stato, nessun ripristino necessario.
// Scope sul componente <mocks-next-catalog> così ogni percorso appare una sola volta (il
// selezionato compare anche nel dettaglio, fuori scope).
test.describe("E1 · catalogo", () => {
  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
  });

  test("elenca tutti gli 8 endpoint delle fixture", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const paths = [
      "/api/health",
      "/api/users",
      "/api/users/:id",
      "/api/admin/config",
      "/api/legacy",
      "/api/status",
      "/api/echo",
      "/api/enrich",
    ];
    for (const path of paths) {
      await expect(catalog.getByText(path, { exact: true })).toBeVisible();
    }
  });

  test("il footer riporta i conteggi e gli attivi corretti", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText(/8\s+endpoint/)).toBeVisible();
    await expect(catalog.getByText(/3\s+collection/)).toBeVisible();
    // 8 endpoint, 1 disabilitato (legacy) → "7 / 8 attivi" (lingua fissata a IT dall'helper)
    await expect(catalog.getByText(/7\s*\/\s*8\s+attivi/)).toBeVisible();
  });

  test("mostra le tre collezioni e il gruppo Unsorted", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("Unsorted")).toBeVisible();
    await expect(catalog.getByText("Core API")).toBeVisible();
    await expect(catalog.getByText("Admin", { exact: true })).toBeVisible();
    await expect(catalog.getByText("Dynamic")).toBeVisible();
  });

  test("Unsorted è in cima, poi le collezioni root nell'ordine di childOrder", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const topOf = async (text) => {
      const box = await catalog.getByText(text, { exact: true }).first().boundingBox();
      return box.y;
    };
    const unsorted = await topOf("Unsorted");
    const core = await topOf("Core API");
    const dynamic = await topOf("Dynamic");
    expect(unsorted).toBeLessThan(core); // Unsorted sempre per primo
    expect(core).toBeLessThan(dynamic); // root: [Core API, Dynamic]
  });

  test("l'endpoint disabilitato è muted, gli attivi no", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.locator(".mx-muted", { hasText: "/api/legacy" })).toBeVisible();
    await expect(catalog.locator(".mx-muted", { hasText: "/api/health" })).toHaveCount(0);
  });

  test("l'endpoint disabilitato ha lo switch spento, gli attivi acceso", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    // Ogni riga (endpoint o cartella) è un .cdk-drag isolato: il filtro per percorso ne prende una sola.
    const switchOf = (path) => catalog.locator(".cdk-drag").filter({ hasText: path }).getByRole("switch");
    await expect(switchOf("/api/legacy")).toHaveAttribute("aria-checked", "false");
    await expect(switchOf("/api/health")).toHaveAttribute("aria-checked", "true");
  });

  test("i tipi non-mock e i metodi sono etichettati nel catalogo", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("handler", { exact: true })).toBeVisible();
    await expect(catalog.getByText("middleware", { exact: true })).toBeVisible();
    await expect(catalog.getByText("POST", { exact: true })).toBeVisible();
  });
});
