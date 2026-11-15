const tls = require("tls");

/**
 * Di chi si fida il proxy quando il backend è in https.
 *
 * Node, da solo, si fida delle CA che porta con sé (più NODE_EXTRA_CA_CERTS): un backend con il
 * certificato di una CA aziendale, che il browser accetta perché la CA è nell'archivio del
 * sistema operativo, attraverso Mockxy dava 502. Qui alle CA di Node si aggiungono quelle del
 * sistema, così il proxy accetta ciò che accetta il browser sulla stessa macchina.
 *
 * Per i certificati che nessun archivio conosce (autofirmati, tipici di un backend locale) la
 * verifica si spegne con config.verifyBackendCertificate = false: una scelta esplicita, per
 * backend di cui ci si fida per altra via.
 */

// Codici con cui Node rifiuta il certificato del server (verifica della catena, validità, nome).
const CERTIFICATE_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function isCertificateError(error) {
  return CERTIFICATE_ERROR_CODES.has(error?.code);
}

// CA di Node (incluse quelle di NODE_EXTRA_CA_CERTS) più quelle dell'archivio di sistema, senza
// doppioni. undefined quando il runtime non le sa elencare o la lettura fallisce: si resta sul
// comportamento predefinito di Node.
function readBackendCertificateAuthorities(source = tls) {
  if (typeof source.getCACertificates !== "function") {
    return undefined;
  }
  try {
    return [...new Set([...source.getCACertificates("default"), ...source.getCACertificates("system")])];
  } catch {
    return undefined;
  }
}

// Un solo contesto per processo: l'archivio di sistema si legge una volta, e interpretare
// centinaia di certificati a ogni connessione sarebbe lavoro sprecato. null = non disponibile.
let sharedSecureContext;

function backendSecureContext() {
  if (sharedSecureContext === undefined) {
    const certificateAuthorities = readBackendCertificateAuthorities();
    try {
      sharedSecureContext = certificateAuthorities
        ? tls.createSecureContext({ ca: certificateAuthorities })
        : null;
    } catch {
      sharedSecureContext = null;
    }
  }
  return sharedSecureContext;
}

// Opzioni TLS da aggiungere alla richiesta verso il backend. Niente per un backend http.
function backendTlsOptions(config, targetUrl) {
  if (targetUrl.protocol !== "https:") {
    return {};
  }
  if (config.verifyBackendCertificate === false) {
    return { rejectUnauthorized: false };
  }
  const secureContext = backendSecureContext();
  return secureContext ? { secureContext } : {};
}

// Corpo del 502 quando il backend c'è ma il suo certificato non passa la verifica: senza, chi
// guarda la risposta vede un backend «irraggiungibile» e cerca il problema nella rete.
function certificateErrorPayload(error) {
  return {
    error: "Bad Gateway",
    message: [
      `The backend's TLS certificate could not be verified (${error.code}).`,
      "If it is issued by a private certificate authority, add that authority to the system trust store or to NODE_EXTRA_CA_CERTS.",
      "For a backend you trust anyway, such as a local one with a self-signed certificate, turn off «Verify the backend certificate» in the workspace settings (VERIFY_BACKEND_CERTIFICATE=false).",
    ].join(" "),
    details: { code: "BACKEND_CERTIFICATE_NOT_VERIFIED", reason: error.code },
  };
}

module.exports = {
  backendTlsOptions,
  certificateErrorPayload,
  isCertificateError,
  readBackendCertificateAuthorities,
};
