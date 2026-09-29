const http = require("http");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { AGENT_BACKEND } = require("./backend-url");
const { MockxyAdmin } = require("./agent-setup/mockxy-admin");
const { ORDERS, PROGRESS, ORDERS_TARGET, SCENARIO_HTML, setupAgentScenario } = require("./agent-setup/scenario");

// Collaudo ripetibile del primo caso (piano agent/API, §9 S6 e §13 C6): lo stesso setup via API,
// da stati di partenza diversi e senza ripristino fra un caso e l'altro, dà lo stesso risultato nel
// browser e lo stesso traffico nel Monitor. Gira sul backend separato del workspace di fixture.
const MOCKS_DIR = path.join(__dirname, "..", "workspace-agent-test", ".run", "mocks");
// Configurazione di avvio da cui dipende il caso (la prepara playwright.config.js).
const REQUIRED_CONFIG = { backendUrl: null, proxyFallbackEnabled: false, globalDelayMs: 0, delayAllRequests: false };
const SCENARIO_URL = `${AGENT_BACKEND}/__agent-test__/scenario`;

async function connect() {
  const admin = new MockxyAdmin(AGENT_BACKEND);
  await admin.connect({ mocksDir: MOCKS_DIR, requireConfig: REQUIRED_CONFIG });
  return admin;
}

const isOrders = (item) => item.method === "GET" && item.path === ORDERS.path;
const isProgress = (item) => item.method === "GET" && item.path === PROGRESS.path;

async function runScenario(page, admin) {
  await setupAgentScenario(admin);
  // Il cursore si prende dopo preparazione, attivazione e reset, prima dell'azione del browser.
  const cursor = await admin.monitorCursor();

  // Playwright fornisce solo l'HTML, all'URL esatto sull'origine di Mockxy: le fetch della pagina
  // attraversano davvero Mockxy.
  await page.route(SCENARIO_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: SCENARIO_HTML }),
  );
  await page.goto(SCENARIO_URL);
  await expect(page.getByTestId("orders")).toHaveText("o-1");
  const refresh = page.getByRole("button", { name: "Aggiorna avanzamento" });
  await refresh.click();
  await expect(page.getByTestId("progress")).toHaveText("pending");
  await refresh.click();
  await expect(page.getByTestId("progress")).toHaveText("done");

  // Fra le voci successive al cursore, senza pretendere che siano solo queste (favicon e altro
  // traffico accessorio non contano): un gap farebbe fallire readTraffic.
  const traffic = await admin.readTraffic(cursor, {}, {
    until: (items) => items.filter(isOrders).length >= 1 && items.filter(isProgress).length >= 2,
  });
  expect(traffic.filter(isOrders).map((item) => item.status)).toEqual([200]);
  expect(traffic.filter(isProgress).map((item) => item.status)).toEqual([202, 200]);
}

test.describe("E22 · setup ripetibile via API", () => {
  test("A: parte con la variante alternativa selezionata e la sequence già consumata", async ({ page }) => {
    const admin = await connect();
    const orders = await admin.findEndpoint(ORDERS.method, ORDERS.path);
    await admin.select(orders.id, ORDERS.alternative);
    // Una prova precedente ha lasciato sul target un ritardo lungo e il templating acceso: un
    // aggiornamento conserva i campi omessi, quindi il setup deve dichiararli.
    const leftover = await fetch(`${AGENT_BACKEND}/_admin/api/mocks/${orders.id}/responses/${ORDERS.target}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "mock", delayMs: 30000, templated: true }),
    });
    expect(leftover.status).toBe(200);
    // La sequence si consuma prima del setup, mai fra il reset e la prova.
    await fetch(`${AGENT_BACKEND}${PROGRESS.path}`);
    await fetch(`${AGENT_BACKEND}${PROGRESS.path}`);
    expect((await fetch(`${AGENT_BACKEND}${ORDERS.path}`)).status).toBe(503);
    expect(await (await fetch(`${AGENT_BACKEND}${PROGRESS.path}`)).json()).toEqual({ state: "done" });

    await runScenario(page, admin);
  });

  test("B: parte con gli endpoint disabilitati e Proxy All attivo", async ({ page }) => {
    const admin = await connect();
    const orders = await admin.findEndpoint(ORDERS.method, ORDERS.path);
    const progress = await admin.findEndpoint(PROGRESS.method, PROGRESS.path);
    await admin.setEnabled([orders.id, progress.id], false);
    await admin.mutate("PATCH", "/server", { proxyAll: true }, "Enabling Proxy All");
    expect((await fetch(`${AGENT_BACKEND}${ORDERS.path}`)).status).not.toBe(200);

    await runScenario(page, admin);
  });

  test("C: lo stesso setup ripetuto senza ripristino dà lo stesso risultato", async ({ page }) => {
    const admin = await connect();
    await runScenario(page, admin);
    await runScenario(page, admin);
  });
});

test.describe("E22 · diagnostica del setup", () => {
  test("workspace sbagliato: si ferma prima di cambiare qualunque cosa", async () => {
    const admin = new MockxyAdmin(AGENT_BACKEND);
    await expect(admin.connect({ mocksDir: path.join(__dirname, "..", "workspace-test", "mocks") })).rejects.toMatchObject({ code: "WRONG_WORKSPACE" });
  });

  test("configurazione diversa da quella richiesta dal test", async () => {
    const admin = new MockxyAdmin(AGENT_BACKEND);
    await expect(admin.connect({ mocksDir: MOCKS_DIR, requireConfig: { globalDelayMs: 250 } })).rejects.toMatchObject({ code: "CONFIG_MISMATCH" });
  });

  test("runtime senza /info né contratto: lo dice e non tenta mutazioni", async () => {
    const calls = [];
    const server = http.createServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const admin = new MockxyAdmin(`http://127.0.0.1:${server.address().port}`);
      await expect(admin.connect({ mocksDir: MOCKS_DIR })).rejects.toMatchObject({ code: "CONTRACT_UNVERIFIABLE" });
      expect(calls).toEqual(["GET /_admin/api/info"]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("precondizione fallita: nessun nuovo tentativo né sovrascrittura", async () => {
    const admin = await connect();
    const orders = await admin.findEndpoint(ORDERS.method, ORDERS.path);
    const { revision } = await admin.readVariant(orders.id, ORDERS.target);
    // Un altro client cambia la variante dopo la lettura.
    const other = await fetch(`${AGENT_BACKEND}/_admin/api/mocks/${orders.id}/responses/${ORDERS.target}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "mock", title: "Cambiata altrove", status: 201 }),
    });
    expect(other.status).toBe(200);

    await expect(admin.writeVariant(orders.id, ORDERS.target, ORDERS_TARGET, revision)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await admin.readVariant(orders.id, ORDERS.target)).response).toMatchObject({ title: "Cambiata altrove", status: 201 });
  });

  test("una modifica rifiutata dal motore porta il suo codice nell'errore", async () => {
    const admin = await connect();
    const orders = await admin.findEndpoint(ORDERS.method, ORDERS.path);
    await expect(admin.prepareVariant(orders.id, ORDERS.target, { ...ORDERS_TARGET, status: 42 }, { allowActive: true })).rejects.toMatchObject({
      code: "NOT_APPLIED",
      details: { code: "MUTATION_REJECTED" },
    });
  });

  test("uno step della sequence selezionata è attivo anche se non selezionato", async () => {
    const admin = await connect();
    await setupAgentScenario(admin);
    const progress = await admin.findEndpoint(PROGRESS.method, PROGRESS.path);
    const step = await admin.readVariant(progress.id, PROGRESS.pending);
    expect(step).toMatchObject({ selected: false, active: true });
    await expect(admin.prepareVariant(progress.id, PROGRESS.pending, { title: "Senza dichiararlo" })).rejects.toMatchObject({ code: "ACTIVE_VARIANT" });
  });

  // Codex, #34: la scadenza vale per tutta l'attesa, anche con una risposta lenta o durante una
  // paginazione che non finisce.
  test("la scadenza del traffico interrompe una risposta lenta e una paginazione senza fine", async () => {
    let slowCalls = 0;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://stub");
      const since = Number(url.searchParams.get("since"));
      const page = (runtimeId) => JSON.stringify({
        items: [],
        cursor: { runtimeId, generation: 1, since: String(since + 1) },
        hasMore: true,
        gap: false,
        gapReason: null,
        available: { oldestId: null, newestId: null, highWatermark: String(since + 1) },
      });
      if (url.searchParams.get("runtimeId") === "slow") {
        slowCalls += 1;
        setTimeout(() => res.writeHead(200, { "content-type": "application/json" }).end(page("slow")), 2000);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(page("paged"));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const admin = new MockxyAdmin(`http://127.0.0.1:${server.address().port}`);
      for (const runtimeId of ["slow", "paged"]) {
        const started = Date.now();
        await expect(admin.readTraffic({ runtimeId, generation: 1, since: "0" }, {}, { timeoutMs: 100 })).rejects.toMatchObject({ code: "TRAFFIC_TIMEOUT" });
        expect(Date.now() - started).toBeLessThan(1000);
      }
      expect(slowCalls).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("un gap del Monitor ferma la verifica invece di concludere «nessuna richiesta»", async () => {
    const admin = await connect();
    const cursor = await admin.monitorCursor();
    await fetch(`${AGENT_BACKEND}/_admin/api/monitoring/requests`, { method: "DELETE" });
    await expect(admin.readTraffic(cursor)).rejects.toMatchObject({ code: "MONITOR_GAP", details: { gapReason: "cleared" } });
  });
});
