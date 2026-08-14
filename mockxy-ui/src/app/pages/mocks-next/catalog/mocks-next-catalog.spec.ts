import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { MocksNextCatalog } from './mocks-next-catalog';
import { MocksStore } from '../mocks-next.store';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { ViewStateService } from '../../../shared/view-state.service';
import { translocoTesting } from '../../../testing/transloco-testing';

// Il footer del catalogo è l'unico posto in cui l'utente viene a sapere che una definizione
// presente su disco NON è stata caricata: il rifiuto del formato legacy disabilita l'endpoint e
// manda il suo traffico al proxy, e senza questa riga succederebbe in silenzio.
describe('MocksNextCatalog — footer delle definizioni scartate', () => {
  function create() {
    const api = {
      listMocks: vi.fn(() => of({ items: [], collections: [], childOrder: {} })),
      getMock: vi.fn(),
    };
    const viewState = {
      read: vi.fn(() => null),
      write: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [MocksNextCatalog, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        MocksStore,
        { provide: MockAdminApiService, useValue: api },
        { provide: ViewStateService, useValue: viewState },
      ],
    });
    const fixture = TestBed.createComponent(MocksNextCatalog);
    const store = TestBed.inject(MocksStore);
    fixture.detectChanges();
    return { fixture, store };
  }

  function footerText(fixture: ReturnType<typeof create>['fixture']): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('senza definizioni scartate non mostra nulla', () => {
    const { fixture } = create();
    expect(footerText(fixture)).not.toContain('non caricat');
  });

  it('con definizioni scartate mostra il conteggio', () => {
    const { fixture, store } = create();
    store.loadErrors.set([
      { configFilePath: 'legacy/GET.endpoint.json', message: 'endpoint.sequence is no longer supported' },
      { configFilePath: 'rotto/POST.endpoint.json', message: 'Invalid JSON' },
    ]);
    fixture.detectChanges();

    expect(footerText(fixture)).toContain('2 non caricati');
  });

  it('il tooltip elenca file e motivo, uno per riga', () => {
    const { fixture, store } = create();
    store.loadErrors.set([
      { configFilePath: 'legacy/GET.endpoint.json', message: 'endpoint.sequence is no longer supported' },
      { configFilePath: 'rotto/POST.endpoint.json', message: 'Invalid JSON' },
    ]);
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tooltip: string = (fixture.componentInstance as any).loadErrorsTooltip();
    expect(tooltip).toBe(
      'legacy/GET.endpoint.json: endpoint.sequence is no longer supported\n' +
        'rotto/POST.endpoint.json: Invalid JSON',
    );
    // Il file e il motivo devono restare distinguibili: senza a capo preservati il tooltip
    // diventa un muro di testo (per questo ui-tooltip usa whitespace-pre-line).
    expect(tooltip.split('\n')).toHaveLength(2);
  });
});
