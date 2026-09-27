// Errore strutturato dell'admin API: status HTTP + messaggio + dettagli opzionali.
// È la radice delle dipendenze dei moduli admin: non deve importare nulla.
function createAdminError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details != null) {
    error.details = details;
  }
  return error;
}

// Un file referenziato che manca durante una lettura: la definizione può essere cambiata mentre
// la leggevamo. Il marcatore non cambia status e messaggio dell'errore, ma permette alle letture
// del dettaglio di distinguerlo da un errore di schema o di accesso (piano agent/API, §13 C4).
function markMissingFile(error) {
  error.missingFile = true;
  return error;
}

function isMissingFileError(error) {
  return error?.missingFile === true || error?.code === "ENOENT";
}

module.exports = {
  createAdminError,
  isMissingFileError,
  markMissingFile,
};
