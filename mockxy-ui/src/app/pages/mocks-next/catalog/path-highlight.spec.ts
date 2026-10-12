import { highlightParts } from './path-highlight';

describe('highlightParts', () => {
  it('senza termine torna il testo intero, non evidenziato', () => {
    expect(highlightParts('/api/orders', '')).toEqual([{ text: '/api/orders', match: false }]);
    expect(highlightParts('/api/orders', '   ')).toEqual([{ text: '/api/orders', match: false }]);
  });

  it('se il termine non compare torna il testo intero, non evidenziato', () => {
    expect(highlightParts('/api/orders', 'users')).toEqual([{ text: '/api/orders', match: false }]);
  });

  it('isola la corrispondenza fra ciò che la precede e ciò che la segue', () => {
    expect(highlightParts('/api/orders/{orderId}', 'orders')).toEqual([
      { text: '/api/', match: false },
      { text: 'orders', match: true },
      { text: '/{orderId}', match: false },
    ]);
  });

  it('evidenzia ogni occorrenza, anche in testa e in coda', () => {
    expect(highlightParts('api/x/api', 'api')).toEqual([
      { text: 'api', match: true },
      { text: '/x/', match: false },
      { text: 'api', match: true },
    ]);
  });

  // La ricerca del catalogo non distingue le maiuscole: l'evidenziazione nemmeno, ma mostra il
  // testo com'è scritto nel path.
  it('non distingue maiuscole e minuscole, e conserva quelle del testo', () => {
    expect(highlightParts('/api/orders/{orderId}', 'ORDERID')).toEqual([
      { text: '/api/orders/{', match: false },
      { text: 'orderId', match: true },
      { text: '}', match: false },
    ]);
  });

  it('ignora gli spazi attorno al termine, come la ricerca', () => {
    expect(highlightParts('/api/orders', ' orders ')).toEqual([
      { text: '/api/', match: false },
      { text: 'orders', match: true },
    ]);
  });
});
