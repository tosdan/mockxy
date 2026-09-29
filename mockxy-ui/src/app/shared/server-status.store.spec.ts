import { TestBed } from '@angular/core/testing';
import { Subject, of, type Observable } from 'rxjs';
import type { Mock } from 'vitest';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { ServerState } from '../mock-admin-api.types';
import { ToastService } from '../ui/ui-toast/ui-toast';
import { fakeRuntimeSync } from '../testing/runtime-sync-testing';
import { translocoTesting } from '../testing/transloco-testing';
import { ServerStatusStore } from './server-status.store';

describe('ServerStatusStore — sincronizzazione', () => {
  let getServerState: Mock<() => Observable<ServerState>>;
  let updateServerState: Mock<(patch: Partial<ServerState>) => Observable<ServerState>>;
  let sync: ReturnType<typeof fakeRuntimeSync>;

  function create() {
    sync = fakeRuntimeSync();
    TestBed.configureTestingModule({
      imports: [translocoTesting()],
      providers: [
        sync.provider,
        { provide: MockAdminApiService, useValue: { getServerState, updateServerState } },
        { provide: ToastService, useValue: { show: vi.fn(), dismiss: vi.fn() } },
      ],
    });
    return TestBed.inject(ServerStatusStore);
  }

  beforeEach(() => {
    getServerState = vi.fn(() => of({ serverEnabled: true, proxyAll: false }));
    updateServerState = vi.fn((patch) => of({ serverEnabled: true, proxyAll: false, ...patch }));
  });

  it('dopo un riavvio del motore Proxy All torna quello vero senza ricaricare la pagina', () => {
    const store = create();
    store.setProxyAll(true);
    expect(store.proxyAll()).toBe(true);

    // Il motore è ripartito col valore di default.
    getServerState.mockReturnValue(of({ serverEnabled: true, proxyAll: false }));
    sync.runtime();

    expect(store.proxyAll()).toBe(false);
  });

  it('rilegge quando cambia la revisione del server, non per le altre', () => {
    const store = create();
    getServerState.mockReturnValue(of({ serverEnabled: false, proxyAll: true }));
    sync.revisions('catalog');
    expect(store.proxyAll()).toBe(false);

    sync.revisions('server');
    expect(store.proxyAll()).toBe(true);
    expect(store.serverEnabled()).toBe(false);
    expect(store.loading()).toBe(false);
  });

  it('una rilettura partita prima di una modifica dell’utente non la sovrascrive', () => {
    const store = create();
    const late = new Subject<ServerState>();
    getServerState.mockReturnValueOnce(late);
    sync.revisions('server');

    store.setProxyAll(true);
    late.next({ serverEnabled: true, proxyAll: false });

    expect(store.proxyAll()).toBe(true);
  });

  it('con una modifica in volo non rilegge', () => {
    const store = create();
    const pending = new Subject<ServerState>();
    updateServerState.mockReturnValueOnce(pending);
    store.setProxyAll(true);
    getServerState.mockClear();

    sync.revisions('server');
    expect(getServerState).not.toHaveBeenCalled();

    pending.next({ serverEnabled: true, proxyAll: true });
    pending.complete();
    sync.revisions('server');
    expect(getServerState).toHaveBeenCalledTimes(1);
    expect(store.proxyAll()).toBe(false);
  });

  it('due riletture sovrapposte: vince la più recente anche se la prima arriva dopo', () => {
    const store = create();
    const first = new Subject<ServerState>();
    const second = new Subject<ServerState>();
    getServerState.mockReturnValueOnce(first).mockReturnValueOnce(second);
    sync.revisions('server');
    sync.revisions('server');

    second.next({ serverEnabled: true, proxyAll: true });
    first.next({ serverEnabled: true, proxyAll: false });

    expect(store.proxyAll()).toBe(true);
  });

  it('il caricamento iniziale superato da una rilettura non ripristina il valore vecchio', () => {
    const initial = new Subject<ServerState>();
    getServerState.mockReturnValueOnce(initial);
    const store = create();
    getServerState.mockReturnValueOnce(of({ serverEnabled: true, proxyAll: true }));
    sync.resync();

    initial.next({ serverEnabled: true, proxyAll: false });
    expect(store.proxyAll()).toBe(true);
  });
});
