const { test, expect } = require("@playwright/test");
const { gotoMocks, mockIdByPath, resetWorkspace, E2E_BACKEND } = require("./helpers");

// SEQ come segnale visivo unico della sequence selezionata: badge nella riga del catalogo e chip
// accanto alla tendina delle varianti, entrambi nel verde del token --sequence. La response viene
// creata e quindi selezionata via admin API su /api/status (l'unica fixture con due varianti);
// scrittura su file → afterEach resetWorkspace.
const SEQUENCE = {
  type: "sequence",
  title: "Polling",
  steps: [{ response: "001.response.json", times: 2 }, { response: "002.response.json" }],
  onEnd: "stay",
};

// Il verde del token --sequence (styles.css): #6ee7b7.
const SEQUENCE_GREEN = "rgb(110, 231, 183)";

async function createSequence(request) {
  const id = await mockIdByPath(request, "/api/status");
  const response = await request.post(`${E2E_BACKEND}/_admin/api/mocks/${id}/responses`, {
    data: SEQUENCE,
  });
  expect(response.ok()).toBeTruthy();
  const detail = await response.json();
  return { id, sequenceFile: detail.selectedResponseFile };
}

async function selectResponse(request, id, responseFileName) {
  const response = await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}`, {
    data: { selectedResponseFile: responseFileName },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("SEQ · badge nel catalogo e chip nella barra delle varianti", () => {
  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  test("con la sequenza attiva compaiono badge e chip, nel verde del token", async ({ page, request }) => {
    await createSequence(request);
    await gotoMocks(page);

    // Catalogo: la riga di /api/status porta il badge SEQ.
    const row = page.locator("mocks-next-catalog div.cursor-pointer", { hasText: "/api/status" }).first();
    await expect(row.getByText("SEQ", { exact: true })).toBeVisible();

    // Dettaglio: il chip SEQ sta nella barra delle varianti, accanto alla tendina.
    await page.locator("mocks-next-catalog").getByText("/api/status", { exact: true }).click();
    const chip = page.locator("mocks-next-detail ui-chip").getByText("SEQ", { exact: true });
    await expect(chip).toBeVisible();

    // Il chip usa il verde del token --sequence, non la tinta brand: è il segnale "ben visibile".
    const color = await chip.evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe(SEQUENCE_GREEN);
  });

  test("selezionando una response ordinaria la sequence resta definita ma non è attiva", async ({ page, request }) => {
    const { id } = await createSequence(request);
    await selectResponse(request, id, "001.response.json");
    await gotoMocks(page);

    const row = page.locator("mocks-next-catalog div.cursor-pointer", { hasText: "/api/status" }).first();
    await expect(row.getByText("SEQ", { exact: true })).toHaveCount(0);

    await page.locator("mocks-next-catalog").getByText("/api/status", { exact: true }).click();
    await expect(page.locator("mocks-next-detail").getByText("SEQ", { exact: true })).toHaveCount(0);
  });

  test("eliminando la response sequence selezionata, badge e chip spariscono", async ({ page, request }) => {
    const { id, sequenceFile } = await createSequence(request);
    await gotoMocks(page);
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("SEQ", { exact: true })).toBeVisible();

    const deleted = await request.delete(
      `${E2E_BACKEND}/_admin/api/mocks/${id}/responses/${encodeURIComponent(sequenceFile)}`,
    );
    expect(deleted.ok()).toBeTruthy();
    await gotoMocks(page);

    await expect(catalog.getByText("SEQ", { exact: true })).toHaveCount(0);
    await catalog.getByText("/api/status", { exact: true }).click();
    await expect(page.locator("mocks-next-detail").getByText("SEQ", { exact: true })).toHaveCount(0);
  });
});
