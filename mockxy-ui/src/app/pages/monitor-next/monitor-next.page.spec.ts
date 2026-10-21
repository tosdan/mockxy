import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { MonitorNextPage } from './monitor-next.page';
import { translocoTesting } from '../../testing/transloco-testing';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { MonitorStreamStore } from '../../shared/monitor-stream.store';
import { ViewStateService } from '../../shared/view-state.service';
import { UiDialog } from '../../ui/ui-dialog/ui-dialog';
import type { RequestMonitorEntry } from '../../mock-admin-api.types';

function entry(partial: Partial<RequestMonitorEntry> & Pick<RequestMonitorEntry, 'id' | 'method' | 'status' | 'source'>): RequestMonitorEntry {
  return {
    timestamp: '2026-06-16T12:31:04.882Z',
    path: partial.originalUrl ?? '/api',
    originalUrl: '/api',
    latencyMs: 10,
    requestHeaders: {},
    requestBodyBytes: 0,
    requestBodyTruncated: false,
    ...partial,
  };
}

const ENTRIES: RequestMonitorEntry[] = [
  entry({ id: '1', method: 'POST', originalUrl: '/api/orders', status: 201, source: 'mock', latencyMs: 12, requestHeaders: { 'content-type': 'application/json', host: 'x' }, requestBody: '{"a":1}' }),
  entry({ id: '2', method: 'GET', originalUrl: '/api/users/42', status: 200, source: 'backend', latencyMs: 88 }),
  entry({ id: '3', method: 'GET', originalUrl: '/api/payments', status: 502, source: 'backend', latencyMs: 31 }),
];

// Esito di un elemento di create-mocks, come lo restituisce il server (§13 C7).
function captureItem(partial: Record<string, unknown> = {}) {
  return {
    requestId: '2',
    method: 'GET',
    path: '/api/users/42',
    id: 'nuovo',
    responseFile: '001.response.json',
    writeOutcome: 'created',
    runtimeOutcome: 'applied',
    captureOutcome: 'complete',
    warnings: [],
    error: null,
    ...partial,
  };
}
function createResult(items: Record<string, unknown>[], counts: Record<string, number> = {}) {
  return { runtimeId: 'rt-1', counts: { created: 1, addedVariants: 0, skipped: 0, unavailable: 0, failed: 0, incomplete: 0, ...counts }, items, runtime: { status: 'applied', errors: [] } };
}

const apiStub = {
  // Lo snapshot dichiara il runtime delle voci: la creazione lo rimanda al server.
  streamRequestMonitoring: () => of({ type: 'snapshot', runtimeId: 'rt-1', items: ENTRIES }),
  createMocksFromMonitor: vi.fn((_request: Record<string, unknown>) => of(createResult([captureItem()]))),
  clearRequestMonitoring: () => of(undefined),
  listRequestMonitoring: () => of({ items: ENTRIES }),
  createMock: vi.fn((_request: { config: Record<string, unknown>; body: unknown; description?: string }) => of({})),
  resolveMock: vi.fn((_method: string, _path: string) => of(null)),
  createResponse: vi.fn((_id: string, _request: Record<string, unknown>) => of({})),
};

const dialogStub = {
  open: vi.fn(() => ({ close: vi.fn() })),
};

/** Stub in-memory di ViewStateService: la densita' scelta in un test non passa al successivo. */
function makeViewStateStub() {
  const state = new Map<string, unknown>();
  return {
    read: vi.fn((key: string) => state.get(key) ?? null),
    write: vi.fn((key: string, value: unknown) => {
      if (value == null) state.delete(key);
      else state.set(key, value);
    }),
  };
}

describe('MonitorNextPage', () => {
  let viewState: ReturnType<typeof makeViewStateStub>;

  beforeEach(async () => {
    viewState = makeViewStateStub();
    await TestBed.configureTestingModule({
      imports: [MonitorNextPage, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MockAdminApiService, useValue: apiStub },
        { provide: UiDialog, useValue: dialogStub },
        { provide: ViewStateService, useValue: viewState },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(MonitorNextPage);
    fixture.detectChanges(); // ngOnInit → snapshot → entries
    return { fixture, c: fixture.componentInstance as any };
  }

  describe('pulsante di reset del filtro path/URL', () => {
    // La pagina ha piu' label con dentro dei controlli: si punta all'aria-label del pulsante.
    function clearButton(fixture: ReturnType<typeof create>['fixture']): HTMLButtonElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Svuota il filtro"]');
    }

    it('a filtro vuoto non compare', () => {
      const { fixture } = create();
      expect(clearButton(fixture)).toBeNull();
    });

    it('compare col filtro valorizzato, lo svuota e ripristina le entry filtrate', () => {
      const { fixture, c } = create();
      c.search.set('orders');
      fixture.detectChanges();
      expect(c.filtered().length).toBe(1);

      const button = clearButton(fixture);
      expect(button?.getAttribute('aria-label')).toBe('Svuota il filtro');
      button?.click();
      fixture.detectChanges();

      expect(c.search()).toBe('');
      expect(c.filtered().length).toBe(3);
      expect(clearButton(fixture)).toBeNull();
    });

    it('dopo lo svuotamento il fuoco resta nel campo', () => {
      const { fixture, c } = create();
      c.search.set('orders');
      fixture.detectChanges();

      clearButton(fixture)?.click();

      expect(document.activeElement).toBe(
        (fixture.nativeElement as HTMLElement).querySelector('label input[type="text"]'),
      );
    });
  });

  it('carica le entry dallo snapshot live', () => {
    const { c } = create();
    expect(c.entries().length).toBe(3);
  });

  it('apre con deep link la risorsa shared-state diagnosticata', () => {
    const { c } = create();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    c.goToSharedState('items');
    expect(navigate).toHaveBeenCalledWith(['/dati'], {
      queryParams: { tab: 'runtime', name: 'items' },
    });
  });

  it('calcola le statistiche su tutte le entry', () => {
    const { c } = create();
    expect(c.total()).toBe(3);
    expect(c.statusCounts()).toEqual({ 2: 2, 3: 0, 4: 0, 5: 1 }); // 201, 200, 502
    expect(c.unmockedCount()).toBe(2); // le due dal backend
    expect(c.avgLatency()).toBe(Math.round((12 + 88 + 31) / 3));
  });

  // Gli errori si contano sui chip di stato: ognuno dice quante voci mostrerebbe, fra quelle che
  // passano gli altri filtri. Il proprio filtro non li cambia.
  it('i chip di stato contano le voci degli altri filtri, e il numero e\' sul chip', () => {
    const { fixture, c } = create();
    c.search.set('payments');
    c.toggleStatusClass(2);
    fixture.detectChanges();
    expect(c.statusCounts()).toEqual({ 2: 0, 3: 0, 4: 0, 5: 1 });
    const chips = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button[aria-pressed]'))
      .filter((b) => /^\dxx/.test((b.textContent ?? '').trim()));
    expect(chips.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual(['2xx 0', '3xx 0', '4xx 0', '5xx 1']);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('il chip delle non mockate accende e spegne il filtro "backend reale"', () => {
    const { fixture, c } = create();
    const chip = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-pressed]') as HTMLButtonElement;
    expect((chip().textContent ?? '').replace(/\s+/g, ' ')).toContain('2 non mockate');
    chip().click();
    fixture.detectChanges();
    expect(c.sourceFilter()).toBe('real-backend');
    expect(chip().getAttribute('aria-pressed')).toBe('true');
    expect(c.filtered().map((e: RequestMonitorEntry) => e.id)).toEqual(['2', '3']);
    chip().click();
    fixture.detectChanges();
    expect(c.sourceFilter()).toBe('all');
  });

  // La colonna della latenza nella riga compatta e' larga 7 caratteri: le richieste lente non
  // devono andare a capo e raddoppiare l'altezza della riga.
  it('latenze lunghe in secondi, sempre entro 7 caratteri e senza andare a capo', () => {
    const { fixture, c } = create();
    expect(c.formatLatency(1503)).toBe('1503 ms');
    expect(c.formatLatency(9999)).toBe('9999 ms');
    expect(c.formatLatency(10_000)).toBe('10,0 s');
    expect(c.formatLatency(30_000)).toBe('30,0 s');
    expect(c.formatLatency(125_000)).toBe('125 s');
    for (const ms of [0, 1503, 9999, 10_000, 99_949, 100_000, 999_999]) expect(c.formatLatency(ms).length).toBeLessThanOrEqual(7);
    const latency = (fixture.nativeElement as HTMLElement).querySelector('[role="option"] .text-right > span') as HTMLElement;
    expect(latency.classList.contains('whitespace-nowrap')).toBe(true);
  });

  it('densita\' compatta: la lista la legge dalla classe, e resta per la visita dopo', () => {
    const { fixture, c } = create();
    const list = () => (fixture.nativeElement as HTMLElement).querySelector('[role="listbox"]') as HTMLElement;
    expect(list().classList.contains('mx-compact')).toBe(false);
    c.toggleCompact();
    fixture.detectChanges();
    expect(list().classList.contains('mx-compact')).toBe(true);
    expect(viewState.write).toHaveBeenLastCalledWith('monitor-density', 'compact');

    const again = create();
    expect(again.c.compact()).toBe(true);
    again.c.toggleCompact();
    expect(viewState.write).toHaveBeenLastCalledWith('monitor-density', null);
  });

  it('filtra per ricerca su path/metodo', () => {
    const { c } = create();
    c.search.set('orders');
    expect(c.filtered().map((e: RequestMonitorEntry) => e.id)).toEqual(['1']);
  });

  it('filtra per metodo', () => {
    const { c } = create();
    c.methodFilter.set('GET');
    expect(c.filtered().map((e: RequestMonitorEntry) => e.id)).toEqual(['2', '3']);
  });

  it('filtra per sorgente', () => {
    const { c } = create();
    c.sourceFilter.set('mock');
    expect(c.filtered().map((e: RequestMonitorEntry) => e.id)).toEqual(['1']);
  });

  it('filtra per classe di status (toggle multipli)', () => {
    const { c } = create();
    c.toggleStatusClass(5);
    expect(c.filtered().map((e: RequestMonitorEntry) => e.id)).toEqual(['3']);
    c.toggleStatusClass(2); // ora 2xx OR 5xx: 201, 200, 502
    expect(c.filtered().map((e: RequestMonitorEntry) => e.id).sort()).toEqual(['1', '2', '3']);
  });

  it('costruisce un cURL con metodo, header (escluso host) e body', () => {
    const { c } = create();
    const curl = c.buildCurl(ENTRIES[0]);
    expect(curl).toContain("curl -X POST '/api/orders'");
    expect(curl).toContain("-H 'content-type: application/json'");
    expect(curl).not.toContain('host:');
    expect(curl).toContain('--data \'{"a":1}\'');
  });

  it('"Vai al mock" naviga al catalogo con metodo e route', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const { c } = create();
    c.goToDefinition(entry({ id: 'x', method: 'GET', status: 200, source: 'mock', originalUrl: '/be/regioni', matchedRoutePath: '/be/regioni' }));
    expect(navSpy).toHaveBeenCalledWith(['/mocks'], { queryParams: { m: 'GET', p: '/be/regioni' } });
  });

  it('per una entry backend risolve il mock che oggi la coprirebbe e ci naviga', () => {
    apiStub.resolveMock.mockClear();
    apiStub.resolveMock.mockReturnValue(of({ id: 'abc', method: 'GET', path: '/api/users/:id', disabled: false }) as never);
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const { fixture, c } = create();
    c.selectEntry('2'); // entry backend GET /api/users/42
    fixture.detectChanges(); // fa girare l'effect di lookup

    expect(apiStub.resolveMock).toHaveBeenCalledWith('GET', '/api/users/42');
    expect(c.coveringMock()).toEqual({ id: 'abc', method: 'GET', path: '/api/users/:id', disabled: false });

    c.goToCoveringMock(c.coveringMock());
    expect(navSpy).toHaveBeenCalledWith(['/mocks'], { queryParams: { m: 'GET', p: '/api/users/:id' } });
  });

  it('per una entry servita da mock non interroga il resolver (ha già il suo link)', () => {
    apiStub.resolveMock.mockClear();
    apiStub.resolveMock.mockReturnValue(of(null));

    const { fixture, c } = create();
    c.selectEntry('1'); // entry source=mock
    fixture.detectChanges();

    expect(apiStub.resolveMock).not.toHaveBeenCalled();
    expect(c.coveringMock()).toBeNull();
  });

  // Piano agent/API, §13 C7: la pagina non trasforma più le catture, lo fa il server.
  describe('creazione di mock dal traffico', () => {
    beforeEach(() => {
      apiStub.createMocksFromMonitor.mockReset();
      apiStub.createMocksFromMonitor.mockReturnValue(of(createResult([captureItem()])));
      dialogStub.open.mockClear();
    });

    it('chiede al server di creare il mock dalla cattura, col runtime delle voci mostrate', () => {
      const { c } = create();
      c.createMockFromEntry(ENTRIES[1]);
      expect(apiStub.createMocksFromMonitor).toHaveBeenCalledWith({
        runtimeId: 'rt-1',
        ids: ['2'],
        onConflict: 'skip',
        selectAddedVariants: false,
        newEndpointEnabled: true,
      });
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Mock creato', tone: 'success' });
    });

    it('senza «Attiva subito» il nuovo endpoint nasce disattivato e lo si dichiara', () => {
      const { c } = create();
      c.activateNewMocks.set(false);
      c.createMockFromEntry(ENTRIES[1]);
      expect(apiStub.createMocksFromMonitor.mock.calls[0][0]).toMatchObject({ newEndpointEnabled: false });
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Mock creato senza attivarlo' });
    });

    it('una cattura incompleta si dichiara come bozza da completare', () => {
      apiStub.createMocksFromMonitor.mockReturnValue(of(createResult([captureItem({ captureOutcome: 'incomplete', warnings: [{ code: 'INCOMPLETE_CAPTURE', reason: 'binary' }] })], { incomplete: 1 })));
      const { c } = create();
      c.createMockFromEntry(ENTRIES[1]);
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Mock creato (skeleton)', tone: 'warning' });
    });

    it('il toast di creazione apre il mock creato, con metodo e rotta dell\'esito', () => {
      apiStub.createMocksFromMonitor.mockReturnValue(of(createResult([captureItem({ path: '/api/users/:id' })])));
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const { c } = create();
      c.createMockFromEntry(ENTRIES[1]);
      c.toast.toasts().at(-1).action.run();
      expect(navSpy).toHaveBeenCalledWith(['/mocks'], { queryParams: { m: 'GET', p: '/api/users/:id' } });
    });

    it('con l\'endpoint già esistente apre il dialog invece di un errore', () => {
      apiStub.createMocksFromMonitor.mockReturnValue(of(createResult([captureItem({ id: 'endpoint-esistente', responseFile: null, writeOutcome: 'skipped', runtimeOutcome: 'not_applicable' })], { created: 0, skipped: 1 })));
      const { c } = create();
      c.createMockFromEntry(ENTRIES[1]);
      expect(dialogStub.open).toHaveBeenCalledTimes(1);
      expect(c.mockExistsPrompt()).toMatchObject({ existingMockId: 'endpoint-esistente', method: 'GET', path: '/api/users/42' });
    });

    it('la conferma aggiunge la cattura come variante selezionata; «Aggiungi senza attivare» no', () => {
      const skipped = createResult([captureItem({ id: 'endpoint-esistente', responseFile: null, writeOutcome: 'skipped' })], { created: 0, skipped: 1 });
      const added = createResult([captureItem({ id: 'endpoint-esistente', responseFile: '002.response.json', writeOutcome: 'variant_added' })], { created: 0, addedVariants: 1 });
      const router = TestBed.inject(Router);
      const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const { c } = create();

      apiStub.createMocksFromMonitor.mockReturnValueOnce(of(skipped)).mockReturnValueOnce(of(added));
      c.createMockFromEntry(ENTRIES[1]);
      c.confirmAddResponseToExisting();
      expect(apiStub.createMocksFromMonitor.mock.calls[1][0]).toMatchObject({ ids: ['2'], onConflict: 'add-variant', selectAddedVariants: true });
      expect(c.mockExistsPrompt()).toBeNull();
      c.toast.toasts().at(-1).action.run();
      expect(navSpy).toHaveBeenCalledWith(['/mocks'], { queryParams: { m: 'GET', p: '/api/users/42' } });

      apiStub.createMocksFromMonitor.mockReturnValueOnce(of(skipped)).mockReturnValueOnce(of(added));
      c.createMockFromEntry(ENTRIES[1]);
      c.confirmAddResponseToExisting(false);
      expect(apiStub.createMocksFromMonitor.mock.calls[3][0]).toMatchObject({ onConflict: 'add-variant', selectAddedVariants: false });
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Variante aggiunta senza attivarla' });
    });

    it('l\'annullo chiude il dialog senza aggiungere varianti', () => {
      apiStub.createMocksFromMonitor.mockReturnValue(of(createResult([captureItem({ id: 'endpoint-esistente', writeOutcome: 'skipped' })], { created: 0, skipped: 1 })));
      const { c } = create();
      c.createMockFromEntry(ENTRIES[1]);
      c.cancelAddResponseToExisting();
      expect(apiStub.createMocksFromMonitor).toHaveBeenCalledTimes(1);
      expect(c.mockExistsPrompt()).toBeNull();
    });

    it('una cattura non più disponibile lo dice', () => {
      apiStub.createMocksFromMonitor.mockReturnValue(of(createResult([captureItem({ method: null, path: null, id: null, responseFile: null, writeOutcome: 'skipped', captureOutcome: 'unavailable' })], { created: 0, unavailable: 1 })));
      const { c } = create();
      c.createMockFromEntry(ENTRIES[1]);
      expect(dialogStub.open).not.toHaveBeenCalled();
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Cattura non più disponibile', tone: 'error' });
    });

    it('motore ripartito, risposta persa ed errori: un solo tentativo, nessuna ripetizione cieca', () => {
      const { c } = create();
      apiStub.createMocksFromMonitor.mockReturnValueOnce(throwError(() => ({ status: 409, error: { details: { code: 'RUNTIME_CHANGED', runtimeId: 'rt-2' } } })));
      c.createMockFromEntry(ENTRIES[1]);
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Il motore è ripartito' });

      apiStub.createMocksFromMonitor.mockReturnValueOnce(throwError(() => ({ status: 0 })));
      c.createMockFromEntry(ENTRIES[1]);
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Esito sconosciuto' });

      apiStub.createMocksFromMonitor.mockReturnValueOnce(throwError(() => ({ status: 500, error: { message: 'boom' } })));
      c.createMockFromEntry(ENTRIES[1]);
      expect(c.toast.toasts().at(-1)).toMatchObject({ tone: 'error', description: 'boom' });
      expect(apiStub.createMocksFromMonitor).toHaveBeenCalledTimes(3);
      expect(dialogStub.open).not.toHaveBeenCalled();
    });

    it('un batch fallito dopo la scrittura riporta quanto è stato scritto, varianti comprese', () => {
      const skipped = createResult([captureItem({ id: 'endpoint-esistente', responseFile: null, writeOutcome: 'skipped' })], { created: 0, skipped: 1 });
      const partial = createResult([captureItem({ id: 'endpoint-esistente', responseFile: '002.response.json', writeOutcome: 'variant_added', runtimeOutcome: 'not_applied' })], { created: 0, addedVariants: 1 });
      const { c } = create();
      apiStub.createMocksFromMonitor
        .mockReturnValueOnce(of(skipped))
        .mockReturnValueOnce(throwError(() => ({ status: 500, error: { message: 'reload fallito', details: { code: 'BATCH_RUNTIME_FAILED', result: partial } } })));
      c.createMockFromEntry(ENTRIES[1]);
      c.confirmAddResponseToExisting();
      expect(c.toast.toasts().at(-1)).toMatchObject({ tone: 'error', description: 'reload fallito Scritto finora: 0 create, 1 varianti aggiunte, 1 non servite dal runtime.' });
    });

    // Un runtime nuovo per lo store dello stream, come dopo un riavvio del motore: nuovo snapshot.
    function restartableStream() {
      const stream$ = new BehaviorSubject<unknown>({ type: 'snapshot', runtimeId: 'rt-1', items: ENTRIES });
      vi.spyOn(apiStub, 'streamRequestMonitoring').mockReturnValueOnce(stream$ as never);
      return { restart: () => stream$.next({ type: 'snapshot', runtimeId: 'rt-2', items: ENTRIES }) };
    }

    it('il dialog aperto prima di un riavvio rimanda la cattura col suo runtime, non con quello nuovo', () => {
      const { restart } = restartableStream();
      apiStub.createMocksFromMonitor.mockReturnValueOnce(of(createResult([captureItem({ id: 'endpoint-esistente', responseFile: null, writeOutcome: 'skipped' })], { created: 0, skipped: 1 })));
      const { c } = create();
      c.createMockFromEntry(ENTRIES[1]);
      restart();
      c.confirmAddResponseToExisting(false);
      expect(apiStub.createMocksFromMonitor.mock.calls[1][0]).toMatchObject({ runtimeId: 'rt-1', ids: ['2'] });
    });

    it('una selezione fatta prima di un riavvio non vale per le voci del nuovo runtime', () => {
      const { restart } = restartableStream();
      const { c } = create();
      c.toggleSelection('2');
      expect(c.selectedCount()).toBe(1);

      restart();
      expect(c.selectedCount()).toBe(0);
      c.createMocksFromSelected();
      expect(apiStub.createMocksFromMonitor).not.toHaveBeenCalled();

      c.toggleSelection('3');
      c.createMocksFromSelected();
      expect(apiStub.createMocksFromMonitor.mock.calls[0][0]).toMatchObject({ runtimeId: 'rt-2', ids: ['3'] });
    });

    it('il messaggio segue l\'opzione mandata, non la casella cambiata durante la richiesta', () => {
      const response$ = new Subject<unknown>();
      apiStub.createMocksFromMonitor.mockReturnValueOnce(response$ as never);
      const { c } = create();
      c.createMockFromEntry(ENTRIES[1]);
      c.activateNewMocks.set(false);
      response$.next(createResult([captureItem()]));
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Mock creato', tone: 'success' });
    });

    it('«Aggiungi senza attivare» non attiva niente, neanche un endpoint ricreato nel frattempo', () => {
      const skipped = createResult([captureItem({ id: 'endpoint-esistente', responseFile: null, writeOutcome: 'skipped' })], { created: 0, skipped: 1 });
      // L'endpoint è stato eliminato mentre il dialog era aperto: il server lo ricrea.
      const recreated = createResult([captureItem({ id: 'endpoint-esistente', writeOutcome: 'created', runtimeOutcome: 'not_applicable' })]);
      const { c } = create();
      apiStub.createMocksFromMonitor.mockReturnValueOnce(of(skipped)).mockReturnValueOnce(of(recreated));
      c.createMockFromEntry(ENTRIES[1]);
      c.confirmAddResponseToExisting(false);
      expect(apiStub.createMocksFromMonitor.mock.calls[1][0]).toMatchObject({ onConflict: 'add-variant', selectAddedVariants: false, newEndpointEnabled: false });
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Mock creato senza attivarlo' });

      apiStub.createMocksFromMonitor.mockReturnValueOnce(of(skipped)).mockReturnValueOnce(of(createResult([captureItem({ id: 'endpoint-esistente' })])));
      c.createMockFromEntry(ENTRIES[1]);
      c.confirmAddResponseToExisting();
      expect(apiStub.createMocksFromMonitor.mock.calls[3][0]).toMatchObject({ selectAddedVariants: true, newEndpointEnabled: true });
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Mock creato' });
    });

    it('scritto ma non servito dal runtime: avviso col motivo, mai un successo', () => {
      const notServed = { runtimeOutcome: 'not_applied', error: 'Il runtime non ha caricato il file.' };
      const { c } = create();
      apiStub.createMocksFromMonitor.mockReturnValueOnce(of(createResult([captureItem(notServed)])));
      c.createMockFromEntry(ENTRIES[1]);
      expect(c.toast.toasts().at(-1)).toMatchObject({
        title: 'Scritto, ma non servito',
        tone: 'warning',
        description: 'GET /api/users/42 è su disco, ma il runtime non lo serve. Il runtime non ha caricato il file.',
      });

      apiStub.createMocksFromMonitor
        .mockReturnValueOnce(of(createResult([captureItem({ id: 'endpoint-esistente', responseFile: null, writeOutcome: 'skipped' })], { created: 0, skipped: 1 })))
        .mockReturnValueOnce(of(createResult([captureItem({ id: 'endpoint-esistente', writeOutcome: 'variant_added', ...notServed })], { created: 0, addedVariants: 1 })));
      c.createMockFromEntry(ENTRIES[1]);
      c.confirmAddResponseToExisting();
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Scritto, ma non servito', tone: 'warning' });

      apiStub.createMocksFromMonitor.mockReturnValueOnce(of(createResult([captureItem(notServed), captureItem({ requestId: '3' })], { created: 2 })));
      c.toggleSelection('2');
      c.toggleSelection('3');
      c.createMocksFromSelected();
      expect(c.toast.toasts().at(-1)).toMatchObject({ tone: 'warning', description: '2 create, 1 non servite dal runtime' });
    });

    it('senza il runtime delle voci non crea niente', () => {
      const stream = TestBed.inject(MonitorStreamStore) as unknown as { runtimeId: () => string | null };
      const { c } = create();
      vi.spyOn(stream, 'runtimeId').mockReturnValue(null);
      c.createMockFromEntry(ENTRIES[1]);
      expect(apiStub.createMocksFromMonitor).not.toHaveBeenCalled();
      expect(c.toast.toasts().at(-1)).toMatchObject({ title: 'Monitor non ancora collegato' });
    });
  });

  it("la voce 'Backend vero' filtra tutto ciò che non è uscito da mock/handler", () => {
    const { c } = create();
    c.sourceFilter.set('real-backend');
    expect(c.filtered().map((e: RequestMonitorEntry) => e.id)).toEqual(['2', '3']); // id1 = mock
  });

  it('crea mock massivi con una sola richiesta, nell\'ordine di cattura, e svuota la selezione', () => {
    apiStub.createMocksFromMonitor.mockReset();
    apiStub.createMocksFromMonitor.mockReturnValue(of(createResult([captureItem({ requestId: '2' }), captureItem({ requestId: '3', writeOutcome: 'skipped' })], { created: 1, skipped: 1 })));
    const { c } = create();
    c.toggleSelection('3');
    c.toggleSelection('2');
    expect(c.selectedCount()).toBe(2);
    c.createMocksFromSelected();
    expect(apiStub.createMocksFromMonitor).toHaveBeenCalledTimes(1);
    expect(apiStub.createMocksFromMonitor.mock.calls[0][0]).toMatchObject({ ids: ['2', '3'], onConflict: 'skip', newEndpointEnabled: true });
    expect(c.toast.toasts().at(-1).description).toBe('1 create, 1 già esistenti');
    expect(c.selectedCount()).toBe(0);
  });

  // Come il catalogo: il clic sulla riga apre, quello sulla casella spunta; le azioni sulle voci
  // spuntate stanno in una barra in fondo alla lista, e non c'e' piu' una modalita' "Seleziona".
  describe('lista a selezione multipla', () => {
    function setup() {
      const created = create();
      const host = created.fixture.nativeElement as HTMLElement;
      const options = () => Array.from(host.querySelectorAll<HTMLElement>('[role="option"]'));
      const option = (id: string) => options().find((row) => row.dataset['entryId'] === id)!;
      const press = (key: string, shiftKey = false) => {
        const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
        (document.activeElement ?? host).dispatchEvent(event);
        created.fixture.detectChanges();
        return event;
      };
      const flush = async () => {
        await Promise.resolve();
        created.fixture.detectChanges();
      };
      return { ...created, host, options, option, press, flush };
    }
    const checked = (rows: HTMLElement[]) => rows.filter((row) => row.getAttribute('aria-selected') === 'true').map((row) => row.dataset['entryId']);

    it('è un listbox a selezione multipla; la voce aperta è corrente e l’unica raggiungibile col Tab', () => {
      const { host, options, option, fixture } = setup();
      const listbox = host.querySelector('[role="listbox"]')!;
      expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
      expect(listbox.getAttribute('aria-label')).toBe('Richieste catturate');

      option('2').click();
      fixture.detectChanges();
      expect(options().filter((row) => row.getAttribute('tabindex') === '0').map((row) => row.dataset['entryId'])).toEqual(['2']);
      expect(option('2').getAttribute('aria-current')).toBe('true');
      expect(host.textContent).not.toContain('Seleziona');
    });

    it('il clic sulla riga la apre senza spuntarla; il clic sulla casella la spunta senza aprirla', () => {
      const { c, option, fixture } = setup();
      option('2').click();
      fixture.detectChanges();
      expect(c.selected()?.id).toBe('2');
      expect(c.selectedCount()).toBe(0);

      option('3').querySelector<HTMLElement>('[data-check]')!.click();
      fixture.detectChanges();
      expect(c.selected()?.id).toBe('2');
      expect([...c.selectedIds()]).toEqual(['3']);
    });

    it('shift-clic sulla casella spunta l’intervallo dall’ultima spuntata', () => {
      const { options, fixture } = setup();
      const ids = options().map((row) => row.dataset['entryId']!);
      options()[0].querySelector<HTMLElement>('[data-check]')!.click();
      options()[2].querySelector<HTMLElement>('[data-check]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      fixture.detectChanges();
      expect(checked(options())).toEqual(ids);
    });

    it('le frecce aprono la voce successiva e le danno il fuoco; Spazio spunta, Maiuscole+Spazio l’intervallo', async () => {
      const { c, options, press, flush, fixture } = setup();
      const ids = options().map((row) => row.dataset['entryId']!);
      options()[0].click();
      fixture.detectChanges();
      options()[0].focus();

      const freccia = press('ArrowDown');
      await flush();
      expect(freccia.defaultPrevented).toBe(true);
      expect(c.selected()?.id).toBe(ids[1]);
      expect((document.activeElement as HTMLElement).dataset['entryId']).toBe(ids[1]);

      press(' ');
      expect(checked(options())).toEqual([ids[1]]);
      press('End');
      await flush();
      press(' ', true);
      expect(checked(options())).toEqual([ids[1], ids[2]]);
    });

    it('la barra in fondo alla lista compare con la selezione: crea i mock o la annulla', () => {
      const { c, host, option, fixture } = setup();
      const bar = () => Array.from(host.querySelectorAll('span')).find((span) => /selezionat/.test(span.textContent ?? ''));
      expect(bar()).toBeUndefined();

      option('2').querySelector<HTMLElement>('[data-check]')!.click();
      fixture.detectChanges();
      expect(bar()?.textContent?.trim()).toBe('1 selezionate');

      host.querySelector<HTMLButtonElement>('button[aria-label="Annulla la selezione"]')!.click();
      fixture.detectChanges();
      expect(c.selectedCount()).toBe(0);
      expect(bar()).toBeUndefined();
    });

    it('il path della riga si tronca in testa, e il filtro del metodo ha un nome', () => {
      const { host, option } = setup();
      const path = option('2').querySelector<HTMLElement>('[dir="rtl"]')!;
      expect(path.getAttribute('title')).toBe('/api/users/42');
      expect(path.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
      expect(host.querySelector('[aria-label="Filtra per metodo"]')).not.toBeNull();
    });
  });

  // Testata come il catalogo: nome della vista e conteggio; "Live" non si ripete, la pausa si'.
  describe('testata', () => {
    it('conta le richieste, e sotto filtro le mostrate sul totale', () => {
      const { fixture, c } = create();
      const host = fixture.nativeElement as HTMLElement;
      const badge = () => host.querySelector('ui-page-header ui-badge')?.textContent?.trim();
      expect(host.querySelector('h1')?.textContent?.trim()).toBe('Monitor');
      expect(badge()).toBe('3');
      c.search.set('payments');
      fixture.detectChanges();
      expect(badge()).toBe('1 di 3');
    });

    it('niente badge "Live"; "In pausa" solo a monitor fermo', () => {
      const { fixture } = create();
      const stream = TestBed.inject(MonitorStreamStore);
      const header = () => (fixture.nativeElement as HTMLElement).querySelector('ui-page-header')?.textContent ?? '';
      stream.setStreaming(true);
      fixture.detectChanges();
      expect(header()).not.toContain('Live');
      expect(header()).not.toContain('In pausa');
      stream.setStreaming(false);
      fixture.detectChanges();
      expect(header()).toContain('In pausa');
    });
  });

  describe('icone di provenienza', () => {
    it('ogni riga ha l\'icona della provenienza; in compatta il nome resta per lo screen reader', () => {
      const { fixture, c } = create();
      const host = fixture.nativeElement as HTMLElement;
      const mockRow = () => host.querySelector('[role="option"][data-entry-id="1"]') as HTMLElement; // la voce mock
      expect(c.sourceIcon('mock')).toBe('lucideFileText');
      expect(mockRow().querySelectorAll('ng-icon svg').length).toBeGreaterThan(0);
      c.toggleCompact();
      fixture.detectChanges();
      expect(mockRow().querySelector('.sr-only')?.textContent?.trim()).toBe('Mock');
    });

    it('il passo di una sequenza: nome e passo dietro l\'icona SEQ', () => {
      const { c } = create();
      const row = { ...ENTRIES[0], sequenceStep: { index: 1, count: 3, responseFile: '002.response.json' } };
      expect(c.compactSourceText(row)).toBe('Mock · SEQ 2/3');
      expect(c.compactSourceText(ENTRIES[1])).toBe('Proxy');
    });

    it('la risposta di un endpoint WebSocket non e\' fra le non mockate', () => {
      const { c } = create();
      expect(c.isUnmocked('ws')).toBe(false);
      expect(c.isUnmocked('backend')).toBe(true);
    });
  });
});
