import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { MocksNextCatalog } from './mocks-next-catalog';
import { MocksStore } from '../mocks-next.store';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { ViewStateService } from '../../../shared/view-state.service';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import { translocoTesting } from '../../../testing/transloco-testing';

describe('MocksNextCatalog', () => {
  /** `stored`: lo stato di vista già salvato, come lo troverebbe ViewStateService. */
  function create(stored: Record<string, unknown> = {}) {
    const api = {
      listMocks: vi.fn(() => of({ items: [], collections: [], childOrder: {} })),
      getMock: vi.fn(),
    };
    const viewState = {
      read: vi.fn((key: string) => stored[key] ?? null),
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
    return { fixture, store, viewState };
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
    it('offre ricarica, espandi, collassa e la densità compatta', () => {
      const { fixture } = create();
      headerButton(fixture, 'Azioni di vista').click();
      fixture.detectChanges();

      expect(menuItems().map((b) => b.textContent?.trim())).toEqual([
        'Ricarica dal disco',
        'Espandi tutte le cartelle',
        'Collassa tutte le cartelle',
        'Densità compatta',
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

  // Selezione multipla: la barra delle azioni di massa compare solo quando c'e' una selezione, e
  // le azioni riguardano solo cio' che si vede — sotto filtro non si tocca l'invisibile.
  describe('selezione multipla', () => {
    function seedCatalog(store: ReturnType<typeof create>['store']) {
      store.mocks.set([
        { id: 'uno', type: 'mock', method: 'GET', path: '/uno', status: 200, disabled: false, configFilePath: 'uno' },
        { id: 'due', type: 'handler', method: 'GET', path: '/due', status: null, disabled: false, configFilePath: 'due' },
        { id: 'tre', type: 'mock', method: 'GET', path: '/tre', status: 200, disabled: false, configFilePath: 'tre' },
      ] as never);
    }
    function boxes(fixture: ReturnType<typeof create>['fixture']): HTMLElement[] {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="checkbox"]'));
    }
    function bulkBarText(fixture: ReturnType<typeof create>['fixture']): string {
      return (fixture.nativeElement as HTMLElement).textContent ?? '';
    }

    it('la barra compare solo con una selezione, e conta al singolare quando è uno', () => {
      const { fixture, store } = create();
      seedCatalog(store);
      fixture.detectChanges();

      expect(bulkBarText(fixture)).not.toContain('selezionat');

      boxes(fixture)[0].click();
      fixture.detectChanges();
      expect(bulkBarText(fixture)).toContain('1 selezionato');

      boxes(fixture)[1].click();
      fixture.detectChanges();
      expect(bulkBarText(fixture)).toContain('2 selezionati');
    });

    // A larghezza minima "2 selezionati" andava a capo dentro la propria etichetta.
    it('il conteggio non va a capo, e lo spostamento ha un’etichetta corta', () => {
      const { fixture, store } = create();
      seedCatalog(store);
      fixture.detectChanges();
      boxes(fixture)[0].click();
      fixture.detectChanges();

      const label = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span')).find(
        (span) => span.textContent?.trim() === '1 selezionato',
      );
      expect(label?.classList).toContain('whitespace-nowrap');
      expect(headerButton(fixture, 'Sposta').textContent?.trim()).toBe('Sposta');
    });

    it('shift-click estende dall ultimo spuntato', () => {
      const { fixture, store } = create();
      seedCatalog(store);
      fixture.detectChanges();

      boxes(fixture)[0].click();
      boxes(fixture)[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      fixture.detectChanges();

      expect(boxes(fixture).filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(3);
    });

    it('abilita e disabilita passano dalla rotta di massa, in una chiamata sola', () => {
      const { fixture, store } = create();
      seedCatalog(store);
      fixture.detectChanges();
      const spy = vi.spyOn(store, 'setEndpointsEnabled').mockImplementation(() => {});

      boxes(fixture)[0].click();
      boxes(fixture)[1].click();
      fixture.detectChanges();
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.trim() === 'Disabilita')!
        .click();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(['uno', 'due'], false);
    });

    it('sotto filtro le azioni non toccano gli endpoint nascosti', () => {
      const { fixture, store } = create();
      seedCatalog(store);
      fixture.detectChanges();

      boxes(fixture).forEach((b) => b.click());
      fixture.detectChanges();

      // Il filtro per tipo lascia visibile il solo handler: la selezione resta, ma l'azione
      // riguarda cio' che si vede.
      store.typeFilter.set('handler');
      fixture.detectChanges();

      const spy = vi.spyOn(store, 'setEndpointsEnabled').mockImplementation(() => {});
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.trim() === 'Abilita')!
        .click();

      expect(spy).toHaveBeenCalledWith(['due'], true);
    });

    it('l eliminazione chiede conferma prima di procedere', () => {
      const { fixture, store } = create();
      seedCatalog(store);
      fixture.detectChanges();
      const spy = vi.spyOn(store, 'removeEndpoints').mockImplementation(() => {});

      boxes(fixture)[0].click();
      fixture.detectChanges();
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('button[aria-label="Elimina i selezionati"]')!
        .click();
      fixture.detectChanges();

      expect(spy).not.toHaveBeenCalled();
      expect(bulkBarText(fixture)).toContain('Elimina 1');

      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.trim() === 'Elimina 1')!
        .click();
      expect(spy).toHaveBeenCalledWith(['uno'], expect.any(Function));
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

  });

  // Sotto filtro il riordino e' sospeso (cdkDragDisabled). Lo diceva un avviso fisso in testata
  // per tutto il tempo del filtro; ora lo si dice a chi prova a trascinare, quando serve.
  describe('riordino sospeso sotto filtro', () => {
    function setup() {
      const created = create();
      seedTree(created.store);
      created.fixture.detectChanges();
      return { ...created, toast: TestBed.inject(ToastService) };
    }
    /** Preme su una riga e sposta il puntatore di `distance` px, come chi inizia a trascinare. */
    function dragFrom(target: Element, distance: number) {
      target.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true }));
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 + distance, bubbles: true }));
      document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    }
    const titles = (toast: ToastService) => toast.toasts().map((item) => item.title);

    it('non tiene più un avviso fisso in testata', () => {
      const { fixture, store } = setup();
      store.searchTerm.set('uno');
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Riordino sospeso');
    });

    it('avvisa chi prova a trascinare una riga, con la ricerca o con un filtro del menu', () => {
      const { fixture, store, toast } = setup();
      store.searchTerm.set('uno');
      fixture.detectChanges();
      dragFrom(rowOf(fixture, 'e:uno'), 20);
      expect(titles(toast)).toEqual(['Riordino sospeso mentre filtri']);

      toast.toasts.set([]);
      store.searchTerm.set('');
      store.typeFilter.set('mock');
      fixture.detectChanges();
      dragFrom(rowOf(fixture, 'c:madre'), 20);
      expect(titles(toast)).toEqual(['Riordino sospeso mentre filtri']);
    });

    it('tace allo scorrimento con un dito: è uno scroll, non un tentativo di riordino', () => {
      const { fixture, store, toast } = setup();
      store.searchTerm.set('uno');
      fixture.detectChanges();
      const down = new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });

      rowOf(fixture, 'e:uno').dispatchEvent(down);
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 60, bubbles: true }));
      document.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));

      expect(toast.toasts()).toEqual([]);
    });

    it('non impila un secondo avviso finché il primo è a schermo', () => {
      const { fixture, store, toast } = setup();
      store.searchTerm.set('uno');
      fixture.detectChanges();

      dragFrom(rowOf(fixture, 'e:uno'), 20);
      dragFrom(rowOf(fixture, 'e:uno'), 20);

      expect(toast.toasts().length).toBe(1);
    });

    it('tace senza filtro, per un click senza spostamento e sui controlli della riga', () => {
      const { fixture, store, toast } = setup();
      dragFrom(rowOf(fixture, 'e:uno'), 20); // nessun filtro: il trascinamento è quello vero
      store.searchTerm.set('uno');
      fixture.detectChanges();
      dragFrom(rowOf(fixture, 'e:uno'), 3); // un click che trema
      dragFrom(rowOf(fixture, 'e:uno').querySelector('button')!, 20); // il menu della riga

      expect(toast.toasts()).toEqual([]);
    });

    it('sotto filtro nasconde la maniglia di trascinamento delle cartelle', () => {
      const { fixture, store } = setup();
      const grips = () => (fixture.nativeElement as HTMLElement).querySelectorAll('.cursor-grab').length;
      expect(grips()).toBe(2);

      store.searchTerm.set('uno');
      fixture.detectChanges();

      expect(grips()).toBe(0);
    });
  });

  describe('riscontro del filtro', () => {
    function setup() {
      const created = create();
      seedTree(created.store);
      created.fixture.detectChanges();
      return created;
    }
    const headerBadge = (fixture: ReturnType<typeof create>['fixture']) =>
      (fixture.nativeElement as HTMLElement).querySelector('h2 + ui-badge')!;

    it('la testata conta il totale, e sotto filtro quanti endpoint restano sul totale', () => {
      const { fixture, store } = setup();
      expect(headerBadge(fixture).textContent?.trim()).toBe('3');

      store.searchTerm.set('uno');
      fixture.detectChanges();
      expect(headerBadge(fixture).textContent?.trim()).toBe('1 di 3');
      expect(headerBadge(fixture).getAttribute('aria-live')).toBe('polite');

      store.searchTerm.set('');
      store.statusFilter.set('on');
      fixture.detectChanges();
      expect(headerBadge(fixture).textContent?.trim()).toBe('2 di 3');
    });

    it('evidenzia nel path il testo cercato, lasciando intero il testo della riga', () => {
      const { fixture, store } = setup();
      const marks = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('mark')).map((m) => m.textContent);
      expect(marks()).toEqual([]);

      store.searchTerm.set('UN');
      fixture.detectChanges();

      expect(marks()).toEqual(['un']);
      expect(rowOf(fixture, 'e:uno').querySelector('bdi')?.textContent).toBe('/uno');
    });

    // Su una riga spenta il testo eredita il grigio: sul velo giallo scendeva a 3:1.
    it('il testo evidenziato resta chiaro anche su una riga spenta', () => {
      const { fixture, store } = setup();
      store.searchTerm.set('sciolto');
      fixture.detectChanges();

      const mark = rowOf(fixture, 'e:sciolto').querySelector('mark')!;
      expect(mark.classList).toContain('text-foreground');
      expect(mark.classList).not.toContain('text-inherit');
    });

    // Una live region che nasce già piena di solito non viene annunciata: deve esistere prima.
    it('il conteggio vive in un solo elemento, che resta lo stesso accendendo il filtro', () => {
      const { fixture, store } = setup();
      const before = headerBadge(fixture);
      expect(before.getAttribute('aria-live')).toBe('polite');

      store.searchTerm.set('uno');
      fixture.detectChanges();

      expect(headerBadge(fixture)).toBe(before);
    });

    // La ricerca guarda anche metodo e tipo: una riga può corrispondere senza che il path c'entri.
    it('non evidenzia nulla quando a corrispondere è il metodo', () => {
      const { fixture, store } = setup();
      store.searchTerm.set('post');
      fixture.detectChanges();

      expect(rowOf(fixture, 'e:due').querySelector('bdi')?.textContent).toBe('/due');
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('mark').length).toBe(0);
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

  /** Catalogo a due livelli: Unsorted con un endpoint spento, e una collection con una figlia. */
  function seedTree(store: ReturnType<typeof create>['store']) {
    store.mocks.set([
      { id: 'sciolto', type: 'mock', method: 'GET', path: '/sciolto', status: 200, disabled: true, configFilePath: 'sciolto' },
      { id: 'uno', type: 'mock', method: 'GET', path: '/uno', status: 200, disabled: false, configFilePath: 'uno', collectionId: 'madre' },
      { id: 'due', type: 'mock', method: 'POST', path: '/due', status: 201, disabled: false, configFilePath: 'due', collectionId: 'figlia' },
    ] as never);
    store.collections.set([
      { id: 'madre', label: 'Madre' },
      { id: 'figlia', label: 'Figlia', parentId: 'madre' },
    ] as never);
    store.childOrder.set({ root: ['madre'], madre: ['uno', 'figlia'], figlia: ['due'], unsorted: ['sciolto'] });
  }

  function treeRows(fixture: ReturnType<typeof create>['fixture']): HTMLElement[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="treeitem"]'));
  }
  function rowOf(fixture: ReturnType<typeof create>['fixture'], key: string): HTMLElement {
    const found = treeRows(fixture).find((row) => row.dataset['rowKey'] === key);
    if (!found) throw new Error('riga non trovata: ' + key);
    return found;
  }

  // Le righe erano div cliccabili: da tastiera non si apriva un endpoint ne' si chiudeva una
  // cartella. Ora il catalogo e' un albero ARIA: una sola riga raggiungibile col Tab e le frecce
  // per muoversi fra le righe. I controlli interni alle righe restano fermate del Tab.
  describe('navigazione da tastiera', () => {
    function setup() {
      const created = create();
      seedTree(created.store);
      created.fixture.detectChanges();
      return created;
    }
    function press(fixture: ReturnType<typeof create>['fixture'], key: string, target = document.activeElement!, shiftKey = false) {
      const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }
    const focusedKey = () => (document.activeElement as HTMLElement | null)?.dataset['rowKey'];

    it('espone le righe come albero, con livello e stato di apertura', () => {
      const { fixture } = setup();
      const tree = (fixture.nativeElement as HTMLElement).querySelector('[role="tree"]');

      expect(tree?.getAttribute('aria-label')).toBe('Catalogo');
      expect(treeRows(fixture).map((row) => [row.dataset['rowKey'], row.getAttribute('aria-level')])).toEqual([
        ['c:unsorted', '1'],
        ['e:sciolto', '2'],
        ['c:madre', '1'],
        ['e:uno', '2'],
        ['c:figlia', '2'],
        ['e:due', '3'],
      ]);
      expect(rowOf(fixture, 'c:madre').getAttribute('aria-expanded')).toBe('true');
    });

    it('lascia al Tab una sola riga: la prima, poi quella che ha avuto il fuoco', () => {
      const { fixture } = setup();
      const tabbable = () => treeRows(fixture).filter((row) => row.getAttribute('tabindex') === '0');

      expect(tabbable().map((row) => row.dataset['rowKey'])).toEqual(['c:unsorted']);

      rowOf(fixture, 'e:uno').focus();
      fixture.detectChanges();

      expect(tabbable().map((row) => row.dataset['rowKey'])).toEqual(['e:uno']);
    });

    it('le frecce su e giù scorrono le righe visibili, Home ed End vanno agli estremi', () => {
      const { fixture } = setup();
      rowOf(fixture, 'c:unsorted').focus();

      press(fixture, 'ArrowDown');
      expect(focusedKey()).toBe('e:sciolto');
      press(fixture, 'ArrowDown');
      expect(focusedKey()).toBe('c:madre');
      press(fixture, 'ArrowUp');
      expect(focusedKey()).toBe('e:sciolto');
      press(fixture, 'End');
      expect(focusedKey()).toBe('e:due');
      press(fixture, 'Home');
      expect(focusedKey()).toBe('c:unsorted');
    });

    it('sinistra chiude la cartella e destra la riapre; da aperta, destra scende al primo figlio', () => {
      const { fixture } = setup();
      rowOf(fixture, 'c:madre').focus();

      press(fixture, 'ArrowLeft');
      expect(rowOf(fixture, 'c:madre').getAttribute('aria-expanded')).toBe('false');
      expect(treeRows(fixture).map((row) => row.dataset['rowKey'])).not.toContain('e:uno');
      expect(focusedKey()).toBe('c:madre');

      press(fixture, 'ArrowRight');
      expect(rowOf(fixture, 'c:madre').getAttribute('aria-expanded')).toBe('true');

      press(fixture, 'ArrowRight');
      expect(focusedKey()).toBe('e:uno');
    });

    it('sinistra da un endpoint, o da una cartella chiusa, risale alla cartella che lo contiene', () => {
      const { fixture } = setup();
      rowOf(fixture, 'e:due').focus();

      press(fixture, 'ArrowLeft');
      expect(focusedKey()).toBe('c:figlia');
      press(fixture, 'ArrowLeft'); // chiude figlia
      press(fixture, 'ArrowLeft'); // già chiusa: risale
      expect(focusedKey()).toBe('c:madre');
    });

    // Spazio spunta, Invio apre: prima facevano entrambi la stessa cosa, aprire.
    it('Spazio spunta l’endpoint a fuoco senza aprirlo, e una seconda volta toglie la spunta', () => {
      const { fixture, store } = setup();
      const select = vi.spyOn(store, 'selectMock').mockImplementation(() => undefined);
      const checked = () => rowOf(fixture, 'e:uno').querySelector('[role="checkbox"]')!.getAttribute('aria-checked');

      rowOf(fixture, 'e:uno').focus();
      const spazio = press(fixture, ' ');
      expect(checked()).toBe('true');
      expect(rowOf(fixture, 'e:uno').getAttribute('aria-selected')).toBe('true');
      expect(spazio.defaultPrevented).toBe(true);
      expect(select).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(rowOf(fixture, 'e:uno'));

      press(fixture, ' ');
      expect(checked()).toBe('false');
      expect(rowOf(fixture, 'e:uno').getAttribute('aria-selected')).toBe('false');
    });

    it('Maiuscole+Spazio spunta l’intervallo dall’ultimo spuntato, come lo shift-click', () => {
      const { fixture } = setup();
      const checkedKeys = () =>
        treeRows(fixture)
          .filter((row) => row.getAttribute('aria-selected') === 'true')
          .map((row) => row.dataset['rowKey']);

      rowOf(fixture, 'e:sciolto').focus();
      press(fixture, ' ');
      rowOf(fixture, 'e:due').focus();
      press(fixture, ' ', document.activeElement!, true);

      expect(checkedKeys()).toEqual(['e:sciolto', 'e:uno', 'e:due']);
    });

    // Con la selezione multipla aria-selected dice le spunte: l'endpoint aperto lo dice aria-current.
    it('l’albero è a selezione multipla, e l’endpoint aperto è marcato come corrente', () => {
      const { fixture, store } = setup();
      const tree = (fixture.nativeElement as HTMLElement).querySelector('[role="tree"]')!;
      expect(tree.getAttribute('aria-multiselectable')).toBe('true');

      store.selected.set({ id: 'uno' } as never); // l'endpoint aperto nel dettaglio
      fixture.detectChanges();

      expect(rowOf(fixture, 'e:uno').getAttribute('aria-current')).toBe('true');
      expect(rowOf(fixture, 'e:uno').getAttribute('aria-selected')).toBe('false');
      expect(rowOf(fixture, 'e:due').hasAttribute('aria-current')).toBe(false);
      expect(rowOf(fixture, 'c:madre').hasAttribute('aria-selected')).toBe(false);
    });

    it('Invio apre l’endpoint a fuoco, Spazio chiude la cartella a fuoco', () => {
      const { fixture, store } = setup();
      const select = vi.spyOn(store, 'selectMock').mockImplementation(() => undefined);

      rowOf(fixture, 'e:uno').focus();
      const invio = press(fixture, 'Enter');
      expect(select).toHaveBeenCalledWith('uno');
      expect(invio.defaultPrevented).toBe(true);

      rowOf(fixture, 'c:figlia').focus();
      press(fixture, ' ');
      expect(rowOf(fixture, 'c:figlia').getAttribute('aria-expanded')).toBe('false');
    });

    // Spunta, menu e switch stanno dentro la riga: i loro tasti non devono muovere l'albero.
    it('ignora i tasti premuti sui controlli interni alla riga', () => {
      const { fixture, store } = setup();
      const select = vi.spyOn(store, 'selectMock').mockImplementation(() => undefined);
      const menuButton = rowOf(fixture, 'e:uno').querySelector('button')!;
      menuButton.focus();

      const event = press(fixture, 'ArrowDown', menuButton);
      press(fixture, 'Enter', menuButton);

      expect(document.activeElement).toBe(menuButton);
      expect(event.defaultPrevented).toBe(false);
      expect(select).not.toHaveBeenCalled();
    });

    it('freccia giù dal campo di ricerca porta il fuoco nell’albero', () => {
      const { fixture } = setup();
      const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('label input')!;
      input.focus();

      press(fixture, 'ArrowDown', input);

      expect(focusedKey()).toBe('c:unsorted');
    });
  });

  // Una riga per endpoint, per vedere più catalogo: un'opzione del menu di vista, ricordata.
  describe('densità compatta', () => {
    function setup(stored: Record<string, unknown> = {}) {
      const created = create(stored);
      created.store.mocks.set([
        { id: 'uno', type: 'mock', method: 'GET', path: '/uno', status: 200, disabled: false, configFilePath: 'uno', responseCount: 1 },
        { id: 'due', type: 'handler', method: 'POST', path: '/due', status: 201, disabled: false, configFilePath: 'due', responseCount: 3 },
      ] as never);
      created.fixture.detectChanges();
      return created;
    }
    const host = (fixture: ReturnType<typeof create>['fixture']) => fixture.nativeElement as HTMLElement;
    const toggle = () =>
      document.querySelector<HTMLButtonElement>('.cdk-overlay-container [role="menuitemcheckbox"]')!;
    function openViewMenu(fixture: ReturnType<typeof create>['fixture']) {
      headerButton(fixture, 'Azioni di vista').click();
      fixture.detectChanges();
    }

    it('è un’opzione a spunta del menu di vista, spenta di partenza', () => {
      const { fixture } = setup();
      openViewMenu(fixture);

      expect(toggle().textContent?.trim()).toBe('Densità compatta');
      expect(toggle().getAttribute('aria-checked')).toBe('false');
      expect(host(fixture).classList).not.toContain('mx-compact');
    });

    it('accenderla compatta il catalogo e la ricorda; spegnerla la dimentica', () => {
      const { fixture, viewState } = setup();
      openViewMenu(fixture);
      toggle().click();
      fixture.detectChanges();

      expect(host(fixture).classList).toContain('mx-compact');
      expect(viewState.write).toHaveBeenLastCalledWith('catalog-density', 'compact');

      openViewMenu(fixture);
      expect(toggle().getAttribute('aria-checked')).toBe('true');
      toggle().click();
      fixture.detectChanges();

      expect(host(fixture).classList).not.toContain('mx-compact');
      expect(viewState.write).toHaveBeenLastCalledWith('catalog-density', null);
    });

    it('riparte compatta se l’ultima volta lo era', () => {
      const { fixture } = setup({ 'catalog-density': 'compact' });
      expect(host(fixture).classList).toContain('mx-compact');
    });

    // Il tipo "mock" e una sola response sono il caso comune: in una riga sola tolgono spazio al path.
    it('da compatta tace il tipo "mock" e la response unica, e mostra il resto', () => {
      const { fixture } = setup({ 'catalog-density': 'compact' });
      const text = (key: string) => rowOf(fixture, key).textContent!.replace(/\s+/g, ' ');

      expect(text('e:uno')).not.toContain('mock');
      expect(rowOf(fixture, 'e:uno').querySelector('ng-icon[name="lucideMessageSquare"]')).toBeNull();
      expect(text('e:due')).toContain('handler');
      expect(text('e:due')).toContain('3');
    });

    it('a densità normale i dettagli ci sono tutti, come prima', () => {
      const { fixture } = setup();
      expect(rowOf(fixture, 'e:uno').textContent).toContain('mock');
      expect(rowOf(fixture, 'e:uno').querySelector('ng-icon[name="lucideMessageSquare"]')).not.toBeNull();
    });
  });

  describe('riga endpoint', () => {
    function setup() {
      const created = create();
      seedTree(created.store);
      created.fixture.detectChanges();
      return created;
    }

    // L'opacita' portava il testo sotto il contrasto AA: da spenta la riga perde solo il colore.
    it('da spenta non tiene i colori di metodo, tipo e status: eredita il grigio della riga', () => {
      const { fixture } = setup();
      const colored = (row: HTMLElement) =>
        Array.from(row.querySelectorAll<HTMLElement>('ui-badge, bdi, span'))
          .flatMap((element) => [element, element.parentElement!])
          .some((element) => /text-(method|status|type|foreground)/.test(element.className));

      expect(rowOf(fixture, 'e:sciolto').classList).toContain('mx-muted');
      expect(colored(rowOf(fixture, 'e:sciolto'))).toBe(false);
      expect(rowOf(fixture, 'e:uno').classList).not.toContain('mx-muted');
      expect(colored(rowOf(fixture, 'e:uno'))).toBe(true);
    });

    // Il solo grigio si notava poco: da spenta il badge del metodo resta un contorno tratteggiato.
    it('da spenta svuota il badge del metodo, da accesa lo lascia pieno', () => {
      const { fixture } = setup();
      const badge = (key: string) => rowOf(fixture, key).querySelector('ui-badge')!.classList;

      expect(badge('e:sciolto')).toContain('outline-dashed');
      expect(badge('e:sciolto')).toContain('bg-transparent');
      expect(badge('e:sciolto')).not.toContain('ring-1');
      expect(badge('e:uno')).not.toContain('outline-dashed');
      expect(badge('e:uno')).toContain('ring-1');
    });

    // "Unsorted" era scritto in inglese fisso, anche nell'interfaccia italiana.
    it('chiama "Non assegnati" il gruppo degli endpoint senza collection, nell’albero e nei menu', () => {
      const { fixture } = setup();
      expect(rowOf(fixture, 'c:unsorted').textContent).toContain('Non assegnati');
      expect(rowOf(fixture, 'c:unsorted').textContent).not.toContain('Unsorted');

      rowOf(fixture, 'e:uno').querySelector<HTMLButtonElement>('button[aria-label="Sposta in collection"]')!.click();
      fixture.detectChanges();

      expect(menuItems().map((b) => b.textContent?.trim())).toEqual(['Non assegnati', 'Madre', 'Figlia']);
    });

    // I menu "⋮" di riga e di cartella avevano solo il tooltip: per uno screen reader, "pulsante".
    it('i pulsanti a sola icona hanno un nome accessibile', () => {
      const { fixture } = setup();
      const unnamed = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === '' && !button.getAttribute('aria-label'),
      );

      expect(unnamed).toEqual([]);
      expect(rowOf(fixture, 'e:uno').querySelector('button')?.getAttribute('aria-label')).toBe('Sposta in collection');
      expect(rowOf(fixture, 'c:madre').querySelector('button')?.getAttribute('aria-label')).toBe('Azioni collection');
    });

    // Spunta e menu tenevano posto anche invisibili, circa 60 px tolti al path.
    it('la spunta sta nel margine dell’indentazione, prima del metodo, a ogni profondità', () => {
      const { fixture } = setup();
      const box = (key: string) => rowOf(fixture, key).querySelector<HTMLElement>('[role="checkbox"]')!;

      expect(box('e:uno').classList).toContain('absolute');
      expect(box('e:uno').style.left).toBe('3px'); // profondità 1: metodo a 22 px
      expect(box('e:due').style.left).toBe('17px'); // profondità 2: metodo a 36 px
    });

    it('il menu non tiene posto: invisibile non riceve click, e la riga resta alta come prima', () => {
      const { fixture } = setup();
      const row = rowOf(fixture, 'e:uno');
      const menu = row.querySelector<HTMLElement>('button[aria-label="Sposta in collection"]')!;

      expect(row.classList).toContain('min-h-11');
      expect(menu.classList).toContain('absolute');
      expect(menu.classList).toContain('pointer-events-none');
      expect(menu.classList).toContain('group-hover:pointer-events-auto');
      expect(menu.classList).toContain('aria-expanded:pointer-events-auto');
    });

    // Troncato in coda, due path della stessa collection diventavano indistinguibili.
    it('tronca il path in testa: riga rtl, testo in un <bdi> ltr, path intero nel title', () => {
      const { fixture } = setup();
      const path = rowOf(fixture, 'e:uno').querySelector<HTMLElement>('[title="/uno"]')!;

      expect(path.getAttribute('dir')).toBe('rtl');
      expect(path.classList).toContain('truncate');
      expect(path.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
      expect(path.textContent).toBe('/uno');
    });
  });

});
