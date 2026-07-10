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

module.exports = {
  createAdminError,
};
