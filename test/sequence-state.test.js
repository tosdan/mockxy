const { SequenceStateStore } = require("../src/mocks/sequence-state");
const { normalizeSequenceConfig } = require("../src/mocks/sequence-config");

const RESPONSES = ["a.response.json", "b.response.json", "c.response.json"];
const KEY = "GET /api/operazioni/1";

function sequenceOf(config) {
  const { errors, sequence } = normalizeSequenceConfig(config, RESPONSES);
  expect(errors).toEqual([]);
  return sequence;
}

// Orologio controllabile: i test di forMs/resetAfterMs muovono il tempo a mano.
function createStore(startMs = 1000) {
  let currentMs = startMs;
  const store = new SequenceStateStore({ now: () => currentMs });
  return {
    store,
    tick: (ms) => {
      currentMs += ms;
    },
  };
}

describe("SequenceStateStore (cursore runtime delle sequenze)", () => {
  test("step times: serve N richieste poi avanza, e con stay resta sull'ultimo", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 2 },
        { response: "b.response.json" },
      ],
    });

    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    // Terminale: resta sull'ultimo per sempre.
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
  });

  test("step forMs: il timer parte alla prima richiesta dello step, non da quando è corrente", () => {
    const { store, tick } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", forMs: 10000 },
        { response: "b.response.json" },
      ],
    });

    // Nessuna richiesta per 1 minuto: il timer non è mai partito.
    tick(60000);
    expect(store.resolveStep(KEY, sequence)).toBe(0);
    tick(9999);
    expect(store.resolveStep(KEY, sequence)).toBe(0);
    tick(1);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
  });

  test("onEnd loop: esaurito l'ultimo step si riparte dal primo", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      onEnd: "loop",
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json", times: 2 },
      ],
    });

    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
  });

  test("con stay l'ultimo step esaurito (times) resta comunque servito: terminale", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json", times: 1 },
      ],
    });

    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
  });

  test("auto-reset per inattività: senza richieste per resetAfterMs si riparte dal primo step", () => {
    const { store, tick } = createStore();
    const sequence = sequenceOf({
      resetAfterMs: 30000,
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json" },
      ],
    });

    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    // Richieste ravvicinate: nessun reset.
    tick(29999);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    // Pausa lunga: la sessione di prova successiva riparte da capo.
    tick(30000);
    expect(store.resolveStep(KEY, sequence)).toBe(0);
  });

  test("firma cambiata (definizione modificata) = cursore azzerato; firma uguale = conservato", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json" },
      ],
    });

    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(1);

    // Stessa definizione ri-normalizzata (es. reload per la modifica della descrizione).
    const sameSequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json" },
      ],
    });
    expect(store.resolveStep(KEY, sameSequence)).toBe(1);

    const changedSequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 5 },
        { response: "b.response.json" },
      ],
    });
    expect(store.resolveStep(KEY, changedSequence)).toBe(0);
  });

  test("reset manuale: si riparte dal primo step", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json" },
      ],
    });

    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    store.reset(KEY);
    expect(store.resolveStep(KEY, sequence)).toBe(0);
  });

  test("endpoint diversi hanno cursori indipendenti", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json" },
      ],
    });

    expect(store.resolveStep("GET /uno", sequence)).toBe(0);
    expect(store.resolveStep("GET /uno", sequence)).toBe(1);
    expect(store.resolveStep("GET /due", sequence)).toBe(0);
  });

  test("getState: vergine prima della prima richiesta e dopo un cambio di firma, poi riflette il cursore", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 2 },
        { response: "b.response.json" },
      ],
    });

    expect(store.getState(KEY, sequence)).toEqual({
      stepIndex: 0,
      servedInStep: 0,
      stepStartedAt: null,
      lastRequestAt: null,
    });

    store.resolveStep(KEY, sequence);
    const state = store.getState(KEY, sequence);
    expect(state.stepIndex).toBe(0);
    expect(state.servedInStep).toBe(1);
    expect(state.stepStartedAt).toBe(1000);
    expect(state.lastRequestAt).toBe(1000);

    const changedSequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 9 },
        { response: "b.response.json" },
      ],
    });
    expect(store.getState(KEY, changedSequence).servedInStep).toBe(0);
  });

  test("sequenza mista times+forMs: il timer del secondo step parte alla sua prima richiesta", () => {
    const { store, tick } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json", forMs: 5000 },
        { response: "c.response.json" },
      ],
    });

    expect(store.resolveStep(KEY, sequence)).toBe(0);
    tick(60000); // il tempo passato PRIMA della prima richiesta dello step forMs non conta
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    tick(4999);
    expect(store.resolveStep(KEY, sequence)).toBe(1);
    tick(1);
    expect(store.resolveStep(KEY, sequence)).toBe(2);
  });
});
