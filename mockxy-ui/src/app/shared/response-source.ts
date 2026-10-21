import {
  lucideArrowLeftRight,
  lucideBlend,
  lucideCircleDashed,
  lucideFileText,
  lucideListOrdered,
  lucidePlaneTakeoff,
  lucideRadioTower,
  lucideSearchX,
  lucideServer,
  lucideServerOff,
  lucideSquareFunction,
} from '@ng-icons/lucide';

/**
 * Provenienza di una risposta (Monitor, Storico) e tipo di un endpoint (catalogo): etichetta,
 * colore e icona. L'icona affianca il colore, cosi' il tipo si riconosce anche senza distinguere i
 * colori; stessa icona per lo stesso concetto in tutte le pagine.
 */
export interface ResponseSourceMeta {
  readonly label: string;
  readonly color: string;
  readonly icon: string;
}

/** Le icone usate qui, da passare a provideIcons nelle pagine che mostrano provenienze o tipi. */
export const RESPONSE_SOURCE_ICONS = {
  lucideArrowLeftRight,
  lucideBlend,
  lucideCircleDashed,
  lucideFileText,
  lucideListOrdered,
  lucidePlaneTakeoff,
  lucideRadioTower,
  lucideSearchX,
  lucideServer,
  lucideServerOff,
  lucideSquareFunction,
};

/** Icona della sequenza: per i passi SEQ del Monitor e per il tipo "sequence" del catalogo. */
export const SEQUENCE_ICON = 'lucideListOrdered';

/**
 * Provenienze servite da una response locale (un mock, un handler, uno stream SSE o WS):
 * le altre sono "non mockate", passate dal backend vero o rimaste senza risposta. Stessa
 * partizione del filtro "backend reale" che lo Storico applica sul server (monitor-dump-reader).
 */
const LOCAL_SOURCES: ReadonlySet<string> = new Set(['mock', 'handler', 'sse', 'ws']);

/** "Non mockata": non servita da una response locale. */
export function isUnmockedSource(source: string): boolean {
  return !LOCAL_SOURCES.has(source);
}

/** Provenienza di una voce del Monitor o dello Storico (il campo `source` della voce). */
export function responseSourceMeta(source: string): ResponseSourceMeta {
  switch (source) {
    case 'mock': return { label: 'Mock', color: 'var(--type-mock)', icon: 'lucideFileText' };
    case 'handler': return { label: 'Handler', color: 'var(--type-handler)', icon: 'lucideSquareFunction' };
    case 'middleware': return { label: 'Middleware', color: 'var(--type-middleware)', icon: 'lucideBlend' };
    case 'sse': return { label: 'SSE', color: 'var(--brand)', icon: 'lucideRadioTower' };
    case 'backend': return { label: 'Proxy', color: 'var(--brand-soft)', icon: 'lucideServer' };
    case 'mock-only':
    case 'mock-only-miss': return { label: 'Miss', color: 'var(--foreground-faint)', icon: 'lucideSearchX' };
    case 'backend-unconfigured': return { label: 'No backend', color: 'var(--foreground-faint)', icon: 'lucideServerOff' };
    case 'cors-preflight': return { label: 'CORS', color: 'var(--foreground-faint)', icon: 'lucidePlaneTakeoff' };
    case 'ws': return { label: 'WS', color: 'var(--brand)', icon: 'lucideArrowLeftRight' };
    case 'ws-upgrade-required': return { label: 'WS', color: 'var(--foreground-faint)', icon: 'lucideArrowLeftRight' };
    default: return { label: source, color: 'var(--muted-foreground)', icon: 'lucideCircleDashed' };
  }
}

/** Icona del tipo di un endpoint del catalogo (il colore lo da' il catalogo, che lo spegne se disattivo). */
export function endpointTypeIcon(type: string): string {
  switch (type) {
    case 'handler': return 'lucideSquareFunction';
    case 'middleware': return 'lucideBlend';
    case 'sequence': return SEQUENCE_ICON;
    case 'sse': return 'lucideRadioTower';
    case 'ws': return 'lucideArrowLeftRight';
    default: return 'lucideFileText';
  }
}
