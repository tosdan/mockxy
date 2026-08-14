import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
  };

  function create() {
    store = {
      selected: signal<MockDetail | undefined>(detail()),
      detailUnavailable: signal<string | undefined>(undefined),
      detailLoading: signal(false),
      savingId: signal<string | undefined>(undefined),
      error: signal<string | undefined>(undefined),
      reloadSelectedDetail: vi.fn(),
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

  it('con dettaglio leggibile mostra l’endpoint', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('/api/operazioni');
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
