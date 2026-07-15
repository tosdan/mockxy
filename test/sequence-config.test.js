const { normalizeSequenceConfig, computeSequenceSignature } = require("../src/mocks/sequence-config");

const RESPONSES = ["001.response.json", "002.response.json", "003.response.json"];

function valid(overrides = {}) {
  return {
    steps: [
      { response: "001.response.json", times: 3 },
      { response: "002.response.json" },
    ],
    ...overrides,
  };
}

describe("sequence-config (validazione del campo sequence)", () => {
  test("sequence assente è legittima: nessun errore, sequence null", () => {
    expect(normalizeSequenceConfig(null, RESPONSES)).toEqual({ errors: [], sequence: null });
    expect(normalizeSequenceConfig(undefined, RESPONSES)).toEqual({ errors: [], sequence: null });
  });

  test("una sequenza minima valida viene normalizzata con i default", () => {
    const { errors, sequence } = normalizeSequenceConfig(valid(), RESPONSES);
    expect(errors).toEqual([]);
    expect(sequence).toEqual({
      enabled: true,
      steps: [
        { response: "001.response.json", times: 3 },
        { response: "002.response.json" },
      ],
      onEnd: "stay",
      resetAfterMs: null,
    });
  });

  test("enabled false, onEnd loop e resetAfterMs vengono conservati", () => {
    const { errors, sequence } = normalizeSequenceConfig(
      valid({
        enabled: false,
        onEnd: "loop",
        resetAfterMs: 30000,
        steps: [
          { response: "001.response.json", forMs: 15000 },
          { response: "002.response.json", times: 1 },
        ],
      }),
      RESPONSES
    );
    expect(errors).toEqual([]);
    expect(sequence.enabled).toBe(false);
    expect(sequence.onEnd).toBe("loop");
    expect(sequence.resetAfterMs).toBe(30000);
    expect(sequence.steps[0]).toEqual({ response: "001.response.json", forMs: 15000 });
  });

  test("i campi sconosciuti di sequence e step non finiscono nella forma normalizzata", () => {
    const { sequence } = normalizeSequenceConfig(
      valid({ extra: true, steps: [{ response: "001.response.json", times: 1, note: "x" }, { response: "002.response.json" }] }),
      RESPONSES
    );
    expect(sequence).not.toHaveProperty("extra");
    expect(sequence.steps[0]).toEqual({ response: "001.response.json", times: 1 });
  });

  test("sequence non-oggetto viene rifiutata", () => {
    expect(normalizeSequenceConfig([], RESPONSES).errors).toEqual(["sequence must be an object"]);
    expect(normalizeSequenceConfig("x", RESPONSES).errors).toEqual(["sequence must be an object"]);
  });

  test("servono almeno 2 step (uno solo equivale alla selezione classica)", () => {
    const { errors } = normalizeSequenceConfig(valid({ steps: [{ response: "001.response.json" }] }), RESPONSES);
    expect(errors).toEqual(["sequence.steps must be an array with at least 2 steps"]);
  });

  test("uno step deve referenziare una variante elencata in responseFiles", () => {
    const { errors } = normalizeSequenceConfig(
      valid({ steps: [{ response: "sconosciuta.response.json", times: 1 }, { response: "002.response.json" }] }),
      RESPONSES
    );
    expect(errors).toEqual([
      "sequence.steps[0].response must be a response filename listed in responseFiles",
    ]);
  });

  test("times e forMs sono mutuamente esclusivi e devono essere interi positivi", () => {
    const both = normalizeSequenceConfig(
      valid({ steps: [{ response: "001.response.json", times: 1, forMs: 100 }, { response: "002.response.json" }] }),
      RESPONSES
    );
    expect(both.errors).toEqual(["sequence.steps[0] cannot declare both times and forMs"]);

    const invalidValues = normalizeSequenceConfig(
      valid({ steps: [{ response: "001.response.json", times: 0 }, { response: "002.response.json", forMs: -5 }] }),
      RESPONSES
    );
    expect(invalidValues.errors).toEqual([
      "sequence.steps[0].times must be a positive integer",
      "sequence.steps[1].forMs must be a positive integer",
    ]);
  });

  test("gli step non terminali devono dichiarare un criterio di avanzamento", () => {
    const { errors } = normalizeSequenceConfig(
      valid({
        steps: [
          { response: "001.response.json" },
          { response: "002.response.json" },
        ],
      }),
      RESPONSES
    );
    expect(errors).toEqual(["sequence.steps[0] must declare times or forMs"]);
  });

  test("con onEnd loop anche l'ultimo step deve dichiarare un criterio", () => {
    const { errors } = normalizeSequenceConfig(valid({ onEnd: "loop" }), RESPONSES);
    expect(errors).toEqual([
      "sequence.steps[1] must declare times or forMs when sequence.onEnd is loop",
    ]);
  });

  test("onEnd, resetAfterMs ed enabled malformati vengono segnalati", () => {
    const { errors } = normalizeSequenceConfig(
      valid({ enabled: "sì", onEnd: "restart", resetAfterMs: 1.5 }),
      RESPONSES
    );
    expect(errors).toEqual([
      "sequence.enabled must be a boolean",
      "sequence.onEnd must be stay or loop",
      "sequence.resetAfterMs must be a positive integer",
    ]);
  });
});

describe("computeSequenceSignature (firma per la sopravvivenza del cursore)", () => {
  test("stessa definizione = stessa firma, anche cambiando enabled", () => {
    const a = normalizeSequenceConfig(valid({ enabled: true }), RESPONSES).sequence;
    const b = normalizeSequenceConfig(valid({ enabled: false }), RESPONSES).sequence;
    expect(computeSequenceSignature(a)).toBe(computeSequenceSignature(b));
  });

  test("cambiare step, onEnd o resetAfterMs cambia la firma", () => {
    const base = normalizeSequenceConfig(valid(), RESPONSES).sequence;
    const differentTimes = normalizeSequenceConfig(
      valid({ steps: [{ response: "001.response.json", times: 5 }, { response: "002.response.json" }] }),
      RESPONSES
    ).sequence;
    const differentReset = normalizeSequenceConfig(valid({ resetAfterMs: 1000 }), RESPONSES).sequence;

    expect(computeSequenceSignature(differentTimes)).not.toBe(computeSequenceSignature(base));
    expect(computeSequenceSignature(differentReset)).not.toBe(computeSequenceSignature(base));
  });
});
