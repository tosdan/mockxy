import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ActivationStore } from './activation.store';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { ActivationItem } from '../mock-admin-api.types';
import { ToastService } from '../ui/ui-toast/ui-toast';
import { translocoTesting } from '../testing/transloco-testing';
import { fakeRuntimeSync } from '../testing/runtime-sync-testing';

// Attivazioni temporanee viste dall'interfaccia: si leggono dal motore, e si rileggono quando
// qualcun altro (un test, via API) le cambia.
describe('ActivationStore', () => {
  const ordini: ActivationItem = { id: 'ordini', method: 'GET', path: '/ordini', enabled: true };
  const utenti: ActivationItem = { id: 'utenti', method: 'GET', path: '/utenti', responseFile: '002.response.json' };
  let sync: ReturnType<typeof fakeRuntimeSync>;
  let api: {
    getActivation: ReturnType<typeof vi.fn>;
    patchActivation: ReturnType<typeof vi.fn>;
    clearActivation: ReturnType<typeof vi.fn>;
  };
  let toast: { show: ReturnType<typeof vi.fn> };

  function create(items: ActivationItem[] = []) {
    sync = fakeRuntimeSync();
    api = {
      getActivation: vi.fn(() => of({ revision: 1, items })),
      patchActivation: vi.fn(() => of({ revision: 2, items: [ordini] })),
      clearActivation: vi.fn(() => of({ revision: 3, items: [] })),
    };
    toast = { show: vi.fn() };
    TestBed.configureTestingModule({
      imports: [translocoTesting()],
      providers: [sync.provider, { provide: MockAdminApiService, useValue: api }, { provide: ToastService, useValue: toast }],
    });
    return TestBed.inject(ActivationStore);
  }

  it('legge le attivazioni alla partenza e le trova per metodo e percorso', () => {
    const store = create([ordini, utenti]);

    expect(store.count()).toBe(2);
    expect(store.of({ method: 'get', path: '/utenti' })).toEqual(utenti);
    expect(store.of({ method: 'POST', path: '/utenti' })).toBeUndefined();
    expect(store.of({ method: 'GET', path: '/altro' })).toBeUndefined();
  });

  // L'id di catalogo è il percorso del file: spostando la cartella cambia, e il catalogo si
  // rilegge, ma la revisione delle attivazioni non si muove. L'endpoint è sempre lo stesso.
  it("ritrova l'attivazione anche se nel frattempo l'id di catalogo dell'endpoint è cambiato", () => {
    const store = create([ordini]);

    sync.revisions('catalog');

    expect(api.getActivation).toHaveBeenCalledTimes(1);
    expect(store.of({ method: 'GET', path: '/ordini' })).toEqual(ordini);
  });

  it('si rilegge quando la revisione delle attivazioni cambia, non per le altre', () => {
    const store = create();
    api.getActivation.mockReturnValue(of({ revision: 2, items: [ordini] }));

    sync.revisions('catalog');
    expect(store.count()).toBe(0);

    sync.revisions('activation');
    expect(store.count()).toBe(1);
  });

  it('un runtime nuovo riparte senza attivazioni: si rilegge', () => {
    const store = create([ordini]);
    api.getActivation.mockReturnValue(of({ revision: 1, items: [] }));

    sync.runtime();

    expect(store.count()).toBe(0);
  });

  it('ritoccare un endpoint applica lo stato restituito dal motore', () => {
    const store = create();

    store.set({ id: 'ordini', enabled: true });

    expect(api.patchActivation).toHaveBeenCalledWith([{ id: 'ordini', enabled: true }]);
    expect(store.items()).toEqual([ordini]);
  });

  it('togliere lo stato temporaneo di un endpoint azzera entrambi i campi', () => {
    const store = create([ordini]);
    api.patchActivation.mockReturnValue(of({ revision: 2, items: [] }));

    store.remove('ordini');

    expect(api.patchActivation).toHaveBeenCalledWith([{ id: 'ordini', enabled: null, responseFile: null }]);
    expect(store.count()).toBe(0);
  });

  it('azzerare riporta tutto a come è salvato', () => {
    const store = create([ordini, utenti]);

    store.clear();

    expect(api.clearActivation).toHaveBeenCalledTimes(1);
    expect(store.count()).toBe(0);
  });

  it('un rifiuto del motore lascia lo stato di prima e lo dice', () => {
    const store = create([ordini]);
    api.patchActivation.mockReturnValue(throwError(() => ({ error: { message: 'variante che non si carica' } })));

    store.set({ id: 'ordini', responseFile: '003.response.json' });

    expect(store.items()).toEqual([ordini]);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stato temporaneo non applicato', tone: 'error' }));
    expect(store.busy()).toBe(false);
  });
});
