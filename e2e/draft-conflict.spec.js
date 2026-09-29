const { test, expect } = require("@playwright/test");
const { gotoMocks, mockIdByPath, resetWorkspace, E2E_BACKEND } = require("./helpers");

// Piano agent/API, §13 C4 — bozze della GUI protette da revisione, contro il motore reale: un
// agente scrive la stessa risorsa mentre la bozza è aperta, il salvataggio riceve 409 e la bozza
// resta; confronto, ricarica e "Salva la mia versione" usano le revisioni vere. Scrittura:
// l'afterEach ripristina le fixture.
test.describe("E20 · conflitti delle bozze", () => {
  let catalog;
  let detail;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    detail = page.locator("mocks-next-detail");
    await catalog.getByText("/api/status", { exact: true }).click();
    await expect(detail.getByText("Due response: OK e Non trovato")).toBeVisible();
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  const panel = () => detail.locator("mocks-next-draft-conflict");
  const api = (id, suffix = "") => `${E2E_BACKEND}/_admin/api/mocks/${id}${suffix}`;

  test("descrizione: il conflitto conserva il testo e si salva la propria versione dopo il confronto", async ({ page, request }) => {
    await detail.locator('button:not([ui-button]):has(ng-icon[name="lucidePencil"])').click();
    const input = detail.getByPlaceholder(/Descrizione endpoint/);
    await input.fill("");
    await input.pressSequentially("Scritta nella GUI");
    await expect(input).toHaveValue("Scritta nella GUI");

    // L'agente scrive la descrizione mentre la bozza è aperta (senza precondizione: forma legacy).
    const id = await mockIdByPath(request, "/api/status");
    const agentWrite = await request.put(api(id, "/endpoint"), { data: { description: "Scritta dall'agente" } });
    expect(agentWrite.ok()).toBe(true);

    await input.press("Enter");
    await expect(panel().getByText("La versione è cambiata mentre la modificavi")).toBeVisible();
    await expect(input).toHaveValue("Scritta nella GUI");

    await panel().getByRole("button", { name: "Confronta" }).click();
    await expect(panel().getByText("Scritta dall'agente")).toBeVisible();
    await panel().getByRole("button", { name: "Salva la mia versione" }).click();

    await expect(detail.getByText("Scritta nella GUI")).toBeVisible();
    await expect(panel()).toBeHidden();
    const saved = await (await request.get(api(id))).json();
    expect(saved.endpoint.description).toBe("Scritta nella GUI");
    expect(saved.endpoint.enabled).toBe(true);
  });

  test("variante: la bozza di A resta su A anche se l'agente modifica A e attiva B", async ({ page, request }) => {
    await detail.getByRole("button", { name: "Azioni sulla variante" }).click();
    await page.getByRole("menuitem", { name: "Modifica la response selezionata" }).click();
    const statusField = detail.locator("mocks-next-status-combobox input");
    await statusField.click();
    await statusField.press("ControlOrMeta+a");
    await statusField.pressSequentially("418");
    await statusField.press("Escape");

    // L'agente riscrive A (status 503) e attiva B mentre la bozza di A è aperta.
    const id = await mockIdByPath(request, "/api/status");
    const rewrite = await request.put(api(id, "/responses/001.response.json"), {
      data: { type: "mock", title: "OK", status: 503, headers: { "content-type": "application/json" }, delayMs: 0, body: { status: "agent" } },
    });
    expect(rewrite.ok()).toBe(true);
    const select = await request.put(api(id), { data: { selectedResponseFile: "002.response.json" } });
    expect(select.ok()).toBe(true);

    await detail.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(panel().getByText("La versione è cambiata mentre la modificavi")).toBeVisible();
    await expect(statusField).toHaveValue(/418/);

    // Ricarica: la bozza è modificata, quindi prima la conferma; poi la versione dell'agente.
    await panel().getByRole("button", { name: "Ricarica" }).click();
    await panel().getByRole("button", { name: "Sostituisci" }).click();
    await expect(panel().getByText("Bozza ricaricata dalla versione attuale.")).toBeVisible();
    await expect(statusField).toHaveValue(/503/);

    await statusField.click();
    await statusField.press("ControlOrMeta+a");
    await statusField.pressSequentially("418");
    await statusField.press("Escape");
    await detail.getByRole("button", { name: "Salva", exact: true }).click();
    await expect(detail.getByRole("button", { name: "Salva", exact: true })).toBeHidden();

    // Il salvataggio è andato su A, sopra la versione dell'agente; B resta com'era e attiva.
    const a = await (await request.get(api(id, "/responses/001.response.json"))).json();
    expect(a.response.status).toBe(418);
    expect(a.response.body).toEqual({ status: "agent" });
    const b = await (await request.get(api(id, "/responses/002.response.json"))).json();
    expect(b.response.status).toBe(404);
    expect(b.selected).toBe(true);
  });
});
