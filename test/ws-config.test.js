const { normalizeWsConfig, matchWsRule } = require("../src/mocks/ws-config");

// Validazione della variante ws: copione, onEnd (con closeCode/closeReason), regole e presets.
describe("ws config", () => {
  test("normalizza una variante completa", () => {
    const { errors, ws } = normalizeWsConfig({
      script: [
        { afterMs: 0, data: { tipo: "benvenuto" } },
        { afterMs: 500, data: "ciao" },
      ],
      onEnd: "keep-open",
      rules: [
        { match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] },
        { match: { json: { azione: "subscribe" } }, reply: [{ afterMs: 100, data: { esito: "ok" } }] },
      ],
      presets: [{ label: "Errore", data: { tipo: "errore" } }],
    });

    expect(errors).toEqual([]);
    expect(ws.script).toHaveLength(2);
    expect(ws.onEnd).toBe("keep-open");
    expect(ws.rules).toHaveLength(2);
    expect(ws.presets).toEqual([{ label: "Errore", data: { tipo: "errore" } }]);
    expect(ws.closeCode).toBeNull();
  });

  test("difetti minimi: copione vuoto e default keep-open", () => {
    const { errors, ws } = normalizeWsConfig({});
    expect(errors).toEqual([]);
    expect(ws.script).toEqual([]);
    expect(ws.onEnd).toBe("keep-open");
    expect(ws.rules).toEqual([]);
  });

  test("rifiuta onEnd sconosciuto, afterMs negativo e data mancante", () => {
    const { errors } = normalizeWsConfig({
      onEnd: "explode",
      script: [{ afterMs: -1, data: "x" }, { afterMs: 0 }],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "onEnd must be keep-open, close or loop",
        "script[0].afterMs must be a non-negative integer",
        "script[1].data is required",
      ])
    );
  });

  test("closeCode/closeReason valgono solo con onEnd close, e nei limiti del protocollo", () => {
    expect(normalizeWsConfig({ onEnd: "keep-open", closeCode: 1000 }).errors).toEqual([
      "closeCode requires onEnd close",
    ]);
    expect(normalizeWsConfig({ onEnd: "close", closeCode: 2000 }).errors).toEqual([
      "closeCode must be 1000 or an integer between 3000 and 4999",
    ]);
    expect(normalizeWsConfig({ onEnd: "close", closeReason: "x".repeat(124) }).errors).toEqual([
      "closeReason must be a string of at most 123 characters",
    ]);
    const ok = normalizeWsConfig({ onEnd: "close", closeCode: 4001, closeReason: "done" });
    expect(ok.errors).toEqual([]);
    expect(ok.ws.closeCode).toBe(4001);
    expect(ok.ws.closeReason).toBe("done");
  });

  test("loop richiede copione non vuoto con almeno un ritardo positivo", () => {
    expect(normalizeWsConfig({ onEnd: "loop" }).errors).toEqual([
      "onEnd loop requires a non-empty script",
    ]);
    expect(normalizeWsConfig({ onEnd: "loop", script: [{ afterMs: 0, data: "x" }] }).errors).toEqual([
      "onEnd loop requires at least one script entry with afterMs > 0",
    ]);
  });

  test("una regola dichiara esattamente un criterio di match e un reply non vuoto", () => {
    const { errors } = normalizeWsConfig({
      rules: [
        { match: { equals: "a", contains: "b" }, reply: [{ afterMs: 0, data: "x" }] },
        { match: { equals: "a" }, reply: [] },
        { match: {}, reply: [{ afterMs: 0, data: "x" }] },
      ],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        "rules[0].match must declare exactly one of equals, contains or json",
        "rules[1].reply must be a non-empty array",
        "rules[2].match must declare exactly one of equals, contains or json",
      ])
    );
  });
});

// Il match dei messaggi in ingresso: prima regola che matcha vince, nessun default.
describe("ws rule matching", () => {
  const rules = normalizeWsConfig({
    rules: [
      { match: { equals: "ping" }, reply: [{ afterMs: 0, data: "pong" }] },
      { match: { contains: "aiuto" }, reply: [{ afterMs: 0, data: "arrivo" }] },
      { match: { json: { azione: "subscribe", canale: "news" } }, reply: [{ afterMs: 0, data: "ok" }] },
    ],
  }).ws.rules;

  test("equals: solo il testo esatto", () => {
    expect(matchWsRule(rules, "ping").reply[0].data).toBe("pong");
    expect(matchWsRule(rules, "ping ")).toBeNull();
  });

  test("contains: sottostringa ovunque", () => {
    expect(matchWsRule(rules, "serve aiuto subito").reply[0].data).toBe("arrivo");
  });

  test("json: subset di primo livello, con valori confrontati in profondità", () => {
    expect(matchWsRule(rules, JSON.stringify({ azione: "subscribe", canale: "news", extra: 1 }))).not.toBeNull();
    expect(matchWsRule(rules, JSON.stringify({ azione: "subscribe", canale: "sport" }))).toBeNull();
    expect(matchWsRule(rules, "non-json")).toBeNull();
  });

  test("prima regola che matcha vince", () => {
    const overlapping = normalizeWsConfig({
      rules: [
        { match: { contains: "pi" }, reply: [{ afterMs: 0, data: "primo" }] },
        { match: { equals: "ping" }, reply: [{ afterMs: 0, data: "secondo" }] },
      ],
    }).ws.rules;
    expect(matchWsRule(overlapping, "ping").reply[0].data).toBe("primo");
  });

  test("nessun match: null (niente eco di default)", () => {
    expect(matchWsRule(rules, "messaggio qualunque")).toBeNull();
  });
});
