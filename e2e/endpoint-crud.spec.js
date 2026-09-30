const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace, E2E_BACKEND } = require("./helpers");

// E7 — CRUD endpoint: crea via dialog "Nuovo" (mock/handler), elimina dal dettaglio, copia verso
// un nuovo metodo+path. Scrittura: l'afterEach ripristina la run dir dalle fixture.
test.describe("E7 · CRUD endpoint", () => {
  let catalog;

  let statusBar;
  let detail;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");

    statusBar = page.locator("app-status-bar");
    detail = page.locator("mocks-next-detail");
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  test("crea un nuovo endpoint mock dal dialog Nuovo", async ({ page }) => {
    await page.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Mock", exact: true }).click();
    await page.getByPlaceholder("/es/risorsa/:id").fill("/api/nuovo-mock");
    await page.getByRole("button", { name: "Crea", exact: true }).click();

    await expect(catalog.getByText("/api/nuovo-mock", { exact: true })).toBeVisible();
    await expect(statusBar.getByText(/9\s+endpoint/)).toBeVisible();
  });

  test("una creazione riuscita senza dettaglio rilegge il nuovo endpoint", async ({ page, request }) => {
    await catalog.getByText("/api/health", { exact: true }).click();
    const info = await (await request.get(`${E2E_BACKEND}/_admin/api/info`)).json();
    // Congela soltanto l'evento catalogo: questo test verifica il pulsante di recupero,
    // prima che una rilettura automatica possa sostituirlo.
    await page.route("**/_admin/api/info", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.revisions.catalog = info.revisions.catalog;
      await route.fulfill({ response, json: body });
    });
    let createdId;
    await page.route("**/_admin/api/mocks", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      const body = await response.json();
      createdId = body.id;
      // La creazione avviene sul server reale. Simula solo il ramo di successo C1
      // nel quale la lettura successiva alla scrittura non compone il dettaglio.
      await route.fulfill({ response, json: { id: createdId, detailUnavailable: { message: "Dettaglio temporaneamente non disponibile" } } });
    });

    await catalog.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Mock", exact: true }).click();
    const dialog = page.locator("cdk-dialog-container");
    await page.getByPlaceholder("/es/risorsa/:id").fill("/api/nuovo-senza-dettaglio");
    await dialog.getByRole("button", { name: "Crea", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(detail.getByText("Dettaglio temporaneamente non disponibile")).toBeVisible();

    await detail.getByRole("button", { name: "Rileggi" }).click();

    await expect(detail.getByRole("heading", { name: "/api/nuovo-senza-dettaglio", exact: true })).toBeVisible();
    const saved = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks/${createdId}`)).json();
    expect(saved.path).toBe("/api/nuovo-senza-dettaglio");
  });

  test("una creazione con file senza dettaglio carica B e lascia A invariato", async ({ page, request }) => {
    await catalog.getByText("/api/health", { exact: true }).click();
    await expect(detail.getByRole("heading", { name: "/api/health", exact: true })).toBeVisible();
    const items = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks`)).json();
    const previousId = items.items.find((item) => item.path === "/api/health").id;
    const previous = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks/${previousId}`)).json();
    const previousBody = await (await request.get(`${E2E_BACKEND}/api/health`)).text();
    const info = await (await request.get(`${E2E_BACKEND}/_admin/api/info`)).json();
    // Il recupero automatico non deve mascherare la dipendenza dell'upload dalla selezione.
    await page.route("**/_admin/api/info", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.revisions.catalog = info.revisions.catalog;
      await route.fulfill({ response, json: body });
    });
    let createdId;
    await page.route("**/_admin/api/mocks", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      createdId = (await response.json()).id;
      await route.fulfill({ response, json: { id: createdId, detailUnavailable: { message: "Dettaglio temporaneamente non disponibile" } } });
    });
    const uploads = [];
    page.on("request", (req) => {
      const path = new URL(req.url()).pathname;
      if (req.method() === "PUT" && path.endsWith("/file")) uploads.push(path);
    });

    await catalog.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Mock", exact: true }).click();
    const dialog = page.locator("cdk-dialog-container");
    await dialog.getByPlaceholder("/es/risorsa/:id").fill("/api/nuovo-con-file");
    await dialog.getByRole("button", { name: "File", exact: true }).click();
    const contents = "contenuto destinato solo a B";
    await dialog.locator('input[type="file"]').setInputFiles({ name: "body.txt", mimeType: "text/plain", buffer: Buffer.from(contents) });
    await dialog.getByRole("button", { name: "Crea", exact: true }).click();
    await expect(dialog).toBeHidden();

    expect(uploads).toEqual([`/_admin/api/mocks/${encodeURIComponent(createdId)}/responses/001.response.json/file`]);
    await expect(detail.getByRole("heading", { name: "/api/nuovo-con-file", exact: true })).toBeVisible();
    const served = await request.get(`${E2E_BACKEND}/api/nuovo-con-file`);
    expect(served.ok()).toBe(true);
    expect(await served.text()).toBe(contents);
    const after = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks/${previousId}`)).json();
    expect(after.responseRevision).toBe(previous.responseRevision);
    expect(after.response).toEqual(previous.response);
    expect(await (await request.get(`${E2E_BACKEND}/api/health`)).text()).toBe(previousBody);
  });

  test("crea un nuovo endpoint handler dal dialog Nuovo", async ({ page }) => {
    await page.getByRole("button", { name: "Nuovo", exact: true }).click();
    await page.getByRole("menuitem", { name: "Handler", exact: true }).click();
    await page.getByPlaceholder("/es/risorsa/:id").fill("/api/nuovo-handler");
    await page.getByRole("button", { name: "Crea", exact: true }).click();

    await expect(catalog.getByText("/api/nuovo-handler", { exact: true })).toBeVisible();
    // appare come handler (tipo etichettato sulla riga)
    await expect(
      catalog.locator(".cdk-drag").filter({ hasText: "/api/nuovo-handler" }).getByText("handler", { exact: true }),
    ).toBeVisible();
  });

  test("elimina un endpoint dal dettaglio", async ({ page }) => {
    await catalog.getByText("/api/health", { exact: true }).click();
    // L'eliminazione e' scesa nel menu "..." della testata: azione rara e distruttiva.
    await detail.getByRole("button", { name: "Altre azioni" }).click();
    await page.getByRole("menuitem", { name: "Elimina endpoint" }).click();
    await expect(detail.getByText(/Eliminare l'endpoint/)).toBeVisible();
    await detail.getByRole("button", { name: "Elimina", exact: true }).click();

    await expect(catalog.getByText("/api/health", { exact: true })).toHaveCount(0);
    await expect(statusBar.getByText(/7\s+endpoint/)).toBeVisible();
  });

  test("copia un endpoint verso un nuovo path", async ({ page }) => {
    await catalog.getByText("/api/users", { exact: true }).click();
    // "Copia" esatto: il blocco codice ha un bottone "Copia il codice" da escludere.
    await detail.getByRole("button", { name: "Copia", exact: true }).click();

    const dialog = page.locator("cdk-dialog-container");
    await expect(dialog).toBeVisible();
    await dialog.locator("input[ui-input]").fill("/api/users-copia");
    await dialog.getByRole("button", { name: "Copia", exact: true }).click();

    await expect(catalog.getByText("/api/users-copia", { exact: true })).toBeVisible();
    await expect(statusBar.getByText(/9\s+endpoint/)).toBeVisible();
  });
});
