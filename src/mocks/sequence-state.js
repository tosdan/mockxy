const { computeSequenceSignature } = require("./sequence-config");

// Cursori runtime delle sequenze di varianti: a che punto è ogni endpoint con sequenza attiva.
// Stato volutamente in-memory ed effimero (vedi docs/progetto/DESIGN-SEQUENZE.md): si azzera al
// riavvio del motore, col reset manuale (admin API), per inattività (resetAfterMs) e quando la
// definizione della sequenza cambia (confronto di firma — così una modifica all'endpoint che NON
// tocca la sequenza, es. la descrizione, non falsa un giro di polling in corso).
//
// Le voci di endpoint spariti restano nella mappa fino al riavvio: sono poche decine di byte
// l'una e potare a ogni reload non vale l'accoppiamento col loader.

class SequenceStateStore {
  constructor({ now = () => Date.now() } = {}) {
    this.entries = new Map();
    this.now = now;
  }

  createEntry(signature) {
    return {
      signature,
      stepIndex: 0,
      servedInStep: 0,
      // Il timer di uno step forMs parte alla sua PRIMA richiesta, non da quando è diventato
      // corrente: "processing dura 15s" conta da quando il client inizia a chiedere.
      stepStartedAt: null,
      lastRequestAt: null,
      // Con onEnd "stay" l'ultimo step esaurito diventa terminale: i criteri smettono di
      // contare e si resta lì fino a un reset.
      terminal: false,
    };
  }

  // Fa avanzare il cursore di uno step (o chiude/riavvolge la sequenza a fine corsa).
  advance(entry, sequence) {
    if (entry.stepIndex >= sequence.steps.length - 1) {
      if (sequence.onEnd === "loop") {
        entry.stepIndex = 0;
      } else {
        entry.terminal = true;
        return;
      }
    } else {
      entry.stepIndex += 1;
    }
    entry.servedInStep = 0;
    entry.stepStartedAt = null;
  }

  /**
   * Sceglie lo step che serve QUESTA richiesta e aggiorna il cursore: applica l'auto-reset per
   * inattività, salta gli step forMs scaduti, conta la richiesta e (per gli step times) avanza
   * quando la quota è esaurita. `key` identifica l'endpoint ("METHOD path"); `sequence` è la
   * definizione normalizzata. Restituisce l'indice dello step servito.
   */
  resolveStep(key, sequence) {
    const now = this.now();
    const signature = computeSequenceSignature(sequence);
    let entry = this.entries.get(key);
    if (entry == null || entry.signature !== signature) {
      entry = this.createEntry(signature);
      this.entries.set(key, entry);
    }

    if (
      sequence.resetAfterMs != null
      && entry.lastRequestAt != null
      && now - entry.lastRequestAt >= sequence.resetAfterMs
    ) {
      entry = this.createEntry(signature);
      this.entries.set(key, entry);
    }

    // Step forMs scaduti: si avanza prima di servire. Al più un passo per richiesta reale (lo
    // step successivo non ha ancora stepStartedAt), ma il ciclo resta per chiarezza e simmetria.
    while (!entry.terminal) {
      const step = sequence.steps[entry.stepIndex];
      if (step.forMs != null && entry.stepStartedAt != null && now - entry.stepStartedAt >= step.forMs) {
        this.advance(entry, sequence);
        continue;
      }
      break;
    }

    if (entry.stepStartedAt == null) {
      entry.stepStartedAt = now;
    }
    entry.servedInStep += 1;
    entry.lastRequestAt = now;
    const servedIndex = entry.stepIndex;

    // Avanzamento anticipato per gli step times: il cursore punta già allo step della prossima
    // richiesta, così lo stato esposto all'admin è sempre "cosa risponderà adesso".
    const servedStep = sequence.steps[servedIndex];
    if (!entry.terminal && servedStep.times != null && entry.servedInStep >= servedStep.times) {
      this.advance(entry, sequence);
    }

    return servedIndex;
  }

  /** Stato corrente per l'admin API; vergine (primo step, nessuna richiesta) se mai servito o firma cambiata. */
  getState(key, sequence) {
    const entry = this.entries.get(key);
    if (entry == null || entry.signature !== computeSequenceSignature(sequence)) {
      return { stepIndex: 0, servedInStep: 0, stepStartedAt: null, lastRequestAt: null };
    }
    return {
      stepIndex: entry.stepIndex,
      servedInStep: entry.servedInStep,
      stepStartedAt: entry.stepStartedAt,
      lastRequestAt: entry.lastRequestAt,
    };
  }

  /** Riparte dal primo step alla prossima richiesta (reset manuale dall'admin API / UI). */
  reset(key) {
    this.entries.delete(key);
  }
}

module.exports = {
  SequenceStateStore,
};
