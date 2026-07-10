import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MonitorNextPage } from './monitor-next.page';
import { translocoTesting } from '../../testing/transloco-testing';
import { MockAdminApiService } from '../../mock-admin-api.service';
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

const apiStub = {
  streamRequestMonitoring: () => of({ type: 'snapshot', items: ENTRIES }),
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

  it('carica le entry dallo snapshot live', () => {
    const { c } = create();
    expect(c.entries().length).toBe(3);
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

  it('crea un mock dalla request/response catturata', () => {
    apiStub.createMock.mockClear();
    const { c } = create();
    c.createMockFromEntry(ENTRIES[0]);
    expect(apiStub.createMock).toHaveBeenCalledTimes(1);
    const arg = apiStub.createMock.mock.calls[0][0];
    expect(arg.config).toEqual(expect.objectContaining({ method: 'POST', path: '/api/orders', status: 201, bodyFile: '001.response.json' }));
    expect(arg.body).toEqual({});
  });

  it('createMockFromEntry riporta il content-type della response e scarta gli header calcolati', () => {
    apiStub.createMock.mockClear();
    const { c } = create();
    c.createMockFromEntry(entry({ id: 'h', method: 'GET', status: 200, source: 'backend', originalUrl: '/api/x', responseHeaders: { 'content-type': 'application/xml', 'content-length': '123' }, responseBody: '<a/>' }));
    expect(apiStub.createMock).toHaveBeenCalledTimes(1);
    expect(apiStub.createMock.mock.calls[0][0].config['headers']).toEqual({ 'content-type': 'application/xml' });
  });

  it('createMockFromEntry crea uno skeleton (body vuoto + descrizione) per body troncati o binari', () => {
    apiStub.createMock.mockClear();
    const { c } = create();
    c.createMockFromEntry(entry({ id: 't', method: 'GET', status: 200, source: 'backend', responseBody: '{"a":1}', responseBodyTruncated: true }));
    c.createMockFromEntry(entry({ id: 'b', method: 'GET', status: 200, source: 'backend', responseBody: '[binary payload: 999 bytes]' }));
    expect(apiStub.createMock).toHaveBeenCalledTimes(2);
    for (const [req] of apiStub.createMock.mock.calls) {
      expect(req.body).toEqual({});
      expect(req.description).toContain('[da completare]');
    }
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

  it('il toast di creazione offre l\'azione "apri il mock creato" che naviga al catalogo', () => {
    apiStub.createMock.mockClear();
    apiStub.createMock.mockReturnValue(of({ id: 'nuovo', method: 'GET', path: '/api/users/42', disabled: false }) as never);
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const { c } = create();
    c.createMockFromEntry(ENTRIES[1]);

    const toast = c.toast.toasts().at(-1);
    expect(toast.action).toBeDefined();
    toast.action.run();
    expect(navSpy).toHaveBeenCalledWith(['/mocks'], { queryParams: { m: 'GET', p: '/api/users/42' } });
  });

  it('su 409 con existingMockId apre il dialog di conferma invece del toast di errore', () => {
    apiStub.createMock.mockClear();
    dialogStub.open.mockClear();
    apiStub.createMock.mockReturnValue(
      throwError(() => ({ status: 409, error: { details: { existingMockId: 'endpoint-esistente' } } })) as never,
    );

    const { c } = create();
    c.createMockFromEntry(ENTRIES[1]);

    expect(dialogStub.open).toHaveBeenCalledTimes(1);
    expect(c.mockExistsPrompt()).toMatchObject({ existingMockId: 'endpoint-esistente' });
  });

  it('la conferma aggiunge la response catturata come variante dell\'endpoint esistente', () => {
    apiStub.createMock.mockClear();
    apiStub.createResponse.mockClear();
    apiStub.createMock.mockReturnValue(
      throwError(() => ({ status: 409, error: { details: { existingMockId: 'endpoint-esistente' } } })) as never,
    );
    apiStub.createResponse.mockReturnValue(of({ id: 'endpoint-esistente', method: 'GET', path: '/api/users/42' }) as never);
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const { c } = create();
    c.createMockFromEntry(entry({ id: 'k', method: 'GET', status: 200, source: 'backend', originalUrl: '/api/users/42', responseHeaders: { 'content-type': 'application/json' }, responseBody: '{"v":2}' }));
    c.confirmAddResponseToExisting();

    expect(apiStub.createResponse).toHaveBeenCalledTimes(1);
    const [idArg, payloadArg] = apiStub.createResponse.mock.calls[0];
    expect(idArg).toBe('endpoint-esistente');
    expect(payloadArg).toMatchObject({ type: 'mock', status: 200, body: { v: 2 } });
    expect(payloadArg['title']).toContain('dal monitor');
    expect(c.mockExistsPrompt()).toBeNull();

    // Il toast di esito offre la navigazione al mock.
    const toast = c.toast.toasts().at(-1);
    toast.action.run();
    expect(navSpy).toHaveBeenCalledWith(['/mocks'], { queryParams: { m: 'GET', p: '/api/users/42' } });
  });

  it('l\'annullo chiude il dialog senza aggiungere varianti', () => {
    apiStub.createMock.mockClear();
    apiStub.createResponse.mockClear();
    apiStub.createMock.mockReturnValue(
      throwError(() => ({ status: 409, error: { details: { existingMockId: 'endpoint-esistente' } } })) as never,
    );

    const { c } = create();
    c.createMockFromEntry(ENTRIES[1]);
    c.cancelAddResponseToExisting();

    expect(apiStub.createResponse).not.toHaveBeenCalled();
    expect(c.mockExistsPrompt()).toBeNull();
  });

  it('un errore di creazione senza existingMockId mostra il toast di errore', () => {
    apiStub.createMock.mockClear();
    dialogStub.open.mockClear();
    apiStub.createMock.mockReturnValue(throwError(() => ({ status: 500, error: { message: 'boom' } })) as never);

    const { c } = create();
    c.createMockFromEntry(ENTRIES[1]);

    expect(dialogStub.open).not.toHaveBeenCalled();
    expect(c.toast.toasts().at(-1).tone).toBe('error');
  });

  it("la voce 'Backend vero' filtra tutto ciò che non è uscito da mock/handler", () => {
    const { c } = create();
    c.sourceFilter.set('real-backend');
    expect(c.filtered().map((e: RequestMonitorEntry) => e.id)).toEqual(['2', '3']); // id1 = mock
  });

  it('crea mock massivo dalle entry selezionate ed esce dalla selezione', () => {
    apiStub.createMock.mockClear();
    const { c } = create();
    c.enterSelection();
    c.toggleSelection('2');
    c.toggleSelection('3');
    expect(c.selectedCount()).toBe(2);
    c.createMocksFromSelected();
    expect(apiStub.createMock).toHaveBeenCalledTimes(2);
    expect(c.selectionMode()).toBe(false);
  });
});
