// Corsa tra un task e un timer: una promise che non risolve mai (fetch senza timeout,
// deadlock) non deve lasciare la richiesta appesa per sempre. Se il task perde la corsa
// e rigetta più tardi, l'errore viene inghiottito (niente unhandled rejection); un
// eventuale risultato tardivo viene semplicemente ignorato.
function runWithTimeout(taskFn, timeoutMs, { code, message }) {
  const taskPromise = Promise.resolve().then(taskFn);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return taskPromise;
  }

  taskPromise.catch(() => {});
  let timer;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = code;
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });

  return Promise.race([taskPromise, timeoutPromise]).finally(() => clearTimeout(timer));
}

module.exports = { runWithTimeout };
