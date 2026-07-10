// Decisioni di hardening per la navigazione della finestra Electron, isolate dal runtime GUI così
// da restare testabili con Jest (main.js le installa su webContents e agisce con shell.openExternal).
//
// Principio: la finestra deve restare sull'app (il motore locale su 127.0.0.1, o la view di
// benvenuto). Qualunque tentativo di portarla altrove è bloccato; se è un link http/https lo si
// apre nel browser di sistema, non dentro l'app. Nuove finestre Electron non se ne aprono mai.

// True quando due URL condividono lo stesso origin (protocollo + host + porta). Gli URL non
// parsabili non sono mai "stesso origin".
function isSameOrigin(currentUrl, targetUrl) {
  try {
    return new URL(currentUrl).origin === new URL(targetUrl).origin;
  } catch (_error) {
    return false;
  }
}

// True per gli schemi che ha senso delegare al browser di sistema (i soli apribili con openExternal
// senza rischio: niente file:, javascript:, data: ecc.).
function isExternalWebUrl(targetUrl) {
  try {
    const protocol = new URL(targetUrl).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch (_error) {
    return false;
  }
}

// Decide una navigazione della finestra principale (evento will-navigate/will-redirect).
// - stesso origin dell'URL corrente → consentita (è la SPA che naviga dentro sé stessa);
// - altrimenti bloccata; se è un link web, va aperta nel browser di sistema.
function decideNavigation(currentUrl, targetUrl) {
  if (isSameOrigin(currentUrl, targetUrl)) {
    return { allow: true, openExternal: null };
  }
  return { allow: false, openExternal: isExternalWebUrl(targetUrl) ? targetUrl : null };
}

// Decide una richiesta di apertura finestra (window.open, target="_blank"): mai una nuova finestra
// Electron. Se è un link web lo si apre nel browser di sistema, altrimenti si nega e basta.
function decideWindowOpen(targetUrl) {
  return { openExternal: isExternalWebUrl(targetUrl) ? targetUrl : null };
}

module.exports = {
  isSameOrigin,
  isExternalWebUrl,
  decideNavigation,
  decideWindowOpen,
};
