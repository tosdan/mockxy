import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MocksNextDetail } from './mocks-next-detail';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { MocksStore } from '../mocks-next.store';
import type { MockDetail } from '../../../mock-admin-api.types';

function detail(overrides: Partial<MockDetail> = {}): MockDetail {
  return {
    id: 'e1',
    type: 'mock',
    method: 'GET',
    path: '/api/operazioni',
    status: 200,
    disabled: false,
    configFilePath: 'operazioni/GET.endpoint.json',
    editable: true,
    selectedResponseFile: '001.response.json',
    responses: [{ fileName: '001.response.json', type: 'mock', title: 'Ok', selected: true }],
    endpoint: {
      method: 'GET',
      path: '/api/operazioni',
      enabled: true,
      responseFiles: ['001.response.json'],
      selectedResponseFile: '001.response.json',
    },
    config: { method: 'GET', path: '/api/operazioni', status: 200, disabled: false, headers: {}, delayMs: 0 },
    body: { ok: true },
    ...overrides,
  };
}

describe('MocksNextDetail', () => {
  let store: {
    selected: ReturnType<typeof signal<MockDetail | undefined>>;
    detailUnavailable: ReturnType<typeof signal<string | undefined>>;
    detailLoading: ReturnType<typeof signal<boolean>>;
    savingId: ReturnType<typeof signal<string | undefined>>;
    error: ReturnType<typeof signal<string | undefined>>;
    reloadSelectedDetail: ReturnType<typeof vi.fn>;
    collections: ReturnType<typeof signal<{ id: string; label: string }[]>>;
    saveResponse: ReturnType<typeof vi.fn>;
    assignCollection: ReturnType<typeof vi.fn>;
  };

  function create() {
    store = {
      selected: signal<MockDetail | undefined>(detail()),
      detailUnavailable: signal<string | undefined>(undefined),
      detailLoading: signal(false),
      savingId: signal<string | undefined>(undefined),
      error: signal<string | undefined>(undefined),
      reloadSelectedDetail: vi.fn(),
      collections: signal<{ id: string; label: string }[]>([]),
      saveResponse: vi.fn(),
      assignCollection: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [MocksNextDetail, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: MocksStore, useValue: store },
        { provide: MockAdminApiService, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(MocksNextDetail);
    fixture.detectChanges();
    return fixture;
  }

  // Il flag templated cambia il significato del body che si sta guardando: senza, i segnaposto
  // sono testo letterale. Viveva solo dentro il form di modifica, quindi in vista il body era
  // ambiguo. Il backend lo cancella sulle varianti file-backed: li' il controllo non va mostrato.
  describe('stato Template nella testata del body', () => {
    function chip(fixture: ReturnType<typeof create>): HTMLElement | null {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span')).find(
        (el) => /Template/i.test(el.textContent ?? '') && el.querySelector('ui-switch') != null,
      ) as HTMLElement | undefined ?? null;
    }

    it('compare su una variante mock e riflette il flag', () => {
      const fixture = create();
      expect(chip(fixture)).not.toBeNull();
      expect(chip(fixture)!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');

      store.selected.set(detail({ config: { method: 'GET', path: '/api/operazioni', status: 200, disabled: false, headers: {}, delayMs: 0, templated: true } }));
      fixture.detectChanges();
      expect(chip(fixture)!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    });

    it('commutarlo manda una PUT parziale, senza toccare il resto della variante', () => {
      const fixture = create();
      (fixture.componentInstance as unknown as { onTemplatedChange(v: boolean): void }).onTemplatedChange(true);

      expect(store.saveResponse).toHaveBeenCalledWith({ type: 'mock', status: 200, templated: true });
    });

    it('non compare su una variante agganciata a un file: li il backend cancella il flag', () => {
      const fixture = create();
      store.selected.set(detail({ payloadType: 'file', fileInfo: { name: 'logo.png' } } as never));
      fixture.detectChanges();

      expect(chip(fixture)).toBeNull();
    });

    it('non compare su handler e middleware, che la risposta la producono da codice', () => {
      const fixture = create();
      for (const type of ['handler', 'middleware'] as const) {
        store.selected.set(detail({ type, source: 'module.exports = {};' }));
        fixture.detectChanges();
        expect(chip(fixture)).toBeNull();
      }
    });

    it('su un endpoint non modificabile lo mostra solo se acceso, e non lo lascia commutare', () => {
      const fixture = create();
      store.selected.set(detail({ editable: false }));
      fixture.detectChanges();
      expect(chip(fixture)).toBeNull();

      store.selected.set(detail({ editable: false, config: { method: 'GET', path: '/api/operazioni', status: 200, disabled: false, headers: {}, delayMs: 0, templated: true } }));
      fixture.detectChanges();
      expect(chip(fixture)).not.toBeNull();
      // Che sia disabilitato si vede dal fatto che non scrive: e' quello che conta.
      chip(fixture)!.querySelector<HTMLElement>('[role="switch"]')!.click();
      expect(store.saveResponse).not.toHaveBeenCalled();
    });
  });

  // Status e delay sono le due cose che si ritoccano di continuo: modificarle qui deve costare una
  // PUT PARZIALE, cosi' il merge del backend lascia intatti body, headers, titolo e flag template.
  describe('status e delay modificabili in posto', () => {
    function statusButton(fixture: ReturnType<typeof create>): HTMLButtonElement {
      return (fixture.nativeElement as HTMLElement).querySelector('mocks-next-status-combobox button')!;
    }
    function delayInput(fixture: ReturnType<typeof create>): HTMLInputElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('input[type="number"]');
    }

    it('cambiare lo status manda solo tipo e status', () => {
      const fixture = create();
      (fixture.componentInstance as unknown as { onStatusChange(s: number | null): void }).onStatusChange(500);

      expect(store.saveResponse).toHaveBeenCalledTimes(1);
      expect(store.saveResponse).toHaveBeenCalledWith({ type: 'mock', status: 500 });
    });

    it('cambiare il delay rispedisce lo status corrente, che il tipo della richiesta esige', () => {
      const fixture = create();
      (fixture.componentInstance as unknown as { onDelayChange(v: string): void }).onDelayChange('250');

      expect(store.saveResponse).toHaveBeenCalledWith({ type: 'mock', status: 200, delayMs: 250 });
    });

    it('non manda nulla per un valore uguale a quello corrente o non valido', () => {
      const fixture = create();
      const api = fixture.componentInstance as unknown as {
        onStatusChange(s: number | null): void;
        onDelayChange(v: string): void;
      };

      api.onStatusChange(200);
      api.onStatusChange(null);
      api.onDelayChange('0');
      api.onDelayChange('-5');
      api.onDelayChange('abc');

      expect(store.saveResponse).not.toHaveBeenCalled();
    });

    it('un handler non offre i controlli in posto: non ha uno status suo da riscrivere', () => {
      const fixture = create();
      store.selected.set(detail({ type: 'handler', source: 'module.exports = {};' }));
      fixture.detectChanges();

      expect(delayInput(fixture)).toBeNull();
      expect(statusButton(fixture)?.getAttribute('aria-disabled') ?? 'assente').toBeDefined();
    });

    it('un endpoint non modificabile li mostra in sola lettura', () => {
      const fixture = create();
      store.selected.set(detail({ editable: false }));
      fixture.detectChanges();

      expect(delayInput(fixture)).toBeNull();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('delay');
    });
  });

  it('con dettaglio leggibile mostra l’endpoint', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('/api/operazioni');
  });

  it('mostra la sorgente di un handler con il linguaggio JavaScript', () => {
    const fixture = create();
    store.selected.set(
      detail({
        type: 'handler',
        source: 'module.exports = { async resolveResponse() { return { status: 200 }; } };',
      }),
    );
    fixture.detectChanges();

    const code = fixture.debugElement.query(By.css('ui-code'));
    expect(code).not.toBeNull();
    expect(code.componentInstance.language()).toBe('javascript');
    expect(code.nativeElement.querySelector('[style*="--json-key"]')).not.toBeNull();
  });

  // Il pannello non deve mostrare il dettaglio precedente dopo una mutazione riuscita di cui non
  // si riesce a leggere l'esito: al suo posto dichiara l'illeggibilità e offre di rileggere.
  it('con dettaglio non componibile sostituisce il pannello, mostra il motivo e offre la rilettura', () => {
    const fixture = create();
    store.detailUnavailable.set('Invalid JSON in /mocks/operazioni/GET.responses/002.response.json');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Invalid JSON in /mocks/operazioni/GET.responses/002.response.json');
    expect(root.textContent).not.toContain('/api/operazioni');

    const retry = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Rileggi'),
    );
    expect(retry).toBeTruthy();
    retry?.click();
    expect(store.reloadSelectedDetail).toHaveBeenCalledTimes(1);
  });

  it('una variante illeggibile è elencata come tale e non è selezionabile', () => {
    const fixture = create();
    store.selected.set(
      detail({
        responses: [
          { fileName: '001.response.json', type: 'mock', title: 'Ok', selected: true },
          { fileName: '002.response.json', invalid: true, error: 'Invalid JSON in 002.response.json' },
        ],
      }),
    );
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (fixture.componentInstance as any).responseOptions();
    expect(options[1]).toMatchObject({ value: '002.response.json', disabled: true });
    expect(options[1].label).toContain('non leggibile');
  });
});
