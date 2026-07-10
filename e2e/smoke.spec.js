const { test, expect } = require("@playwright/test");
const { gotoMocks } = require("./helpers");

// E0 — smoke: prova che l'impalcatura regge. Backend reale (fixture) + UI reale si parlano:
// il catalogo si popola con gli 8 endpoint noti e le 3 collezioni, senza errori in console.
test.describe("smoke", () => {
  test("l'app carica il catalogo dalle fixture note", async ({ page }) => {
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await gotoMocks(page);

    // Il footer riassume i conteggi: è l'assert più forte che backend→UI funziona.
    await expect(page.getByText(/3\s+collection/)).toBeVisible();

    // Alcuni percorsi delle fixture (first(): il selezionato appare anche nel dettaglio).
    await expect(page.getByText("/api/health").first()).toBeVisible();
    await expect(page.getByText("/api/echo").first()).toBeVisible();
    await expect(page.getByText("/api/enrich").first()).toBeVisible();

    // Le collezioni note nel catalogo.
    await expect(page.getByText("Core API")).toBeVisible();
    await expect(page.getByText("Dynamic")).toBeVisible();

    expect(errors).toEqual([]);
  });
});
