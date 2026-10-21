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
    // Il conteggio della testata e' dei risultati, nel colore del filtro.
    await expect(storico.locator("ui-page-header ui-badge")).toHaveText("1");

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
    // Dalla voce piu' recente: l'ultima richiesta sta in cima.
    await expect(rows.nth(0)).toContainText("/api/tre-e2e");
    await expect(rows.nth(2)).toContainText("/api/uno-e2e");
    const current = storico.locator('[role="option"][aria-current="true"]');

    await rows.filter({ hasText: "/api/due-e2e" }).click();
    await expect(current).toContainText("/api/due-e2e");
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(0);

    await rows.filter({ hasText: "/api/tre-e2e" }).locator("[data-check]").click();
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(current).toContainText("/api/due-e2e"); // spuntare non apre

    // Il fuoco resta sulla lista: la voce attiva la dice aria-activedescendant.
    await expect(storico.getByRole("listbox")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(current).toContainText("/api/uno-e2e");
    await page.keyboard.press("Space");
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(2);
    await expect(storico.getByText("2 selezionate")).toBeVisible();
    const activeId = await storico.getByRole("listbox").getAttribute("aria-activedescendant");
    await expect(storico.locator(`[id="${activeId}"]`)).toContainText("/api/uno-e2e");
  });

  // Lista virtualizzata: scorrendo lontano la riga attiva esce dal DOM. La lista non deve indicare
  // un elemento che non c'e', e i tasti devono riportare in vista la voce su cui agiscono.
  test("la voce attiva resta in vista: End e Spazio con la barra che compare, scroll lontano, rientro da tastiera", async ({ page, request }) => {
    await setDumpEnabled(request, true);
    for (let i = 0; i < 40; i += 1) await request.get(`${E2E_BACKEND}/api/riga-${i}`);
    await expect.poll(async () => await flushDump(request), { timeout: 8000 }).toBeGreaterThanOrEqual(40);
    await setDumpEnabled(request, false);

    await gotoStorico(page);
    const storico = page.locator("app-storico-dump");
    const list = storico.getByRole("listbox");
    // La voce indicata da aria-activedescendant, una volta che la lista la indica.
    const active = async () => {
      await expect(list).toHaveAttribute("aria-activedescendant", /^storico-entry-\d+$/);
      return storico.locator(`[id="${await list.getAttribute("aria-activedescendant")}"]`);
    };
    const first = storico.getByRole("option").first();
    const firstPath = (await first.locator('[dir="rtl"]').getAttribute("title")) ?? "";

    // End e Spazio da selezione vuota: la barra delle azioni che compare accorcia la lista, e
    // l'ultima riga, appena spuntata, deve restare tutta in vista.
    await first.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Space");
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(await active()).toHaveAttribute("aria-selected", "true");
    await expect(await active()).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Space");
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(0);
    await page.keyboard.press("Home");
    // Home riporta in cima, ma le righe si ridisegnano un attimo dopo: cliccando prima, "la prima
    // riga" sarebbe ancora una delle ultime, e Playwright la scorrerebbe in vista cliccando altro.
    await expect(first).toContainText(firstPath);

    await first.click();
    await expect(list).toBeFocused();
    await expect(await active()).toContainText(firstPath);

    const scrollAway = () => list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await scrollAway();
    await expect(storico.locator(`[id="storico-entry-0"]`)).toHaveCount(0);
    await expect(list).not.toHaveAttribute("aria-activedescendant", /.*/);

    // Fuori e dentro con Tab: la voce attiva torna in vista.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(list).toBeFocused();
    await expect(await active()).toContainText(firstPath);
    await expect(await active()).toBeInViewport({ ratio: 1 });

    // Spazio dopo aver scorso via: spunta la voce attiva, mostrandola.
    await scrollAway();
    await expect(list).not.toHaveAttribute("aria-activedescendant", /.*/);
    await page.keyboard.press("Space");
    await expect(storico.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(await active()).toHaveAttribute("aria-selected", "true");
    await expect(await active()).toContainText(firstPath);
    await expect(await active()).toBeInViewport({ ratio: 1 });
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
