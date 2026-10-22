const { test, expect } = require("@playwright/test");
const { gotoMocks } = require("./helpers");

// E3 — dettaglio: selezione di una riga → header endpoint (metodo, percorso, descrizione), percorso
// file, status e body/headers della response; per gli script la sorgente al posto del body. Sola
// lettura: selezionare un endpoint fa solo GET del dettaglio, non scrive.
test.describe("E3 · dettaglio", () => {
  let catalog;
  let detail;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    detail = page.locator("mocks-next-detail");
  });

  const select = (p) => catalog.getByText(p, { exact: true }).click();

  test("mostra metodo, percorso e descrizione dell'endpoint selezionato", async () => {
    await select("/api/users");
    await expect(detail.getByRole("heading", { name: "/api/users", exact: true })).toBeVisible();
    await expect(detail.getByText("GET", { exact: true }).first()).toBeVisible();
    await expect(detail.getByText("Elenco utenti")).toBeVisible();
  });

  // A pannello stretto status e delay, a larghezza fissa, schiacciavano la tendina delle varianti
  // fino a nascondere quella attiva. Ora la tendina tiene una larghezza minima e status e delay
  // scendono sotto, insieme; il separatore fra i due gruppi sparisce quando vanno a capo.
  test("a pannello stretto la variante attiva resta leggibile, e status e delay vanno a capo", async ({ page }) => {
    await select("/api/status");
    const picker = detail.getByRole("combobox", { name: "Variante servita" });
    const status = detail.locator("mocks-next-status-combobox");
    const delay = detail.getByRole("spinbutton");
    const geometry = async () => ({ picker: await picker.boundingBox(), status: await status.boundingBox(), delay: await delay.boundingBox() });

    let g = await geometry();
    expect(Math.abs(g.picker.y - g.status.y)).toBeLessThan(8); // tutto su una riga

    await page.setViewportSize({ width: 1100, height: 800 });
    await expect.poll(async () => (await status.boundingBox()).y - (await picker.boundingBox()).y).toBeGreaterThan(20);
    g = await geometry();
    expect(g.picker.width).toBeGreaterThan(200);
    await expect(picker).toContainText(/OK/);
    expect(Math.abs(g.status.y + g.status.height / 2 - (g.delay.y + g.delay.height / 2))).toBeLessThan(4); // status e delay insieme
    // Il separatore, a capo, cade fuori dalla zona visibile della barra.
    const separatorVisible = await status.evaluate((el) => {
      const group = el.parentElement;
      const separator = group.querySelector('[aria-hidden="true"]');
      const clip = group.parentElement.getBoundingClientRect();
      return separator.getBoundingClientRect().right > clip.left;
    });
    expect(separatorVisible).toBe(false);
  });

  test("mostra il percorso del file di definizione", async () => {
    await select("/api/users");
    await expect(detail.getByText(/api[\\/]users[\\/]GET\.endpoint\.json/)).toBeVisible();
  });

  test("mostra lo status e il body JSON della response", async () => {
    await select("/api/users");
    await expect(detail.locator("mocks-next-status-combobox input")).toHaveValue(/200/);
    await expect(detail.getByText(/Ada Lovelace/)).toBeVisible();
    await expect(detail.getByText(/Alan Turing/)).toBeVisible();
  });

  test("mostra gli headers della response (content-type)", async () => {
    await select("/api/health");
    // La sezione Headers è un collapsible aperto di default: il content-type è già visibile.
    await expect(detail.getByText(/application\/json/)).toBeVisible();
  });

  test("per un handler mostra la sorgente resolveResponse invece del body", async () => {
    await select("/api/echo");
    await expect(detail.getByRole("heading", { name: "/api/echo", exact: true })).toBeVisible();
    await expect(detail.getByText("POST", { exact: true }).first()).toBeVisible();
    await expect(detail.getByText(/resolveResponse/)).toBeVisible();
  });

  test("per un middleware mostra la sorgente transformResponse", async () => {
    await select("/api/enrich");
    await expect(detail.getByText(/transformResponse/)).toBeVisible();
  });

  test("cambiando selezione, il dettaglio si aggiorna al nuovo endpoint", async () => {
    await select("/api/health");
    await expect(detail.getByRole("heading", { name: "/api/health", exact: true })).toBeVisible();
    await select("/api/admin/config");
    await expect(detail.getByRole("heading", { name: "/api/admin/config", exact: true })).toBeVisible();
    await expect(detail.getByText("Configurazione admin")).toBeVisible();
    // il precedente non è più nell'header del dettaglio
    await expect(detail.getByRole("heading", { name: "/api/health", exact: true })).toHaveCount(0);
  });
});
