const { test, expect } = require("@playwright/test");
const { gotoMocks } = require("./helpers");

// E2 — ricerca e filtri: sola lettura (lo stato è tutto UI-locale, ripristinato da gotoMocks a ogni
// test). Stato e reset sono controlli in chiaro nella testata; il tipo resta un menu, overlay CDK a
// livello page, quindi le sue voci si cercano fuori dallo scope del catalogo.
test.describe("E2 · ricerca e filtri", () => {
  let catalog;
  let search;
  let typeButton;
  let statusFilter;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    search = catalog.getByPlaceholder(/Filtra il catalogo/);
    typeButton = catalog.getByRole("button", { name: /^Tipo:/ });
    statusFilter = (label) => catalog.getByRole("radio", { name: label, exact: true });
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

  test("la sola ricerca non tocca i filtri di tipo e stato", async () => {
    await expect(typeButton).toHaveText(/Tutti/);
    await search.fill("users");
    await expect(path("/api/health")).toHaveCount(0); // filtro applicato
    // Tipo e stato restano su "Tutti", e non compare il reset: la ricerca ha il suo campo.
    await expect(typeButton).toHaveText(/Tutti/);
    await expect(statusFilter("Tutti")).toHaveAttribute("aria-checked", "true");
    await expect(catalog.getByRole("button", { name: "Reimposta filtri" })).toHaveCount(0);
  });

  test("sotto filtro il catalogo dichiara che il riordino è sospeso", async () => {
    await expect(catalog.getByText(/Riordino sospeso/)).toHaveCount(0);
    await search.fill("users");
    await expect(catalog.getByText(/Riordino sospeso/)).toBeVisible();
    await search.fill("");
    await expect(catalog.getByText(/Riordino sospeso/)).toHaveCount(0);
  });

  test("il filtro per tipo Handler mostra solo gli handler, e il pulsante lo dice", async ({ page }) => {
    await typeButton.click();
    await page.getByRole("menuitem", { name: "Handler" }).click();
    await expect(path("/api/echo")).toBeVisible();
    await expect(path("/api/users")).toHaveCount(0);
    await expect(path("/api/enrich")).toHaveCount(0);
    await expect(typeButton).toHaveText(/Handler/);
  });

  test("il filtro per tipo Middleware isola i middleware", async ({ page }) => {
    await typeButton.click();
    await page.getByRole("menuitem", { name: "Middleware" }).click();
    await expect(path("/api/enrich")).toBeVisible();
    await expect(path("/api/echo")).toHaveCount(0);
    await expect(path("/api/health")).toHaveCount(0);
  });

  test("il filtro per stato Disattivi mostra solo l'endpoint disabilitato", async () => {
    await statusFilter("Disattivi").click();
    await expect(path("/api/legacy")).toBeVisible();
    await expect(path("/api/health")).toHaveCount(0);
    await expect(path("/api/echo")).toHaveCount(0);
  });

  test("Reimposta filtri riporta il catalogo completo e riazzera i controlli", async ({ page }) => {
    await typeButton.click();
    await page.getByRole("menuitem", { name: "Handler" }).click();
    await statusFilter("Attivi").click();
    await expect(path("/api/health")).toHaveCount(0);

    await catalog.getByRole("button", { name: "Reimposta filtri" }).click();
    await expect(path("/api/health")).toBeVisible();
    await expect(path("/api/echo")).toBeVisible();
    await expect(typeButton).toHaveText(/Tutti/);
    await expect(statusFilter("Tutti")).toHaveAttribute("aria-checked", "true");
  });
});
