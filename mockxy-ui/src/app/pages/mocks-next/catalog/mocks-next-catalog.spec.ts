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

  describe('pulsante di reset del filtro', () => {
    function clearButton(fixture: ReturnType<typeof create>['fixture']): HTMLButtonElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('label button[type="button"]');
    }

    it('a filtro vuoto non compare', () => {
      const { fixture } = create();
      expect(clearButton(fixture)).toBeNull();
    });

    it('compare quando il filtro ha del testo e lo svuota in un colpo', () => {
      const { fixture, store } = create();
      store.searchTerm.set('utenti');
      fixture.detectChanges();

      const button = clearButton(fixture);
      expect(button).not.toBeNull();
      expect(button?.getAttribute('aria-label')).toBe('Svuota il filtro');

      button?.click();
      fixture.detectChanges();

      expect(store.searchTerm()).toBe('');
      expect(clearButton(fixture)).toBeNull();
    });

    it('dopo lo svuotamento il fuoco resta nel campo, pronto per riscrivere', () => {
      const { fixture, store } = create();
      store.searchTerm.set('utenti');
      fixture.detectChanges();

      clearButton(fixture)?.click();

      const input = (fixture.nativeElement as HTMLElement).querySelector('label input');
      expect(document.activeElement).toBe(input);
    });
  });

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
