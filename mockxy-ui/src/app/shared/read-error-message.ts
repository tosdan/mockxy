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

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}
