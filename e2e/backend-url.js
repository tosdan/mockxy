// Porta e URL del backend e2e: unica fonte per playwright.config.js (avvio e healthcheck del
// server) e per gli helper dei test (reset dello stato via API). La config d'indagine
// playwright.ngprobe.config.js NON la usa di proposito: è la replica congelata dell'architettura A.
const E2E_PORT = 3101;
const E2E_BACKEND = `http://localhost:${E2E_PORT}`;

module.exports = { E2E_PORT, E2E_BACKEND };
