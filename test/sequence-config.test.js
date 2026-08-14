const { normalizeSequenceResponse, computeSequenceSignature } = require("../src/mocks/sequence-config");

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

describe("sequence-config (validazione della response sequence)", () => {
  test("la response sequence deve essere un oggetto", () => {
    expect(normalizeSequenceResponse(null, RESPONSES).errors).toEqual(["sequence response must be an object"]);
    expect(normalizeSequenceResponse([], RESPONSES).errors).toEqual(["sequence response must be an object"]);
  });

  test("una sequenza minima valida viene normalizzata con i default", () => {
    const { errors, sequence } = normalizeSequenceResponse(valid(), RESPONSES);
    expect(errors).toEqual([]);
    expect(sequence).toEqual({
      steps: [
        { response: "001.response.json", times: 3 },
        { response: "002.response.json" },
      ],
      onEnd: "stay",
      resetAfterMs: null,
    });
  });

  test("onEnd loop e resetAfterMs vengono conservati", () => {
    const { errors, sequence } = normalizeSequenceResponse(
      valid({
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
    expect(sequence.onEnd).toBe("loop");
    expect(sequence.resetAfterMs).toBe(30000);
    expect(sequence.steps[0]).toEqual({ response: "001.response.json", forMs: 15000 });
  });

  test("i campi sconosciuti di sequence e step non finiscono nella forma normalizzata", () => {
    const { sequence } = normalizeSequenceResponse(
      valid({ extra: true, steps: [{ response: "001.response.json", times: 1, note: "x" }, { response: "002.response.json" }] }),
      RESPONSES
    );
    expect(sequence).not.toHaveProperty("extra");
    expect(sequence.steps[0]).toEqual({ response: "001.response.json", times: 1 });
  });

  test("enabled viene rifiutato: l'attivazione dipende dalla response selezionata", () => {
    expect(normalizeSequenceResponse(valid({ enabled: false }), RESPONSES).errors).toEqual([
      "sequence.enabled is not supported; select the sequence response to activate it",
    ]);
  });

  test("servono almeno 2 step (uno solo equivale alla selezione classica)", () => {
    const { errors } = normalizeSequenceResponse(valid({ steps: [{ response: "001.response.json" }] }), RESPONSES);
    expect(errors).toEqual(["sequence.steps must be an array with at least 2 steps"]);
  });

  test("uno step deve referenziare una variante elencata in responseFiles", () => {
    const { errors } = normalizeSequenceResponse(
      valid({ steps: [{ response: "sconosciuta.response.json", times: 1 }, { response: "002.response.json" }] }),
      RESPONSES
    );
    expect(errors).toEqual([
      "sequence.steps[0].response must be a response filename listed in responseFiles",
    ]);
  });

  test("times e forMs sono mutuamente esclusivi e devono essere interi positivi", () => {
    const both = normalizeSequenceResponse(
      valid({ steps: [{ response: "001.response.json", times: 1, forMs: 100 }, { response: "002.response.json" }] }),
      RESPONSES
    );
    expect(both.errors).toEqual(["sequence.steps[0] cannot declare both times and forMs"]);

    const invalidValues = normalizeSequenceResponse(
      valid({ steps: [{ response: "001.response.json", times: 0 }, { response: "002.response.json", forMs: -5 }] }),
      RESPONSES
    );
    expect(invalidValues.errors).toEqual([
      "sequence.steps[0].times must be a positive integer",
      "sequence.steps[1].forMs must be a positive integer",
    ]);
  });

  test("gli step non terminali devono dichiarare un criterio di avanzamento", () => {
    const { errors } = normalizeSequenceResponse(
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
    const { errors } = normalizeSequenceResponse(valid({ onEnd: "loop" }), RESPONSES);
    expect(errors).toEqual([
      "sequence.steps[1] must declare times or forMs when sequence.onEnd is loop",
    ]);
  });

  test("onEnd e resetAfterMs malformati vengono segnalati", () => {
    const { errors } = normalizeSequenceResponse(
      valid({ onEnd: "restart", resetAfterMs: 1.5 }),
      RESPONSES
    );
    expect(errors).toEqual([
      "sequence.onEnd must be stay or loop",
      "sequence.resetAfterMs must be a positive integer",
    ]);
  });
});

describe("computeSequenceSignature (firma per la sopravvivenza del cursore)", () => {
  test("stesso file e stessa definizione = stessa firma; file diversi = firme diverse", () => {
    const a = normalizeSequenceResponse(valid(), RESPONSES).sequence;
    const b = normalizeSequenceResponse(valid(), RESPONSES).sequence;
    expect(computeSequenceSignature("003.response.json", a)).toBe(computeSequenceSignature("003.response.json", b));
    expect(computeSequenceSignature("003.response.json", a)).not.toBe(computeSequenceSignature("004.response.json", b));
  });

  test("cambiare step, onEnd o resetAfterMs cambia la firma", () => {
    const base = normalizeSequenceResponse(valid(), RESPONSES).sequence;
    const differentTimes = normalizeSequenceResponse(
      valid({ steps: [{ response: "001.response.json", times: 5 }, { response: "002.response.json" }] }),
      RESPONSES
    ).sequence;
    const differentReset = normalizeSequenceResponse(valid({ resetAfterMs: 1000 }), RESPONSES).sequence;

    expect(computeSequenceSignature("003.response.json", differentTimes)).not.toBe(computeSequenceSignature("003.response.json", base));
    expect(computeSequenceSignature("003.response.json", differentReset)).not.toBe(computeSequenceSignature("003.response.json", base));
  });
});
