import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { MonitorNextPage } from './monitor-next.page';
import { translocoTesting } from '../../testing/transloco-testing';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { MonitorStreamStore } from '../../shared/monitor-stream.store';
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

describe('MonitorNextPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonitorNextPage, translocoTesting()],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: MockAdminApiService, useValue: apiStub }, { provide: UiDialog, useValue: dialogStub }],
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
    expect(c.errorCount()).toBe(1); // 502
    expect(c.avgLatency()).toBe(Math.round((12 + 88 + 31) / 3));
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
      c.enterSelection();
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
      c.enterSelection();
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

  it('crea mock massivi con una sola richiesta, nell\'ordine di cattura, ed esce dalla selezione', () => {
    apiStub.createMocksFromMonitor.mockReset();
    apiStub.createMocksFromMonitor.mockReturnValue(of(createResult([captureItem({ requestId: '2' }), captureItem({ requestId: '3', writeOutcome: 'skipped' })], { created: 1, skipped: 1 })));
    const { c } = create();
    c.enterSelection();
    c.toggleSelection('3');
    c.toggleSelection('2');
    expect(c.selectedCount()).toBe(2);
    c.createMocksFromSelected();
    expect(apiStub.createMocksFromMonitor).toHaveBeenCalledTimes(1);
    expect(apiStub.createMocksFromMonitor.mock.calls[0][0]).toMatchObject({ ids: ['2', '3'], onConflict: 'skip', newEndpointEnabled: true });
    expect(c.toast.toasts().at(-1).description).toBe('1 create, 1 già esistenti');
    expect(c.selectionMode()).toBe(false);
  });
});
