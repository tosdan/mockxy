// Validazione e normalizzazione della variante di risposta `sse` (vedi
// docs/progetto/DESIGN-SSE.md): un copione di eventi Server-Sent Events da mandare in onda a
// ogni connessione, più i messaggi pronti (presets) della console.
//
// Modulo condiviso tra il loader runtime e l'admin API, come sequence-config: stessa forma
// accettata/rifiutata ovunque, errori incorniciati dal chiamante ({ errors, sse }).

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

const SSE_ON_END_VALUES = new Set(["keep-open", "close", "loop"]);

// Un messaggio SSE (voce di copione, preset o push manuale): data obbligatorio (JSON o
// stringa), event/id facoltativi. Restituisce gli errori con la label del contesto.
function validateSseMessage(message, label, errors) {
  if (!isPlainObject(message)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(message, "data")) {
    errors.push(`${label}.data is required`);
    return null;
  }
  if (message.event != null && (typeof message.event !== "string" || message.event.trim() === "")) {
    errors.push(`${label}.event must be a non-empty string`);
  }
  if (message.id != null && typeof message.id !== "string") {
    errors.push(`${label}.id must be a string`);
  }

  const normalized = { data: message.data };
  if (message.event != null) {
    normalized.event = message.event;
  }
  if (typeof message.id === "string") {
    normalized.id = message.id;
  }
  return normalized;
}

/**
 * Valida e normalizza il contenuto di una variante `sse`. Forma normalizzata:
 *   { retryMs, script: [{ afterMs, data, event?, id? }], onEnd, presets: [{ label?, data, event?, id? }] }
 * `script` può essere vuoto (endpoint muto, alimentato dalla console); `onEnd` default keep-open.
 */
function normalizeSseConfig(response) {
  const errors = [];

  let retryMs = null;
  if (response.retryMs != null) {
    if (!isNonNegativeInteger(response.retryMs)) {
      errors.push("retryMs must be a non-negative integer");
    } else {
      retryMs = response.retryMs;
    }
  }

  const onEnd = response.onEnd == null ? "keep-open" : response.onEnd;
  if (!SSE_ON_END_VALUES.has(onEnd)) {
    errors.push("onEnd must be keep-open, close or loop");
  }

  const script = [];
  if (response.script != null && !Array.isArray(response.script)) {
    errors.push("script must be an array");
  } else {
    (response.script || []).forEach((entry, index) => {
      const label = `script[${index}]`;
      const message = validateSseMessage(entry, label, errors);
      if (message == null) {
        return;
      }
      if (!isNonNegativeInteger(entry.afterMs)) {
        errors.push(`${label}.afterMs must be a non-negative integer`);
        return;
      }
      script.push({ afterMs: entry.afterMs, ...message });
    });
  }

  // Con loop un copione vuoto girerebbe a vuoto; e un loop di soli afterMs 0 sarebbe un ciclo
  // stretto: serve almeno un ritardo complessivo positivo.
  if (onEnd === "loop") {
    if (script.length === 0) {
      errors.push("onEnd loop requires a non-empty script");
    } else if (script.every((entry) => entry.afterMs === 0)) {
      errors.push("onEnd loop requires at least one script entry with afterMs > 0");
    }
  }

  const presets = [];
  if (response.presets != null && !Array.isArray(response.presets)) {
    errors.push("presets must be an array");
  } else {
    (response.presets || []).forEach((entry, index) => {
      const label = `presets[${index}]`;
      const message = validateSseMessage(entry, label, errors);
      if (message == null) {
        return;
      }
      if (entry.label != null && typeof entry.label !== "string") {
        errors.push(`${label}.label must be a string`);
        return;
      }
      presets.push({ label: entry.label || "", ...message });
    });
  }

  if (errors.length > 0) {
    return { errors, sse: null };
  }

  return {
    errors: [],
    sse: { retryMs, script, onEnd, presets },
  };
}

module.exports = {
  normalizeSseConfig,
  validateSseMessage,
};
