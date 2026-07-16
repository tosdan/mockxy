import { resolveDesktopBindAddress, resolveServerAddress } from './runtime-bar';

// L'indirizzo nella barra runtime deve essere quello VERO quando la pagina è servita dal
// motore (desktop o UI compilata sotto /_admin/ui/): il default cablato localhost:3000 vale
// solo per ng serve, dove la pagina gira sulla porta del dev server (collaudo 9 lug 2026,
// BACKLOG-PRODOTTO punto 1).
describe('resolveServerAddress', () => {
  it('UI servita dal motore nel browser: mostra host e porta della pagina', () => {
    expect(
      resolveServerAddress({
        isDesktop: false,
        baseUri: 'http://localhost:3344/_admin/ui/',
        host: 'localhost:3344',
      })
    ).toBe('localhost:3344');
  });

  it("accesso da LAN: l'hostname non-localhost resta visibile", () => {
    expect(
      resolveServerAddress({
        isDesktop: false,
        baseUri: 'http://192.168.1.20:3000/_admin/ui/',
        host: '192.168.1.20:3000',
      })
    ).toBe('192.168.1.20:3000');
  });

  it('app desktop: usa la porta reale del workspace attivo (valore iniziale, poi vale il bind)', () => {
    expect(
      resolveServerAddress({
        isDesktop: true,
        baseUri: 'http://localhost:52814/_admin/ui/',
        host: 'localhost:52814',
      })
    ).toBe('localhost:52814');
  });

  it('sviluppo con ng serve: resta il default del motore, non la porta del dev server', () => {
    expect(
      resolveServerAddress({
        isDesktop: false,
        baseUri: 'http://localhost:4207/',
        host: 'localhost:4207',
      })
    ).toBe('localhost:3000');
  });

  it('host assente (contesti senza window): ripiega sul default', () => {
    expect(resolveServerAddress({ isDesktop: true, baseUri: '', host: '' })).toBe('localhost:3000');
  });
});

// Nel desktop la finestra carica SEMPRE dal loopback: l'etichetta deve mostrare l'interfaccia
// di bind scelta nei settings del workspace (127.0.0.1 vs 0.0.0.0), non l'URL della pagina.
describe('resolveDesktopBindAddress', () => {
  it('bind su tutta la rete: mostra 0.0.0.0 con la porta del workspace', () => {
    expect(resolveDesktopBindAddress({ host: '0.0.0.0', port: 3000 }, 'localhost:52814')).toBe('0.0.0.0:3000');
  });

  it('bind loopback: mostra 127.0.0.1 con la porta del workspace', () => {
    expect(resolveDesktopBindAddress({ host: '127.0.0.1', port: 3000 }, 'localhost:52814')).toBe('127.0.0.1:3000');
  });

  it('porta assente nelle info: ripiega sulla porta della pagina', () => {
    expect(resolveDesktopBindAddress({ host: '0.0.0.0' }, 'localhost:52814')).toBe('0.0.0.0:52814');
  });

  it('porta assente ovunque: mostra il solo host di bind', () => {
    expect(resolveDesktopBindAddress({ host: '0.0.0.0' }, 'localhost')).toBe('0.0.0.0');
  });

  it('info assenti (bridge in errore) o senza host: null, l\'etichetta non cambia', () => {
    expect(resolveDesktopBindAddress(null, 'localhost:52814')).toBeNull();
    expect(resolveDesktopBindAddress({ host: '' }, 'localhost:52814')).toBeNull();
  });
});
