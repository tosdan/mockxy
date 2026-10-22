const { test, expect } = require("@playwright/test");

// Editor di codice. Stati evidenziati (selezione, ricerca): il testo sopra il velo si scrive col
// colore pieno, perche' i colori spenti della sintassi sotto un velo scendono sotto 4.5:1. E i testi
// di CodeMirror nella lingua dell'app. La pagina Design System ha un editor sempre presente, senza
// dati da preparare.
test.describe("editor di codice · stati evidenziati e lingua", () => {
  test("selezione e risultati della ricerca: velo dell'app e testo a colore pieno", async ({ page }) => {
    await page.goto("/_admin/ui/design-system#code-editor");
    const editor = page.locator("#code-editor .cm-editor").first();
    await editor.locator(".cm-content").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await page.keyboard.insertText('{\n  "id": 1,\n  "ruoli": ["admin", "id"]\n}');

    const foreground = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--foreground)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    // Colori del testo dentro un segno, discendenti compresi (il segno puo' avvolgere la sintassi).
    const textColors = (selector) =>
      editor.evaluate((root, s) => [...new Set([...root.querySelectorAll(`${s}, ${s} *`)].map((e) => getComputedStyle(e).color))], selector);

    // Selezione: la riga 2 per intero.
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+End");
    await expect(editor.locator(".cm-selectedText")).not.toHaveCount(0);
    expect(await textColors(".cm-selectedText")).toEqual([foreground]);
    // Non il verde scuro di CodeMirror, che vinceva per specificita' sull'editor a fuoco.
    await expect(editor.locator(".cm-selectionBackground").first()).not.toHaveCSS("background-color", "rgb(34, 51, 51)");

    // Ricerca: velo ambra al posto del ciano di CodeMirror; il risultato corrente e' bordato.
    await page.keyboard.press("Control+f");
    await page.keyboard.type("id");
    await page.keyboard.press("Enter");
    await expect(editor.locator(".cm-searchMatch")).toHaveCount(2);
    await expect(editor.locator(".cm-searchMatch").first()).not.toHaveCSS("background-color", "rgba(0, 255, 255, 0.54)");
    await expect(editor.locator(".cm-searchMatch-selected")).toHaveCSS("outline-style", "solid");
    expect(await textColors(".cm-searchMatch")).toEqual([foreground]);
  });

  // I testi di CodeMirror (ricerca e sostituzione) seguono la lingua dell'app, anche cambiandola.
  test("il pannello di ricerca parla la lingua dell'app, e la segue quando cambia", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("mx-lang", "it"));
    await page.goto("/_admin/ui/design-system#code-editor");
    const editor = page.locator("#code-editor .cm-editor").first();
    await editor.locator(".cm-content").click();
    await page.keyboard.press("Control+f");
    await expect(editor.getByPlaceholder("Cerca")).toBeVisible();
    await expect(editor.getByRole("button", { name: "successivo" })).toBeVisible();
    await expect(editor.getByRole("button", { name: "sostituisci tutti" })).toBeVisible();

    await page.getByRole("button", { name: "Lingua" }).click();
    await page.getByRole("menuitem", { name: "English" }).click();
    // Il pannello aperto resta com'era; riaprendolo e' nella lingua nuova.
    await editor.locator(".cm-content").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+f");
    await expect(editor.getByPlaceholder("Find")).toBeVisible();
    await expect(editor.getByRole("button", { name: "replace all" })).toBeVisible();
  });
});
