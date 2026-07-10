import { AbstractControl, ValidationErrors } from '@angular/forms';

const REGULAR_COLLECTION_SEGMENT_SOURCE = '[A-Za-z0-9._-]+';
const PARAM_COLLECTION_SEGMENT_SOURCE = '\\{[A-Za-z0-9_]+\\}';
const QUERY_COLLECTION_SEGMENT_SOURCE = '\\^[A-Za-z0-9._-]+(?:_[A-Za-z0-9._-]+)*';
const DYNAMIC_ROUTE_SEGMENT_PATTERN = /^:([A-Za-z0-9_]+)$/;
const REGULAR_COLLECTION_SEGMENT_PATTERN = new RegExp(`^${REGULAR_COLLECTION_SEGMENT_SOURCE}$`);
const PARAM_COLLECTION_SEGMENT_PATTERN = new RegExp(`^${PARAM_COLLECTION_SEGMENT_SOURCE}$`);
const QUERY_COLLECTION_SEGMENT_PATTERN = new RegExp(`^${QUERY_COLLECTION_SEGMENT_SOURCE}$`);
const RESERVED_ROUTE_PATH_CHAR = '^';

export const COLLECTION_PATH_INPUT_PATTERN = new RegExp(
  `^(?:${REGULAR_COLLECTION_SEGMENT_SOURCE}|${PARAM_COLLECTION_SEGMENT_SOURCE}|${QUERY_COLLECTION_SEGMENT_SOURCE})(?:[\\/](?:${REGULAR_COLLECTION_SEGMENT_SOURCE}|${PARAM_COLLECTION_SEGMENT_SOURCE}|${QUERY_COLLECTION_SEGMENT_SOURCE}))*$`
);

/** Normalizza un path collection utente unificando slash, spazi laterali e slash finali. */
export function normalizeCollectionPath(collectionPath: string): string {
  return collectionPath
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/+?/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

/** Valida il formato slash-separated dei path collection, inclusi segmenti {param} e ^query. */
export function isValidCollectionPath(collectionPath: string): boolean {
  if (collectionPath === '') {
    return false;
  }

  return COLLECTION_PATH_INPUT_PATTERN.test(collectionPath);
}

/** Deriva il segmento collection a partire da un segmento della route dichiarata. */
function deriveCollectionSegmentFromRouteSegment(routeSegment: string): string {
  const dynamicMatch = routeSegment.match(DYNAMIC_ROUTE_SEGMENT_PATTERN);
  if (dynamicMatch != null) {
    return `{${dynamicMatch[1]}}`;
  }

  const isSupportedStaticSegment = REGULAR_COLLECTION_SEGMENT_PATTERN.test(routeSegment)
    || PARAM_COLLECTION_SEGMENT_PATTERN.test(routeSegment);
  const isReservedRelativeSegment = routeSegment === '.' || routeSegment === '..';
  if (!isSupportedStaticSegment || isReservedRelativeSegment) {
    throw new Error('unsupported-route-segment');
  }

  return routeSegment;
}

/** Deriva il nome collection dedicato alla query string usando il prefisso riservato ^. */
function deriveQueryCollectionSegment(queryString: string): string {
  const queryCollectionSegment = `^${queryString.replaceAll('&', '_').replaceAll('=', '-')}`;
  if (!QUERY_COLLECTION_SEGMENT_PATTERN.test(queryCollectionSegment)) {
    throw new Error('unsupported-query-collection');
  }

  return queryCollectionSegment;
}

/** Converte una route API nel path collection usato per salvare mock, handler e middleware. */
export function deriveCollectionPathFromRoutePath(routePath: string): string {
  if (routePath.includes(RESERVED_ROUTE_PATH_CHAR)) {
    throw new Error('reserved-route-character');
  }

  const queryStartIndex = routePath.indexOf('?');
  let pathPortion = routePath;
  let queryString = '';

  if (queryStartIndex !== -1) {
    pathPortion = routePath.slice(0, queryStartIndex);
    queryString = routePath.slice(queryStartIndex + 1);
  }

  const collectionSegments = pathPortion
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => deriveCollectionSegmentFromRouteSegment(segment));

  if (queryString !== '') {
    collectionSegments.push(deriveQueryCollectionSegment(queryString));
  }

  return collectionSegments.join('/');
}

/** Restituisce l'etichetta da mostrare nel form per la collection derivata dalla path corrente. */
export function readDerivedCollectionPathLabel(routePath: string): string | undefined {
  if (routePath === '' || !routePath.startsWith('/')) {
    return undefined;
  }

  try {
    const derivedCollectionPath = deriveCollectionPathFromRoutePath(routePath);
    if (derivedCollectionPath !== '') {
      return derivedCollectionPath;
    }

    return 'root del catalogo';
  } catch (_error) {
    return undefined;
  }
}

/**
 * Variante non-form di {@link routePathValidator}: restituisce un messaggio d'errore
 * leggibile (o null se valido). Per uso con signal/template (es. dialog "Nuovo").
 * Path vuoto → null (il "required" si gestisce a parte).
 */
export function routePathError(routePath: string): string | null {
  if (routePath.trim() === '') {
    return null;
  }
  if (!routePath.startsWith('/')) {
    return 'pathError.leadingSlash';
  }
  if (routePath.includes(RESERVED_ROUTE_PATH_CHAR)) {
    return 'pathError.reservedChar';
  }
  try {
    deriveCollectionPathFromRoutePath(routePath);
    return null;
  } catch (_error) {
    return 'pathError.convention';
  }
}

/** Valida la path dichiarata nel form garantendo compatibilita con la convenzione collection. */
export function routePathValidator(control: AbstractControl): ValidationErrors | null {
  const routePath = typeof control.value === 'string' ? control.value : '';
  if (routePath === '') {
    return null;
  }

  if (!routePath.startsWith('/')) {
    return { pathFormat: true };
  }

  if (routePath.includes(RESERVED_ROUTE_PATH_CHAR)) {
    return { reservedCharacter: true };
  }

  try {
    deriveCollectionPathFromRoutePath(routePath);
    return null;
  } catch (_error) {
    return { unsupportedCollectionConvention: true };
  }
}
