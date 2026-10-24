/**
 * Formati comuni alle viste del traffico (Monitor e Storico): colori sui token, testo dello status,
 * header in tabella e linguaggio del body. Funzioni pure, cosi' lista e dettaglio dicono lo stesso.
 */

/** Colore del metodo HTTP, dal token --method-*. */
export function methodColor(method: string): string {
  return `var(--method-${method.toLowerCase()})`;
}

/** Colore di una classe di status (2xx-5xx); fallback neutro fuori range. */
export function statusClassColor(klass: number): string {
  return klass >= 2 && klass <= 5 ? `var(--status-${klass}xx)` : 'var(--muted-foreground)';
}

export function statusColor(status: number): string {
  return statusClassColor(Math.floor(status / 100));
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  422: 'Unprocessable', 429: 'Too Many', 500: 'Server Error', 502: 'Bad Gateway', 503: 'Unavailable',
};

/** Frase breve dello status, accanto al numero; vuota per i codici meno comuni. */
export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? '';
}

/** Tinta trasparente di un colore (per fondi e bordi tenui), via color-mix. */
export function tint(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

export type Headers = Record<string, string | string[]> | undefined;

/** Numero di header (per il badge della sezione). */
export function headerCount(headers: Headers): number {
  return headers ? Object.keys(headers).length : 0;
}

/** Header ordinati per nome come coppie [nome, valore]; i valori multipli separati da virgola. */
export function headerRows(headers: Headers): [string, string][] {
  return Object.entries(headers ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]): [string, string] => [name, Array.isArray(value) ? value.join(', ') : String(value)]);
}

/** Evidenziazione del body: JSON se e' un oggetto o un array valido, altrimenti testo semplice. */
export function bodyLanguage(text: string | undefined): 'json' | 'text' {
  const trimmed = (text ?? '').trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return 'text';
  try {
    JSON.parse(trimmed);
    return 'json';
  } catch {
    return 'text';
  }
}
