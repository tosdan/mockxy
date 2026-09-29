import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError, type Observable } from 'rxjs';
import type { Mock } from 'vitest';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RuntimeStatusReport } from '../mock-admin-api.types';
import { fakeRuntimeSync } from '../testing/runtime-sync-testing';
import { READ_RETRY_MAX_MS, READ_RETRY_MIN_MS } from './read-retry';
import { RuntimeDiagnosticsStore } from './runtime-diagnostics.store';

function report(overrides: Partial<RuntimeStatusReport> = {}): RuntimeStatusReport {
  return {
    runtimeId: 'runtime-1',
    lastAttempt: { id: 1, startedAt: 'a', completedAt: 'b', reasons: ['startup'], status: 'applied' },
    lastAppliedAttemptId: 1,
    errors: [],
    fatalError: null,
    ...overrides,
  };
}

const RETAINED = { endpointId: 'e1', filePath: 'users/GET.endpoint.json', message: "Unexpected token '{'", serving: 'retained' as const };

describe('RuntimeDiagnosticsStore', () => {
  let getRuntimeStatus: Mock<() => Observable<RuntimeStatusReport>>;
  let sync: ReturnType<typeof fakeRuntimeSync>;

  function create() {
    sync = fakeRuntimeSync();
    TestBed.configureTestingModule({
      providers: [sync.provider, { provide: MockAdminApiService, useValue: { getRuntimeStatus } }],
    });
    return TestBed.inject(RuntimeDiagnosticsStore);
  }

  beforeEach(() => {
    getRuntimeStatus = vi.fn(() => of(report()));
  });

  it('legge l’esito all’avvio e lo rilegge quando cambia la diagnostica, anche con la vecchia rotta servita', () => {
    const store = create();
    expect(store.hasProblems()).toBe(false);

    getRuntimeStatus.mockReturnValueOnce(of(report({ errors: [RETAINED] })));
    sync.revisions('diagnostics');

    expect(store.errors()).toEqual([RETAINED]);
    expect(store.hasProblems()).toBe(true);
  });

  it('non rilegge per revisioni che non lo riguardano; rilegge al focus e a ogni nuovo runtime', () => {
    create();
    sync.revisions('server', 'catalog');
    expect(getRuntimeStatus).toHaveBeenCalledTimes(1);
    sync.resync();
    sync.runtime();
    expect(getRuntimeStatus).toHaveBeenCalledTimes(3);
  });

  it('un caricamento fallito nel suo insieme è un problema anche senza errori di file', () => {
    getRuntimeStatus.mockReturnValue(of(report({ fatalError: { message: 'boom' } })));
    const store = create();
    expect(store.fatalError()).toEqual({ message: 'boom' });
    expect(store.hasProblems()).toBe(true);
  });

  it('una richiesta alla volta, con una sola in coda; un errore lascia l’ultimo esito', () => {
    const slow = new Subject<RuntimeStatusReport>();
    getRuntimeStatus.mockReturnValueOnce(slow);
    const store = create();
    sync.revisions('diagnostics');
    sync.revisions('diagnostics');
    expect(getRuntimeStatus).toHaveBeenCalledTimes(1);

    slow.next(report({ errors: [RETAINED] }));
    slow.complete();
    expect(getRuntimeStatus).toHaveBeenCalledTimes(2);

    getRuntimeStatus.mockReturnValueOnce(throwError(() => new Error('down')));
    sync.resync();
    expect(store.errors()).toEqual([]);
  });

  // La revisione nuova è già stata vista: senza un nuovo tentativo il polling non chiederebbe più
  // di rileggere, e la status bar resterebbe indietro.
  it('una lettura fallita si ritenta da sola, con attese crescenti, finché riesce', () => {
    vi.useFakeTimers();
    try {
      const store = create();
      getRuntimeStatus.mockReturnValueOnce(throwError(() => ({ status: 503 })));
      getRuntimeStatus.mockReturnValueOnce(throwError(() => ({ status: 503 })));
      getRuntimeStatus.mockReturnValue(of(report({ errors: [RETAINED] })));

      sync.revisions('diagnostics');
      vi.advanceTimersByTime(READ_RETRY_MIN_MS);
      expect(getRuntimeStatus).toHaveBeenCalledTimes(3);
      expect(store.hasProblems()).toBe(false);
      vi.advanceTimersByTime(2 * READ_RETRY_MIN_MS);
      expect(getRuntimeStatus).toHaveBeenCalledTimes(4);
      expect(store.errors()).toEqual([RETAINED]);

      vi.advanceTimersByTime(READ_RETRY_MAX_MS);
      expect(getRuntimeStatus).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
