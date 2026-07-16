// Validazione e normalizzazione della variante di risposta `ws` (vedi
// docs/progetto/DESIGN-WEBSOCKET.md): copione di messaggi in uscita, regole dichiarative di
// risposta ai messaggi in ingresso e messaggi pronti (presets) della console.
//
// Modulo condiviso tra il loader runtime e l'admin API, come sse-config: stessa forma
// accettata/rifiutata ovunque, errori incorniciati dal chiamante ({ errors, ws }).

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

const WS_ON_END_VALUES = new Set(["keep-open", "close", "loop"]);
// I codici applicativi validi per una close WebSocket lato server: 1000 (normale) e la banda 3000-4999.
function isValidCloseCode(value) {
  return Number.isInteger(value) && (value === 1000 || (value >= 3000 && value <= 4999));
}

// Un messaggio WS (voce di copione, reply di regola, preset o push manuale): solo `data`
// (JSON — serializzato sul filo — o stringa). Niente event/id: sono concetti SSE.
function validateWsMessage(message, label, errors) {
  if (!isPlainObject(message)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(message, "data")) {
    errors.push(`${label}.data is required`);
    return null;
  }
  return { data: message.data };
}

function normalizeScriptEntries(entries, field, errors) {
  const script = [];
  if (entries != null && !Array.isArray(entries)) {
    errors.push(`${field} must be an array`);
    return script;
  }
  (entries || []).forEach((entry, index) => {
    const label = `${field}[${index}]`;
    const message = validateWsMessage(entry, label, errors);
    if (message == null) {
      return;
    }
    if (!isNonNegativeInteger(entry.afterMs)) {
      errors.push(`${label}.afterMs must be a non-negative integer`);
      return;
    }
    script.push({ afterMs: entry.afterMs, ...message });
  });
  return script;
}

// Il match di una regola: UNA sola condizione tra equals (testo esatto), contains
// (sottostringa) e json (il messaggio è JSON e contiene le coppie indicate — subset di primo
// livello, senza logica: quando serve di più, il gradino giusto è l'handler).
function normalizeRuleMatch(match, label, errors) {
  if (!isPlainObject(match)) {
    errors.push(`${label}.match must be an object`);
    return null;
  }
  const kinds = ["equals", "contains", "json"].filter((kind) =>
    Object.prototype.hasOwnProperty.call(match, kind)
  );
  if (kinds.length !== 1) {
    errors.push(`${label}.match must declare exactly one of equals, contains or json`);
    return null;
  }
  const kind = kinds[0];
  if (kind === "json") {
    if (!isPlainObject(match.json)) {
      errors.push(`${label}.match.json must be an object`);
      return null;
    }
    return { json: match.json };
  }
  if (typeof match[kind] !== "string" || match[kind] === "") {
    errors.push(`${label}.match.${kind} must be a non-empty string`);
    return null;
  }
  return { [kind]: match[kind] };
}

/**
 * Valida e normalizza il contenuto di una variante `ws`. Forma normalizzata:
 *   { script: [{ afterMs, data }], onEnd, closeCode, closeReason,
 *     rules: [{ match, reply: [{ afterMs, data }] }], presets: [{ label, data }] }
 * `script` può essere vuoto (endpoint muto: solo regole e console); `onEnd` default keep-open.
 */
function normalizeWsConfig(response) {
  const errors = [];

  const onEnd = response.onEnd == null ? "keep-open" : response.onEnd;
  if (!WS_ON_END_VALUES.has(onEnd)) {
    errors.push("onEnd must be keep-open, close or loop");
  }

  let closeCode = null;
  let closeReason = null;
  if (response.closeCode != null) {
    if (!isValidCloseCode(response.closeCode)) {
      errors.push("closeCode must be 1000 or an integer between 3000 and 4999");
    } else if (onEnd !== "close") {
      errors.push("closeCode requires onEnd close");
    } else {
      closeCode = response.closeCode;
    }
  }
  if (response.closeReason != null) {
    if (typeof response.closeReason !== "string" || response.closeReason.length > 123) {
      // 123 = limite del protocollo: il payload della close (2 byte di codice + reason) sta in 125.
      errors.push("closeReason must be a string of at most 123 characters");
    } else if (onEnd !== "close") {
      errors.push("closeReason requires onEnd close");
    } else {
      closeReason = response.closeReason;
    }
  }

  const script = normalizeScriptEntries(response.script, "script", errors);

  // Come per le SSE: un loop senza copione girerebbe a vuoto, uno di soli afterMs 0 sarebbe
  // un ciclo stretto.
  if (onEnd === "loop") {
    if (script.length === 0) {
      errors.push("onEnd loop requires a non-empty script");
    } else if (script.every((entry) => entry.afterMs === 0)) {
      errors.push("onEnd loop requires at least one script entry with afterMs > 0");
    }
  }

  const rules = [];
  if (response.rules != null && !Array.isArray(response.rules)) {
    errors.push("rules must be an array");
  } else {
    (response.rules || []).forEach((entry, index) => {
      const label = `rules[${index}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${label} must be an object`);
        return;
      }
      const match = normalizeRuleMatch(entry.match, label, errors);
      if (match == null) {
        return;
      }
      const reply = normalizeScriptEntries(entry.reply, `${label}.reply`, errors);
      if (!Array.isArray(entry.reply) || entry.reply.length === 0) {
        errors.push(`${label}.reply must be a non-empty array`);
        return;
      }
      rules.push({ match, reply });
    });
  }

  const presets = [];
  if (response.presets != null && !Array.isArray(response.presets)) {
    errors.push("presets must be an array");
  } else {
    (response.presets || []).forEach((entry, index) => {
      const label = `presets[${index}]`;
      const message = validateWsMessage(entry, label, errors);
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
    return { errors, ws: null };
  }

  return {
    errors: [],
    ws: { script, onEnd, closeCode, closeReason, rules, presets },
  };
}

/**
 * Prima regola che matcha il messaggio in ingresso, o null (nessun eco di default: il
 * messaggio resta solo nel transcript — vedi design, questione 3 decisa).
 * `text` è il payload testuale del frame; il JSON per il match `json` viene parsato una volta.
 */
function matchWsRule(rules, text) {
  let parsed;
  let parsedKnown = false;
  for (const rule of rules) {
    if (rule.match.equals != null) {
      if (text === rule.match.equals) {
        return rule;
      }
      continue;
    }
    if (rule.match.contains != null) {
      if (text.includes(rule.match.contains)) {
        return rule;
      }
      continue;
    }
    if (!parsedKnown) {
      parsedKnown = true;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    if (
      parsed != null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.entries(rule.match.json).every(
        ([key, value]) => JSON.stringify(parsed[key]) === JSON.stringify(value)
      )
    ) {
      return rule;
    }
  }
  return null;
}

module.exports = {
  normalizeWsConfig,
  validateWsMessage,
  matchWsRule,
};
