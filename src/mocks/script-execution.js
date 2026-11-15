const vm = require("vm");
const { AsyncLocalStorage } = require("async_hooks");

/**
 * Esecuzione degli script del workspace (handler, middleware) dentro il processo del motore.
 *
 * Gli script girano nello stesso processo di tutto il resto: del server, dell'admin API e,
 * nell'app desktop, della finestra e degli altri workspace. Due loro errori non restavano
 * confinati alla richiesta:
 *
 * - **codice sincrono che non finisce** (`while (true) {}`, una regex catastrofica): il timeout
 *   della richiesta è un timer, e un timer non scatta finché il thread è occupato. Qui la
 *   chiamata passa da `vm` con un tempo massimo, che interrompe l'esecuzione da fuori;
 * - **un errore lanciato fuori dalla richiesta** (dentro un timer o una promise non attesa):
 *   arriva al processo come eccezione non gestita. Qui ogni chiamata gira in un contesto
 *   asincrono che ne ricorda l'origine, così chi gestisce l'errore a livello di processo
 *   (script-fault-guard.js) sa che viene da uno script e da quale.
 *
 * Limite dichiarato: il tempo massimo copre il tratto sincrono fino al primo `await` (o
 * l'intera funzione, se è sincrona). Un ciclo che parte dopo un `await` non è interrompibile
 * senza spostare gli script in un altro thread.
 */

// Origine dello script in esecuzione: { kind, filePath, method?, path? }.
const scriptOrigins = new AsyncLocalStorage();

// Un solo contesto vm, riusato: serve soltanto a far partire la chiamata sotto il tempo massimo.
// La funzione chiamata resta quella del contesto principale, con i suoi oggetti e i suoi errori.
const invocationSlot = { call: null };
const invocationContext = vm.createContext(invocationSlot);
const invocationScript = new vm.Script("call()", { filename: "mockxy-script-invocation" });

class ScriptBlockedError extends Error {
  constructor(budgetMs) {
    super(`The script kept the server busy for ${budgetMs}ms with synchronous code and was interrupted.`);
    this.name = "ScriptBlockedError";
    this.code = "SCRIPT_BLOCKED";
    this.budgetMs = budgetMs;
  }
}

// Chiama `fn` e ne restituisce il risultato (anche una promise); se il suo codice sincrono
// supera il tempo massimo lo interrompe e lancia ScriptBlockedError. Attenzione: l'interruzione
// non esegue i `finally` attraversati, nemmeno quelli del motore: chi offre agli script API con
// callback deve saper tornare a uno stato coerente (vedi SharedStateStore).
function invokeWithSyncBudget(fn, budgetMs) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    return fn();
  }
  const previous = invocationSlot.call;
  invocationSlot.call = fn;
  try {
    return invocationScript.runInContext(invocationContext, { timeout: Math.ceil(budgetMs) });
  } catch (error) {
    if (error?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      throw new ScriptBlockedError(Math.ceil(budgetMs));
    }
    throw error;
  } finally {
    invocationSlot.call = previous;
  }
}

// Esegue una funzione di uno script del workspace: origine ricordata per tutto ciò che la
// chiamata avvia (timer, promise), tempo massimo sul tratto sincrono. Uscendo, il contesto
// asincrono torna quello di prima anche dopo un'interruzione.
function runScript(origin, fn, syncBudgetMs) {
  return scriptOrigins.run(origin, () => invokeWithSyncBudget(fn, syncBudgetMs));
}

// Solo l'origine, senza tempo massimo: per il caricamento del modulo, dove interrompere un
// `require` a metà lascerebbe moduli compilati per metà nella cache di Node.
function runWithScriptOrigin(origin, fn) {
  return scriptOrigins.run(origin, fn);
}

// Origine dello script da cui discende il codice in esecuzione; undefined fuori dagli script.
function currentScriptOrigin() {
  return scriptOrigins.getStore();
}

function isScriptBlockedError(error) {
  return error instanceof ScriptBlockedError;
}

module.exports = {
  currentScriptOrigin,
  invokeWithSyncBudget,
  isScriptBlockedError,
  runScript,
  runWithScriptOrigin,
  ScriptBlockedError,
};
