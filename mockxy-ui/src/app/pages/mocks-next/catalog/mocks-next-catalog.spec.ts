import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { MocksNextCatalog } from './mocks-next-catalog';
import { MocksStore } from '../mocks-next.store';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { ViewStateService } from '../../../shared/view-state.service';
import { translocoTesting } from '../../../testing/transloco-testing';

describe('MocksNextCatalog', () => {
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

  /** Voci del menu CDK aperto (vivono nell'overlay, fuori dal fixture). */
  function menuItems(): HTMLButtonElement[] {
    return Array.from(document.querySelectorAll('.cdk-overlay-container [ui-menu] button'));
  }

  function headerButton(fixture: ReturnType<typeof create>['fixture'], label: string): HTMLButtonElement {
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    );
    const found = buttons.find(
      (b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label,
    );
    if (!found) throw new Error('pulsante non trovato: ' + label);
    return found;
  }

  // La testata ha un solo punto di creazione: quello che prima era sparso fra la topbar di pagina
  // ("Nuovo", "Importa OpenAPI") e le icone della testata ("Nuova collection") sta in un menu solo.
  describe('menu Nuovo', () => {
    function openNew(fixture: ReturnType<typeof create>['fixture']) {
      headerButton(fixture, 'Nuovo').click();
      fixture.detectChanges();
    }

    it('elenca i tre tipi di definizione, la collection e l import OpenAPI', () => {
      const { fixture } = create();
      openNew(fixture);
      expect(menuItems().map((b) => b.textContent?.trim())).toEqual([
        'Mock',
        'Handler',
        'Middleware',
        'Nuova collection',
        'Importa OpenAPI',
      ]);
    });

    it('chiede alla pagina di creare, con il tipo scelto', () => {
      const { fixture } = create();
      const chiesti: string[] = [];
      fixture.componentInstance.create.subscribe((type) => chiesti.push(type));

      for (const label of ['Mock', 'Handler', 'Middleware']) {
        openNew(fixture);
        menuItems().find((b) => b.textContent?.trim() === label)!.click();
        fixture.detectChanges();
      }

      expect(chiesti).toEqual(['mock', 'handler', 'middleware']);
    });

    it('chiede alla pagina l import OpenAPI', () => {
      const { fixture } = create();
      let chiesto = 0;
      fixture.componentInstance.importOpenapi.subscribe(() => (chiesto += 1));

      openNew(fixture);
      menuItems().find((b) => b.textContent?.includes('Importa OpenAPI'))!.click();
      fixture.detectChanges();

      expect(chiesto).toBe(1);
    });

    it('la collection resta interna al catalogo: apre l input inline', () => {
      const { fixture } = create();
      openNew(fixture);
      menuItems().find((b) => b.textContent?.includes('Nuova collection'))!.click();
      fixture.detectChanges();

      const input = (fixture.nativeElement as HTMLElement).querySelector('input[placeholder="Nome collection…"]');
      expect(input).not.toBeNull();
    });
  });

  // Ricarica/espandi/collassa sono rare: scendono nel menu "…" invece di stare in barra con lo
  // stesso peso visivo dei filtri, che si usano di continuo.
  describe('menu delle azioni di vista', () => {
    it('offre ricarica, espandi e collassa', () => {
      const { fixture } = create();
      headerButton(fixture, 'Azioni di vista').click();
      fixture.detectChanges();

      expect(menuItems().map((b) => b.textContent?.trim())).toEqual([
        'Ricarica dal disco',
        'Espandi tutte le cartelle',
        'Collassa tutte le cartelle',
      ]);
    });

    it('ricarica rilegge il catalogo dal backend', () => {
      const { fixture } = create();
      const api = TestBed.inject(MockAdminApiService) as unknown as { listMocks: { mock: { calls: unknown[] } } };
      const prima = api.listMocks.mock.calls.length;

      headerButton(fixture, 'Azioni di vista').click();
      fixture.detectChanges();
      menuItems().find((b) => b.textContent?.includes('Ricarica'))!.click();
      fixture.detectChanges();

      expect(api.listMocks.mock.calls.length).toBe(prima + 1);
    });
  });

  // I filtri stanno in chiaro nella testata: prima erano chiusi in un menu e li segnalava solo un
  // pallino rosso, quindi non si poteva sapere COSA fosse filtrato senza aprirlo.
  describe('filtri in chiaro', () => {
    function radios(fixture: ReturnType<typeof create>['fixture']): HTMLButtonElement[] {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="radio"]'));
    }
    function typeButton(fixture: ReturnType<typeof create>['fixture']): HTMLButtonElement {
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
      ).find((b) => b.textContent?.includes('Tipo:'))!;
    }
    function resetButton(fixture: ReturnType<typeof create>['fixture']): HTMLButtonElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Reimposta filtri"]');
    }

    it('lo stato è un segmentato che dice quale voce è scelta', () => {
      const { fixture, store } = create();
      expect(radios(fixture).map((b) => b.textContent?.trim())).toEqual(['Tutti', 'Attivi', 'Disattivi']);
      expect(radios(fixture).map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);

      store.statusFilter.set('off');
      fixture.detectChanges();
      expect(radios(fixture).map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    });

    it('il segmentato scrive sullo stato del catalogo', () => {
      const { fixture, store } = create();
      radios(fixture).find((b) => b.textContent?.trim() === 'Attivi')!.click();
      fixture.detectChanges();
      expect(store.statusFilter()).toBe('on');
    });

    it('il pulsante del tipo mostra il tipo scelto, non un pallino', () => {
      const { fixture, store } = create();
      expect(typeButton(fixture).textContent).toContain('Tutti');

      store.typeFilter.set('handler');
      fixture.detectChanges();
      expect(typeButton(fixture).textContent).toContain('Handler');
    });

    it('il reset compare solo con un filtro acceso, e li riporta entrambi a "tutti"', () => {
      const { fixture, store } = create();
      expect(resetButton(fixture)).toBeNull();

      store.typeFilter.set('handler');
      store.statusFilter.set('off');
      fixture.detectChanges();

      resetButton(fixture)!.click();
      fixture.detectChanges();

      expect(store.typeFilter()).toBe('all');
      expect(store.statusFilter()).toBe('all');
      expect(resetButton(fixture)).toBeNull();
    });

    // Il riordino e' davvero sospeso sotto filtro (cdkDragDisabled): prima lo era in silenzio.
    it('dichiara il riordino sospeso quando un filtro è acceso, ricerca inclusa', () => {
      const { fixture, store } = create();
      const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text()).not.toContain('Riordino sospeso');

      store.searchTerm.set('utenti');
      fixture.detectChanges();
      expect(text()).toContain('Riordino sospeso');

      store.searchTerm.set('');
      store.typeFilter.set('mock');
      fixture.detectChanges();
      expect(text()).toContain('Riordino sospeso');
    });
  });

  // "/" e' la scorciatoia di ricerca dei tool a lista (git, less, GitHub): qui porta al filtro.
  describe('scorciatoia "/"', () => {
    function searchInput(fixture: ReturnType<typeof create>['fixture']): HTMLInputElement {
      return (fixture.nativeElement as HTMLElement).querySelector('label input')!;
    }

    it('porta il fuoco nel campo del filtro', () => {
      const { fixture } = create();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
      fixture.detectChanges();

      expect(document.activeElement).toBe(searchInput(fixture));
    });

    it('non ruba il tasto mentre si scrive in un campo', () => {
      const { fixture } = create();
      const altrove = document.createElement('input');
      document.body.appendChild(altrove);
      altrove.focus();

      altrove.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
      fixture.detectChanges();

      expect(document.activeElement).toBe(altrove);
      altrove.remove();
    });

    it('non risponde quando accompagna un modificatore', () => {
      const { fixture } = create();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true }));
      fixture.detectChanges();

      expect(document.activeElement).not.toBe(searchInput(fixture));
    });
  });

  describe('pulsante di reset del filtro', () => {
    function clearButton(fixture: ReturnType<typeof create>['fixture']): HTMLButtonElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('button[aria-label="Svuota il filtro"]');
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

});
