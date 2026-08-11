const { SequenceStateStore } = require("../src/mocks/sequence-state");
const { normalizeSequenceResponse } = require("../src/mocks/sequence-config");

const RESPONSES = ["a.response.json", "b.response.json", "c.response.json"];
const KEY = "GET /api/operazioni/1";
const SEQUENCE_FILE = "sequence.response.json";

function sequenceOf(config) {
  const { errors, sequence } = normalizeSequenceResponse(config, RESPONSES);
  expect(errors).toEqual([]);
  return sequence;
}

// Orologio controllabile: i test di forMs/resetAfterMs muovono il tempo a mano.
function createStore(startMs = 1000) {
  let currentMs = startMs;
  const rawStore = new SequenceStateStore({ now: () => currentMs });
  const store = {
    resolveStep: (key, sequence) => rawStore.resolveStep(key, SEQUENCE_FILE, sequence),
    getState: (key, sequence) => rawStore.getState(key, SEQUENCE_FILE, sequence),
    reset: (key) => rawStore.reset(key),
    reconcile: (active) => rawStore.reconcile(active),
  };
  return {
    store,
    rawStore,
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

  test("reconcile conserva lo stato a firma uguale e lo azzera al cambio di variante", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json" },
      ],
    });
    const active = (fileName) => new Map([[KEY, { sequenceFileName: fileName, sequence }]]);

    expect(store.reconcile(active(SEQUENCE_FILE))).toEqual(new Set([KEY]));
    expect(store.resolveStep(KEY, sequence)).toBe(0);
    expect(store.resolveStep(KEY, sequence)).toBe(1);

    expect(store.reconcile(active(SEQUENCE_FILE))).toEqual(new Set());
    expect(store.resolveStep(KEY, sequence)).toBe(1);

    expect(store.reconcile(active("other.response.json"))).toEqual(new Set([KEY]));
    // Il wrapper usa SEQUENCE_FILE: la firma diversa forza comunque uno stato vergine.
    expect(store.resolveStep(KEY, sequence)).toBe(0);
  });

  test("reconcile rimuove lo stato quando l'endpoint non serve più una sequence", () => {
    const { store } = createStore();
    const sequence = sequenceOf({
      steps: [
        { response: "a.response.json", times: 1 },
        { response: "b.response.json" },
      ],
    });
    store.reconcile(new Map([[KEY, { sequenceFileName: SEQUENCE_FILE, sequence }]]));
    store.resolveStep(KEY, sequence);
    expect(store.reconcile(new Map())).toEqual(new Set([KEY]));
    expect(store.getState(KEY, sequence).servedInStep).toBe(0);
  });
});
