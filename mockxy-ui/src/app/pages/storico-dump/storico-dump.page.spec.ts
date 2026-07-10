import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
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
      expect(api.readMonitorDumps).toHaveBeenCalledWith(null, 300);
      expect(c.entries().map((e: DumpEntry) => e.dumpKey)).toEqual(['f#0', 'f#1']);
      expect(c.files()).toEqual([FILE1]);
      expect(c.focusedKey()).toBe('f#0');
      expect(c.done()).toBe(false);
    });

    it('loadMore rimanda il cursore ricevuto e ACCUMULA le pagine; a done non chiama più', () => {
      const { c } = create();
      c.loadMore();
      expect(api.readMonitorDumps).toHaveBeenLastCalledWith({ fileIndex: 0, lineIndex: 2 }, 300);
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

  describe('selezione', () => {
    function clickRow(c: any, index: number, shiftKey = false): void {
      c.onRowClick(c.entries()[index], index, { shiftKey } as MouseEvent);
    }

    it('il click alterna la selezione della riga e la mette a fuoco', () => {
      const { c } = create();
      clickRow(c, 1);
      expect([...c.selectedKeys()]).toEqual(['f#1']);
      expect(c.focusedKey()).toBe('f#1');
      clickRow(c, 1);
      expect(c.selectedCount()).toBe(0);
    });

    it('shift-click seleziona il range dall’ultimo click, in entrambe le direzioni', () => {
      const { c } = create();
      c.loadMore(); // 3 entry
      clickRow(c, 2); // ancora: f#2
      clickRow(c, 0, true); // shift verso l'alto
      expect([...c.selectedKeys()].sort()).toEqual(['f#0', 'f#1', 'f#2']);
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
      expect(api.createMocksFromDump).toHaveBeenCalledWith({ keys: ['f#0', 'f#1'] });
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

    it('"tutto il file" manda il criterio per nome file', () => {
      const { c } = create();
      c.createFromFile(FILE1);
      expect(api.createMocksFromDump).toHaveBeenCalledWith({ file: FILE1.name });
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
      expect(api.readMonitorDumps).toHaveBeenCalledWith(null, 300); // riparte dal cursore nullo
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
});
