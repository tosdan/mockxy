import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError, type Observable } from 'rxjs';
import type { Mock } from 'vitest';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RuntimeConfigPatch, RuntimeConfigState } from '../mock-admin-api.types';
import { fakeRuntimeSync } from '../testing/runtime-sync-testing';
import { runtimeConfigState } from '../testing/runtime-config-testing';
import { translocoTesting } from '../testing/transloco-testing';
import { ToastService } from '../ui/ui-toast/ui-toast';
import { RuntimeConfigStore } from './runtime-config.store';

// Configurazione del runtime per la GUI (piano agent/API, §13 C8).
describe('RuntimeConfigStore', () => {
  let getRuntimeConfig: Mock<() => Observable<RuntimeConfigState>>;
  let patchRuntimeConfig: Mock<(patch: RuntimeConfigPatch) => Observable<RuntimeConfigState>>;
  let sync: ReturnType<typeof fakeRuntimeSync>;

  function create() {
    sync = fakeRuntimeSync();
    TestBed.configureTestingModule({
      imports: [translocoTesting()],
      providers: [sync.provider, { provide: MockAdminApiService, useValue: { getRuntimeConfig, patchRuntimeConfig } }],
    });
    return TestBed.inject(RuntimeConfigStore);
  }

  beforeEach(() => {
    getRuntimeConfig = vi.fn(() => of(runtimeConfigState()));
    patchRuntimeConfig = vi.fn(() => of(runtimeConfigState()));
  });

  it('legge la configurazione e conta gli override, nell’ordine del server', () => {
    getRuntimeConfig.mockReturnValue(of(runtimeConfigState({ requestTimeoutMs: 500, backendUrl: null })));
    const store = create();
    expect(store.overrideKeys()).toEqual(['backendUrl', 'requestTimeoutMs']);
    expect(store.overrideCount()).toBe(2);
  });

  it('rilegge quando cambia la revisione config, al focus e a ogni nuovo runtime, che riparte senza override', () => {
    const store = create();
    getRuntimeConfig.mockReturnValue(of(runtimeConfigState({ corsEnabled: true })));
    sync.revisions('catalog', 'server');
    expect(getRuntimeConfig).toHaveBeenCalledTimes(1);
    sync.revisions('config');
    expect(store.overrideKeys()).toEqual(['corsEnabled']);

    getRuntimeConfig.mockReturnValue(of(runtimeConfigState()));
    sync.runtime();
    expect(store.overrideCount()).toBe(0);
    sync.resync();
    expect(getRuntimeConfig).toHaveBeenCalledTimes(4);
  });

  it('il ritorno ai valori di avvio toglie gli override indicati e usa la risposta', () => {
    getRuntimeConfig.mockReturnValue(of(runtimeConfigState({ corsEnabled: true, globalDelayMs: 300 })));
    patchRuntimeConfig.mockReturnValue(of(runtimeConfigState({ globalDelayMs: 300 })));
    const store = create();

    store.reset(['corsEnabled']);

    expect(patchRuntimeConfig).toHaveBeenCalledWith({ unset: ['corsEnabled'] });
    expect(store.overrideKeys()).toEqual(['globalDelayMs']);
  });

  it('una lettura partita prima di un ripristino riuscito non riporta indietro lo stato', () => {
    const store = create();
    getRuntimeConfig.mockReset();
    const stale = new Subject<RuntimeConfigState>();
    getRuntimeConfig.mockReturnValue(stale);
    sync.revisions('config');

    patchRuntimeConfig.mockReturnValue(of(runtimeConfigState()));
    store.reset(['corsEnabled']);
    stale.next(runtimeConfigState({ corsEnabled: true }));
    stale.complete();

    expect(store.overrideCount()).toBe(0);
  });

  it('un ripristino rifiutato lo dice e lascia lo stato com’era', () => {
    getRuntimeConfig.mockReturnValue(of(runtimeConfigState({ corsEnabled: true })));
    patchRuntimeConfig.mockReturnValue(throwError(() => ({ status: 500, error: { message: 'boom' } })));
    const store = create();

    store.reset(['corsEnabled']);

    expect(store.overrideKeys()).toEqual(['corsEnabled']);
    expect(store.resetting()).toBe(false);
    expect(TestBed.inject(ToastService).toasts().at(-1)).toMatchObject({ title: 'Ripristino non riuscito', description: 'boom', tone: 'error' });
  });
});
