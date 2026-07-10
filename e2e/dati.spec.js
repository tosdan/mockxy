const { test, expect } = require("@playwright/test");
const { gotoDati, clearDataFiles, resetWorkspace, E2E_BACKEND } = require("./helpers");

// E18 — scenario "Dati → handler". La pagina Dati carica file JSON che gli handler richiamano con
// data('nome'). Qui si esercita il giro completo attraverso la UI servita dal backend: si carica un
// file dalla pagina, un handler (creato via API) lo legge con data() e ne serve una versione
// manipolata; più rinomina, cancellazione e il rifiuto dei file non-json. Isolamento: clearDataFiles
// (svuota i file dati dalla run dir) prima e dopo; resetWorkspace rimuove l'handler creato.
test.describe("E18 · Dati → handler via data()", () => {
  test.beforeEach(async ({ request }) => {
    await clearDataFiles(request);
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
    await clearDataFiles(request);
  });

  // Carica un file dalla pagina Dati usando il vero input file (setInputFiles su input nascosto).
  async function uploadViaUi(page, name, jsonValue) {
    await page.locator('app-dati input[type="file"]').setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(jsonValue)),
    });
  }

  test("un file caricato dalla pagina Dati è leggibile da un handler con data()", async ({ page, request }) => {
    // arrange: un handler che filtra e mappa la collezione letta da data('utenti')
    const source = `module.exports = {
  async resolveResponse({ data }) {
    const utenti = await data("utenti");
    return { jsonBody: utenti.filter((u) => u.attivo).map((u) => u.nome) };
  }
};`;
    const created = await request.post(`${E2E_BACKEND}/_admin/api/mocks`, {
      data: { type: "handler", definition: { method: "GET", path: "/api/from-data" }, source },
    });
    expect(created.status()).toBe(201);

    // act: carica utenti.json dalla pagina Dati
    await gotoDati(page);
    await uploadViaUi(page, "utenti.json", [
      { nome: "Ada", attivo: true },
      { nome: "Bob", attivo: false },
      { nome: "Cleo", attivo: true },
    ]);

    // assert UI: toast di conferma (toaster globale) + snippet di riferimento nel dettaglio della pagina
    const dati = page.locator("app-dati");
    await expect(page.locator("ui-toaster").getByText("File caricato")).toBeVisible();
    await expect(dati.getByText("const utenti = await data('utenti');")).toBeVisible();

    // assert integrazione: l'handler legge il file e serve la lista filtrata (attende il reload runtime)
    await expect
      .poll(
        async () => {
          const res = await request.get(`${E2E_BACKEND}/api/from-data`);
          return res.ok() ? await res.json() : null;
        },
        { timeout: 8000 },
      )
      .toEqual(["Ada", "Cleo"]);
  });

  test("rinomina (normalizzata a lowercase) e cancellazione dalla pagina Dati", async ({ page, request }) => {
    await gotoDati(page);
    await uploadViaUi(page, "prezzi.json", { eur: 10 });

    const dati = page.locator("app-dati");
    await expect(dati.getByText("const prezzi = await data('prezzi');")).toBeVisible();

    // rinomina: matita → input (maiuscola, normalizzata dal server) → conferma
    await dati.locator('button:has(ng-icon[name="lucidePencil"])').click();
    await dati.locator("input[ui-input]").fill("Listino");
    await dati.locator('button[ui-button]:has(ng-icon[name="lucideCheck"])').click();
    await expect(dati.getByText("const listino = await data('listino');")).toBeVisible();

    // il nuovo nome è quello che vede il backend
    const afterRename = await (await request.get(`${E2E_BACKEND}/_admin/api/files`)).json();
    expect(afterRename.items.map((f) => f.name)).toEqual(["listino"]);

    // cancellazione con conferma → torna allo stato vuoto
    await dati.getByRole("button", { name: "Elimina" }).click();
    await dati.getByRole("button", { name: "Conferma" }).click();
    await expect(dati.getByText("Nessun file dati.")).toBeVisible();
  });

  test("rinominare un file usato riscrive i riferimenti data() e l'endpoint continua a funzionare", async ({ page, request }) => {
    // arrange: un handler che legge data('sorgente')
    const source = `module.exports = {
  async resolveResponse({ data }) {
    const rows = await data("sorgente");
    return { jsonBody: rows.map((r) => r.n) };
  }
};`;
    const created = await request.post(`${E2E_BACKEND}/_admin/api/mocks`, {
      data: { type: "handler", definition: { method: "GET", path: "/api/legge-sorgente" }, source },
    });
    expect(created.status()).toBe(201);

    // carica il file dalla pagina Dati → l'endpoint lo legge
    await gotoDati(page);
    await uploadViaUi(page, "sorgente.json", [{ n: "uno" }, { n: "due" }]);
    const dati = page.locator("app-dati");
    await expect(dati.getByText("const sorgente = await data('sorgente');")).toBeVisible();
    await expect
      .poll(async () => {
        const res = await request.get(`${E2E_BACKEND}/api/legge-sorgente`);
        return res.ok() ? await res.json() : null;
      }, { timeout: 8000 })
      .toEqual(["uno", "due"]);

    // rinomina con l'opzione (pre-selezionata perché il file è usato) → riscrive i riferimenti
    await dati.locator('button:has(ng-icon[name="lucidePencil"])').click();
    await expect(dati.locator("ui-checkbox")).toBeVisible();
    await dati.locator("input[ui-input]").fill("dataset");
    await dati.locator('button[ui-button]:has(ng-icon[name="lucideCheck"])').click();
    await expect(dati.getByText("const dataset = await data('dataset');")).toBeVisible();

    // l'endpoint continua a rispondere leggendo il file rinominato (riferimento riscritto + reload)
    await expect
      .poll(async () => {
        const res = await request.get(`${E2E_BACKEND}/api/legge-sorgente`);
        return res.ok() ? await res.json() : null;
      }, { timeout: 8000 })
      .toEqual(["uno", "due"]);
  });

  test("un file non-json viene rifiutato senza toccare l'elenco", async ({ page }) => {
    await gotoDati(page);
    await page.locator('app-dati input[type="file"]').setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("non json"),
    });

    await expect(page.locator("ui-toaster").getByText("Solo file JSON")).toBeVisible();
    await expect(page.locator("app-dati").getByText("Nessun file dati.")).toBeVisible();
  });
});
