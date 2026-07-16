const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace, E2E_BACKEND } = require("./helpers");

// Il mock WebSocket end-to-end: endpoint con variante ws creato via admin API, WebSocket VERA
// aperta dal browser, copione ricevuto, console con transcript bidirezionale, push broadcast
// dalla console e regola di risposta. Scritture su file → afterEach resetWorkspace.
const WS_URL = `${E2E_BACKEND.replace("http", "ws")}/api/live`;

async function createWsEndpoint(request) {
  const created = await request.post(`${E2E_BACKEND}/_admin/api/mocks`, {
    data: { config: { method: "GET", path: "/api/live", status: 200, headers: {} }, body: {} },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id;

  const response = await request.post(`${E2E_BACKEND}/_admin/api/mocks/${id}/responses`, {
    data: {
      type: "ws",
      title: "Canale live",
      script: [{ afterMs: 0, data: { tipo: "benvenuto" } }],
      rules: [{ match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] }],
    },
  });
  expect(response.status()).toBe(201);
  const detail = await response.json();
  const wsFile = detail.responses.find((entry) => entry.type === "ws").fileName;

  const selected = await request.put(`${E2E_BACKEND}/_admin/api/mocks/${id}`, {
    data: { selectedResponseFile: wsFile },
  });
  expect(selected.status()).toBe(200);
  return id;
}

test.describe("mock WebSocket · copione, console e regole", () => {
  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  test("il browser si connette al mock, la console fa la regia, le regole rispondono", async ({ page, request }) => {
    // gotoMocks asserisce il footer delle fixture (8 endpoint): la creazione del nono avviene
    // dopo, e un reload porta il catalogo aggiornato.
    await gotoMocks(page);
    await createWsEndpoint(request);
    await page.reload();

    // Il dettaglio dell'endpoint ws mostra la console al posto della preview del body.
    await page.locator("mocks-next-catalog").getByText("/api/live", { exact: true }).click();
    const console_ = page.locator("mocks-next-ws-console");
    await expect(console_).toBeVisible();

    // WebSocket vera dal contesto della pagina: il copione parte alla connessione.
    await page.evaluate((url) => {
      window.wsMessages = [];
      window.wsSocket = new WebSocket(url);
      window.wsSocket.onmessage = (event) => window.wsMessages.push(event.data);
    }, WS_URL);
    await expect.poll(() => page.evaluate(() => window.wsMessages)).toEqual(['{"tipo":"benvenuto"}']);

    // La console vede la connessione (polling ogni 2s) e il messaggio del copione nel transcript.
    await expect(console_.getByText(/#\d+/)).toBeVisible({ timeout: 8000 });
    await expect(console_.getByText('{"tipo":"benvenuto"}')).toBeVisible();

    // Regia manuale: il push dalla console arriva alla WebSocket del browser (broadcast).
    await console_.locator("textarea").fill('{"tipo":"promo"}');
    await console_.getByRole("button", { name: /Invia a tutti/ }).click();
    await expect
      .poll(() => page.evaluate(() => window.wsMessages))
      .toEqual(['{"tipo":"benvenuto"}', '{"tipo":"promo"}']);

    // Regola: il client parla, il mock risponde solo a lui; il transcript mostra il ricevuto.
    await page.evaluate(() => window.wsSocket.send("ping"));
    await expect
      .poll(() => page.evaluate(() => window.wsMessages))
      .toEqual(['{"tipo":"benvenuto"}', '{"tipo":"promo"}', "pong"]);
    await expect(console_.getByText("ricevuto")).toBeVisible({ timeout: 8000 });
    await expect(console_.getByText("regola")).toBeVisible();

    await page.evaluate(() => window.wsSocket.close());
  });

  test("una GET normale sull'endpoint ws risponde 426 Upgrade Required", async ({ request }) => {
    await createWsEndpoint(request);

    const response = await request.get(`${E2E_BACKEND}/api/live`);
    expect(response.status()).toBe(426);
    expect((await response.json()).error).toBe("Upgrade Required");
  });
});
