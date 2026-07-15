const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace } = require("./helpers");

// E9 — collection: crea, sposta endpoint dentro, sotto-collection annidata, espandi/collassa,
// elimina, abilita/disabilita in blocco. Scrittura: afterEach = resetWorkspace (l'impronta include
// collezioni e membership). NB: l'API non ha rename collection → non testabile.
test.describe("E9 · collection", () => {
  let catalog;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  const row = (text) => catalog.locator(".cdk-drag").filter({ hasText: text });
  const folderBadge = (name) => row(name).first().locator("ui-badge");
  const kebab = (text) => row(text).first().locator('button:has(ng-icon[name="lucideEllipsisVertical"])');

  test("crea una collection dall'header del catalogo", async () => {
    await catalog.locator('button:has(ng-icon[name="lucideFolderPlus"])').first().click();
    await catalog.getByPlaceholder(/Nome collection/).fill("E2E coll");
    await catalog.getByPlaceholder(/Nome collection/).press("Enter");

    await expect(catalog.getByText("E2E coll")).toBeVisible();
    await expect(catalog.getByText(/4\s+collection/)).toBeVisible();
  });

  test("sposta un endpoint in una collection dal menu della riga", async ({ page }) => {
    // Core API ha 2 endpoint propri (users, users/:id).
    await expect(folderBadge("Core API")).toHaveText("2");

    await kebab("/api/health").click();
    await page.getByRole("menuitem", { name: "Core API" }).click();

    // ora Core API ne ha 3, e health non è più fra i non categorizzati (Unsorted).
    await expect(folderBadge("Core API")).toHaveText("3");
  });

  test("crea una sotto-collection annidata sotto una collection", async ({ page }) => {
    await kebab("Core API").click();
    await page.getByRole("menuitem", { name: "Nuova sotto-collection" }).click();
    await catalog.getByPlaceholder(/Nome sotto-collection/).fill("E2E sub");
    await catalog.getByPlaceholder(/Nome sotto-collection/).press("Enter");

    await expect(catalog.getByText("E2E sub")).toBeVisible();
    await expect(catalog.getByText(/4\s+collection/)).toBeVisible();
  });

  test("collassa e riespande tutte le cartelle", async () => {
    // di partenza gli endpoint dentro le collezioni sono visibili
    await expect(catalog.getByText("/api/users", { exact: true })).toBeVisible();

    await catalog.locator('button:has(ng-icon[name="lucideShrink"])').click();
    await expect(catalog.getByText("/api/users", { exact: true })).toHaveCount(0);
    // le cartelle restano
    await expect(catalog.getByText("Core API")).toBeVisible();

    await catalog.locator('button:has(ng-icon[name="lucideExpand"])').click();
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
    await expect(catalog.getByText(/2\s+collection/)).toBeVisible();
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
    await expect(catalog.getByText(/2\s+collection/)).toBeVisible();
    // stavolta gli endpoint contenuti sono stati eliminati con la collection
    await expect(catalog.getByText("/api/echo", { exact: true })).toHaveCount(0);
    await expect(catalog.getByText(/6\s+endpoint/)).toBeVisible();
  });

  test("disabilita in blocco tutti gli endpoint di una collection", async ({ page }) => {
    await kebab("Core API").click();
    await page.getByRole("menuitem", { name: "Disabilita tutti" }).click();

    await expect(catalog.locator(".mx-muted", { hasText: "/api/users" })).toHaveCount(2);
  });
});
