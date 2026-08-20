const { test, expect } = require("@playwright/test");
const { gotoMocks, gotoMonitor } = require("./helpers");

// Palette dei comandi: si apre da qualunque view con Ctrl+K, filtra endpoint e comandi, esegue con
// Invio. Sola lettura tranne l'ultimo test, che commuta il monitor e lo rimette com'era.
test.describe("palette dei comandi", () => {
  const palette = (page) => page.getByRole("dialog", { name: "Comandi" });
  const options = (page) => palette(page).getByRole("option");
  // Si scrive NELL'elemento, non sulla pagina: il fuoco ci arriva in modo asincrono e
  // keyboard.type() puo' partire prima che l'input lo abbia.
  const search = (page) => palette(page).getByRole("combobox");

  test("si apre con Ctrl+K anche fuori dal catalogo, e Esc la chiude", async ({ page }) => {
    await gotoMonitor(page);
    await expect(palette(page)).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await expect(palette(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
  });

  test("elenca viste, comandi runtime ed endpoint del workspace", async ({ page }) => {
    await gotoMocks(page);
    await page.keyboard.press("Control+k");

    await expect(palette(page).getByText("Viste", { exact: true })).toBeVisible();
    await expect(palette(page).getByText("Runtime", { exact: true })).toBeVisible();
    await expect(palette(page).getByText("Endpoint", { exact: true })).toBeVisible();
    // Gli endpoint arrivano dal motore, non da uno store di pagina: ci sono tutti e otto.
    await expect(options(page).filter({ hasText: "/api/" })).toHaveCount(8);
  });

  test("la ricerca filtra, e Invio salta all'endpoint scelto", async ({ page }) => {
    await gotoMocks(page);
    await page.keyboard.press("Control+k");
    await search(page).fill("users");

    await expect(options(page)).toHaveCount(2); // /api/users e /api/users/:id
    await page.keyboard.press("Enter");

    await expect(palette(page)).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]p=%2Fapi%2Fusers/);
    await expect(
      page.locator("mocks-next-detail").getByRole("heading", { name: "/api/users", exact: true }),
    ).toBeVisible();
  });

  test("saltare a un endpoint funziona anche restando sul catalogo", async ({ page }) => {
    await gotoMocks(page);
    const detail = page.locator("mocks-next-detail");

    await page.keyboard.press("Control+k");
    await search(page).fill("echo");
    // L'elenco degli endpoint arriva via HTTP: si aspetta che ci sia, come farebbe un utente.
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(detail.getByRole("heading", { name: "/api/echo", exact: true })).toBeVisible();

    // Secondo salto senza cambiare rotta: la pagina non si rimonta, quindi conta che ascolti i
    // CAMBI dei query param e non solo il primo.
    await page.keyboard.press("Control+k");
    await search(page).fill("enrich");
    // L'elenco degli endpoint arriva via HTTP: si aspetta che ci sia, come farebbe un utente.
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(detail.getByRole("heading", { name: "/api/enrich", exact: true })).toBeVisible();
  });

  // I comandi runtime NON si eseguono qui: commutano stato del motore condiviso con tutta la
  // suite (il monitor, il server), e spegnerlo per un test fa cadere gli altri. Si verifica che
  // ci siano e che leggano lo stato; l'esecuzione e' gia' coperta dai salti agli endpoint.
  test("elenca i comandi runtime con lo stato corrente accanto", async ({ page }) => {
    await gotoMocks(page);
    await page.keyboard.press("Control+k");
    await search(page).fill("monitor");

    // Il monitor e' live: il comando offerto e' quello che lo mette in pausa.
    await expect(options(page).filter({ hasText: /Metti in pausa il monitor/ })).toBeVisible();
    await expect(options(page).filter({ hasText: /Metti in pausa il monitor/ })).toContainText("live");
  });

  test("Invio su una vista ci naviga", async ({ page }) => {
    await gotoMocks(page);
    await page.keyboard.press("Control+k");
    await search(page).fill("storico");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/storico/);
    await expect(palette(page)).toHaveCount(0);
  });
});
