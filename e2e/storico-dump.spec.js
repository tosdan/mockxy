const { test, expect } = require("@playwright/test");
const {
  gotoStorico,
  setDumpEnabled,
  flushDump,
  clearDumps,
  clearMonitor,
  resetWorkspace,
  E2E_BACKEND,
} = require("./helpers");

// E17 — scenario "cattura → mock" dallo Storico dump (l'altra metà di E16, ma dalla cattura
// DUREVOLE su disco anziché dal traffico live). Attivo il dump del monitor, genero una richiesta
// non mockata, la scrivo su disco (flush); poi nello Storico la si seleziona e la si converte in un
// mock, oppure si crea da tutto il file, oppure si elimina il dump. Isolamento: clearDumps (ferma il
// dump ed elimina i file dalla run dir) + clearMonitor prima e dopo; resetWorkspace rimuove i mock.
test.describe("E17 · storico dump → crea mock", () => {
  test.beforeEach(async ({ request }) => {
    await clearDumps(request);
    await clearMonitor(request);
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
    await clearDumps(request);
    await clearMonitor(request);
  });

  // Genera una entry di dump su disco: attiva il dump, richiede un path non mockato, forza la
  // scrittura. L'evento monitor→dump può arrivare async dopo la risposta HTTP, quindi si fletta il
  // flush finché scrive almeno una entry; poi si ferma il dump (niente altre catture).
  async function seedDump(request) {
    await setDumpEnabled(request, true);
    await request.get(`${E2E_BACKEND}/api/dump-e2e`);
    await expect.poll(async () => await flushDump(request), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
    await setDumpEnabled(request, false);
  }

  // Righe con quando e da chi, e filtri applicati dal server su tutto l'archivio.
  test("le righe dicono provenienza, latenza e ora; i filtri trovano le voci in tutto l'archivio", async ({ page, request }) => {
    await setDumpEnabled(request, true);
    await request.get(`${E2E_BACKEND}/api/health`); // mock, 200
    await request.get(`${E2E_BACKEND}/api/dump-e2e`); // non mockata
    await request.get(`${E2E_BACKEND}/api/users`); // mock, 200
    await expect.poll(async () => await flushDump(request), { timeout: 8000 }).toBeGreaterThanOrEqual(3);
    await setDumpEnabled(request, false);

    await gotoStorico(page);
    const storico = page.locator("app-storico-dump");
    const rows = storico.getByRole("option");
    await expect(rows).toHaveCount(3);

    const health = rows.filter({ hasText: "/api/health" });
    await expect(health).toContainText("Mock");
    await expect(health).toContainText(/\d+ ms/);
    await expect(health).toContainText(/\d\d\/\d\d \d\d:\d\d:\d\d/);
    // Il path si tronca in testa: riga rtl, testo intero nel tooltip.
    await expect(health.locator('[dir="rtl"]')).toHaveAttribute("title", "/api/health");

    await storico.getByPlaceholder(/Filtra path/).fill("dump-e2e");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("/api/dump-e2e");
    await expect(storico.getByText("1 risultati")).toBeVisible();

    await storico.getByPlaceholder(/Filtra path/).fill("");
    await storico.getByRole("button", { name: "2xx" }).click();
    await expect(rows).toHaveCount(2);
    await storico.getByRole("button", { name: "2xx" }).click();
    await expect(rows).toHaveCount(3);
  });

  // Prima ogni clic sulla riga la apriva e insieme la spuntava.
  test("il clic sulla riga apre senza spuntare; la casella spunta; da tastiera frecce e Spazio", async ({ page, request }) => {
    await setDumpEnabled(request, true);
    for (const p of ["/api/uno-e2e", "/api/due-e2e", "/api/tre-e2e"]) await request.get(`${E2E_BACKEND}${p}`);
    await expect.poll(async () => await flushDump(request), { timeout: 8000 }).toBeGreaterThanOrEqual(3);
    await setDumpEnabled(request, false);

    await gotoStorico(page);
    const storico = page.locator("app-storico-dump");
    const rows = storico.getByRole("option");
    await expect(rows).toHaveCount(3);
    const current = storico.locator('[role="option"][aria-current="true"]');

    await rows.filter({ hasText: "/api/due-e2e" }).click();
    await expect(current).toContainText("/api/due-e2e");
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(0);

    await rows.filter({ hasText: "/api/tre-e2e" }).locator("[data-check]").click();
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(current).toContainText("/api/due-e2e"); // spuntare non apre

    // Il fuoco resta sulla lista: la voce attiva la dice aria-activedescendant.
    await expect(storico.getByRole("listbox")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(current).toContainText("/api/uno-e2e");
    await page.keyboard.press("Space");
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(2);
    await expect(storico.getByText("2 selezionate")).toBeVisible();
    const activeId = await storico.getByRole("listbox").getAttribute("aria-activedescendant");
    await expect(storico.locator(`[id="${activeId}"]`)).toContainText("/api/uno-e2e");
  });

  test("una entry selezionata nello storico diventa un mock nel catalogo", async ({ page, request }) => {
    await seedDump(request);

    await gotoStorico(page);
    const storico = page.locator("app-storico-dump");
    // .first(): il path compare nella riga della lista e nel pannello dettaglio (auto-focus).
    await expect(storico.getByText("/api/dump-e2e").first()).toBeVisible();

    // Seleziona tutte le entry caricate → crea mock dalla barra in fondo alla lista.
    await storico.getByRole("button", { name: "Seleziona caricate" }).click();
    await storico.getByRole("button", { name: "Crea mock", exact: true }).click();
    await expect(page.locator("ui-toaster").getByText("Mock creati")).toBeVisible();

    // Il mock compare nel catalogo (8 → 9).
    await page.getByRole("navigation", { name: "Viste" }).getByRole("link", { name: "Catalogo" }).click();
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("/api/dump-e2e", { exact: true })).toBeVisible();
    await expect(page.locator("app-status-bar").getByText(/9\s+endpoint/)).toBeVisible();
  });

  test("crea mock da tutto il file di dump (menu File)", async ({ page, request }) => {
    await seedDump(request);

    await gotoStorico(page);
    const storico = page.locator("app-storico-dump");
    await expect(storico.getByText("/api/dump-e2e").first()).toBeVisible();

    // Apri il menu "File (N)" e crea da tutto il file (selezione {file}, non {keys}).
    await storico.getByRole("button", { name: /File \(/ }).click();
    const menu = page.locator("[ui-menu]");
    await menu.getByRole("button", { name: "Tutto" }).click();
    await expect(page.locator("ui-toaster").getByText("Mock creati")).toBeVisible();

    await page.getByRole("navigation", { name: "Viste" }).getByRole("link", { name: "Catalogo" }).click();
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("/api/dump-e2e", { exact: true })).toBeVisible();
    await expect(page.locator("app-status-bar").getByText(/9\s+endpoint/)).toBeVisible();
  });

  test("elimina un file di dump dal menu File", async ({ page, request }) => {
    await seedDump(request);

    await gotoStorico(page);
    const storico = page.locator("app-storico-dump");
    await expect(storico.getByText("/api/dump-e2e").first()).toBeVisible();

    // Apri il menu "File (N)" ed elimina il dump (bottone col cestino).
    await storico.getByRole("button", { name: /File \(/ }).click();
    const menu = page.locator("[ui-menu]");
    await menu.locator('button:has(ng-icon[name="lucideTrash2"])').click();

    await expect(page.locator("ui-toaster").getByText("Dump eliminato")).toBeVisible();
    // Dopo l'eliminazione lo storico si ricarica e resta vuoto (nessun dump su disco).
    await expect(storico.getByText(/Nessun dump su disco/)).toBeVisible();
  });
});
