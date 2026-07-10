const { test, expect } = require("@playwright/test");
const { gotoMocks, resetWorkspace, E2E_BACKEND } = require("./helpers");

// E10 — riordino/reparent delle collection e drag-drop. La GEOMETRIA del drag (decisione into/line/
// none, indici) è già coperta a fondo dagli unit test `catalog-dnd.spec.ts` (12 test). Qui l'e2e
// verifica le operazioni via UI che reggono in modo affidabile: riordino e reparent dal menu, più
// un drag reale con pointer events come smoke del wiring cdkDrag. Scrittura: afterEach reset.
test.describe("E10 · riordino e drag-drop", () => {
  let catalog;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
  });

  test.afterEach(async ({ request, page }) => {
    await resetWorkspace(request, page);
  });

  const row = (text) => catalog.locator(".cdk-drag").filter({ hasText: text });
  const kebab = (text) => row(text).first().locator('button:has(ng-icon[name="lucideEllipsisVertical"])');
  const topOf = async (text) => (await catalog.getByText(text, { exact: true }).first().boundingBox()).y;

  test("riordina le collection root dal menu (Sposta giù)", async ({ page }) => {
    // ordine iniziale: Core API prima di Dynamic
    expect(await topOf("Core API")).toBeLessThan(await topOf("Dynamic"));

    await kebab("Core API").click();
    await page.getByRole("menuitem", { name: "Sposta giù" }).click();

    // ora Dynamic è prima di Core API
    await expect.poll(async () => (await topOf("Dynamic")) < (await topOf("Core API"))).toBe(true);
  });

  test("annida una collection sotto un'altra dal menu (Sposta sotto), poi la riporta a root", async ({ page, request }) => {
    // reparent Core API sotto Dynamic ("Sposta sotto" è un'etichetta di sezione; i target sono
    // menuitem diretti: "Livello principale" e le collection valide).
    await kebab("Core API").click();
    await page.getByRole("menuitem", { name: "Dynamic", exact: true }).click();

    // stato persistito: collection-core ha parentId collection-dynamic
    await expect
      .poll(async () => {
        const body = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks`)).json();
        return body.collections.find((c) => c.id === "collection-core")?.parentId;
      })
      .toBe("collection-dynamic");

    // riporta a root
    await kebab("Core API").click();
    await page.getByRole("menuitem", { name: "Livello principale" }).click();

    await expect
      .poll(async () => {
        const body = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks`)).json();
        return body.collections.find((c) => c.id === "collection-core")?.parentId ?? null;
      })
      .toBeNull();
  });

  test("drag-drop reale: trascina un endpoint dentro una collection", async ({ page, request }) => {
    // Core API ha 2 endpoint propri all'inizio.
    const src = catalog.getByText("/api/health", { exact: true });
    const target = catalog.getByText("Core API", { exact: true });
    const s = await src.boundingBox();
    const t = await target.boundingBox();

    // pointer events reali (cdkDrag li ascolta): premi sull'endpoint, muovi in più passi sopra la
    // banda centrale dell'intestazione della collection (drop "dentro"), rilascia.
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2 + 6);
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 20 });
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 5 });
    await page.mouse.up();

    // Verifica sullo STATO (persistito): health è finito in collection-core. Robusto al modo in cui
    // il DOM riflette lo spostamento.
    await expect
      .poll(async () => {
        const body = await (await request.get(`${E2E_BACKEND}/_admin/api/mocks`)).json();
        return body.items.find((i) => i.path === "/api/health")?.collectionId ?? "-";
      })
      .toBe("collection-core");
  });
});
