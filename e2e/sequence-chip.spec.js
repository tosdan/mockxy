const { test, expect } = require("@playwright/test");
const { gotoMocks, mockIdByPath, resetWorkspace, E2E_BACKEND } = require("./helpers");

// SEQ come segnale visivo unico della sequenza attiva: badge nella riga del catalogo e chip nel
// pulsante Sequenza del dettaglio, entrambi nel verde del token --sequence. La sequenza viene
// attivata via admin API su /api/status (l'unica fixture con due varianti); scrittura su file →
// afterEach resetWorkspace.
const SEQUENCE = {
  enabled: true,
  steps: [{ response: "001.response.json", times: 2 }, { response: "002.response.json" }],
  onEnd: "stay",
};

// Il verde del token --sequence (styles.css): #6ee7b7.
const SEQUENCE_GREEN = "rgb(110, 231, 183)";

async function putSequence(request, sequence) {
  const id = await mockIdByPath(request, "/api/status");
  const response = await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}`, { data: { sequence } });
  expect(response.ok()).toBeTruthy();
}

test.describe("SEQ · badge nel catalogo e chip sul pulsante Sequenza", () => {
  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  test("con la sequenza attiva compaiono badge e chip, nel verde del token", async ({ page, request }) => {
    await putSequence(request, SEQUENCE);
    await gotoMocks(page);

    // Catalogo: la riga di /api/status porta il badge SEQ.
    const row = page.locator("mocks-next-catalog div.cursor-pointer", { hasText: "/api/status" }).first();
    await expect(row.getByText("SEQ", { exact: true })).toBeVisible();

    // Dettaglio: il pulsante Sequenza porta il chip SEQ.
    await page.locator("mocks-next-catalog").getByText("/api/status", { exact: true }).click();
    const sequenceButton = page.locator("mocks-next-detail").getByRole("button", { name: /Sequenza/ });
    const chip = sequenceButton.getByText("SEQ", { exact: true });
    await expect(chip).toBeVisible();

    // Il chip usa il verde del token --sequence, non la tinta brand: è il segnale "ben visibile".
    const color = await chip.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe(SEQUENCE_GREEN);
  });

  test("sequenza definita ma disattivata (enabled: false): nessun badge e nessun chip", async ({ page, request }) => {
    await putSequence(request, { ...SEQUENCE, enabled: false });
    await gotoMocks(page);

    const row = page.locator("mocks-next-catalog div.cursor-pointer", { hasText: "/api/status" }).first();
    await expect(row.getByText("SEQ", { exact: true })).toHaveCount(0);

    await page.locator("mocks-next-catalog").getByText("/api/status", { exact: true }).click();
    const sequenceButton = page.locator("mocks-next-detail").getByRole("button", { name: /Sequenza/ });
    await expect(sequenceButton).toBeVisible();
    await expect(sequenceButton.getByText("SEQ", { exact: true })).toHaveCount(0);
  });

  test("rimossa la sequenza, badge e chip spariscono", async ({ page, request }) => {
    await putSequence(request, SEQUENCE);
    await gotoMocks(page);
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("SEQ", { exact: true })).toBeVisible();

    await putSequence(request, null);
    await gotoMocks(page);

    await expect(catalog.getByText("SEQ", { exact: true })).toHaveCount(0);
    await catalog.getByText("/api/status", { exact: true }).click();
    const sequenceButton = page.locator("mocks-next-detail").getByRole("button", { name: /Sequenza/ });
    await expect(sequenceButton).toBeVisible();
    await expect(sequenceButton.getByText("SEQ", { exact: true })).toHaveCount(0);
  });
});
