import { RESPONSE_SOURCE_ICONS, SEQUENCE_ICON, endpointTypeIcon, isUnmockedSource, responseSourceMeta } from './response-source';

describe('response-source', () => {
  it('ogni provenienza nota ha etichetta, colore e un\'icona registrata', () => {
    const sources = ['mock', 'handler', 'middleware', 'sse', 'ws', 'backend', 'mock-only', 'mock-only-miss', 'backend-unconfigured', 'cors-preflight', 'ws-upgrade-required'];
    for (const source of sources) {
      const meta = responseSourceMeta(source);
      // Nessuna provenienza nota cade nel caso di riserva, col nome grezzo e l'icona neutra.
      expect(meta.icon).not.toBe('lucideCircleDashed');
      expect(meta.label).not.toBe(source);
      expect(meta.color).toMatch(/^var\(--/);
      expect(Object.keys(RESPONSE_SOURCE_ICONS)).toContain(meta.icon);
    }
    expect(responseSourceMeta('backend')).toEqual({ label: 'Proxy', color: 'var(--brand-soft)', icon: 'lucideServer' });
    expect(responseSourceMeta('mock-only-miss').icon).toBe('lucideSearchX');
  });

  it('una provenienza sconosciuta resta col suo nome e un\'icona neutra', () => {
    expect(responseSourceMeta('nuova')).toEqual({ label: 'nuova', color: 'var(--muted-foreground)', icon: 'lucideCircleDashed' });
  });

  it('il tipo di un endpoint usa la stessa icona della provenienza, e la sequenza la sua', () => {
    expect(endpointTypeIcon('mock')).toBe(responseSourceMeta('mock').icon);
    expect(endpointTypeIcon('handler')).toBe(responseSourceMeta('handler').icon);
    expect(endpointTypeIcon('middleware')).toBe(responseSourceMeta('middleware').icon);
    expect(endpointTypeIcon('sse')).toBe(responseSourceMeta('sse').icon);
    expect(endpointTypeIcon('ws')).toBe(responseSourceMeta('ws').icon);
    expect(endpointTypeIcon('sequence')).toBe(SEQUENCE_ICON);
    for (const type of ['mock', 'handler', 'middleware', 'sse', 'ws', 'sequence']) {
      expect(Object.keys(RESPONSE_SOURCE_ICONS)).toContain(endpointTypeIcon(type));
    }
  });

  // Stessa partizione del filtro "backend reale" dello Storico, sul server.
  it('mock, handler, SSE e WebSocket sono locali; il resto e\' non mockato', () => {
    for (const source of ['mock', 'handler', 'sse', 'ws']) expect(isUnmockedSource(source)).toBe(false);
    for (const source of ['backend', 'middleware', 'mock-only-miss', 'backend-unconfigured']) expect(isUnmockedSource(source)).toBe(true);
  });
});
