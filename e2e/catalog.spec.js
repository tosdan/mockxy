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

  test("la status bar riporta i conteggi e gli attivi corretti", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(page.locator("app-status-bar").getByText(/8\s+endpoint/)).toBeVisible();
    await expect(page.locator("app-status-bar").getByText(/3\s+collection/)).toBeVisible();
    // 8 endpoint, 1 disabilitato (legacy) → "7 attivi" (lingua fissata a IT dall'helper)
    await expect(page.locator("app-status-bar").getByText(/7\s+attivi/)).toBeVisible();
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

  test("il conteggio di una collezione comprende le sotto-collezioni", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const folderBadge = (name) => catalog.locator(".cdk-drag").filter({ hasText: name }).first().locator("ui-badge");
    // Core API: 2 endpoint propri più quello di Admin, sua sotto-collezione.
    await expect(folderBadge("Core API")).toHaveText("3");
    await expect(folderBadge("Admin")).toHaveText("1");
    await expect(folderBadge("Dynamic")).toHaveText("2");
  });

  test("da tastiera: dal filtro si scende nell'albero, Invio apre l'endpoint, sinistra chiude la cartella", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const focused = catalog.locator('[role="treeitem"]:focus');

    await page.keyboard.press("/");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await expect(focused).toContainText("Unsorted");

    // Unsorted: health, legacy, status.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(focused).toContainText("/api/legacy");
    await page.keyboard.press("Enter");
    await expect(page.locator("mocks-next-detail").getByRole("heading", { name: "/api/legacy", exact: true })).toBeVisible();
    await expect(focused).toHaveAttribute("aria-selected", "true");

    // Da un endpoint, sinistra risale alla cartella; una seconda volta la chiude.
    await page.keyboard.press("ArrowLeft");
    await expect(focused).toContainText("Unsorted");
    await page.keyboard.press("ArrowLeft");
    await expect(focused).toHaveAttribute("aria-expanded", "false");
    await expect(catalog.getByText("/api/health", { exact: true })).toHaveCount(0);
  });

  test("la barra delle azioni di massa sta su una riga alla larghezza minima del catalogo", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await catalog.getByRole("checkbox").nth(0).click({ force: true });
    await catalog.getByRole("checkbox").nth(1).click({ force: true });

    const label = catalog.getByText("2 selezionati");
    const move = catalog.getByRole("button", { name: "Sposta", exact: true });
    const [labelBox, moveBox] = [await label.boundingBox(), await move.boundingBox()];
    // Una riga sola: l'etichetta non va a capo e i pulsanti le stanno accanto, non sotto.
    expect(labelBox.height).toBeLessThan(20);
    expect(Math.abs(labelBox.y + labelBox.height / 2 - (moveBox.y + moveBox.height / 2))).toBeLessThan(4);
  });

  test("spunta e menu non tolgono spazio al path: lo cede il path quando il menu compare", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const row = catalog.locator('[role="treeitem"]').filter({ hasText: "/api/users/:id" });
    const path = row.locator('[dir="rtl"]');
    const menu = row.getByRole("button", { name: "Sposta in collection" });
    const toggle = row.getByRole("switch");
    await page.mouse.move(1000, 600);

    // A riposo il path arriva allo switch, separato solo dallo stacco della riga.
    const rest = { path: await path.boundingBox(), toggle: await toggle.boundingBox(), row: await row.boundingBox() };
    expect(rest.toggle.x - (rest.path.x + rest.path.width)).toBeLessThanOrEqual(12);
    await expect(menu).toHaveCSS("opacity", "0");

    // In hover il menu compare accanto allo switch e il path si ritira per lasciarlo libero.
    await row.hover();
    await expect(menu).toHaveCSS("opacity", "1");
    const hover = { path: await path.boundingBox(), menu: await menu.boundingBox(), row: await row.boundingBox() };
    expect(hover.path.x + hover.path.width).toBeLessThanOrEqual(hover.menu.x);
    expect(hover.menu.x + hover.menu.width).toBeLessThanOrEqual(rest.toggle.x);
    // Nessun salto in verticale fra riposo e hover.
    expect(hover.row.height).toBe(rest.row.height);
  });

  test("spuntare un endpoint non sposta la riga, e il click non lascia il menu acceso", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const row = catalog.locator('[role="treeitem"]').filter({ hasText: "/api/health" });
    const badge = row.locator("ui-badge");
    const before = await badge.boundingBox();

    await row.getByRole("checkbox").click();
    await page.mouse.move(1000, 600);

    await expect(row.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect((await badge.boundingBox()).x).toBe(before.x);
    await expect(row.getByRole("button", { name: "Sposta in collection" })).toHaveCSS("opacity", "0");
  });

  test("col fuoco da tastiera sulla riga il menu compare, e col Tab ci si arriva", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await page.keyboard.press("/");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown"); // /api/health
    await expect(catalog.locator('[role="treeitem"]:focus')).toContainText("/api/health");
    const row = catalog.locator('[role="treeitem"]').filter({ hasText: "/api/health" });
    const menu = row.getByRole("button", { name: "Sposta in collection" });
    await expect(menu).toHaveCSS("opacity", "1");

    await page.keyboard.press("Tab"); // la spunta
    await page.keyboard.press("Tab"); // il menu
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Core API" })).toBeVisible();
  });

  test("un path lungo si tronca in testa: la coda resta visibile", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    // Si allunga un path direttamente nel DOM: le fixture non ne hanno di abbastanza lunghi.
    const tail = await catalog.locator("bdi", { hasText: "/api/admin/config" }).evaluate((bdi) => {
      bdi.textContent = "/api/admin/organizations/{organizationId}/members/{memberId}/config";
      const box = bdi.parentElement.getBoundingClientRect();
      const range = document.createRange();
      range.setStart(bdi.firstChild, bdi.textContent.length - "/config".length);
      range.setEnd(bdi.firstChild, bdi.textContent.length);
      const end = range.getBoundingClientRect();
      range.setStart(bdi.firstChild, 0);
      range.setEnd(bdi.firstChild, 1);
      const start = range.getBoundingClientRect();
      return { tailInside: end.left >= box.left && end.right <= box.right + 1, headClipped: start.left < box.left };
    });
    expect(tail).toEqual({ tailInside: true, headClipped: true });
  });

  test("l'endpoint disabilitato è muted, gli attivi no", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.locator(".mx-muted", { hasText: "/api/legacy" })).toBeVisible();
    await expect(catalog.locator(".mx-muted", { hasText: "/api/health" })).toHaveCount(0);
  });

  test("l'endpoint disabilitato resta leggibile: contrasto AA su path e dettagli", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    // Da spenta la riga perde il colore, non l'opacità: il testo deve restare sopra 4.5:1.
    const ratios = await catalog.locator(".mx-muted", { hasText: "/api/legacy" }).evaluate((row) => {
      const channels = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = (color) => {
        const [r, g, b] = channels(color).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      let surface = row;
      while (getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
      const background = luminance(getComputedStyle(surface).backgroundColor);
      return ["ui-badge", "bdi", ".tabular-nums"].map((selector) => {
        const style = getComputedStyle(row.querySelector(selector));
        const text = luminance(style.color);
        return { selector, opacity: getComputedStyle(row).opacity, ratio: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05) };
      });
    });
    for (const { selector, opacity, ratio } of ratios) {
      expect(opacity, selector).toBe("1");
      expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
    }
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
