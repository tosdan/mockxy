const { test, expect } = require("@playwright/test");
const { gotoMocks } = require("./helpers");

// E2 — ricerca e filtri: sola lettura (lo stato è tutto UI-locale, ripristinato da gotoMocks a ogni
// test). Stato e reset sono controlli in chiaro nella testata; il tipo resta un menu, overlay CDK a
// livello page, quindi le sue voci si cercano fuori dallo scope del catalogo.
/**
 * Contrasto fra il colore del testo di un elemento e il fondo che ci sta davvero sotto: gli strati
 * semitrasparenti degli antenati, dal primo opaco in su, composti su un canvas come li compone il
 * browser (anche i colori oklab/color-mix che getComputedStyle restituisce). Di un gradiente di
 * fondo conta il primo colore, il più coprente: per testo chiaro è la stima prudente.
 */
function contrastOf(locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const paint = (colors) => {
      context.clearRect(0, 0, 1, 1);
      for (const color of colors) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const gradient = style.backgroundImage.match(/(?:rgba?|oklab|oklch|color)\([^)]*\)/);
      if (gradient) layers.unshift(gradient[0]);
      layers.unshift(style.backgroundColor);
      if (paint([style.backgroundColor])[3] === 255) break;
    }
    const luminance = ([r, g, b]) => {
      const [lr, lg, lb] = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const background = luminance(paint(layers));
    const text = luminance(paint([...layers, getComputedStyle(element).color]));
    return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
  });
}

test.describe("E2 · ricerca e filtri", () => {
  let catalog;
  let search;
  let typeButton;
  let statusFilter;

  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
    catalog = page.locator("mocks-next-catalog");
    search = catalog.getByPlaceholder(/Filtra il catalogo/);
    typeButton = catalog.getByRole("button", { name: /^Tipo:/ });
    statusFilter = (label) => catalog.getByRole("radio", { name: label, exact: true });
  });

  const path = (p) => catalog.getByText(p, { exact: true });

  test("la ricerca per percorso filtra il catalogo", async () => {
    await search.fill("users");
    await expect(path("/api/users")).toBeVisible();
    await expect(path("/api/users/:id")).toBeVisible();
    await expect(path("/api/health")).toHaveCount(0);
    await expect(path("/api/echo")).toHaveCount(0);
  });

  test("la ricerca copre anche il metodo HTTP", async () => {
    await search.fill("POST");
    await expect(path("/api/echo")).toBeVisible();
    await expect(path("/api/health")).toHaveCount(0);
  });

  test("una ricerca senza corrispondenze svuota il catalogo e lo dichiara", async () => {
    // Sotto filtro le collezioni senza risultati spariscono: prima restavano, a conteggio zero, e
    // il messaggio non compariva mai in un workspace con collezioni.
    await search.fill("zzz-nessun-endpoint");
    for (const p of ["/api/health", "/api/users", "/api/echo", "/api/enrich", "/api/legacy", "/api/status"]) {
      await expect(path(p)).toHaveCount(0);
    }
    await expect(catalog.getByText("Core API")).toHaveCount(0);
    await expect(catalog.getByText("Dynamic")).toHaveCount(0);
    await expect(catalog.getByText("Nessun endpoint corrisponde ai filtri.")).toBeVisible();
  });

  test("sotto filtro restano solo le collezioni che hanno risultati, con i loro antenati", async () => {
    // "config" sta solo in Admin, sotto-collection di Core API: resta il ramo, sparisce il resto.
    await search.fill("config");
    await expect(path("/api/admin/config")).toBeVisible();
    await expect(catalog.getByText("Core API")).toBeVisible();
    await expect(catalog.getByText("Admin", { exact: true })).toBeVisible();
    await expect(catalog.getByText("Dynamic")).toHaveCount(0);
    await expect(catalog.getByText("Unsorted")).toHaveCount(0);

    await search.fill("");
    await expect(catalog.getByText("Dynamic")).toBeVisible();
  });

  test("la sola ricerca non tocca i filtri di tipo e stato", async () => {
    await expect(typeButton).toHaveText(/Tutti/);
    await search.fill("users");
    await expect(path("/api/health")).toHaveCount(0); // filtro applicato
    // Tipo e stato restano su "Tutti", e non compare il reset: la ricerca ha il suo campo.
    await expect(typeButton).toHaveText(/Tutti/);
    await expect(statusFilter("Tutti")).toHaveAttribute("aria-checked", "true");
    await expect(catalog.getByRole("button", { name: "Reimposta filtri" })).toHaveCount(0);
  });

  test("sotto filtro il riordino è sospeso: lo dice a chi prova a trascinare, non con un avviso fisso", async ({ page }) => {
    const notice = page.locator("ui-toaster").getByText("Riordino sospeso mentre filtri");
    const dragRow = async (p) => {
      const box = await path(p).boundingBox();
      await page.mouse.move(box.x + 10, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 10, box.y + box.height / 2 + 40, { steps: 4 });
      await page.mouse.up();
    };

    await search.fill("users");
    await expect(catalog.getByText(/Riordino sospeso/)).toHaveCount(0);
    await expect(notice).toHaveCount(0);

    await dragRow("/api/users");
    await expect(notice).toBeVisible();
    // Il catalogo non è cambiato: l'ordine resta quello delle fixture.
    await expect(path("/api/users")).toBeVisible();
  });

  test("scorrere il catalogo filtrato con un dito non fa comparire l'avviso di riordino", async ({ page }) => {
    // Un vero pan touch via CDP: Chromium emette pointerdown e qualche pointermove, poi
    // pointercancel quando riconosce lo scroll. L'avviso partiva su quei primi pointermove.
    await page.setViewportSize({ width: 1280, height: 480 });
    await search.fill("api");
    const scroller = catalog.locator(".mx-scroll");
    // L'avviso dura pochi secondi: si registra se compare in qualunque momento del gesto, invece
    // di guardare dopo, quando potrebbe essere già sparito.
    await page.evaluate(() => {
      window.__reorderNoticeSeen = false;
      new MutationObserver(() => {
        if (document.querySelector("ui-toaster")?.textContent.includes("Riordino sospeso")) window.__reorderNoticeSeen = true;
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    const box = await path("/api/health").boundingBox();
    const [x, y] = [box.x + 10, box.y + box.height / 2];
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    // Passi brevi e distanziati, come un dito: è il ritmo che fa arrivare i pointermove prima
    // del pointercancel. A passi lunghi e ravvicinati Chromium annulla subito e il difetto non si vede.
    for (let offset = 12; offset <= 84; offset += 12) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - offset }] });
      await page.waitForTimeout(25);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    // Il gesto è stato davvero uno scroll, e nessun avviso.
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__reorderNoticeSeen)).toBe(false);
  });

  test("il testo evidenziato resta sopra AA, anche su una riga spenta, in hover e selezionata", async ({ page }) => {
    const mark = (p) => catalog.locator(".cdk-drag", { hasText: p }).locator("mark");

    await search.fill("legacy");
    expect(await contrastOf(mark("/api/legacy")), "spenta").toBeGreaterThanOrEqual(4.5);
    await mark("/api/legacy").hover();
    expect(await contrastOf(mark("/api/legacy")), "spenta, in hover").toBeGreaterThanOrEqual(4.5);
    await mark("/api/legacy").click();
    await page.mouse.move(1000, 600);
    expect(await contrastOf(mark("/api/legacy")), "spenta, selezionata").toBeGreaterThanOrEqual(4.5);

    await search.fill("health");
    expect(await contrastOf(mark("/api/health")), "accesa").toBeGreaterThanOrEqual(4.5);
  });

  test("la testata conta i risultati sul totale e il path evidenzia il testo cercato", async () => {
    const count = catalog.locator("h2 + ui-badge");
    await expect(count).toHaveText("8");

    await search.fill("users");
    await expect(count).toHaveText("2 di 8");
    await expect(catalog.locator("mark")).toHaveText(["users", "users"]);
    // Il testo della riga resta intero: si trova ancora per path esatto.
    await expect(path("/api/users/:id")).toBeVisible();

    await search.fill("");
    await expect(count).toHaveText("8");
    await expect(catalog.locator("mark")).toHaveCount(0);
  });

  test("il filtro per tipo Handler mostra solo gli handler, e il pulsante lo dice", async ({ page }) => {
    await typeButton.click();
    await page.getByRole("menuitem", { name: "Handler" }).click();
    await expect(path("/api/echo")).toBeVisible();
    await expect(path("/api/users")).toHaveCount(0);
    await expect(path("/api/enrich")).toHaveCount(0);
    await expect(typeButton).toHaveText(/Handler/);
  });

  test("il filtro per tipo Middleware isola i middleware", async ({ page }) => {
    await typeButton.click();
    await page.getByRole("menuitem", { name: "Middleware" }).click();
    await expect(path("/api/enrich")).toBeVisible();
    await expect(path("/api/echo")).toHaveCount(0);
    await expect(path("/api/health")).toHaveCount(0);
  });

  test("il filtro per stato Disattivi mostra solo l'endpoint disabilitato", async () => {
    await statusFilter("Disattivi").click();
    await expect(path("/api/legacy")).toBeVisible();
    await expect(path("/api/health")).toHaveCount(0);
    await expect(path("/api/echo")).toHaveCount(0);
  });

  // Regressione: la riga dei filtri sbordava dal pannello quando l'etichetta del tipo era lunga,
  // e l'ultimo pulsante finiva sotto il divisore trascinabile — che ha z-20 e intercetta i click.
  // "Middleware" e' l'etichetta piu' larga: bastava quella a superare la larghezza disponibile.
  test("con l'etichetta di tipo piu' lunga i filtri restano dentro il pannello", async ({ page }) => {
    await typeButton.click();
    await page.getByRole("menuitem", { name: "Middleware" }).click();

    const reset = catalog.getByRole("button", { name: "Reimposta filtri" });
    const dentro = await reset.evaluate((btn) => {
      const pannello = btn.closest("mocks-next-catalog").getBoundingClientRect();
      const riga = btn.parentElement;
      return {
        sbordo: riga.scrollWidth - riga.clientWidth,
        oltreIlBordo: Math.round(btn.getBoundingClientRect().right - pannello.right),
      };
    });
    expect(dentro.sbordo).toBe(0);
    expect(dentro.oltreIlBordo).toBeLessThanOrEqual(0);

    // E il click deve arrivarci davvero: se il divisore lo copre, Playwright va in timeout.
    await reset.click();
    await expect(typeButton).toHaveText(/Tutti/);
  });

  test("Reimposta filtri riporta il catalogo completo e riazzera i controlli", async ({ page }) => {
    await typeButton.click();
    await page.getByRole("menuitem", { name: "Handler" }).click();
    await statusFilter("Attivi").click();
    await expect(path("/api/health")).toHaveCount(0);

    await catalog.getByRole("button", { name: "Reimposta filtri" }).click();
    await expect(path("/api/health")).toBeVisible();
    await expect(path("/api/echo")).toBeVisible();
    await expect(typeButton).toHaveText(/Tutti/);
    await expect(statusFilter("Tutti")).toHaveAttribute("aria-checked", "true");
  });
});
