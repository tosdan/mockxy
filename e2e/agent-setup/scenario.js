// Scenario del collaudo C6 (piano agent/API, §13 C6): due endpoint del workspace di fixture,
// risolti dal catalogo per metodo e path e lavorati per filename noto. Il setup prepara prima i
// contenuti con la revisione letta, poi attiva, poi azzera la sequence: funziona da qualunque
// stato abbia lasciato la prova precedente, senza ripristinarlo.

const JSON_HEADERS = { "content-type": "application/json" };

const ORDERS = { method: "GET", path: "/agent-test/orders", target: "001.response.json", alternative: "002.response.json" };
const PROGRESS = { method: "GET", path: "/agent-test/progress", pending: "001.response.json", done: "002.response.json", sequence: "003.response.json" };

const ORDERS_TARGET = { type: "mock", title: "Ordini", status: 200, headers: JSON_HEADERS, delayMs: 0, body: { orders: [{ id: "o-1" }] } };
const PROGRESS_PENDING = { type: "mock", title: "In corso", status: 202, headers: JSON_HEADERS, delayMs: 0, body: { state: "pending" } };
const PROGRESS_DONE = { type: "mock", title: "Completato", status: 200, headers: JSON_HEADERS, delayMs: 0, body: { state: "done" } };
// Primo step servito una volta, l'ultimo senza criterio; onEnd "stay"; nessun reset per inattività.
const PROGRESS_SEQUENCE = {
  type: "sequence",
  title: "Avanzamento",
  steps: [{ response: PROGRESS.pending, times: 1 }, { response: PROGRESS.done }],
  onEnd: "stay",
  resetAfterMs: null,
};

async function setupAgentScenario(admin) {
  const orders = await admin.findEndpoint(ORDERS.method, ORDERS.path);
  const progress = await admin.findEndpoint(PROGRESS.method, PROGRESS.path);
  await admin.requireVariants(orders.id, [ORDERS.target, ORDERS.alternative]);
  await admin.requireVariants(progress.id, [PROGRESS.pending, PROGRESS.done, PROGRESS.sequence]);

  // 2. Contenuti, con la revisione appena letta. Sono varianti che il setup riattiva e azzera
  // subito dopo: riscriverle anche se attive è voluto.
  await admin.prepareVariant(orders.id, ORDERS.target, ORDERS_TARGET, { allowActive: true });
  await admin.prepareVariant(progress.id, PROGRESS.pending, PROGRESS_PENDING, { allowActive: true });
  await admin.prepareVariant(progress.id, PROGRESS.done, PROGRESS_DONE, { allowActive: true });
  await admin.prepareVariant(progress.id, PROGRESS.sequence, PROGRESS_SEQUENCE, { allowActive: true });

  // 3. Attivazione, solo dopo che la preparazione è riuscita.
  await admin.serveMocks();
  await admin.select(orders.id, ORDERS.target);
  await admin.select(progress.id, PROGRESS.sequence);
  await admin.setEnabled([orders.id, progress.id], true);

  // 4. La sequence riparte dal primo step anche se era già selezionata.
  await admin.resetSequence(progress.id);
  return { orders, progress };
}

// Pagina di fixture: mostra l'ordine dopo la fetch degli ordini e, a ogni clic, lo stato
// dell'avanzamento. Le fetch usano path relativi sulla stessa origine di Mockxy.
const SCENARIO_HTML = `<!doctype html>
<html lang="it">
  <head><meta charset="utf-8"><title>Scenario agent-test</title></head>
  <body>
    <p>Ordine: <output data-testid="orders">…</output></p>
    <p>Avanzamento: <output data-testid="progress">—</output></p>
    <button type="button" id="refresh">Aggiorna avanzamento</button>
    <script>
      fetch("/agent-test/orders")
        .then((response) => response.json())
        .then((data) => { document.querySelector('[data-testid="orders"]').textContent = data.orders.map((order) => order.id).join(", "); });
      document.getElementById("refresh").addEventListener("click", () => {
        fetch("/agent-test/progress")
          .then((response) => response.json())
          .then((data) => { document.querySelector('[data-testid="progress"]').textContent = data.state; });
      });
    </script>
  </body>
</html>
`;

module.exports = { ORDERS, PROGRESS, ORDERS_TARGET, SCENARIO_HTML, setupAgentScenario };
