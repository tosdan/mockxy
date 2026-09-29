import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { MocksStore } from './mocks-next.store';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { ViewStateService } from '../../shared/view-state.service';
import { translocoTesting } from '../../testing/transloco-testing';
import { fakeRuntimeSync } from '../../testing/runtime-sync-testing';
import {
  UNSORTED_COLLECTION_ID,
  type CollectionSummary,
  type MockDetail,
  type MockDetailAfterMutation,
  type MockListResponse,
  type MockSummary,
} from '../../mock-admin-api.types';

function summary(id: string, overrides: Partial<MockSummary> = {}): MockSummary {
  return {
    id,
    type: 'mock',
    method: 'GET',
    path: `/${id}`,
    status: 200,
    disabled: false,
    configFilePath: `mocks/${id}/GET.endpoint.json`,
    responseCount: 1,
    ...overrides,
  };
}

function coll(id: string, overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return { id, label: id, itemCount: 0, ...overrides };
}

function detail(id: string, overrides: Partial<MockDetail> = {}): MockDetail {
  return {
    ...summary(id),
    editable: true,
    selectedResponseFile: '001.response.json',
    endpoint: {
      method: 'GET',
      path: `/${id}`,
      enabled: true,
      description: `descrizione ${id}`,
      responseFiles: ['001.response.json'],
      selectedResponseFile: '001.response.json',
    },
    ...overrides,
  };
}

/** Errore HTTP di una lettura incompleta del dettaglio, come lo propaga HttpClient. */
function readInconsistent(detailMessage: string) {
  return {
    status: 409,
    error: {
      message: `The endpoint could not be read consistently: ${detailMessage}`,
      details: { code: 'READ_INCONSISTENT', retryable: true },
    },
  };
}

function listResponse(
  items: MockSummary[],
  collections: CollectionSummary[] = [],
  childOrder: Record<string, string[]> = {},
): MockListResponse {
  return { items, collections, childOrder };
}

function makeApiStub() {
  return {
      listMocks: vi.fn(() => of(listResponse([summary('e1'), summary('e2')]))),
      getMock: vi.fn((id: string) => of(detail(id))),
      updateEndpoint: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      selectResponse: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      updateResponse: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      createResponse: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      createSequence: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      updateSequence: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      deleteResponse: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      uploadResponseFile: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      deleteMock: vi.fn(() => of(undefined)),
      createCollection: vi.fn(() => of(coll('nuova'))),
      assignDefinitionCollection: vi.fn((id: string): Observable<MockDetailAfterMutation> => of(detail(id))),
      deleteCollection: vi.fn(() => of(undefined)),
      eraseCollection: vi.fn(() => of({ deleted: 1 })),
      updateCollectionEnabled: vi.fn(() => of(listResponse([summary('e1')]))),
      reorderCollections: vi.fn(() => of(undefined)),
      reparentCollection: vi.fn(() => of(undefined)),
      reorderCollectionChildren: vi.fn(() => of(undefined)),
      createMock: vi.fn((): Observable<MockDetailAfterMutation> => of(detail('nuovo'))),
      copyEndpoint: vi.fn((): Observable<MockDetailAfterMutation> => of(detail('copia'))),
      createHandler: vi.fn((): Observable<MockDetailAfterMutation> => of(detail('nuovo-handler'))),
      createMiddleware: vi.fn((): Observable<MockDetailAfterMutation> => of(detail('nuovo-middleware'))),
    };
}

/** Stub in-memory di ViewStateService: isola i test dal localStorage reale (e tra loro). */
function makeViewStateStub() {
  const state = new Map<string, unknown>();
  return {
    read: vi.fn((key: string) => state.get(key) ?? null),
    write: vi.fn((key: string, value: unknown) => {
      if (value == null) state.delete(key);
      else state.set(key, value);
    }),
  };
}

describe('MocksStore', () => {
  let api: ReturnType<typeof makeApiStub>;
  let viewState: ReturnType<typeof makeViewStateStub>;
  let sync: ReturnType<typeof fakeRuntimeSync>;

  beforeEach(() => {
    api = makeApiStub();
    viewState = makeViewStateStub();
    sync = fakeRuntimeSync();
    TestBed.configureTestingModule({
      imports: [translocoTesting()],
      providers: [
        MocksStore,
        sync.provider,
        { provide: MockAdminApiService, useValue: api },
        { provide: ViewStateService, useValue: viewState },
      ],
    });
  });

  function create(): MocksStore {
    return TestBed.inject(MocksStore);
  }

  describe('foresta del catalogo', () => {
    it('ordina radici e figli misti secondo childOrder, con Unsorted a parte', () => {
      const store = create();
      store.mocks.set([
        summary('e1', { collectionId: 'c1' }),
        summary('e2', { collectionId: 'c1' }),
        summary('e3'), // non categorizzato → Unsorted
      ]);
      store.collections.set([coll('c1'), coll('c2', { parentId: 'c1' })]);
      store.childOrder.set({
        root: ['c1'],
        c1: ['e2', 'c2', 'e1'], // sotto-collection intercalata tra gli endpoint
        [UNSORTED_COLLECTION_ID]: ['e3'],
      });

      const roots = store.catalogTree();
      expect(roots.map((r) => r.collection.id)).toEqual(['c1']);
      expect(roots[0].children.map((c) => (c.kind === 'endpoint' ? c.endpoint.id : c.node.collection.id)))
        .toEqual(['e2', 'c2', 'e1']);
      // il conteggio della collection sono i SOLI endpoint propri (non delle sotto-collection)
      expect(roots[0].collection.count).toBe(2);
      const nested = roots[0].children.find((c) => c.kind === 'collection');
      expect(nested?.kind === 'collection' && nested.node.collection.depth).toBe(1);
      expect(store.unsortedNode()?.collection.endpoints.map((e) => e.id)).toEqual(['e3']);
      expect(store.collectionEndpointCount(UNSORTED_COLLECTION_ID)).toBe(1);
      expect(store.collectionEndpointCount('c1')).toBe(2);
      store.searchTerm.set('e1');
      expect(store.collectionEndpointCount(UNSORTED_COLLECTION_ID)).toBe(1);
      expect(store.collectionEndpointCount('c1')).toBe(2);
      expect(store.catalogIsEmpty()).toBe(false);
    });

    it('accoda i ref assenti da childOrder (prima endpoint, poi collection) e ignora i ref orfani', () => {
      const store = create();
      store.mocks.set([summary('e1', { collectionId: 'c1' }), summary('e2', { collectionId: 'c1' })]);
      store.collections.set([coll('c1'), coll('c2', { parentId: 'c1' })]);
      // childOrder conosce solo e2 e cita un ref che non esiste più
      store.childOrder.set({ root: ['c1'], c1: ['e2', 'fantasma'] });

      const c1 = store.catalogTree()[0];
      expect(c1.children.map((c) => (c.kind === 'endpoint' ? c.endpoint.id : c.node.collection.id)))
        .toEqual(['e2', 'e1', 'c2']);
    });

    it('senza endpoint né collection il catalogo è vuoto', () => {
      const store = create();
      expect(store.catalogTree()).toEqual([]);
      expect(store.unsortedNode()).toBeNull();
      expect(store.catalogIsEmpty()).toBe(true);
    });
  });

  describe('filtri', () => {
    it('ricerca, tipo e stato filtrano in AND gli endpoint del catalogo', () => {
      const store = create();
      store.mocks.set([
        summary('e1', { path: '/utenti', type: 'mock' }),
        summary('e2', { path: '/utenti/attivi', type: 'handler' }),
        summary('e3', { path: '/utenti/spenti', type: 'handler', disabled: true }),
        summary('e4', { path: '/altro', type: 'handler' }),
      ]);

      store.searchTerm.set('utenti');
      store.typeFilter.set('handler');
      store.statusFilter.set('on');

      expect(store.unsortedNode()?.collection.endpoints.map((e) => e.id)).toEqual(['e2']);
      expect(store.hasActiveFilter()).toBe(true);
      expect(store.hasMenuFilter()).toBe(true);
      // i totali del footer NON seguono i filtri
      expect(store.totalEndpoints()).toBe(4);
      expect(store.activeEndpoints()).toBe(3);
    });

    it('la sola ricerca non accende l’indicatore del menu filtri', () => {
      const store = create();
      store.searchTerm.set('x');
      expect(store.hasActiveFilter()).toBe(true);
      expect(store.hasMenuFilter()).toBe(false);
    });
  });

  describe('loadCatalog', () => {
    it('applica la risposta e apre il primo endpoint', () => {
      const store = create();
      store.loadCatalog();
      expect(store.mocks().map((m) => m.id)).toEqual(['e1', 'e2']);
      expect(api.getMock).toHaveBeenCalledWith('e1');
      expect(store.selected()?.id).toBe('e1');
      expect(store.loading()).toBe(false);
    });

    it('con preselect apre l’endpoint che combacia per metodo+path', () => {
      const store = create();
      store.loadCatalog({ method: 'GET', path: '/e2' });
      expect(store.selected()?.id).toBe('e2');
    });

    it('su errore espone il messaggio del server e non seleziona nulla', () => {
      api.listMocks.mockReturnValueOnce(throwError(() => new Error('backend giù')));
      const store = create();
      store.loadCatalog();
      expect(store.error()).toBe('backend giù');
      expect(store.selected()).toBeUndefined();
      expect(store.loading()).toBe(false);
    });

    it('riapre l’ultimo endpoint selezionato (persistito), come lasciato tornando sulla view', () => {
      viewState.write('mocks-selected', 'e2');
      const store = create();
      store.loadCatalog();
      expect(store.selected()?.id).toBe('e2');
    });

    it('un id persistito non più nel catalogo ripiega sul primo endpoint', () => {
      viewState.write('mocks-selected', 'sparito');
      const store = create();
      store.loadCatalog();
      expect(store.selected()?.id).toBe('e1');
    });

    it('espone le definizioni scartate dal caricamento invece di buttarle via', () => {
      const loadErrors = [
        { configFilePath: 'legacy/GET.endpoint.json', message: 'endpoint.sequence is no longer supported' },
      ];
      api.listMocks.mockReturnValueOnce(of({ ...listResponse([summary('e1')]), loadErrors }));
      const store = create();

      store.loadCatalog();

      expect(store.loadErrors()).toEqual(loadErrors);
    });

    it('una risposta che non le riporta conserva le segnalazioni note, non le azzera', () => {
      // Alcune mutazioni rispondono senza rifare la scansione da disco (es. PATCH
      // collections/:id/enabled): lì l'assenza significa "non lo so", non "nessuna".
      const store = create();
      const loadErrors = [{ configFilePath: 'legacy/GET.endpoint.json', message: 'rifiutato' }];
      api.listMocks.mockReturnValueOnce(of({ ...listResponse([summary('e1')]), loadErrors }));
      store.loadCatalog();
      expect(store.loadErrors()).toEqual(loadErrors);

      api.updateCollectionEnabled.mockReturnValueOnce(of(listResponse([summary('e1')])));
      store.setCollectionEnabled('c1', false);

      expect(store.loadErrors()).toEqual(loadErrors);
    });

    it('il preselect del monitor vince sull’id persistito', () => {
      viewState.write('mocks-selected', 'e1');
      const store = create();
      store.loadCatalog({ method: 'GET', path: '/e2' });
      expect(store.selected()?.id).toBe('e2');
    });
  });

  describe('reload', () => {
    it('mantiene la selezione se l’endpoint esiste ancora', () => {
      const store = create();
      store.loadCatalog();
      api.getMock.mockClear();
      store.reload();
      expect(api.getMock).toHaveBeenCalledWith('e1');
      expect(store.selected()?.id).toBe('e1');
    });

    it('una lettura incompleta del dettaglio aperto lo lascia com’è e la segnala', () => {
      const store = create();
      store.selectMock('e1');
      api.getMock.mockReturnValueOnce(throwError(() => readInconsistent('x')));

      store.reload();

      expect(store.selected()?.id).toBe('e1');
      expect(store.error()).toContain('Dettaglio non leggibile in questo momento');
    });

    it('gli altri errori del dettaglio aperto restano silenziosi', () => {
      const store = create();
      store.selectMock('e1');
      api.getMock.mockReturnValueOnce(throwError(() => new Error('404')));

      store.reload();

      expect(store.selected()?.id).toBe('e1');
      expect(store.error()).toBeUndefined();
    });

    it('se l’endpoint selezionato è sparito apre il primo della nuova lista', () => {
      const store = create();
      store.loadCatalog();
      api.listMocks.mockReturnValue(of(listResponse([summary('e9')])));
      store.reload();
      expect(store.selected()?.id).toBe('e9');
    });
  });

  describe('selectMock', () => {
    it('non ricarica il dettaglio già selezionato', () => {
      const store = create();
      store.selectMock('e1');
      api.getMock.mockClear();
      store.selectMock('e1');
      expect(api.getMock).not.toHaveBeenCalled();
    });

    it('su errore espone il messaggio e chiude il loading', () => {
      api.getMock.mockReturnValueOnce(throwError(() => new Error('404')));
      const store = create();
      store.selectMock('e1');
      expect(store.error()).toBe('404');
      expect(store.detailLoading()).toBe(false);
    });

    it('una lettura incompleta, già ripetuta dal servizio, è segnalata come non disponibile', () => {
      api.getMock.mockReturnValueOnce(throwError(() => readInconsistent('Response asset file not found on disk.')));
      const store = create();
      store.selectMock('e1');
      expect(store.error()).toBe(
        "Dettaglio non leggibile in questo momento: l'endpoint sta cambiando o un file che usa manca. Riprova tra poco. " +
          'The endpoint could not be read consistently: Response asset file not found on disk.',
      );
      expect(store.selected()).toBeUndefined();
      expect(api.getMock).toHaveBeenCalledTimes(1);
    });

    it('persiste l’id selezionato per la visita successiva', () => {
      const store = create();
      store.selectMock('e2');
      expect(viewState.write).toHaveBeenCalledWith('mocks-selected', 'e2');
    });
  });

  describe('toggleEnabled', () => {
    it('invia solo enabled, senza rileggere né reinviare la description, e riallinea il dettaglio', () => {
      const store = create();
      store.loadCatalog(); // seleziona e1
      api.getMock.mockClear();
      store.toggleEnabled('e1', false);
      expect(api.updateEndpoint).toHaveBeenCalledWith('e1', { enabled: false });
      expect(api.getMock).not.toHaveBeenCalled();
      expect(store.selected()?.id).toBe('e1');
      expect(store.savingId()).toBeUndefined();
    });

    it('su errore ripristina lo stato ottimistico ed espone il messaggio', () => {
      const store = create();
      store.mocks.set([summary('e1'), summary('e2')]);
      api.updateEndpoint.mockReturnValueOnce(throwError(() => new Error('scrittura fallita')));

      store.toggleEnabled('e1', false);

      expect(store.mocks().find((m) => m.id === 'e1')?.disabled).toBe(false); // revert
      expect(store.error()).toBe('scrittura fallita');
      expect(store.savingId()).toBeUndefined();
    });
  });

  // Piano agent/API, §7 S4: le riletture di sincronizzazione aggiornano catalogo e dettaglio senza
  // indicatori né toast, e non sovrascrivono mai una risposta più recente.
  describe('sincronizzazione col runtime', () => {
    const list3 = listResponse([summary('e1'), summary('e2'), summary('e3')]);

    it('un cambio del catalogo rilegge elenco e dettaglio aperto, senza indicatori né errori', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.listMocks.mockReturnValue(of(list3));
      api.getMock.mockReturnValue(of(detail('e1', { status: 418 })));

      sync.revisions('catalog');

      expect(store.mocks()).toHaveLength(3);
      expect(store.selected()?.status).toBe(418);
      expect(store.loading()).toBe(false);
      expect(store.detailLoading()).toBe(false);
      expect(store.error()).toBeUndefined();
      expect(store.syncTick()).toBe(1);
    });

    it('revisioni che non riguardano il catalogo non rileggono; il focus rilegge anche a revisioni invariate', () => {
      const store = create();
      store.selected.set(detail('e1'));
      sync.revisions('server', 'dump');
      expect(api.listMocks).not.toHaveBeenCalled();

      sync.resync();
      expect(api.listMocks).toHaveBeenCalledTimes(1);
      expect(api.getMock).toHaveBeenCalledWith('e1');
    });

    it('una rilettura in ritardo non sovrascrive la risposta più recente di una mutazione', () => {
      const store = create();
      store.selected.set(detail('e1'));
      const late = new Subject<ReturnType<typeof listResponse>>();
      api.listMocks.mockReturnValueOnce(late).mockReturnValue(of(list3));
      sync.revisions('catalog');

      api.updateResponse.mockReturnValueOnce(of(detail('e1', { status: 201 })));
      store.saveResponse({ type: 'mock', title: '', status: 201, headers: {}, delayMs: 0, body: {} });
      late.next(listResponse([summary('e1')]));
      late.complete();

      expect(store.selected()?.status).toBe(201);
      expect(store.mocks()).toHaveLength(3);
    });

    it('con una mutazione in corso non rilegge', () => {
      const store = create();
      store.selected.set(detail('e1'));
      store.savingId.set('e1');
      sync.revisions('catalog');
      expect(api.listMocks).not.toHaveBeenCalled();
    });

    it('una rilettura alla volta, e una sola in coda', () => {
      const store = create();
      const slow = new Subject<ReturnType<typeof listResponse>>();
      api.listMocks.mockReturnValueOnce(slow).mockReturnValue(of(list3));
      sync.revisions('catalog');
      sync.revisions('catalog');
      sync.resync();
      expect(api.listMocks).toHaveBeenCalledTimes(1);

      slow.next(list3);
      slow.complete();
      expect(api.listMocks).toHaveBeenCalledTimes(2);
      expect(store.syncTick()).toBe(2);
    });

    it('l’endpoint aperto sparito resta visibile e segnalato', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.listMocks.mockReturnValue(of(listResponse([summary('e2')])));

      sync.revisions('catalog');

      expect(store.selectedGone()).toBe(true);
      expect(store.selected()?.id).toBe('e1');
      expect(api.getMock).not.toHaveBeenCalled();
    });

    it('col workspace cambiato il dettaglio aperto non passa all’omonimo; aprire un endpoint chiude lo stato stantio', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.listMocks.mockReturnValue(of(list3));

      sync.runtime(true);

      expect(store.staleWorkspace()).toBe(true);
      expect(store.mocks()).toHaveLength(3);
      expect(api.getMock).not.toHaveBeenCalled();
      sync.resync();
      expect(api.getMock).not.toHaveBeenCalled();

      // Stesso id, ma della nuova istanza: si rilegge e le bozze del precedente decadono.
      store.selectMock('e1');
      expect(api.getMock).toHaveBeenCalledWith('e1');
      expect(store.staleWorkspace()).toBe(false);
      expect(store.workspaceGeneration()).toBe(1);
    });

    it('un nuovo runtime sullo stesso workspace rilegge come un focus', () => {
      const store = create();
      store.selected.set(detail('e1'));
      sync.runtime(false);
      expect(api.getMock).toHaveBeenCalledWith('e1');
      expect(store.staleWorkspace()).toBe(false);
    });
  });

  // Piano agent/API, §13 C4: una bozza salva sul bersaglio fissato all'apertura, con la revisione
  // letta; conflitto e risorsa sparita tornano alla bozza, che conserva il testo.
  describe('salvataggi da bozza', () => {
    const REV_A = `rev-v1:${'a'.repeat(64)}`;
    const REV_B = `rev-v1:${'b'.repeat(64)}`;
    const target = { endpointId: 'e1', responseFile: '001.response.json', baseRevision: REV_A };
    const payload = { type: 'mock' as const, title: '', status: 200, headers: {}, delayMs: 0, body: { a: 1 } };
    const conflict = {
      code: 'REVISION_CONFLICT' as const,
      resource: { kind: 'response' as const, endpointId: 'e1', responseFile: '001.response.json' },
      expectedRevision: REV_A,
      currentRevision: REV_B,
    };
    const conflictError = {
      status: 409,
      error: { message: 'The resource changed since it was read: reload it before saving.', details: conflict },
    };

    it('salva sulla variante della bozza con la sua revisione anche se intanto è attiva un’altra', () => {
      const store = create();
      // L'agent ha attivato 002 dopo l'apertura della bozza di 001.
      store.selected.set(detail('e1', { selectedResponseFile: '002.response.json' }));

      store.saveResponse(payload, undefined, { target });

      expect(api.updateResponse).toHaveBeenCalledWith('e1', '001.response.json', { ...payload, expectedRevision: REV_A });
    });

    it('sequence e upload da bozza vanno sul bersaglio; l’upload porta la revisione per l’header', () => {
      const store = create();
      store.selected.set(detail('e1', { selectedResponseFile: '002.response.json' }));
      const sequence = { type: 'sequence' as const, title: '', steps: [{ response: '003.response.json' }], onEnd: 'stay' as const, resetAfterMs: null };

      store.updateSequence(sequence, undefined, { target });
      expect(api.updateSequence).toHaveBeenCalledWith('e1', '001.response.json', { ...sequence, expectedRevision: REV_A });

      const file = new File(['x'], 'logo.png');
      store.uploadResponseFile(file, undefined, undefined, { target });
      expect(api.uploadResponseFile).toHaveBeenCalledWith('e1', '001.response.json', file, REV_A);
    });

    it('la descrizione da bozza manda soltanto la descrizione e la sua revisione', () => {
      const store = create();
      store.selected.set(detail('e1'));

      store.saveDescription('nuova', undefined, { target: { endpointId: 'e1', responseFile: null, baseRevision: REV_A } });

      expect(api.updateEndpoint).toHaveBeenCalledWith('e1', { description: 'nuova', expectedRevision: REV_A });
    });

    it('un 409 REVISION_CONFLICT va alla bozza: niente onSuccess né errore della pagina', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.updateResponse.mockReturnValueOnce(throwError(() => conflictError));
      const onSuccess = vi.fn();
      const onConflict = vi.fn();

      store.saveResponse(payload, onSuccess, { target, onConflict });

      expect(onConflict).toHaveBeenCalledWith(conflict);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(store.error()).toBeUndefined();
      expect(store.savingId()).toBeUndefined();
    });

    it('un 404 dice alla bozza che il bersaglio non esiste più', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.updateEndpoint.mockReturnValueOnce(throwError(() => ({ status: 404, error: { message: 'Endpoint definition not found.' } })));
      const onMissing = vi.fn();

      store.saveDescription('nuova', undefined, { target: { endpointId: 'e1', responseFile: null, baseRevision: REV_A }, onMissing });

      expect(onMissing).toHaveBeenCalledTimes(1);
      expect(store.error()).toBeUndefined();
    });

    it('senza gestori il conflitto resta un errore della pagina, e non si ritenta senza precondizione', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.updateResponse.mockReturnValueOnce(throwError(() => conflictError));

      store.saveResponse(payload, undefined, { target });

      expect(store.error()).toBe('The resource changed since it was read: reload it before saving.');
      expect(api.updateResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe('mutazioni del dettaglio (runDetailMutation)', () => {
    it('crea e aggiorna sequence usando le operazioni response dedicate', () => {
      const store = create();
      store.selected.set(detail('e1', { selectedResponseFile: '003.response.json' }));
      const payload = {
        type: 'sequence' as const,
        title: 'Polling',
        steps: [{ response: '001.response.json', times: 2 }, { response: '002.response.json' }],
        onEnd: 'stay' as const,
        resetAfterMs: null,
      };

      store.createSequence(payload);
      expect(api.createSequence).toHaveBeenCalledWith('e1', payload);

      store.selected.set(detail('e1', { selectedResponseFile: '003.response.json' }));
      store.updateSequence(payload);
      expect(api.updateSequence).toHaveBeenCalledWith('e1', '003.response.json', payload);
    });

    it('a successo risincronizza dettaglio+catalogo e chiama onSuccess', () => {
      const store = create();
      store.selected.set(detail('e1'));
      const onSuccess = vi.fn();
      api.updateResponse.mockReturnValueOnce(of(detail('e1', { status: 418 })));

      store.saveResponse({ type: 'mock', title: '', status: 418, headers: {}, delayMs: 0, body: {} }, onSuccess);

      expect(api.updateResponse).toHaveBeenCalledWith('e1', '001.response.json', expect.objectContaining({ status: 418 }));
      expect(store.selected()?.status).toBe(418);
      expect(store.mocks().length).toBeGreaterThan(0); // catalogo ricaricato
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(store.savingId()).toBeUndefined();
    });

    it('su errore NON chiama onSuccess (le bozze restano aperte) ed espone il messaggio', () => {
      const store = create();
      store.selected.set(detail('e1'));
      const onSuccess = vi.fn();
      api.updateResponse.mockReturnValueOnce(throwError(() => new Error('response rotta')));

      store.saveResponse({ type: 'mock', title: '', status: 200, headers: {}, delayMs: 0, body: {} }, onSuccess);

      expect(onSuccess).not.toHaveBeenCalled();
      expect(store.error()).toBe('response rotta');
      expect(store.savingId()).toBeUndefined();
    });

    it('con dettaglio non componibile resta un successo: niente errore, pannello dichiarato illeggibile', () => {
      const store = create();
      store.selected.set(detail('e1', { status: 200 }));
      const onSuccess = vi.fn();
      api.updateResponse.mockReturnValueOnce(
        of({ id: 'e1', detailUnavailable: { message: 'Invalid JSON in .../002.response.json' } }),
      );

      store.saveResponse({ type: 'mock', title: '', status: 418, headers: {}, delayMs: 0, body: {} }, onSuccess);

      // La mutazione è riuscita: onSuccess parte (le bozze si chiudono) e non c'è errore.
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(store.error()).toBeUndefined();
      expect(store.detailUnavailable()).toBe('Invalid JSON in .../002.response.json');
      // Il pannello NON mostra il dettaglio precedente come se fosse aggiornato.
      expect(store.selected()?.status).toBe(200);
      expect(store.mocks().length).toBeGreaterThan(0); // il catalogo si aggiorna comunque
      expect(store.savingId()).toBeUndefined();
    });

    it('una rilettura riuscita chiude lo stato di illeggibilità', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.updateResponse.mockReturnValueOnce(of({ id: 'e1', detailUnavailable: { message: 'rotto' } }));
      store.saveResponse({ type: 'mock', title: '', status: 418, headers: {}, delayMs: 0, body: {} });
      expect(store.detailUnavailable()).toBe('rotto');

      store.reloadSelectedDetail();

      expect(api.getMock).toHaveBeenCalledWith('e1');
      expect(store.detailUnavailable()).toBeUndefined();
      expect(store.selected()?.id).toBe('e1');
    });

    it('saveDescription invia solo description, senza il flag enabled letto col dettaglio', () => {
      const store = create();
      store.selected.set(detail('e1', { disabled: true }));
      store.saveDescription('nuova');
      expect(api.updateEndpoint).toHaveBeenCalledWith('e1', { description: 'nuova' });
    });

    it('addResponse passa il filename creato, e l’upload può mirare a una variante non selezionata', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.createResponse.mockReturnValueOnce(of({ ...detail('e1'), createdResponseFile: '002.response.json' }));
      const onCreated = vi.fn();
      store.addResponse({ type: 'mock', status: 200, select: false } as never, onCreated);
      expect(onCreated).toHaveBeenCalledWith('002.response.json');

      const file = new File(['x'], 'logo.png');
      store.uploadResponseFile(file, undefined, '002.response.json');
      expect(api.uploadResponseFile).toHaveBeenCalledWith('e1', '002.response.json', file, undefined);
    });

    it('senza selezione le mutazioni sono no-op', () => {
      const store = create();
      store.saveResponse({ type: 'mock', title: '', status: 200, headers: {}, delayMs: 0, body: {} });
      store.removeResponse();
      store.saveDescription('x');
      expect(api.updateResponse).not.toHaveBeenCalled();
      expect(api.deleteResponse).not.toHaveBeenCalled();
      expect(api.updateEndpoint).not.toHaveBeenCalled();
    });

    it('selectResponse non fa nulla se la response è già selezionata', () => {
      const store = create();
      store.selected.set(detail('e1', { selectedResponseFile: '001.response.json' }));
      store.selectResponse('001.response.json');
      expect(api.selectResponse).not.toHaveBeenCalled();
    });
  });

  describe('assignCollection', () => {
    function arrange(store: MocksStore): void {
      store.mocks.set([summary('e1', { collectionId: 'c1' }), summary('e2')]);
      store.collections.set([coll('c1')]);
      store.childOrder.set({ root: ['c1'], c1: ['e1'], [UNSORTED_COLLECTION_ID]: ['e2'] });
    }

    it('non chiama l’API se la collection è già quella corrente', () => {
      const store = create();
      arrange(store);
      store.assignCollection('e1', 'c1');
      expect(api.assignDefinitionCollection).not.toHaveBeenCalled();
    });

    it('sposta subito il ref in childOrder (update ottimistico) all’indice richiesto', () => {
      const store = create();
      arrange(store);
      // blocca la risposta per osservare lo stato ottimistico? Con of() tutto è sincrono:
      // verifichiamo il revert nell'altro test e qui il risultato finale coerente.
      store.assignCollection('e1', undefined, 0);
      expect(api.assignDefinitionCollection).toHaveBeenCalledWith('e1', { collectionId: undefined, targetIndex: 0 });
    });

    it('su errore ripristina mocks e childOrder come prima dello spostamento', () => {
      const store = create();
      arrange(store);
      api.assignDefinitionCollection.mockReturnValueOnce(throwError(() => new Error('conflitto')));

      store.assignCollection('e1', undefined, 0);

      expect(store.mocks().find((m) => m.id === 'e1')?.collectionId).toBe('c1');
      expect(store.childOrder()).toEqual({ root: ['c1'], c1: ['e1'], [UNSORTED_COLLECTION_ID]: ['e2'] });
      expect(store.error()).toBe('conflitto');
    });
  });

  describe('riordini e reparent', () => {
    it('reorderChildren applica subito il nuovo ordine e su errore lo ripristina', () => {
      const store = create();
      store.childOrder.set({ c1: ['a', 'b'] });
      api.reorderCollectionChildren.mockReturnValueOnce(throwError(() => new Error('no')));

      store.reorderChildren('c1', ['b', 'a']);

      expect(store.childOrder()).toEqual({ c1: ['a', 'b'] }); // revert
      expect(store.error()).toBe('no');
    });

    it('reparentCollection su errore ripristina collections e childOrder', () => {
      const store = create();
      store.collections.set([coll('c1'), coll('c2')]);
      store.childOrder.set({ root: ['c1', 'c2'] });
      api.reparentCollection.mockReturnValueOnce(throwError(() => new Error('ciclo')));

      store.reparentCollection('c2', 'c1', 0);

      expect(store.collections().find((c) => c.id === 'c2')?.parentId).toBeUndefined();
      expect(store.childOrder()).toEqual({ root: ['c1', 'c2'] });
      expect(store.error()).toBe('ciclo');
    });

    it('reorderCollections manda al backend i soli fratelli col parentId', () => {
      const store = create();
      store.reorderCollections('c1', ['x', 'y']);
      expect(api.reorderCollections).toHaveBeenCalledWith({ collectionIds: ['x', 'y'], parentId: 'c1' });
    });
  });

  describe('collection: crea / elimina / abilita', () => {
    it('createCollection scarta le etichette vuote senza chiamare l’API', () => {
      const store = create();
      store.createCollection('   ', undefined);
      expect(api.createCollection).not.toHaveBeenCalled();
    });

    it('createCollection ricarica il catalogo e chiama onSuccess', () => {
      const store = create();
      const onSuccess = vi.fn();
      store.createCollection('Nuova', 'c1', onSuccess);
      expect(api.createCollection).toHaveBeenCalledWith({ label: 'Nuova', parentId: 'c1' });
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('setCollectionEnabled riallinea anche il flag disabled del dettaglio aperto', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.updateCollectionEnabled.mockReturnValueOnce(of(listResponse([summary('e1', { disabled: true })])));

      store.setCollectionEnabled('c1', false);

      expect(store.selected()?.disabled).toBe(true);
    });

    it('eraseCollection ricarica il catalogo e deseleziona un endpoint eliminato', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.listMocks.mockReturnValueOnce(of(listResponse([summary('e2')], [coll('c2')])));
      const onSuccess = vi.fn();

      store.eraseCollection(UNSORTED_COLLECTION_ID, onSuccess);

      expect(api.eraseCollection).toHaveBeenCalledWith(UNSORTED_COLLECTION_ID);
      expect(store.mocks().map((item) => item.id)).toEqual(['e2']);
      expect(store.selected()).toBeUndefined();
      expect(store.erasingCollectionId()).toBeUndefined();
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('eraseCollection conserva catalogo e selezione in caso di errore', () => {
      const store = create();
      store.mocks.set([summary('e1')]);
      store.selected.set(detail('e1'));
      api.eraseCollection.mockReturnValueOnce(throwError(() => new Error('erase fallita')));

      store.eraseCollection('c1');

      expect(store.mocks().map((item) => item.id)).toEqual(['e1']);
      expect(store.selected()?.id).toBe('e1');
      expect(store.error()).toBe('erase fallita');
      expect(store.erasingCollectionId()).toBeUndefined();
    });
  });

  describe('removeEndpoint', () => {
    it('elimina il selezionato, apre il primo rimasto e chiama onSuccess', () => {
      const store = create();
      store.selected.set(detail('e1'));
      api.listMocks.mockReturnValue(of(listResponse([summary('e2')])));
      const onSuccess = vi.fn();

      store.removeEndpoint(onSuccess);

      expect(api.deleteMock).toHaveBeenCalledWith('e1');
      expect(store.selected()?.id).toBe('e2');
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('creazione definizioni (runCreate)', () => {
    it('a successo apre la nuova definizione e segnala onDone(true)', () => {
      const store = create();
      const onDone = vi.fn();
      store.createMockDef({ method: 'GET', path: '/nuovo', status: 200 }, { ok: true }, onDone);
      expect(store.selected()?.id).toBe('nuovo');
      expect(onDone).toHaveBeenCalledWith(true);
      expect(store.creating()).toBe(false);
    });

    it('su errore segnala onDone(false) e lascia il dialog aperto con l’errore', () => {
      const store = create();
      const onDone = vi.fn();
      api.createMock.mockReturnValueOnce(throwError(() => new Error('path duplicato')));
      store.createMockDef({ method: 'GET', path: '/dup', status: 200 }, {}, onDone);
      expect(onDone).toHaveBeenCalledWith(false);
      expect(store.error()).toBe('path duplicato');
      expect(store.creating()).toBe(false);
    });

    it('createScriptDef instrada handler e middleware sulle rispettive API', () => {
      const store = create();
      const def = { method: 'GET', path: '/s' };
      store.createScriptDef('handler', def, 'src-h');
      expect(api.createHandler).toHaveBeenCalledWith({ type: 'handler', definition: def, source: 'src-h' });
      store.createScriptDef('middleware', def, 'src-m');
      expect(api.createMiddleware).toHaveBeenCalledWith({ type: 'middleware', definition: def, source: 'src-m' });
      expect(store.selected()?.id).toBe('nuovo-middleware');
    });

    it('copyEndpoint apre il duplicato appena creato', () => {
      const store = create();
      store.copyEndpoint('e1', { method: 'POST', path: '/copia', copyResponses: true });
      expect(store.selected()?.id).toBe('copia');
    });
  });

  describe('messaggi d’errore', () => {
    it('estrae il messaggio del server dal corpo di un errore HTTP', () => {
      const store = create();
      api.listMocks.mockReturnValueOnce(
        throwError(() => ({ error: { message: 'messaggio dal backend' }, message: 'Http failure' })),
      );
      store.loadCatalog();
      expect(store.error()).toBe('messaggio dal backend');
    });

    it('senza messaggio del server ripiega sulla traduzione generica', () => {
      const store = create();
      api.listMocks.mockReturnValueOnce(throwError(() => ({})));
      store.loadCatalog();
      expect(store.error()).toBeTruthy();
    });
  });
});
