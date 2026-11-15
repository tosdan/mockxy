/**
 * Dove va una richiesta proxata: sempre e solo sul backend configurato.
 *
 * Il request-target arriva dal client e non è affidabile: risolverlo come riferimento relativo
 * su BACKEND_URL (`new URL(target, backendUrl)`) lascia che sia lui a scegliere l'host —
 * `//altro-host/x`, `/\altro-host/x` e la forma assoluta `GET http://altro-host/x` portavano
 * la richiesta, con Cookie e Authorization, fuori dal backend — e butta via il percorso di
 * BACKEND_URL (`http://host/gateway/app` + `/users` dava `/users`).
 *
 * Qui dal request-target si prendono solo percorso e query; schema, host e porta sono quelli
 * di BACKEND_URL, e il suo percorso fa da prefisso, come `proxy_pass` di nginx con una URI.
 */

// Host fittizio per interpretare il solo percorso: non viene mai contattato.
const PATH_ONLY_BASE = "http://mockxy.invalid";

// Schema e autorità di un request-target in forma assoluta (RFC 9112 §3.2.2).
const ABSOLUTE_FORM_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

// Riduce il request-target a percorso + query: scarta schema e autorità di una forma assoluta
// e garantisce lo slash iniziale. Un doppio slash iniziale resta percorso.
function toOriginForm(requestTarget) {
  const raw = String(requestTarget ?? "");
  const absolute = ABSOLUTE_FORM_PREFIX.exec(raw);
  const rest = absolute ? raw.slice(absolute[0].length) : raw;
  return rest.startsWith("/") ? rest : `/${rest}`;
}

// Percorso di BACKEND_URL senza slash finale: "" quando il backend è alla radice.
function backendPathPrefix(backendUrl) {
  try {
    return new URL(backendUrl).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

// URL upstream di una richiesta. I segmenti `..` si risolvono dentro il percorso richiesto,
// prima di aggiungere il prefisso: una richiesta non può risalire sopra il percorso di
// BACKEND_URL.
function resolveBackendTarget(requestTarget, backendUrl) {
  const backend = new URL(backendUrl);
  const requested = new URL(`${PATH_ONLY_BASE}${toOriginForm(requestTarget)}`);
  const prefix = backend.pathname.replace(/\/+$/, "");
  return new URL(`${backend.origin}${prefix}${requested.pathname}${requested.search}`);
}

// Riporta un percorso del backend a quello che il client deve chiedere a Mockxy, togliendo il
// prefisso. null quando il percorso sta fuori dal prefisso: attraverso Mockxy non è raggiungibile.
function stripBackendPathPrefix(pathname, prefix) {
  if (prefix === "") {
    return pathname;
  }
  if (pathname === prefix) {
    return "/";
  }
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : null;
}

module.exports = {
  backendPathPrefix,
  resolveBackendTarget,
  stripBackendPathPrefix,
  toOriginForm,
};
