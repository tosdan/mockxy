/**
 * Dati e helper (logica pura, niente Angular) per i "preset comuni" dell'editor di response:
 * bundle di header preconfezionati, preset di response (status + body) e content-type comuni.
 * Usato da MocksNextDetail per seminare i signal di bozza (draftHeaders/draftStatus/draftBody).
 */

/** Riga header (nome/valore), come usata nelle bozze response del dettaglio. */
export interface PresetHeader {
  readonly key: string;
  readonly value: string;
}

/** Bundle di header preconfezionati (CORS, security, …) inseribili in blocco nella bozza response. */
export interface HeaderBundle {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Nome icona lucide (registrato in MocksNextDetail via provideIcons). */
  readonly icon: string;
  readonly headers: readonly PresetHeader[];
}

/** Preset di response (status + body JSON, eventuali header) per i casi comuni (errori, paginazione). */
export interface ResponsePreset {
  readonly id: string;
  readonly label: string;
  readonly status: number;
  readonly body: unknown;
  readonly headers?: readonly PresetHeader[];
}

/** Content-type JSON canonico usato dall'editor (coerente con setBodyFormat del dettaglio). */
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export const HEADER_BUNDLES: readonly HeaderBundle[] = [
  {
    id: 'cors-dev',
    label: 'presets.corsDev',
    description: 'origin * + methods + headers',
    icon: 'lucideGlobe',
    headers: [
      { key: 'Access-Control-Allow-Origin', value: '*' },
      { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
    ],
  },
  {
    id: 'cors-preflight',
    label: 'presets.corsPreflight',
    description: 'allow-methods/headers/max-age',
    icon: 'lucideRepeat',
    headers: [
      { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
      { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
      { key: 'Access-Control-Max-Age', value: '86400' },
    ],
  },
  {
    id: 'no-cache',
    label: 'presets.noCache',
    description: 'cache-control: no-store',
    icon: 'lucideBan',
    headers: [{ key: 'Cache-Control', value: 'no-store' }],
  },
  {
    id: 'security',
    label: 'presets.security',
    description: 'CSP · HSTS · nosniff',
    icon: 'lucideShield',
    headers: [
      { key: 'Content-Security-Policy', value: "default-src 'self'" },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ],
  },
  {
    id: 'auth-bearer',
    label: 'presets.authBearer',
    description: 'www-authenticate',
    icon: 'lucideKey',
    headers: [{ key: 'WWW-Authenticate', value: 'Bearer' }],
  },
];

/** Body d'errore minimale e uniforme per i preset 4xx/5xx. */
function errorBody(error: string, status: number): Record<string, unknown> {
  return { error, status };
}

export const RESPONSE_PRESETS: readonly ResponsePreset[] = [
  { id: 'r400', label: 'presets.r400', status: 400, body: errorBody('Bad Request', 400) },
  { id: 'r401', label: 'presets.r401', status: 401, body: errorBody('Unauthorized', 401) },
  { id: 'r403', label: 'presets.r403', status: 403, body: errorBody('Forbidden', 403) },
  { id: 'r404', label: 'presets.r404', status: 404, body: errorBody('Not Found', 404) },
  { id: 'r409', label: 'presets.r409', status: 409, body: errorBody('Conflict', 409) },
  { id: 'r422', label: 'presets.r422', status: 422, body: errorBody('Unprocessable Entity', 422) },
  { id: 'r429', label: 'presets.r429', status: 429, body: errorBody('Too Many Requests', 429) },
  { id: 'r500', label: 'presets.r500', status: 500, body: errorBody('Internal Server Error', 500) },
  { id: 'r503', label: 'presets.r503', status: 503, body: errorBody('Service Unavailable', 503) },
  {
    id: 'pagination',
    label: 'presets.pagination',
    status: 200,
    body: { items: [], page: 1, pageSize: 20, total: 0 },
    headers: [{ key: 'X-Total-Count', value: '0' }],
  },
];

/** Content-type comuni; il valore include charset dove sensato, l'etichetta è il solo media type. */
export const CONTENT_TYPES: readonly string[] = [
  JSON_CONTENT_TYPE,
  'text/plain; charset=utf-8',
  'text/html; charset=utf-8',
  'application/xml',
  'text/csv; charset=utf-8',
  'application/octet-stream',
];

/** Media type senza parametri (es. "application/json" da "application/json; charset=utf-8"). */
export function contentTypeLabel(value: string): string {
  return value.split(';')[0].trim();
}

/**
 * Unisce gli header di un bundle a quelli esistenti SENZA sovrascrivere: aggiunge solo i nomi non già
 * presenti (confronto case-insensitive). Le righe a chiave vuota restano e non bloccano l'inserimento.
 */
export function mergeHeaders(
  existing: readonly PresetHeader[],
  incoming: readonly PresetHeader[],
): PresetHeader[] {
  const out: PresetHeader[] = existing.map((row) => ({ ...row }));
  const seen = new Set(out.map((row) => row.key.trim().toLowerCase()).filter((key) => key !== ''));
  for (const row of incoming) {
    const key = row.key.trim().toLowerCase();
    if (key !== '' && seen.has(key)) continue;
    out.push({ ...row });
    if (key !== '') seen.add(key);
  }
  return out;
}

/** Imposta (o aggiorna) l'header content-type al valore dato, con match case-insensitive sul nome. */
export function upsertContentType(
  existing: readonly PresetHeader[],
  contentType: string,
): PresetHeader[] {
  const out: PresetHeader[] = existing.map((row) => ({ ...row }));
  const idx = out.findIndex((row) => row.key.trim().toLowerCase() === 'content-type');
  if (idx >= 0) out[idx] = { ...out[idx], value: contentType };
  else out.push({ key: 'content-type', value: contentType });
  return out;
}

/**
 * Vero se il body è "vuoto/di default" (stringa vuota, oggetto `{}` o array `[]`): in tal caso un preset
 * può sostituirlo senza chiedere conferma. Un JSON non valido è considerato contenuto dell'utente.
 */
export function isDefaultBody(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === '') return true;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
  return false;
}
