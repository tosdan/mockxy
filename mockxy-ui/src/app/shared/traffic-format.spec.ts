import { bodyLanguage, headerCount, headerRows, methodColor, statusColor, statusText, tint } from './traffic-format';

describe('traffic-format', () => {
  it('bodyLanguage riconosce JSON strutturato valido, altrimenti testo', () => {
    expect(bodyLanguage('{"a":1}')).toBe('json');
    expect(bodyLanguage('  [1,2] ')).toBe('json');
    expect(bodyLanguage('{rotto')).toBe('text');
    expect(bodyLanguage('ciao')).toBe('text');
    expect(bodyLanguage(undefined)).toBe('text');
  });

  it('headerRows ordina per nome e appiattisce gli array; headerCount li conta', () => {
    expect(headerRows({ zeta: 'z', alfa: ['a', 'b'] })).toEqual([
      ['alfa', 'a, b'],
      ['zeta', 'z'],
    ]);
    expect(headerRows(undefined)).toEqual([]);
    expect(headerCount({ a: '1', b: '2' })).toBe(2);
    expect(headerCount(undefined)).toBe(0);
  });

  it('colori sui token, testo dello status e tinte', () => {
    expect(methodColor('POST')).toBe('var(--method-post)');
    expect(statusColor(404)).toBe('var(--status-4xx)');
    expect(statusColor(101)).toBe('var(--muted-foreground)');
    expect(statusText(502)).toBe('Bad Gateway');
    expect(statusText(418)).toBe('');
    expect(tint('var(--brand)', 16)).toBe('color-mix(in srgb, var(--brand) 16%, transparent)');
  });
});
