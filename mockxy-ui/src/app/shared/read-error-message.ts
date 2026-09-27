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

/**
 * Risultato parziale di un batch fallito (`BATCH_RUNTIME_FAILED`, o `ROLLBACK_FAILED` di un
 * batch): gli elementi già scritti restano su disco anche se la risposta è un errore, e
 * `details.result` li descrive con la stessa forma della risposta 201.
 */
export function readBatchPartialResult<T>(error: unknown): T | undefined {
  if (!isObject(error) || !isObject(error['error']) || !isObject(error['error']['details'])) {
    return undefined;
  }
  const details = error['error']['details'];
  const batchFailure = details['code'] === 'BATCH_RUNTIME_FAILED' || details['code'] === 'ROLLBACK_FAILED';
  return batchFailure && isObject(details['result']) ? (details['result'] as T) : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}
