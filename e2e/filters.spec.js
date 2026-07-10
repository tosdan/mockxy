const { test, expect } = require("@playwright/test");
const { gotoMocks } = require("./helpers");

// E2 — ricerca e filtri: sola lettura (lo stato è tutto UI-locale, ripristinato da gotoMocks a ogni
// test). Il menu filtri è un overlay CDK a livello page: le sue voci si cercano fuori dallo scope
// del catalogo.
test.describe("E2 · ricerca e filtri", () => {
  let catalog;
  let search;
  let filterButton;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    search = catalog.getByPlaceholder(/Filtra il catalogo/);
    filterButton = catalog.locator('button:has(ng-icon[name="lucideFilter"])');
  });

  const path = (p) => catalog.getByText(p, { exact: true });

  test("la ricerca per percorso filtra il catalogo", async () => {
    await search.fill("users");
    await expect(path("/api/users")).toBeVisible();
    await expect(path("/api/users/:id")).toBeVisible();
    await expect(path("/api/health")).toHaveCount(0);
    await expect(path("/api/echo")).toHaveCount(0);
  });

  test("la ricerca copre anche il metodo HTTP", async () => {
    await search.fill("POST");
    await expect(path("/api/echo")).toBeVisible();
    await expect(path("/api/health")).toHaveCount(0);
  });

  test("una ricerca senza corrispondenze svuota gli endpoint mantenendo le collezioni", async () => {
    // Nota: il messaggio "Nessun endpoint corrisponde…" scatta solo in un workspace SENZA
    // collezioni (catalogIsEmpty). Con collezioni presenti, la ricerca svuota gli endpoint ma
    // le cartelle restano, a conteggio zero.
    await search.fill("zzz-nessun-endpoint");
    for (const p of ["/api/health", "/api/users", "/api/echo", "/api/enrich", "/api/legacy", "/api/status"]) {
      await expect(path(p)).toHaveCount(0);
    }
    await expect(catalog.getByText("Core API")).toBeVisible();
    await expect(catalog.getByText("Dynamic")).toBeVisible();
  });

  test("la sola ricerca non accende l'indicatore dei filtri", async () => {
    await expect(filterButton.locator("span.rounded-full")).toHaveCount(0);
    await search.fill("users");
    await expect(path("/api/health")).toHaveCount(0); // filtro applicato
    await expect(filterButton.locator("span.rounded-full")).toHaveCount(0); // ma niente pallino
  });

  test("il filtro per tipo Handler mostra solo gli handler e accende l'indicatore", async ({ page }) => {
    await filterButton.click();
    await page.getByRole("menuitem", { name: "Handler" }).click();
    await expect(path("/api/echo")).toBeVisible();
    await expect(path("/api/users")).toHaveCount(0);
    await expect(path("/api/enrich")).toHaveCount(0);
    await expect(filterButton.locator("span.rounded-full")).toHaveCount(1);
  });

  test("il filtro per tipo Middleware isola i middleware", async ({ page }) => {
    await filterButton.click();
    await page.getByRole("menuitem", { name: "Middleware" }).click();
    await expect(path("/api/enrich")).toBeVisible();
    await expect(path("/api/echo")).toHaveCount(0);
    await expect(path("/api/health")).toHaveCount(0);
  });

  test("il filtro per stato Disattivi mostra solo l'endpoint disabilitato", async ({ page }) => {
    await filterButton.click();
    await page.getByRole("menuitem", { name: "Disattivi" }).click();
    await expect(path("/api/legacy")).toBeVisible();
    await expect(path("/api/health")).toHaveCount(0);
    await expect(path("/api/echo")).toHaveCount(0);
  });

  test("Reimposta filtri riporta il catalogo completo e spegne l'indicatore", async ({ page }) => {
    await filterButton.click();
    await page.getByRole("menuitem", { name: "Handler" }).click();
    await expect(path("/api/health")).toHaveCount(0);
    await expect(filterButton.locator("span.rounded-full")).toHaveCount(1);

    await filterButton.click();
    await page.getByRole("menuitem", { name: "Reimposta filtri" }).click();
    await expect(path("/api/health")).toBeVisible();
    await expect(path("/api/echo")).toBeVisible();
    await expect(filterButton.locator("span.rounded-full")).toHaveCount(0);
  });
});
