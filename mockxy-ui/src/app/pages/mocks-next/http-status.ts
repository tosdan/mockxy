/** Descrizioni testuali dei codici HTTP + helper per le etichette (codice + descrizione). */
export const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 206: 'Partial Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  409: 'Conflict', 410: 'Gone', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

/** Etichetta "codice descrizione" (es. "200 OK"); senza descrizione mostra solo il codice. */
export function statusLabel(code: number): string {
  return `${code} ${STATUS_TEXT[code] ?? ''}`.trim();
}

/** Classe colore del testo per fascia di status (sui token --status-*). */
export function statusTextClass(status: number | null | undefined): string {
  if (status == null) return 'text-muted-foreground';
  if (status >= 500) return 'text-status-5xx';
  if (status >= 400) return 'text-status-4xx';
  if (status >= 300) return 'text-status-3xx';
  if (status >= 200) return 'text-status-2xx';
  return 'text-muted-foreground';
}
