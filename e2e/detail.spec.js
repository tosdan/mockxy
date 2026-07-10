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

  test("mostra il percorso del file di definizione", async () => {
    await select("/api/users");
    await expect(detail.getByText(/api[\\/]users[\\/]GET\.endpoint\.json/)).toBeVisible();
  });

  test("mostra lo status e il body JSON della response", async () => {
    await select("/api/users");
    await expect(detail.getByText(/200/).first()).toBeVisible();
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
