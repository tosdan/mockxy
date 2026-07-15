// Log degli errori dell'app desktop su file, in una sottocartella logs/ accanto all'artefatto
// eseguito: l'utente la trova vicino a ciò che ha lanciato, senza conoscere le cartelle di
// sistema. Raccoglie sia i guasti del guscio Electron (avvio, apertura workspace, eccezioni
// non gestite) sia le righe error del motore (via tee sul logger), che altrimenti finirebbero
// solo su uno stdout invisibile in pacchetto — es. il dettaglio di un handler fallito.
//
// Questo modulo NON dipende da Electron (solo Node): resta testabile dalla suite jest come
// gli altri moduli del guscio (workspace, global-prefs, …).

const fs = require("fs");
const path = require("path");

// Cartella BASE accanto all'artefatto eseguito, nell'ordine più specifico prima:
// - AppImage Linux: accanto al file .AppImage (execPath punta dentro lo squashfs, read-only);
// - build Windows portabile: accanto all'exe (stessa scelta delle preferenze globali);
// - pacchetto installato: accanto all'eseguibile;
// - sviluppo (non impacchettato): devDir (la cartella electron/ del repo).
function resolveLogsBaseDir({ env = process.env, execPath = process.execPath, isPackaged, devDir }) {
  if (env.APPIMAGE) {
    return path.dirname(env.APPIMAGE);
  }
  if (env.PORTABLE_EXECUTABLE_DIR) {
    return env.PORTABLE_EXECUTABLE_DIR;
  }
  if (!isPackaged) {
    return devDir;
  }
  return path.dirname(execPath);
}

const LOGS_DIR_NAME = "logs";

// Un file al giorno: limita la crescita senza logica di rotazione, e "l'errore di oggi"
// è immediato da trovare.
function dailyFileName(now) {
  return `errors-${now.toISOString().slice(0, 10)}.log`;
}

// Riga di log leggibile: timestamp, contesto tra quadre, messaggio, eventuali campi JSON e
// stack indentato. Testo (non JSON-lines): il lettore previsto è una persona, non una pipeline.
function formatEntry(now, context, errorOrMessage, fields) {
  const message = errorOrMessage instanceof Error ? errorOrMessage.message : String(errorOrMessage);
  const stack = errorOrMessage instanceof Error && errorOrMessage.stack ? errorOrMessage.stack : null;
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
  const stackBlock = stack ? `\n${stack.split("\n").map((line) => `    ${line}`).join("\n")}` : "";
  return `${now.toISOString()} [${context}] ${message}${suffix}${stackBlock}\n`;
}

/**
 * Crea il log degli errori su file in `<baseDir>/logs/`, con ripiego su `<fallbackBaseDir>/logs/`
 * se la posizione primaria non è scrivibile (es. eseguibile sotto Program Files). Se nemmeno il
 * ripiego è scrivibile il log si disattiva: il logging non deve MAI abbattere l'app.
 * La scrittura è sincrona: gli errori sono rari e le righe devono arrivare su disco anche se il
 * processo sta morendo (uncaught exception all'avvio).
 *
 * `enabled` è la preferenza dell'utente (spegnibile a runtime con setEnabled, senza riavvio):
 * da spento logError non scrive nulla ma la destinazione resta pronta per la riaccensione.
 * È distinto da logsDir null (nessuna posizione scrivibile), che è un vincolo, non una scelta.
 */
function createErrorFileLog({ baseDir, fallbackBaseDir, now = () => new Date(), enabled = true }) {
  let logsDir = null;
  let isEnabled = enabled !== false;

  for (const candidate of [baseDir, fallbackBaseDir]) {
    if (candidate == null) {
      continue;
    }
    const dir = path.join(candidate, LOGS_DIR_NAME);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      logsDir = dir;
      break;
    } catch {
      // posizione non scrivibile: prova la successiva
    }
  }

  function logError(context, errorOrMessage, fields) {
    if (logsDir == null || !isEnabled) {
      return false;
    }
    const timestamp = now();
    try {
      fs.appendFileSync(path.join(logsDir, dailyFileName(timestamp)), formatEntry(timestamp, context, errorOrMessage, fields));
      return true;
    } catch {
      return false;
    }
  }

  function setEnabled(next) {
    isEnabled = next === true;
  }

  return { logsDir, logError, setEnabled };
}

// Avvolge un logger del motore duplicando le sole righe error verso onError (il chiamante vi
// aggancia il file, etichettando il workspace: nell'app desktop girano più motori insieme).
// Il logger di console resta intatto: stdout in sviluppo continua a mostrare tutto.
function teeErrors(baseLogger, onError) {
  return {
    ...baseLogger,
    error(message, fields) {
      baseLogger.error(message, fields);
      onError(message, fields);
    },
  };
}

module.exports = {
  LOGS_DIR_NAME,
  resolveLogsBaseDir,
  createErrorFileLog,
  teeErrors,
};
