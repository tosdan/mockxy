const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace } = require("./helpers");

// E9 — collection: crea, sposta endpoint dentro, sotto-collection annidata, espandi/collassa,
// elimina, abilita/disabilita in blocco. Scrittura: afterEach = resetWorkspace (l'impronta include
// collezioni e membership). NB: l'API non ha rename collection → non testabile.
test.describe("E9 · collection", () => {
  let catalog;

  let statusBar;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");

    statusBar = page.locator("app-status-bar");
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  const row = (text) => catalog.locator(".cdk-drag").filter({ hasText: text });
  const folderBadge = (name) => row(name).first().locator("ui-badge");
  const kebab = (text) => row(text).first().locator('button:has(ng-icon[name="lucideEllipsisVertical"])');

  test("crea una collection dall'header del catalogo", async ({ page }) => {
    await catalog.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Nuova collection" }).click();
    await catalog.getByPlaceholder(/Nome collection/).fill("E2E coll");
    await catalog.getByPlaceholder(/Nome collection/).press("Enter");

    await expect(catalog.getByText("E2E coll")).toBeVisible();
    await expect(statusBar.getByText(/4\s+collection/)).toBeVisible();
  });

  test("sposta un endpoint in una collection dal menu della riga", async ({ page }) => {
    // Core API conta l'intero sottoalbero: 2 endpoint propri (users, users/:id) più quello di Admin.
    await expect(folderBadge("Core API")).toHaveText("3");

    // Il menu di un endpoint resta fuori dai click finché la riga non è in hover, come per chi usa il mouse.
    await row("/api/health").first().hover();
    await kebab("/api/health").click();
    await page.getByRole("menuitem", { name: "Core API" }).click();

    // ora Core API ne ha 4, e health non è più fra i non assegnati.
    await expect(folderBadge("Core API")).toHaveText("4");
  });

  test("rifiuta, spiegandolo in italiano, una collection col nome dei non assegnati", async ({ page }) => {
    await catalog.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Nuova collection" }).click();
    await catalog.getByPlaceholder(/Nome collection/).fill("non assegnati");
    await catalog.getByPlaceholder(/Nome collection/).press("Enter");

    await expect(page.locator("ui-toaster").getByText("Questo nome è riservato agli endpoint non assegnati: scegline un altro.")).toBeVisible();
    // Il campo resta aperto per correggere, e nessuna collection è stata creata.
    await expect(catalog.getByPlaceholder(/Nome collection/)).toBeVisible();
    await expect(statusBar.getByText(/3\s+collection/)).toBeVisible();
  });

  test("spunta una collection chiusa con le sue sotto-collection e la disabilita in blocco", async ({ page }) => {
    const folderRow = catalog.locator('[role="treeitem"][data-row-key^="c:"]').filter({ hasText: "Core API" });
    const folderBox = folderRow.getByRole("checkbox");

    // Chiusa: i suoi endpoint (users, users/:id e quello di Admin) non si vedono.
    await folderRow.click();
    await expect(catalog.getByText("/api/users", { exact: true })).toHaveCount(0);
    await folderRow.hover();
    await folderBox.click();
    await expect(folderBox).toHaveAttribute("aria-checked", "true");
    await expect(catalog.getByText("3 selezionati")).toBeVisible();

    await catalog.getByRole("button", { name: "Disabilita", exact: true }).click();
    await expect(page.locator("app-status-bar").getByText(/4\s+attivi/)).toBeVisible();

    await folderRow.click(); // riapre: i tre ora sono spenti
    for (const p of ["/api/users", "/api/users/:id", "/api/admin/config"]) {
      await expect(catalog.locator(".mx-muted").filter({ has: page.getByText(p, { exact: true }) })).toHaveCount(1);
    }
  });

  test("da tastiera Spazio su una cartella ne spunta il sottoalbero, Invio la chiude", async ({ page }) => {
    await page.keyboard.press("/");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    // L'ultima riga è un endpoint di Dynamic: sinistra risale alla cartella.
    await page.keyboard.press("ArrowLeft");
    const focused = catalog.locator('[role="treeitem"]:focus');
    await expect(focused).toContainText("Dynamic");

    await page.keyboard.press("Space");
    await expect(catalog.getByText("2 selezionati")).toBeVisible();
    await expect(focused).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Enter");
    await expect(focused).toHaveAttribute("aria-expanded", "false");
    // Chiuderla non toglie le spunte.
    await expect(catalog.getByText("2 selezionati")).toBeVisible();
  });

  test("crea una sotto-collection annidata sotto una collection", async ({ page }) => {
    await kebab("Core API").click();
    await page.getByRole("menuitem", { name: "Nuova sotto-collection" }).click();
    await catalog.getByPlaceholder(/Nome sotto-collection/).fill("E2E sub");
    await catalog.getByPlaceholder(/Nome sotto-collection/).press("Enter");

    await expect(catalog.getByText("E2E sub")).toBeVisible();
    await expect(statusBar.getByText(/4\s+collection/)).toBeVisible();
  });

  test("collassa e riespande tutte le cartelle", async ({ page }) => {
    // di partenza gli endpoint dentro le collezioni sono visibili
    await expect(catalog.getByText("/api/users", { exact: true })).toBeVisible();

    await catalog.getByRole("button", { name: "Azioni di vista" }).click();
    await page.getByRole("menuitem", { name: "Collassa tutte le cartelle" }).click();
    await expect(catalog.getByText("/api/users", { exact: true })).toHaveCount(0);
    // le cartelle restano
    await expect(catalog.getByText("Core API")).toBeVisible();

    await catalog.getByRole("button", { name: "Azioni di vista" }).click();
    await page.getByRole("menuitem", { name: "Espandi tutte le cartelle" }).click();
    await expect(catalog.getByText("/api/users", { exact: true })).toBeVisible();
  });

  test("dissolve una collection: sparisce e i suoi endpoint tornano fra i non categorizzati", async ({ page }) => {
    await expect(catalog.getByText("Dynamic")).toBeVisible();

    await kebab("Dynamic").click();
    await page.getByRole("menuitem", { name: "Dissolvi collection" }).click();
    // conferma inline col conteggio degli endpoint coinvolti (scope: contenitore con "Annulla")
    await catalog
      .locator(':is(span, div):has(> button:has-text("Annulla"))')
      .getByRole("button", { name: /Dissolvi \d+/ })
      .click();

    await expect(catalog.getByText("Dynamic")).toHaveCount(0);
    await expect(statusBar.getByText(/2\s+collection/)).toBeVisible();
    // echo/enrich restano nel catalogo (tornati fra i non categorizzati)
    await expect(catalog.getByText("/api/echo", { exact: true })).toBeVisible();
  });

  test("elimina una collection insieme a tutti i suoi endpoint", async ({ page }) => {
    await expect(catalog.getByText("Dynamic")).toBeVisible();

    await kebab("Dynamic").click();
    await page.getByRole("menuitem", { name: "Elimina collection" }).click();
    await catalog
      .locator(':is(span, div):has(> button:has-text("Annulla"))')
      .getByRole("button", { name: /Elimina \d+/ })
      .click();

    await expect(catalog.getByText("Dynamic")).toHaveCount(0);
    await expect(statusBar.getByText(/2\s+collection/)).toBeVisible();
    // stavolta gli endpoint contenuti sono stati eliminati con la collection
    await expect(catalog.getByText("/api/echo", { exact: true })).toHaveCount(0);
    await expect(statusBar.getByText(/6\s+endpoint/)).toBeVisible();
  });

  test("disabilita in blocco tutti gli endpoint di una collection", async ({ page }) => {
    await kebab("Core API").click();
    await page.getByRole("menuitem", { name: "Disabilita tutti" }).click();

    await expect(catalog.locator(".mx-muted", { hasText: "/api/users" })).toHaveCount(2);
  });
});
