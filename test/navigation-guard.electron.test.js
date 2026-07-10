const {
  isSameOrigin,
  isExternalWebUrl,
  decideNavigation,
  decideWindowOpen,
} = require("../electron/navigation-guard");

// Hardening navigazione dell'app desktop (#20 revisione): la finestra resta sull'app; i link
// esterni vanno al browser di sistema, mai dentro Electron.
describe("navigation guard", () => {
  const engineUrl = "http://127.0.0.1:53123/_admin/ui/";

  describe("decideNavigation", () => {
    test("consente la navigazione same-origin (la SPA che naviga dentro sé stessa)", () => {
      expect(decideNavigation(engineUrl, "http://127.0.0.1:53123/_admin/ui/monitor")).toEqual({
        allow: true,
        openExternal: null,
      });
    });

    test("blocca un link esterno e lo indirizza al browser di sistema", () => {
      expect(decideNavigation(engineUrl, "https://evil.example.com/phish")).toEqual({
        allow: false,
        openExternal: "https://evil.example.com/phish",
      });
    });

    test("blocca un altro origin locale (porta diversa) senza aprirlo altrove è comunque esterno", () => {
      // Porta diversa = origin diverso: bloccato. Essendo http, viene passato al browser.
      expect(decideNavigation(engineUrl, "http://127.0.0.1:9999/")).toEqual({
        allow: false,
        openExternal: "http://127.0.0.1:9999/",
      });
    });

    test("blocca schemi non-web senza tentare di aprirli (no file:/javascript:/data:)", () => {
      for (const target of [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,<h1>x</h1>",
      ]) {
        expect(decideNavigation(engineUrl, target)).toEqual({ allow: false, openExternal: null });
      }
    });

    test("dalla view di benvenuto (file://) resta interno per lo stesso file origin", () => {
      const welcome = "file:///C:/app/welcome.html";
      expect(decideNavigation(welcome, "file:///C:/app/welcome.html#lang").allow).toBe(true);
      expect(decideNavigation(welcome, "https://example.com").allow).toBe(false);
    });

    test("un URL di destinazione non parsabile viene bloccato", () => {
      expect(decideNavigation(engineUrl, "not a url")).toEqual({ allow: false, openExternal: null });
    });
  });

  describe("decideWindowOpen", () => {
    test("un link web va al browser di sistema (l'apertura in Electron è comunque negata)", () => {
      expect(decideWindowOpen("https://docs.example.com")).toEqual({
        openExternal: "https://docs.example.com",
      });
    });

    test("uno schema non-web non viene aperto da nessuna parte", () => {
      expect(decideWindowOpen("file:///etc/passwd")).toEqual({ openExternal: null });
    });
  });

  describe("helper", () => {
    test("isSameOrigin ignora il path ma non la porta", () => {
      expect(isSameOrigin("http://127.0.0.1:3000/a", "http://127.0.0.1:3000/b")).toBe(true);
      expect(isSameOrigin("http://127.0.0.1:3000/a", "http://127.0.0.1:3001/a")).toBe(false);
    });

    test("isExternalWebUrl vero solo per http/https", () => {
      expect(isExternalWebUrl("http://x")).toBe(true);
      expect(isExternalWebUrl("https://x")).toBe(true);
      expect(isExternalWebUrl("file:///x")).toBe(false);
      expect(isExternalWebUrl("javascript:void(0)")).toBe(false);
    });
  });
});
