import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MonitorDumpStore } from './monitor-dump.store';
import { MockAdminApiService } from '../mock-admin-api.service';
import { ToastService } from '../ui/ui-toast/ui-toast';
import type { MonitorDumpState } from '../mock-admin-api.types';
import { translocoTesting } from '../testing/transloco-testing';

function dumpState(overrides: Partial<MonitorDumpState> = {}): MonitorDumpState {
  return { enabled: false, intervalMs: 5000, threshold: 100, currentFile: null, pendingCount: 0, ...overrides };
}

describe('MonitorDumpStore', () => {
  let apiStub: {
    getMonitorDumpState: ReturnType<typeof vi.fn>;
    setMonitorDumpState: ReturnType<typeof vi.fn>;
    flushMonitorDump: ReturnType<typeof vi.fn>;
  };
  let toastStub: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    apiStub = {
      getMonitorDumpState: vi.fn(() => of(dumpState({ enabled: false }))),
      setMonitorDumpState: vi.fn((req: { enabled?: boolean }) => of(dumpState({ enabled: req.enabled ?? false }))),
      flushMonitorDump: vi.fn(() => of({ flushed: 0 })),
    };
    toastStub = { show: vi.fn(), dismiss: vi.fn() };
    TestBed.configureTestingModule({
      imports: [translocoTesting()],
      providers: [
        { provide: MockAdminApiService, useValue: apiStub },
        { provide: ToastService, useValue: toastStub },
      ],
    });
  });

  // Lo store è root-scoped e nel costruttore chiama load(): l'inject fa già partire getMonitorDumpState().
  function create() {
    return TestBed.inject(MonitorDumpStore);
  }

  it('parte con il dump disattivato, caricando lo stato dal backend', () => {
    const store = create();
    expect(apiStub.getMonitorDumpState).toHaveBeenCalledTimes(1);
    expect(store.enabled()).toBe(false);
    expect(store.state()).toEqual(dumpState({ enabled: false }));
    expect(store.available()).toBe(true); // stato caricato → la barra mostra il controllo
  });

  it('senza dump dal backend lo stato resta nullo e il dump risulta non disponibile', () => {
    apiStub.getMonitorDumpState.mockReturnValueOnce(throwError(() => new Error('no dump')));
    const store = create();
    expect(store.state()).toBeNull();
    expect(store.available()).toBe(false);
    expect(store.enabled()).toBe(false); // default a disattivato quando lo stato è nullo
  });

  it('setEnabled(true) attiva il dump via API e aggiorna il signal di stato', () => {
    const store = create();
    store.setEnabled(true);
    expect(apiStub.setMonitorDumpState).toHaveBeenCalledTimes(1);
    expect(apiStub.setMonitorDumpState).toHaveBeenCalledWith({ enabled: true });
    expect(store.enabled()).toBe(true);
    expect(store.state()?.enabled).toBe(true);
  });

  it('setEnabled(false) disattiva il dump via API e aggiorna il signal di stato', () => {
    const store = create();
    store.setEnabled(true);
    store.setEnabled(false);
    expect(apiStub.setMonitorDumpState).toHaveBeenCalledTimes(2);
    expect(apiStub.setMonitorDumpState).toHaveBeenLastCalledWith({ enabled: false });
    expect(store.enabled()).toBe(false);
    expect(store.state()?.enabled).toBe(false);
  });

  it('flush scrive subito il pending su disco via API', () => {
    const store = create();
    store.flush();
    expect(apiStub.flushMonitorDump).toHaveBeenCalledTimes(1);
  });
});
