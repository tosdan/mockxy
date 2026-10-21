import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { StoricoDumpPage } from './storico-dump.page';
import { translocoTesting } from '../../testing/transloco-testing';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import type { DumpEntry, DumpReadCursor, DumpReadPage } from '../../mock-admin-api.types';

function entry(dumpKey: string, over: Partial<DumpEntry> = {}): DumpEntry {
  return {
    dumpKey,
    id: dumpKey,
    timestamp: '2026-07-05T10:00:00.000Z',
    method: 'GET',
    path: `/${dumpKey}`,
    originalUrl: `/${dumpKey}`,
    status: 200,
    source: 'backend',
    latencyMs: 5,
    requestHeaders: {},
    requestBodyBytes: 0,
    requestBodyTruncated: false,
    ...over,
  };
}

function page(items: DumpEntry[], nextCursor: DumpReadCursor | null, done: boolean): DumpReadPage {
  return { items, nextCursor, done };
}

const FILE1 = { name: 'dump-2026-01-01T00-00-00-000Z.ndjson', size: 2048, mtime: 1 };
/** I filtri di una lettura senza filtri accesi. */
const NO_FILTERS = { statusClasses: [] };

describe('StoricoDumpPage', () => {
  let api: ReturnType<typeof makeApiStub>;
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };

  function makeApiStub() {
    // due pagine: la prima con cursore, la seconda finale
    const page1 = page([entry('f#0'), entry('f#1')], { fileIndex: 0, lineIndex: 2 }, false);
    const page2 = page([entry('f#2')], null, true);
    return {
      listMonitorDumps: vi.fn(() => of({ files: [FILE1] })),
      readMonitorDumps: vi.fn((cursor: DumpReadCursor | null) => of(cursor == null ? page1 : page2)),
      createMocksFromDump: vi.fn(() => of({ created: 1, createdEmpty: 0, skippedExisting: 0, failed: 0 })),
      deleteMonitorDump: vi.fn(() => of(undefined)),
    };
  }

  beforeEach(async () => {
    api = makeApiStub();
    toast = { show: vi.fn(), dismiss: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [StoricoDumpPage, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MockAdminApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(StoricoDumpPage);
    fixture.detectChanges(); // ngOnInit → loadFiles + prima pagina
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, c: fixture.componentInstance as any };
  }

  describe('paginazione a cursore', () => {
    it('all’avvio carica file e prima pagina, mettendo a fuoco la prima entry', () => {
      const { c } = create();
      expect(api.readMonitorDumps).toHaveBeenCalledWith(null, 300, NO_FILTERS);
      expect(c.entries().map((e: DumpEntry) => e.dumpKey)).toEqual(['f#0', 'f#1']);
      expect(c.files()).toEqual([FILE1]);
      expect(c.focusedKey()).toBe('f#0');
      expect(c.done()).toBe(false);
    });

    it('loadMore rimanda il cursore ricevuto e ACCUMULA le pagine; a done non chiama più', () => {
      const { c } = create();
      c.loadMore();
      expect(api.readMonitorDumps).toHaveBeenLastCalledWith({ fileIndex: 0, lineIndex: 2 }, 300, NO_FILTERS);
      expect(c.entries().map((e: DumpEntry) => e.dumpKey)).toEqual(['f#0', 'f#1', 'f#2']);
      expect(c.done()).toBe(true);

      c.loadMore(); // esaurito: nessuna nuova chiamata
      expect(api.readMonitorDumps).toHaveBeenCalledTimes(2);
    });

    it('il fuoco non viene rubato dalle pagine successive', () => {
      const { c } = create();
      c.focusedKey.set('f#1');
      c.loadMore();
      expect(c.focusedKey()).toBe('f#1');
      expect(c.focused()?.dumpKey).toBe('f#1');
    });

    it('un errore di lettura mostra un toast d’errore col messaggio del server', () => {
      api.readMonitorDumps.mockReturnValueOnce(throwError(() => ({ error: { message: 'dump illeggibile' } })));
      create();
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', description: 'dump illeggibile' }));
    });
  });

  // Il dettaglio non mostra piu' la chiave tecnica del dump. Le righe stanno in uno scroll
  // virtuale, che qui non disegna nulla (niente layout): le verificano gli e2e dello Storico.
  describe('dettaglio', () => {
    const text = (fixture: ReturnType<typeof create>['fixture']) =>
      ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

    it('il dettaglio dice provenienza, latenza e quando; la chiave del dump resta nel tooltip', () => {
      const { fixture } = create();
      const header = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[title="f#0"]'))
        .find((el) => el.tagName === 'SPAN' && !el.hasAttribute('dir'))!;
      expect((header.textContent ?? '').replace(/\s+/g, ' ')).toMatch(/Proxy · 5 ms · 05\/07\/2026 \d\d:\d\d:\d\d\.000/);
      expect(text(fixture)).not.toContain('f#0 ');
    });
  });

  // I filtri sono quelli del Monitor; li applica il server mentre legge, su tutto l'archivio.
  describe('filtri', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function settle(fixture: ReturnType<typeof create>['fixture']) {
      fixture.detectChanges();
      vi.runOnlyPendingTimers();
      fixture.detectChanges();
    }

    it('metodo, classi di status e provenienza rileggono l’archivio dall’inizio con i filtri', () => {
      const { fixture, c } = create();
      c.loadMore(); // tre voci caricate
      api.readMonitorDumps.mockClear();

      c.methodFilter.set('POST');
      c.toggleStatusClass(5);
      c.toggleStatusClass(4);
      c.sourceFilter.set('real-backend');
      settle(fixture);

      expect(api.readMonitorDumps).toHaveBeenLastCalledWith(null, 300, { method: 'POST', source: 'real-backend', statusClasses: [4, 5] });
      expect(c.cursor()).toEqual({ fileIndex: 0, lineIndex: 2 }); // ripartita dalla prima pagina
    });

    it('la ricerca rilegge solo dopo una pausa di battitura', () => {
      const { fixture, c } = create();
      api.readMonitorDumps.mockClear();

      c.search.set('or');
      fixture.detectChanges();
      c.search.set('ord');
      fixture.detectChanges();
      expect(api.readMonitorDumps).not.toHaveBeenCalled();

      vi.advanceTimersByTime(250);
      fixture.detectChanges();
      expect(api.readMonitorDumps).toHaveBeenCalledTimes(1);
      expect(api.readMonitorDumps).toHaveBeenLastCalledWith(null, 300, { q: 'ord', statusClasses: [] });
    });

    it('a filtro acceso continua a leggere finché la lista non si riempie o l’archivio non finisce', async () => {
      const { fixture, c } = create();
      api.readMonitorDumps.mockClear();

      c.toggleStatusClass(2);
      settle(fixture);
      await Promise.resolve(); // la pagina successiva parte in un microtask

      expect(api.readMonitorDumps).toHaveBeenCalledTimes(2);
      expect(c.entries().map((e: DumpEntry) => e.dumpKey)).toEqual(['f#0', 'f#1', 'f#2']);
      expect(c.done()).toBe(true);
    });

    // Lasciando lo Storico una ricerca rara continuava a scorrere l'archivio, anche dal Catalogo.
    it('lasciata la pagina, né la risposta in corso né una continuazione avviano altre letture', async () => {
      const responses = new Subject<DumpReadPage>();
      const { fixture, c } = create();
      api.readMonitorDumps.mockClear();
      api.readMonitorDumps.mockReturnValue(responses);

      c.toggleStatusClass(5);
      settle(fixture);
      expect(api.readMonitorDumps).toHaveBeenCalledTimes(1);

      fixture.destroy();
      responses.next(page([], { fileIndex: 0, lineIndex: 20000, byteOffset: 1 }, false));
      await Promise.resolve();
      c.loadMore();

      expect(api.readMonitorDumps).toHaveBeenCalledTimes(1);
      expect(responses.observed).toBe(false);
    });

    it('una continuazione già accodata non riparte se la pagina viene distrutta prima', async () => {
      const { fixture, c } = create();
      api.readMonitorDumps.mockClear();
      api.readMonitorDumps.mockReturnValueOnce(of(page([], { fileIndex: 0, lineIndex: 20000, byteOffset: 1 }, false)));

      c.toggleStatusClass(5);
      settle(fixture); // la pagina vuota accoda la continuazione in un microtask
      fixture.destroy();
      await Promise.resolve();

      expect(api.readMonitorDumps).toHaveBeenCalledTimes(1);
    });

    it('a filtro acceso la testata conta i risultati, e l’archivio vuoto lo dice', () => {
      api.readMonitorDumps.mockReturnValue(of(page([], null, true)));
      const { fixture, c } = create();
      c.toggleStatusClass(5);
      settle(fixture);

      const host = fixture.nativeElement as HTMLElement;
      const content = (host.textContent ?? '').replace(/\s+/g, ' ');
      // Il conteggio della testata, nel colore del filtro.
      const badge = host.querySelector('ui-page-header ui-badge');
      expect(badge?.textContent?.trim()).toBe('0');
      expect(badge?.classList.contains('text-brand')).toBe(true);
      expect(content).toContain('Nessuna voce dello storico corrisponde ai filtri.');
    });
  });

  // Prima ogni clic sulla riga la apriva e insieme la spuntava. Ora apre il clic sulla riga e
  // spunta il clic sulla casella, come nel catalogo e nel Monitor. (Le righe sono in uno scroll
  // virtuale che qui non disegna nulla: si chiamano i gestori con il bersaglio del clic.)
  describe('selezione', () => {
    const onCheck = () => {
      const check = document.createElement('span');
      check.setAttribute('data-check', '');
      return check;
    };
    function clickRow(c: any, index: number, shiftKey = false): void {
      c.onRowClick(c.entries()[index], { target: document.createElement('span'), shiftKey } as unknown as MouseEvent);
    }
    function clickCheck(c: any, index: number, shiftKey = false): void {
      c.onRowClick(c.entries()[index], { target: onCheck(), shiftKey } as unknown as MouseEvent);
    }

    it('il clic sulla riga la apre senza spuntarla', () => {
      const { c } = create();
      clickRow(c, 1);
      expect(c.focusedKey()).toBe('f#1');
      expect(c.selectedCount()).toBe(0);
    });

    it('il clic sulla casella la spunta senza aprirla, e un secondo clic la libera', () => {
      const { c } = create();
      clickCheck(c, 1);
      expect([...c.selectedKeys()]).toEqual(['f#1']);
      expect(c.focusedKey()).toBe('f#0');
      clickCheck(c, 1);
      expect(c.selectedCount()).toBe(0);
    });

    it('shift-clic sulla casella seleziona il range dall’ultima spuntata, in entrambe le direzioni', () => {
      const { c } = create();
      c.loadMore(); // 3 entry
      clickCheck(c, 2); // ancora: f#2
      clickCheck(c, 0, true); // shift verso l'alto
      expect([...c.selectedKeys()].sort()).toEqual(['f#0', 'f#1', 'f#2']);
    });

    // Il fuoco resta sulla lista: la voce attiva la dice aria-activedescendant (lista virtualizzata).
    it('le frecce spostano la voce attiva; Spazio la spunta, Maiuscole+Spazio l’intervallo', () => {
      // jsdom non implementa scrollTo, che lo scroll virtuale usa per portare in vista la voce.
      const original = HTMLElement.prototype.scrollTo;
      HTMLElement.prototype.scrollTo = (() => undefined) as typeof original;
      try {
        const { c } = create();
        c.loadMore(); // 3 entry, attiva f#0
        const press = (key: string, shiftKey = false) => {
          const event = new KeyboardEvent('keydown', { key, shiftKey, cancelable: true });
          c.onListKeydown(event);
          return event;
        };

        const freccia = press('ArrowDown');
        expect(freccia.defaultPrevented).toBe(true);
        // aria-activedescendant dipende dalle righe in vista, che jsdom non misura: e2e.
        expect(c.focusedKey()).toBe('f#1');

        press(' ');
        expect([...c.selectedKeys()]).toEqual(['f#1']);
        press('End');
        press(' ', true);
        expect([...c.selectedKeys()].sort()).toEqual(['f#1', 'f#2']);
        press('Home');
        expect(c.focusedKey()).toBe('f#0');
      } finally {
        HTMLElement.prototype.scrollTo = original;
      }
    });

    it('la barra delle azioni compare solo con una selezione, e Annulla la svuota', () => {
      const { fixture, c } = create();
      const bar = () => ((fixture.nativeElement as HTMLElement).textContent ?? '').includes('selezionate');
      expect(bar()).toBe(false);
      clickCheck(c, 0);
      fixture.detectChanges();
      expect(bar()).toBe(true);
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="Deseleziona"]')!.click();
      fixture.detectChanges();
      expect(c.selectedCount()).toBe(0);
      expect(bar()).toBe(false);
    });

    it('seleziona tutte le caricate / azzera', () => {
      const { c } = create();
      c.selectAllLoaded();
      expect(c.selectedCount()).toBe(2);
      c.clearSelection();
      expect(c.selectedCount()).toBe(0);
    });
  });

  describe('creazione mock dal dump', () => {
    it('senza selezione non chiama il backend', () => {
      const { c } = create();
      c.createFromSelected();
      expect(api.createMocksFromDump).not.toHaveBeenCalled();
    });

    it('con selezione manda le chiavi, mostra l’esito e azzera la selezione', () => {
      const { c } = create();
      c.selectAllLoaded();
      c.createFromSelected();
      expect(api.createMocksFromDump).toHaveBeenCalledWith({ keys: ['f#0', 'f#1'], onConflict: 'skip', selectAddedVariants: false, newEndpointEnabled: true });
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
      expect(c.selectedCount()).toBe(0);
      expect(c.creating()).toBe(false);
    });

    it('se non è stato creato nulla il toast è di errore', () => {
      api.createMocksFromDump.mockReturnValueOnce(of({ created: 0, createdEmpty: 0, skippedExisting: 3, failed: 0 }));
      const { c } = create();
      c.selectAllLoaded();
      c.createFromSelected();
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    });

    it('un mock creato ma non servito dal runtime rende il toast un avviso, con il conteggio', () => {
      api.createMocksFromDump.mockReturnValueOnce(
        of({
          created: 2,
          createdEmpty: 0,
          skippedExisting: 0,
          failed: 0,
          items: [
            { key: 'f#0', method: 'GET', path: '/a', id: 'a', responseFile: '001.response.json', writeOutcome: 'created', runtimeOutcome: 'applied', error: null },
            { key: 'f#1', method: 'GET', path: '/b', id: 'b', responseFile: '001.response.json', writeOutcome: 'created', runtimeOutcome: 'not_applied', error: 'Not served after the reload.' },
          ],
          runtime: { status: 'degraded', errors: [] },
        }),
      );
      const { c } = create();
      c.selectAllLoaded();
      c.createFromSelected();
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'warning', description: '2 create, 1 non serviti dal runtime' }),
      );
    });

    it('un batch fallito dopo aver creato dei mock mostra l’errore insieme al risultato parziale', () => {
      const message = 'Mock creation from dump: stopped after 2 of 3 items because one could not be restored: disco pieno';
      api.createMocksFromDump.mockReturnValueOnce(
        throwError(() => ({
          status: 500,
          error: {
            message,
            details: {
              code: 'ROLLBACK_FAILED',
              rollback: 'failed',
              result: {
                created: 1, createdEmpty: 0, skippedExisting: 0, failed: 1,
                items: [
                  { key: 'f#0', method: 'GET', path: '/a', id: 'a', responseFile: '001.response.json', writeOutcome: 'created', runtimeOutcome: 'applied', error: null },
                  { key: 'f#1', method: 'GET', path: '/b', id: null, responseFile: null, writeOutcome: 'failed', runtimeOutcome: 'not_applicable', error: 'disco pieno' },
                ],
                runtime: { status: 'applied', errors: [] },
              },
            },
          },
        })),
      );
      const { c } = create();
      c.selectAllLoaded();
      c.createFromSelected();
      expect(toast.show).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'error', description: `${message} Scritto finora: 1 create, 1 falliti.` }),
      );
    });

    it('il riepilogo conta anche le varianti aggiunte e le catture non più disponibili', () => {
      api.createMocksFromDump.mockReturnValueOnce(of({
        created: 1, createdEmpty: 0, skippedExisting: 0, failed: 0, addedVariants: 2,
        items: [
          { key: 'f#0', method: 'GET', path: '/a', id: 'a', responseFile: '001.response.json', writeOutcome: 'created', runtimeOutcome: 'applied', captureOutcome: 'complete', warnings: [], error: null },
          { key: 'f#9', method: null, path: null, id: null, responseFile: null, writeOutcome: 'skipped', runtimeOutcome: 'not_applicable', captureOutcome: 'unavailable', warnings: [], error: null },
        ],
        runtime: { status: 'applied', errors: [] },
      }) as never);
      const { c } = create();
      c.selectAllLoaded();
      c.createFromSelected();
      expect(toast.show).toHaveBeenLastCalledWith(expect.objectContaining({ description: expect.stringContaining('2 varianti aggiunte, 1 non più disponibili') }));
    });

    it('"tutto il file" manda il criterio per nome file', () => {
      const { c } = create();
      c.createFromFile(FILE1);
      expect(api.createMocksFromDump).toHaveBeenCalledWith({ file: FILE1.name, onConflict: 'skip', selectAddedVariants: false, newEndpointEnabled: true });
    });

    it('su errore mostra il messaggio e sblocca il pulsante', () => {
      api.createMocksFromDump.mockReturnValueOnce(throwError(() => new Error('disco pieno')));
      const { c } = create();
      c.selectAllLoaded();
      c.createFromSelected();
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error', description: 'disco pieno' }));
      expect(c.creating()).toBe(false);
    });
  });

  describe('eliminazione file', () => {
    it('a successo riparte da zero: cursore azzerato, selezione svuotata, prima pagina ricaricata', () => {
      const { c } = create();
      c.loadMore();
      c.selectAllLoaded();
      api.readMonitorDumps.mockClear();

      c.deleteFile(FILE1);

      expect(api.deleteMonitorDump).toHaveBeenCalledWith(FILE1.name);
      expect(api.readMonitorDumps).toHaveBeenCalledWith(null, 300, NO_FILTERS); // riparte dal cursore nullo
      expect(c.entries().map((e: DumpEntry) => e.dumpKey)).toEqual(['f#0', 'f#1']);
      expect(c.selectedCount()).toBe(0);
      expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
    });
  });

  describe('helper puri', () => {
    it('bodyLang riconosce JSON strutturato valido, altrimenti testo', () => {
      const { c } = create();
      expect(c.bodyLang('{"a":1}')).toBe('json');
      expect(c.bodyLang('  [1,2] ')).toBe('json');
      expect(c.bodyLang('{rotto')).toBe('text');
      expect(c.bodyLang('ciao')).toBe('text');
      expect(c.bodyLang(undefined)).toBe('text');
    });

    it('headerRows ordina per nome e appiattisce gli array', () => {
      const { c } = create();
      expect(c.headerRows({ zeta: 'z', alfa: ['a', 'b'] })).toEqual([
        ['alfa', 'a, b'],
        ['zeta', 'z'],
      ]);
      expect(c.headerRows(undefined)).toEqual([]);
      expect(c.headerCount({ a: '1', b: '2' })).toBe(2);
      expect(c.headerCount(undefined)).toBe(0);
    });

    it('sourceLabel e statusColor mappano sorgenti e classi di status', () => {
      const { c } = create();
      expect(c.sourceLabel('backend')).toBe('Proxy');
      expect(c.sourceLabel('mock-only-miss')).toBe('Miss');
      expect(c.sourceLabel('sconosciuta')).toBe('sconosciuta');
      expect(c.statusColor(204)).toBe('var(--status-2xx)');
      expect(c.statusColor(503)).toBe('var(--status-5xx)');
      expect(c.statusColor(99)).toBe('var(--muted-foreground)');
      expect(c.kb(2048)).toBe('2.0');
    });
  });

  describe('testata', () => {
    it('conta le voci caricate, con "+" finche\' ce ne sono altre da leggere', () => {
      const { fixture, c } = create();
      const host = fixture.nativeElement as HTMLElement;
      const badge = () => host.querySelector('ui-page-header ui-badge')?.textContent?.trim();
      expect(host.querySelector('h1')?.textContent?.trim()).toBe('Storico');
      expect(badge()).toBe('2+');
      c.loadMore();
      fixture.detectChanges();
      expect(badge()).toBe('3');
    });
  });
});
