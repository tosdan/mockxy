const { test, expect } = require("@playwright/test");
const { gotoMocks } = require("./helpers");

// E1 — catalogo: lista completa, conteggi, collezioni, "Non assegnati" in cima, endpoint disabilitato
// muted. Sola lettura: non tocca lo stato, nessun ripristino necessario.
// Scope sul componente <mocks-next-catalog> così ogni percorso appare una sola volta (il
// selezionato compare anche nel dettaglio, fuori scope).
test.describe("E1 · catalogo", () => {
  test.beforeEach(async ({ page }) => {
    await gotoMocks(page);
  });

  test("elenca tutti gli 8 endpoint delle fixture", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const paths = [
      "/api/health",
      "/api/users",
      "/api/users/:id",
      "/api/admin/config",
      "/api/legacy",
      "/api/status",
      "/api/echo",
      "/api/enrich",
    ];
    for (const path of paths) {
      await expect(catalog.getByText(path, { exact: true })).toBeVisible();
    }
  });

  test("la status bar riporta i conteggi e gli attivi corretti", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(page.locator("app-status-bar").getByText(/8\s+endpoint/)).toBeVisible();
    await expect(page.locator("app-status-bar").getByText(/3\s+collection/)).toBeVisible();
    // 8 endpoint, 1 disabilitato (legacy) → "7 attivi" (lingua fissata a IT dall'helper)
    await expect(page.locator("app-status-bar").getByText(/7\s+attivi/)).toBeVisible();
  });

  test("mostra le tre collezioni e il gruppo dei non assegnati, col nome italiano", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("Non assegnati")).toBeVisible();
    await expect(catalog.getByText("Unsorted")).toHaveCount(0);
    await expect(catalog.getByText("Core API")).toBeVisible();
    await expect(catalog.getByText("Admin", { exact: true })).toBeVisible();
    await expect(catalog.getByText("Dynamic")).toBeVisible();
  });

  test("i non assegnati sono in cima, poi le collezioni root nell'ordine di childOrder", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const topOf = async (text) => {
      const box = await catalog.getByText(text, { exact: true }).first().boundingBox();
      return box.y;
    };
    const unsorted = await topOf("Non assegnati");
    const core = await topOf("Core API");
    const dynamic = await topOf("Dynamic");
    expect(unsorted).toBeLessThan(core); // i non assegnati sempre per primi
    expect(core).toBeLessThan(dynamic); // root: [Core API, Dynamic]
  });

  test("il conteggio di una collezione comprende le sotto-collezioni", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const folderBadge = (name) => catalog.locator(".cdk-drag").filter({ hasText: name }).first().locator("ui-badge");
    // Core API: 2 endpoint propri più quello di Admin, sua sotto-collezione.
    await expect(folderBadge("Core API")).toHaveText("3");
    await expect(folderBadge("Admin")).toHaveText("1");
    await expect(folderBadge("Dynamic")).toHaveText("2");
  });

  test("da tastiera: dal filtro si scende nell'albero, Invio apre l'endpoint, sinistra chiude la cartella", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const focused = catalog.locator('[role="treeitem"]:focus');

    await page.keyboard.press("/");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await expect(focused).toContainText("Non assegnati");

    // Non assegnati: health, legacy, status.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(focused).toContainText("/api/legacy");
    await page.keyboard.press("Enter");
    await expect(page.locator("mocks-next-detail").getByRole("heading", { name: "/api/legacy", exact: true })).toBeVisible();
    await expect(focused).toHaveAttribute("aria-current", "true");

    // Da un endpoint, sinistra risale alla cartella; una seconda volta la chiude.
    await page.keyboard.press("ArrowLeft");
    await expect(focused).toContainText("Non assegnati");
    await page.keyboard.press("ArrowLeft");
    await expect(focused).toHaveAttribute("aria-expanded", "false");
    await expect(catalog.getByText("/api/health", { exact: true })).toHaveCount(0);
  });

  // Alla larghezza minima del catalogo il conteggio non si spezza mai, e i pulsanti stanno o accanto
  // all'etichetta o, se lo spazio non basta, tutti insieme sotto. Quale dei due dipende dal font di
  // sistema: con Noto Sans la barra sta su una riga per 2,5 px, con DejaVu Sans (il sans-serif di
  // Ubuntu e del runner della CI) va a capo. Si prova con entrambi, invece di supporre un font.
  for (const font of [null, "DejaVu Sans"]) {
    test(`la barra delle azioni di massa non spezza conteggio e pulsanti, col font ${font ?? "di sistema"}`, async ({ page }) => {
      if (font) await page.addStyleTag({ content: `* { font-family: "${font}" !important; }` });
      const catalog = page.locator("mocks-next-catalog");
      // Gli endpoint si spuntano con Ctrl+clic (Cmd su Mac) sulla riga.
      const endpointRows = catalog.locator('[data-row-key^="e:"]');
      await endpointRows.nth(0).locator("ui-badge").click({ modifiers: ["ControlOrMeta"] });
      await endpointRows.nth(1).locator("ui-badge").click({ modifiers: ["ControlOrMeta"] });

      const label = catalog.getByText("2 selezionati");
      await expect(label).toBeVisible();
      const geometry = await label.evaluate((labelEl) => {
        const bar = labelEl.parentElement;
        const buttons = [...bar.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
        const box = labelEl.getBoundingClientRect();
        return {
          label: { top: box.top, bottom: box.bottom, height: box.height, middle: box.top + box.height / 2 },
          barRight: bar.getBoundingClientRect().right,
          middles: buttons.map((rect) => rect.top + rect.height / 2),
          tops: buttons.map((rect) => rect.top),
          rights: buttons.map((rect) => rect.right),
        };
      });
      // Il conteggio su una riga sola.
      expect(geometry.label.height).toBeLessThan(20);
      // I pulsanti tutti su una riga, dentro la barra.
      const middles = geometry.middles;
      expect(Math.max(...middles) - Math.min(...middles)).toBeLessThan(2);
      expect(Math.max(...geometry.rights)).toBeLessThanOrEqual(geometry.barRight);
      // ...accanto all'etichetta, o interamente sotto.
      const beside = Math.abs(middles[0] - geometry.label.middle) < 4;
      const below = Math.min(...geometry.tops) >= geometry.label.bottom;
      expect(beside || below).toBe(true);
    });
  }

  test("il menu non toglie spazio al path: lo cede il path quando il menu compare", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const row = catalog.locator('[role="treeitem"]').filter({ hasText: "/api/users/:id" });
    const path = row.locator('[dir="rtl"]');
    const menu = row.getByRole("button", { name: "Sposta in collection" });
    const toggle = row.getByRole("switch");
    await page.mouse.move(1000, 600);

    // A riposo il path arriva allo switch, separato solo dallo stacco della riga.
    const rest = { path: await path.boundingBox(), toggle: await toggle.boundingBox(), row: await row.boundingBox() };
    expect(rest.toggle.x - (rest.path.x + rest.path.width)).toBeLessThanOrEqual(12);
    await expect(menu).toHaveCSS("opacity", "0");

    // In hover il menu compare accanto allo switch e il path si ritira per lasciarlo libero.
    await row.hover();
    await expect(menu).toHaveCSS("opacity", "1");
    const hover = { path: await path.boundingBox(), menu: await menu.boundingBox(), row: await row.boundingBox() };
    expect(hover.path.x + hover.path.width).toBeLessThanOrEqual(hover.menu.x);
    expect(hover.menu.x + hover.menu.width).toBeLessThanOrEqual(rest.toggle.x);
    // Nessun salto in verticale fra riposo e hover.
    expect(hover.row.height).toBe(rest.row.height);
  });

  test("Ctrl+clic spunta senza aprire e senza spostare la riga, e non lascia il menu acceso", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const row = catalog.locator('[role="treeitem"]').filter({ hasText: "/api/health" });
    const badge = row.locator("ui-badge");
    const before = await badge.boundingBox();
    const opened = await catalog.locator('[aria-current="true"]').getAttribute("data-row-key");

    await badge.click({ modifiers: ["ControlOrMeta"] });
    await page.mouse.move(1000, 600);

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveClass(/mx-checked/);
    await expect(catalog.locator('[aria-current="true"]')).toHaveAttribute("data-row-key", opened);
    expect((await badge.boundingBox()).x).toBe(before.x);
    await expect(row.getByRole("button", { name: "Sposta in collection" })).toHaveCSS("opacity", "0");
  });

  test("col fuoco da tastiera sulla riga il menu compare, e col Tab ci si arriva", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await page.keyboard.press("/");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown"); // /api/health
    await expect(catalog.locator('[role="treeitem"]:focus')).toContainText("/api/health");
    const row = catalog.locator('[role="treeitem"]').filter({ hasText: "/api/health" });
    const menu = row.getByRole("button", { name: "Sposta in collection" });
    await expect(menu).toHaveCSS("opacity", "1");

    await page.keyboard.press("Tab"); // il menu: gli endpoint non hanno piu' la spunta
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Core API" })).toBeVisible();
  });

  test("da tastiera Spazio spunta solo la riga a fuoco, anche con Maiuscole; Invio apre", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const row = (p) => catalog.locator('[role="treeitem"]').filter({ hasText: p }).first();
    await page.keyboard.press("/");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown"); // /api/health
    await page.keyboard.press("Space");
    await expect(row("/api/health")).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown"); // /api/legacy
    await page.keyboard.press("ArrowDown"); // /api/status
    // Niente intervalli: Maiuscole+Spazio spunta la riga a fuoco e basta.
    await page.keyboard.press("Shift+Space");
    await expect(row("/api/status")).toHaveAttribute("aria-selected", "true");
    await expect(row("/api/legacy")).toHaveAttribute("aria-selected", "false");
    await expect(catalog.getByText("2 selezionati")).toBeVisible();

    // Invio, invece, apre.
    await page.keyboard.press("Enter");
    await expect(page.locator("mocks-next-detail").getByRole("heading", { name: "/api/status", exact: true })).toBeVisible();
    await expect(row("/api/status")).toHaveAttribute("aria-current", "true");
  });

  // Le righe non hanno piu' la casella: si spunta in modalita' selezione, o con Ctrl+clic.
  test("in modalità selezione i clic spuntano; la cartella spuntata in parte ha le strisce; Esc annulla", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const row = (p) => catalog.locator('[role="treeitem"]').filter({ hasText: p }).first();
    const folder = catalog.locator('[role="treeitem"][data-row-key^="c:"]').filter({ hasText: "Core API" });
    const opened = await catalog.locator('[aria-current="true"]').getAttribute("data-row-key");

    await catalog.getByRole("button", { name: "Seleziona", exact: true }).click();
    await expect(catalog.getByRole("status")).toContainText("Modalità selezione");
    await row("/api/users").click();
    await expect(row("/api/users")).toHaveAttribute("aria-selected", "true");
    await expect(catalog.locator('[aria-current="true"]')).toHaveAttribute("data-row-key", opened);

    // Core API ha 3 endpoint, uno spuntato: casella mista, strisce e contatore.
    await expect(folder.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
    await expect(folder).toHaveClass(/mx-checked-some/);
    await expect(folder.locator("ui-badge").last()).toHaveText("1/3");
    const stripes = await folder.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(stripes).toContain("repeating-linear-gradient");

    await catalog.getByRole("button", { name: "Fine", exact: true }).click();
    await expect(catalog.getByRole("status")).toHaveCount(0);
    await expect(row("/api/users")).toHaveAttribute("aria-selected", "true");
    await expect(catalog.getByText("Ctrl+clic aggiunge o toglie")).toBeVisible();

    await row("/api/users").focus();
    await page.keyboard.press("Escape");
    await expect(row("/api/users")).toHaveAttribute("aria-selected", "false");
    await expect(catalog.getByText("1 selezionato")).toHaveCount(0);
  });

  test("la densità compatta mette ogni endpoint su una riga, e resta dopo un ricaricamento", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    const row = (p) => catalog.locator('[role="treeitem"]').filter({ hasText: p }).first();
    const toggle = page.getByRole("menuitemcheckbox", { name: "Densità compatta" });
    expect((await row("/api/health").boundingBox()).height).toBe(44);

    await catalog.getByRole("button", { name: "Azioni di vista" }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();

    // Una riga sola: più basse, e senza i dettagli che sono il caso comune.
    await expect.poll(async () => (await row("/api/health").boundingBox()).height).toBe(30);
    await expect(row("/api/health")).not.toContainText("mock");
    await expect(row("/api/echo")).toContainText("handler");

    await page.reload();
    await expect(page.locator("app-status-bar").getByText(/8\s+endpoint/)).toBeVisible();
    expect((await row("/api/health").boundingBox()).height).toBe(30);

    // Si torna indietro dallo stesso posto.
    await catalog.getByRole("button", { name: "Azioni di vista" }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect.poll(async () => (await row("/api/health").boundingBox()).height).toBe(44);
  });

  test("un path lungo si tronca in testa: la coda resta visibile", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    // Si allunga un path direttamente nel DOM: le fixture non ne hanno di abbastanza lunghi.
    const tail = await catalog.locator("bdi", { hasText: "/api/admin/config" }).evaluate((bdi) => {
      bdi.textContent = "/api/admin/organizations/{organizationId}/members/{memberId}/config";
      const box = bdi.parentElement.getBoundingClientRect();
      const range = document.createRange();
      range.setStart(bdi.firstChild, bdi.textContent.length - "/config".length);
      range.setEnd(bdi.firstChild, bdi.textContent.length);
      const end = range.getBoundingClientRect();
      range.setStart(bdi.firstChild, 0);
      range.setEnd(bdi.firstChild, 1);
      const start = range.getBoundingClientRect();
      return { tailInside: end.left >= box.left && end.right <= box.right + 1, headClipped: start.left < box.left };
    });
    expect(tail).toEqual({ tailInside: true, headClipped: true });
  });

  test("l'endpoint disabilitato è muted, gli attivi no", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.locator(".mx-muted", { hasText: "/api/legacy" })).toBeVisible();
    await expect(catalog.locator(".mx-muted", { hasText: "/api/health" })).toHaveCount(0);
  });

  test("l'endpoint disabilitato resta leggibile: contrasto AA su path e dettagli", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    // Da spenta la riga perde il colore, non l'opacità: il testo deve restare sopra 4.5:1.
    const ratios = await catalog.locator(".mx-muted", { hasText: "/api/legacy" }).evaluate((row) => {
      const channels = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = (color) => {
        const [r, g, b] = channels(color).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      let surface = row;
      while (getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
      const background = luminance(getComputedStyle(surface).backgroundColor);
      return ["ui-badge", "bdi", ".tabular-nums"].map((selector) => {
        const style = getComputedStyle(row.querySelector(selector));
        const text = luminance(style.color);
        return { selector, opacity: getComputedStyle(row).opacity, ratio: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05) };
      });
    });
    for (const { selector, opacity, ratio } of ratios) {
      expect(opacity, selector).toBe("1");
      expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("l'endpoint disabilitato ha lo switch spento, gli attivi acceso", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    // Ogni riga (endpoint o cartella) è un .cdk-drag isolato: il filtro per percorso ne prende una sola.
    const switchOf = (path) => catalog.locator(".cdk-drag").filter({ hasText: path }).getByRole("switch");
    await expect(switchOf("/api/legacy")).toHaveAttribute("aria-checked", "false");
    await expect(switchOf("/api/health")).toHaveAttribute("aria-checked", "true");
  });

  test("i tipi non-mock e i metodi sono etichettati nel catalogo", async ({ page }) => {
    const catalog = page.locator("mocks-next-catalog");
    await expect(catalog.getByText("handler", { exact: true })).toBeVisible();
    await expect(catalog.getByText("middleware", { exact: true })).toBeVisible();
    await expect(catalog.getByText("POST", { exact: true })).toBeVisible();
  });

  // Le classi text-* sulle icone erano ignorate: ng-icon dichiara il colore in un proprio layer,
  // che nasceva dopo quelli di Tailwind e li batteva. E a Middleware mancava l'icona.
  test("nel menu Nuovo ogni tipo ha la sua icona, nel colore del tipo", async ({ page }) => {
    await page.locator("mocks-next-catalog").getByRole("button", { name: /Nuovo/ }).click();
    for (const [label, token] of [["Mock", "--type-mock"], ["Handler", "--type-handler"], ["Middleware", "--type-middleware"]]) {
      const icon = page.getByRole("menuitem", { name: label, exact: true }).locator("ng-icon");
      await expect(icon.locator("svg")).toHaveCount(1);
      const [actual, expected] = await icon.evaluate((el, name) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return [getComputedStyle(el).color, resolved];
      }, token);
      expect(actual, label).toBe(expected);
    }
  });

  // Al 40% l'anello di focus stava a 1,9:1 sullo sfondo; sui controlli pieni, attaccato al bordo,
  // sembrava solo un controllo piu' grande. Ora e' al 70% e staccato di 2px.
  test("il focus da tastiera su un pulsante e' un contorno staccato dal bordo", async ({ page }) => {
    const button = page.locator("mocks-next-catalog").getByRole("button", { name: /Nuovo/ });
    await page.keyboard.press("Shift");
    await button.focus();
    const outline = () => button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.outlineWidth, offset: s.outlineOffset, styleName: s.outlineStyle, color: s.outlineColor };
    });
    expect(await outline()).toMatchObject({ width: "2px", offset: "2px", styleName: "solid" });
    // Il pulsante ha una transizione: il colore parte dal testo e si assesta su --ring al 70%.
    await expect.poll(async () => (await outline()).color).toMatch(/\/ 0\.7\)$|, 0\.7\)$/);
  });
});
