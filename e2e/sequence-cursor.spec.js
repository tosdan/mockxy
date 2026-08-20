const { test, expect } = require("@playwright/test");
const { gotoMocks, mockIdByPath, resetWorkspace, E2E_BACKEND } = require("./helpers");

// Il cursore runtime dentro il riepilogo della sequence: la banda dice CHI RISPONDE ADESSO, non
// dove ci si trova. La differenza è sostanziale — il motore avanza il cursore appena esaurita la
// quota di uno step times (src/mocks/sequence-state.js), quindi dopo 2 richieste su uno step
// "2 volte" lo stato esposto è già il passo successivo. Questi test attraversano tutto lo stack
// (richieste vere al mock server) proprio per fissare quella semantica.
//
// /api/status ha due varianti nelle fixture: la terza la crea il test, perché con soli due step
// il secondo sarebbe già quello finale e non si vedrebbe mai un passo "ancora da fare".
const THIRD_VARIANT = { type: "mock", title: "Manutenzione", status: 503, body: { errore: "in manutenzione" } };
const SEQUENCE = {
  type: "sequence",
  title: "Degrado",
  steps: [
    { response: "001.response.json", times: 2 },
    { response: "002.response.json", times: 2 },
    { response: "003.response.json" },
  ],
  onEnd: "stay",
};

async function createSequence(request) {
  const id = await mockIdByPath(request, "/api/status");
  const third = await request.post(`${E2E_BACKEND}/_admin/api/mocks/${id}/responses`, { data: THIRD_VARIANT });
  expect(third.ok()).toBeTruthy();
  const response = await request.post(`${E2E_BACKEND}/_admin/api/mocks/${id}/responses`, { data: SEQUENCE });
  expect(response.ok()).toBeTruthy();
  return { id, sequenceFile: (await response.json()).selectedResponseFile };
}

/** Chiama il mock vero: è l'unico modo di far muovere il cursore. */
async function serve(request, times) {
  for (let i = 0; i < times; i += 1) {
    await request.get(`${E2E_BACKEND}/api/status`);
  }
}

async function openStatusDetail(page) {
  await gotoMocks(page);
  await page.locator("mocks-next-catalog").getByText("/api/status", { exact: true }).click();
  const summary = page.locator("mocks-next-sequence-summary");
  await expect(summary.getByText(/Nessuna richiesta ancora/)).toBeVisible();
  return summary;
}

test.describe("Sequence · il cursore runtime nel riepilogo", () => {
  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  test("mai servita: la banda lo dichiara e non si può azzerare niente", async ({ page, request }) => {
    await createSequence(request);
    const summary = await openStatusDetail(page);

    await expect(summary.getByRole("button", { name: /Riparti dall'inizio/ })).toBeDisabled();
    // Nessuno step è "in corso": il primo risponderà, ma non è ancora successo niente.
    await expect(summary.getByText(/servite/)).toHaveCount(0);
  });

  test("esaurita la quota di uno step, la banda annuncia già il passo successivo", async ({ page, request }) => {
    await createSequence(request);
    const summary = await openStatusDetail(page);

    // Due richieste esauriscono "001.response.json · 2 volte": il cursore è già sul passo 2.
    await serve(request, 2);

    await expect(summary.getByText(/La prossima richiesta risponde col passo 2/)).toBeVisible({ timeout: 10000 });
    // E non deve MAI dire "passo 1": è quello appena finito, non quello che risponderà.
    await expect(summary.getByText(/risponde col passo 1/)).toHaveCount(0);
  });

  test("lo step servito si spegne, quello che risponde adesso è in evidenza", async ({ page, request }) => {
    await createSequence(request);
    const summary = await openStatusDetail(page);

    // Una sola richiesta su "2 volte": il cursore resta sul passo 1, con l'avanzamento a metà.
    await serve(request, 1);
    await expect(summary.getByText(/La prossima richiesta risponde col passo 1/)).toBeVisible({ timeout: 10000 });
    await expect(summary.getByText("servite 1 di 2")).toBeVisible();

    await serve(request, 1);
    await expect(summary.getByText(/risponde col passo 2/)).toBeVisible({ timeout: 10000 });
    // Il passo 1 ha finito: la sua riga perde il numero e prende la spunta.
    await expect(summary.locator("ol > li").first().locator("ng-icon[aria-label]")).toBeVisible();
  });

  test("arrivata all'ultimo step con onEnd \"stay\", la sequenza dichiara che resta lì", async ({ page, request }) => {
    await createSequence(request);
    const summary = await openStatusDetail(page);

    // 2 + 2 richieste esauriscono i due step a quota: si resta sul terzo, che non ha criterio.
    await serve(request, 4);

    await expect(summary.getByText(/Ogni richiesta risponde col passo 3, l'ultimo/)).toBeVisible({ timeout: 10000 });
    await expect(summary.getByText(/003\.response\.json/).first()).toBeVisible();
  });

  test("Riparti dall'inizio riporta la sequenza allo stato vergine", async ({ page, request }) => {
    await createSequence(request);
    const summary = await openStatusDetail(page);
    await serve(request, 2);
    await expect(summary.getByText(/risponde col passo 2/)).toBeVisible({ timeout: 10000 });

    await summary.getByRole("button", { name: /Riparti dall'inizio/ }).click();

    await expect(summary.getByText(/Nessuna richiesta ancora/)).toBeVisible();
    await expect(summary.getByText(/risponde col passo/)).toHaveCount(0);
  });
});
