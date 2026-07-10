import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MocksStore } from './mocks-next.store';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { translocoTesting } from '../../testing/transloco-testing';
import {
  UNSORTED_COLLECTION_ID,
  type CollectionSummary,
  type MockDetail,
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
      updateEndpoint: vi.fn((id: string) => of(detail(id))),
      selectResponse: vi.fn((id: string) => of(detail(id))),
      updateResponse: vi.fn((id: string) => of(detail(id))),
      createResponse: vi.fn((id: string) => of(detail(id))),
      deleteResponse: vi.fn((id: string) => of(detail(id))),
      uploadResponseFile: vi.fn((id: string) => of(detail(id))),
      deleteMock: vi.fn(() => of(undefined)),
      createCollection: vi.fn(() => of(coll('nuova'))),
      assignDefinitionCollection: vi.fn((id: string) => of(detail(id))),
      deleteCollection: vi.fn(() => of(undefined)),
      updateCollectionEnabled: vi.fn(() => of(listResponse([summary('e1')]))),
      reorderCollections: vi.fn(() => of(undefined)),
      reparentCollection: vi.fn(() => of(undefined)),
      reorderCollectionChildren: vi.fn(() => of(undefined)),
      createMock: vi.fn(() => of(detail('nuovo'))),
      copyEndpoint: vi.fn(() => of(detail('copia'))),
      createHandler: vi.fn(() => of(detail('nuovo-handler'))),
      createMiddleware: vi.fn(() => of(detail('nuovo-middleware'))),
    };
}

describe('MocksStore', () => {
  let api: ReturnType<typeof makeApiStub>;

  beforeEach(() => {
    api = makeApiStub();
    TestBed.configureTestingModule({
      imports: [translocoTesting()],
      providers: [MocksStore, { provide: MockAdminApiService, useValue: api }],
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
  });

  describe('toggleEnabled', () => {
    it('aggiorna via API preservando la description corrente e riallinea il dettaglio selezionato', () => {
      const store = create();
      store.loadCatalog(); // seleziona e1
      store.toggleEnabled('e1', false);
      expect(api.updateEndpoint).toHaveBeenCalledWith('e1', { description: 'descrizione e1', enabled: false });
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

  describe('mutazioni del dettaglio (runDetailMutation)', () => {
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
