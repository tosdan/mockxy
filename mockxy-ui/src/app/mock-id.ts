const ENDPOINT_SUFFIX = '.endpoint.json';

/**
 * Percorso della definizione **relativo alla cartella dei mock**, ricavato dall'id admin.
 *
 * L'id di una definizione è il suo percorso relativo posix codificato in base64url
 * (`src/admin/mock-ids.js`): decodificarlo qui evita di mostrare il percorso assoluto, che è lungo,
 * ripete il root del workspace su ogni endpoint e cambia da macchina a macchina. Nessun campo API
 * in più e nessuna dipendenza da Electron, quindi funziona anche nella UI servita dal motore.
 *
 * Restituisce `null` se l'id non decodifica in quello che ci si aspetta: meglio ripiegare sul
 * percorso assoluto che mostrare una stringa inventata, se un giorno la convenzione cambiasse.
 */
export function mockIdToWorkspacePath(id: string | null | undefined): string | null {
  if (!id) {
    return null;
  }

  try {
    const base64 = id.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const looksLikeADefinition =
      decoded.endsWith(ENDPOINT_SUFFIX) && !decoded.startsWith('/') && !decoded.includes('\\');
    return looksLikeADefinition ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Accorcia un percorso togliendo segmenti dal centro, non dalla coda: il nome del file e la
 * cartella che lo contiene sono le parti che identificano l'endpoint, mentre il tronco iniziale
 * si indovina. `api/…/{id}/GET.endpoint.json` dice più di `api/v2/commerce/products/cate…`.
 */
export function shortenWorkspacePath(value: string, maxLength = 72): string {
  if (value.length <= maxLength) {
    return value;
  }

  const segments = value.split('/');
  if (segments.length <= 2) {
    return value;
  }

  const first = segments[0];
  // Si parte dal solo nome del file e si riaggiungono cartelle finali finché ci stanno.
  let tail = [segments[segments.length - 1]];
  for (let index = segments.length - 2; index > 0; index -= 1) {
    const candidate = [segments[index], ...tail];
    if (`${first}/…/${candidate.join('/')}`.length > maxLength) {
      break;
    }
    tail = candidate;
  }

  return `${first}/…/${tail.join('/')}`;
}
