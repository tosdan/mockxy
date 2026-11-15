const { currentScriptOrigin } = require("./mocks/script-execution");

/**
 * Errori che uno script del workspace lancia fuori dalla sua richiesta.
 *
 * Un `throw` dentro un timer, un callback di evento o una promise che nessuno attende non
 * passa dal `try` che avvolge l'handler: arriva al processo come eccezione non gestita, e Node
 * di suo termina. Per un server di mock significa che un errore in uno script spegne il
 * servizio a tutti, senza una riga che dica quale script.
 *
 * La guardia distingue per origine (script-execution.js la ricorda lungo timer e promise):
 * - l'errore discende da uno script del workspace → viene scritto nel log con lo script e
 *   l'endpoint, e il server continua;
 * - l'errore è del motore → resta fatale, come senza guardia: uno stato interno che non
 *   conosciamo non va tenuto in servizio.
 *
 * La installa solo chi possiede il processo (index.js). L'app desktop ha i suoi gestori, che
 * usano describeCurrentScriptFault per dire all'utente di chi è l'errore.
 */

// Campi di log che identificano lo script; null fuori dagli script.
function describeCurrentScriptFault() {
  const origin = currentScriptOrigin();
  if (origin == null) {
    return null;
  }
  const endpoint = [origin.method, origin.path].filter(Boolean).join(" ");
  return {
    scriptKind: origin.kind,
    ...(origin.filePath ? { script: origin.filePath } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}

function errorFields(reason) {
  if (reason instanceof Error) {
    return { error: reason.message, errorName: reason.name, errorStack: reason.stack };
  }
  return { error: String(reason) };
}

// Comportamento di Node senza gestori: stack su stderr, uscita con codice 1.
function exitOnEngineFault(reason) {
  console.error(reason);
  process.exit(1);
}

// Registra i gestori sul processo e restituisce la funzione che li toglie. `logger` può cambiare
// nel tempo (prima dell'avvio non c'è ancora quello del runtime): viene letto a ogni errore.
function installScriptFaultGuard({ getLogger, processRef = process, onEngineFault = exitOnEngineFault }) {
  const handle = (kind) => (reason) => {
    const scriptFault = describeCurrentScriptFault();
    if (scriptFault == null) {
      onEngineFault(reason);
      return;
    }
    getLogger().error(
      "A workspace script failed outside its request (in a timer, an event callback or a promise nobody awaits). The error was contained and the server keeps running.",
      { fault: kind, ...scriptFault, ...errorFields(reason) }
    );
  };
  const onUncaughtException = handle("uncaught_exception");
  const onUnhandledRejection = handle("unhandled_rejection");
  processRef.on("uncaughtException", onUncaughtException);
  processRef.on("unhandledRejection", onUnhandledRejection);
  return () => {
    processRef.off("uncaughtException", onUncaughtException);
    processRef.off("unhandledRejection", onUnhandledRejection);
  };
}

module.exports = { describeCurrentScriptFault, installScriptFaultGuard };
