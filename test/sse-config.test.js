const { normalizeSseConfig, validateSseMessage } = require("../src/mocks/sse-config");

function valid(overrides = {}) {
  return {
    type: "sse",
    title: "Avanzamento",
    script: [
      { afterMs: 0, event: "progress", data: { percent: 10 } },
      { afterMs: 1500, data: "testo" },
    ],
    ...overrides,
  };
}

describe("sse-config (validazione della variante sse)", () => {
  test("una variante minima valida viene normalizzata con i default", () => {
    const { errors, sse } = normalizeSseConfig(valid());
    expect(errors).toEqual([]);
    expect(sse).toEqual({
      retryMs: null,
      script: [
        { afterMs: 0, data: { percent: 10 }, event: "progress" },
        { afterMs: 1500, data: "testo" },
      ],
      onEnd: "keep-open",
      presets: [],
    });
  });

  test("script assente o vuoto è legittimo (endpoint muto, alimentato dalla console)", () => {
    expect(normalizeSseConfig(valid({ script: undefined })).sse.script).toEqual([]);
    expect(normalizeSseConfig(valid({ script: [] })).sse.script).toEqual([]);
  });

  test("retryMs, onEnd e presets vengono conservati", () => {
    const { errors, sse } = normalizeSseConfig(
      valid({
        retryMs: 3000,
        onEnd: "close",
        presets: [{ label: "Promo", event: "notifica", data: { tipo: "promo" } }],
      })
    );
    expect(errors).toEqual([]);
    expect(sse.retryMs).toBe(3000);
    expect(sse.onEnd).toBe("close");
    expect(sse.presets).toEqual([{ label: "Promo", data: { tipo: "promo" }, event: "notifica" }]);
  });

  test("voci di copione malformate: data mancante, afterMs invalido, event vuoto", () => {
    const { errors } = normalizeSseConfig(
      valid({
        script: [
          { afterMs: 0 },
          { afterMs: -1, data: "x" },
          { afterMs: 1, event: " ", data: "x" },
        ],
      })
    );
    expect(errors).toEqual([
      "script[0].data is required",
      "script[1].afterMs must be a non-negative integer",
      "script[2].event must be a non-empty string",
    ]);
  });

  test("onEnd loop richiede un copione non vuoto con almeno un ritardo positivo", () => {
    expect(normalizeSseConfig(valid({ onEnd: "loop", script: [] })).errors).toEqual([
      "onEnd loop requires a non-empty script",
    ]);
    expect(
      normalizeSseConfig(valid({ onEnd: "loop", script: [{ afterMs: 0, data: "x" }] })).errors
    ).toEqual(["onEnd loop requires at least one script entry with afterMs > 0"]);
    expect(
      normalizeSseConfig(valid({ onEnd: "loop", script: [{ afterMs: 1000, data: "x" }] })).errors
    ).toEqual([]);
  });

  test("onEnd e retryMs malformati vengono segnalati", () => {
    const { errors } = normalizeSseConfig(valid({ onEnd: "restart", retryMs: -5 }));
    expect(errors).toEqual([
      "retryMs must be a non-negative integer",
      "onEnd must be keep-open, close or loop",
    ]);
  });

  test("data può essere qualunque JSON, anche falsy (0, false, null)", () => {
    const { errors, sse } = normalizeSseConfig(
      valid({ script: [{ afterMs: 0, data: null }, { afterMs: 1, data: 0 }] })
    );
    expect(errors).toEqual([]);
    expect(sse.script.map((s) => s.data)).toEqual([null, 0]);
  });

  test("validateSseMessage: forma condivisa dei messaggi (push manuale incluso)", () => {
    const errors = [];
    expect(validateSseMessage({ data: "x", event: "e", id: "1" }, "push", errors)).toEqual({
      data: "x",
      event: "e",
      id: "1",
    });
    expect(errors).toEqual([]);

    validateSseMessage({ event: "senza-data" }, "push", errors);
    expect(errors).toEqual(["push.data is required"]);
  });
});
