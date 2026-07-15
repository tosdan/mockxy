// Validazione e normalizzazione del campo `sequence` del file endpoint (vedi
// docs/progetto/DESIGN-SEQUENZE.md): la sequenza è una politica di selezione sopra le varianti
// esistenti — ordina le response e decide quanto a lungo servirle (times = numero di richieste,
// forMs = millisecondi dalla prima richiesta dello step).
//
// Modulo condiviso tra il loader runtime (endpoint-loader) e l'admin API (endpoint-files):
// entrambi devono accettare/rifiutare le stesse forme, ma incorniciano gli errori a modo loro
// (lista di errori di load vs 400 admin). Per questo qui si restituisce { errors, sequence }
// invece di lanciare.

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

const SEQUENCE_ON_END_VALUES = new Set(["stay", "loop"]);

/**
 * Valida e normalizza `sequence` rispetto all'elenco varianti dell'endpoint. `sequence` assente
 * (null/undefined) è legittimo: endpoint senza sequenza, si restituisce { errors: [], sequence: null }.
 *
 * Forma normalizzata:
 *   { enabled, steps: [{ response, times?, forMs? }], onEnd, resetAfterMs }
 * con enabled default true, onEnd default "stay", resetAfterMs null quando assente.
 */
function normalizeSequenceConfig(sequence, responseFiles) {
  if (sequence == null) {
    return { errors: [], sequence: null };
  }

  const errors = [];
  if (!isPlainObject(sequence)) {
    return { errors: ["sequence must be an object"], sequence: null };
  }

  if (sequence.enabled != null && typeof sequence.enabled !== "boolean") {
    errors.push("sequence.enabled must be a boolean");
  }
  const enabled = sequence.enabled !== false;

  const onEnd = sequence.onEnd == null ? "stay" : sequence.onEnd;
  if (!SEQUENCE_ON_END_VALUES.has(onEnd)) {
    errors.push("sequence.onEnd must be stay or loop");
  }

  let resetAfterMs = null;
  if (sequence.resetAfterMs != null) {
    if (!isPositiveInteger(sequence.resetAfterMs)) {
      errors.push("sequence.resetAfterMs must be a positive integer");
    } else {
      resetAfterMs = sequence.resetAfterMs;
    }
  }

  const knownResponseFiles = new Set(Array.isArray(responseFiles) ? responseFiles : []);
  const steps = [];
  if (!Array.isArray(sequence.steps) || sequence.steps.length < 2) {
    // Con un solo step la sequenza equivale alla selezione classica: due modi di dire la stessa
    // cosa sono un errore, non una comodità.
    errors.push("sequence.steps must be an array with at least 2 steps");
  } else {
    sequence.steps.forEach((step, index) => {
      const label = `sequence.steps[${index}]`;
      if (!isPlainObject(step)) {
        errors.push(`${label} must be an object`);
        return;
      }

      if (typeof step.response !== "string" || !knownResponseFiles.has(step.response)) {
        errors.push(`${label}.response must be a response filename listed in responseFiles`);
      }

      const hasTimes = step.times != null;
      const hasForMs = step.forMs != null;
      if (hasTimes && hasForMs) {
        errors.push(`${label} cannot declare both times and forMs`);
      }
      if (hasTimes && !isPositiveInteger(step.times)) {
        errors.push(`${label}.times must be a positive integer`);
      }
      if (hasForMs && !isPositiveInteger(step.forMs)) {
        errors.push(`${label}.forMs must be a positive integer`);
      }

      const isLastStep = index === sequence.steps.length - 1;
      // L'ultimo step senza criterio è lo stato terminale (con "stay" ci si ferma lì); tutti
      // gli altri devono dire quando si avanza. Con "loop" anche l'ultimo deve dirlo, altrimenti
      // il giro non riparte mai.
      if (!hasTimes && !hasForMs && (!isLastStep || onEnd === "loop")) {
        errors.push(
          isLastStep
            ? `${label} must declare times or forMs when sequence.onEnd is loop`
            : `${label} must declare times or forMs`
        );
      }

      const normalizedStep = { response: step.response };
      if (hasTimes) {
        normalizedStep.times = step.times;
      }
      if (hasForMs) {
        normalizedStep.forMs = step.forMs;
      }
      steps.push(normalizedStep);
    });
  }

  if (errors.length > 0) {
    return { errors, sequence: null };
  }

  return {
    errors: [],
    sequence: { enabled, steps, onEnd, resetAfterMs },
  };
}

/**
 * Firma della definizione di sequenza, per far sopravvivere il cursore alle ricariche a caldo
 * che non la toccano (es. modifica della sola descrizione dell'endpoint): firma uguale = cursore
 * conservato, firma diversa = si riparte dal primo step. `enabled` non partecipa: da spenta la
 * sequenza non serve richieste, e riaccenderla non deve falsare un giro a metà.
 */
function computeSequenceSignature(sequence) {
  return JSON.stringify({
    steps: sequence.steps,
    onEnd: sequence.onEnd,
    resetAfterMs: sequence.resetAfterMs,
  });
}

module.exports = {
  normalizeSequenceConfig,
  computeSequenceSignature,
};
