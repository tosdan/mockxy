// Porta e URL del backend e2e: unica fonte per playwright.config.js (avvio e healthcheck del
// server) e per gli helper dei test (reset dello stato via API). La config d'indagine
// playwright.ngprobe.config.js NON la usa di proposito: è la replica congelata dell'architettura A.
const E2E_PORT = 3101;
const E2E_BACKEND = `http://localhost:${E2E_PORT}`;

// Backend separato del collaudo del setup via API (C6), sul workspace di fixture isolato.
const AGENT_PORT = 3102;
const AGENT_BACKEND = `http://localhost:${AGENT_PORT}`;

module.exports = { E2E_PORT, E2E_BACKEND, AGENT_PORT, AGENT_BACKEND };
