import {
  CONTENT_TYPES,
  HEADER_BUNDLES,
  JSON_CONTENT_TYPE,
  RESPONSE_PRESETS,
  contentTypeLabel,
  isDefaultBody,
  mergeHeaders,
  upsertContentType,
} from './response-presets';

describe('response-presets data', () => {
  it('ogni bundle header ha id, label, icona lucide e almeno un header', () => {
    for (const bundle of HEADER_BUNDLES) {
      expect(bundle.id).toBeTruthy();
      expect(bundle.label).toBeTruthy();
      expect(bundle.icon).toMatch(/^lucide/);
      expect(bundle.headers.length).toBeGreaterThan(0);
    }
  });

  it('ogni preset response ha status valido (100–599) e body JSON-serializzabile', () => {
    for (const preset of RESPONSE_PRESETS) {
      expect(preset.status).toBeGreaterThanOrEqual(100);
      expect(preset.status).toBeLessThanOrEqual(599);
      expect(() => JSON.stringify(preset.body)).not.toThrow();
    }
  });

  it('gli id di bundle e preset sono globalmente unici', () => {
    const ids = [...HEADER_BUNDLES, ...RESPONSE_PRESETS].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mergeHeaders', () => {
  it('aggiunge in coda gli header non presenti', () => {
    const out = mergeHeaders(
      [{ key: 'content-type', value: 'application/json' }],
      [
        { key: 'X-A', value: '1' },
        { key: 'X-B', value: '2' },
      ],
    );
    expect(out.map((header) => header.key)).toEqual(['content-type', 'X-A', 'X-B']);
  });

  it('non sovrascrive un header già presente (match case-insensitive)', () => {
    const out = mergeHeaders(
      [{ key: 'Access-Control-Allow-Origin', value: 'https://app.local' }],
      [{ key: 'access-control-allow-origin', value: '*' }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('https://app.local');
  });

  it('mantiene le righe a chiave vuota senza considerarle duplicati', () => {
    const out = mergeHeaders([{ key: '', value: '' }], [{ key: 'X-A', value: '1' }]);
    expect(out).toHaveLength(2);
  });
});

describe('upsertContentType', () => {
  it('aggiunge content-type quando assente', () => {
    expect(upsertContentType([], 'text/plain; charset=utf-8')).toEqual([
      { key: 'content-type', value: 'text/plain; charset=utf-8' },
    ]);
  });

  it('aggiorna il content-type esistente senza duplicarlo (match case-insensitive)', () => {
    const out = upsertContentType(
      [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'X-A', value: '1' },
      ],
      'text/html; charset=utf-8',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ key: 'Content-Type', value: 'text/html; charset=utf-8' });
  });
});

describe('isDefaultBody', () => {
  it('considera default body vuoto, {} e []', () => {
    expect(isDefaultBody('')).toBe(true);
    expect(isDefaultBody('   ')).toBe(true);
    expect(isDefaultBody('{}')).toBe(true);
    expect(isDefaultBody('{\n  \n}')).toBe(true);
    expect(isDefaultBody('[]')).toBe(true);
  });

  it('considera contenuto un body con dati o un JSON non valido', () => {
    expect(isDefaultBody('{ "id": 1 }')).toBe(false);
    expect(isDefaultBody('[1]')).toBe(false);
    expect(isDefaultBody('{ "a":')).toBe(false);
  });
});

describe('contentTypeLabel', () => {
  it('rimuove i parametri dal media type', () => {
    expect(contentTypeLabel(JSON_CONTENT_TYPE)).toBe('application/json');
    expect(contentTypeLabel('application/octet-stream')).toBe('application/octet-stream');
  });

  it('CONTENT_TYPES espone application/json come primo', () => {
    expect(contentTypeLabel(CONTENT_TYPES[0])).toBe('application/json');
  });
});
