const { getDialogMessages, MESSAGES } = require("../electron/dialog-messages");

// Stringhe dei dialoghi nativi (#23 revisione): l'app ha il selettore lingua it/en, i dialoghi
// di sistema devono seguirlo. La guardia importante è la completezza: chi aggiunge una stringa
// in una lingua deve aggiungerla anche nell'altra, con lo stesso tipo (statica o funzione).
describe("dialog messages", () => {
  test("le due lingue hanno le stesse chiavi con gli stessi tipi", () => {
    const italianKeys = Object.keys(MESSAGES.it).sort();
    const englishKeys = Object.keys(MESSAGES.en).sort();
    expect(englishKeys).toEqual(italianKeys);

    for (const key of italianKeys) {
      expect(typeof MESSAGES.en[key]).toBe(typeof MESSAGES.it[key]);
    }
  });

  test("le stringhe parametriche interpolano il valore in entrambe le lingue", () => {
    for (const lang of ["it", "en"]) {
      const messages = getDialogMessages(lang);
      expect(messages.workspaceNotFoundDetail("C:/ws")).toContain("C:/ws");
      expect(messages.initMessage("cartella-x")).toContain("cartella-x");
      expect(messages.initDetail("C:/ws", ".mockxy")).toEqual(expect.stringContaining("C:/ws"));
      expect(messages.initDetail("C:/ws", ".mockxy")).toEqual(expect.stringContaining(".mockxy"));
      expect(messages.closeMessage("il-mio-ws")).toContain("il-mio-ws");
      expect(messages.removeRecentMessage("il-mio-ws")).toContain("il-mio-ws");
    }
  });

  test("una lingua sconosciuta ripiega sull'inglese", () => {
    expect(getDialogMessages("fr")).toBe(MESSAGES.en);
    expect(getDialogMessages(undefined)).toBe(MESSAGES.en);
  });

  test("le lingue supportate restituiscono il proprio set", () => {
    expect(getDialogMessages("it")).toBe(MESSAGES.it);
    expect(getDialogMessages("en")).toBe(MESSAGES.en);
  });
});
