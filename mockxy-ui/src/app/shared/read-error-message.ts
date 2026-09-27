/**
 * Estrae il messaggio del server da un errore HTTP/runtime, o `undefined` se assente
 * (il chiamante fornisce il fallback tradotto, es. translate('common.operationFailed')).
 */
export function readErrorMessage(error: unknown): string | undefined {
  if (isObject(error) && isObject(error['error']) && typeof error['error']['message'] === 'string') {
    return error['error']['message'];
  }
  if (isObject(error) && typeof error['message'] === 'string') {
    return error['message'];
  }
  return undefined;
}

/**
 * Lettura incompleta del dettaglio (409 `READ_INCONSISTENT`): l'endpoint stava cambiando mentre il
 * server lo leggeva, oppure un file che referenzia manca. Si ripete la lettura al massimo una volta.
 */
export function isReadInconsistentError(error: unknown): boolean {
  return (
    isObject(error) &&
    isObject(error['error']) &&
    isObject(error['error']['details']) &&
    error['error']['details']['code'] === 'READ_INCONSISTENT'
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}
