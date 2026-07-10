import { computed, inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, switchMap } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { MockAdminApiService } from '../../mock-admin-api.service';
import {
  CollectionSummary,
  CreateResponseRequest,
  EndpointCopyRequest,
  HandlerDefinitionInput,
  MockConfig,
  MockDetail,
  MockListResponse,
  MockSummary,
  MockType,
  ResponseUpdateRequest,
  UNSORTED_COLLECTION_ID,
} from '../../mock-admin-api.types';

/** Riga endpoint del catalogo (view-model). */
export interface CatalogEndpointVM {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly status: number | null;
  readonly type: MockType;
  readonly enabled: boolean;
  readonly responses: number;
  readonly collectionId?: string;
}

/** Collection del catalogo, appiattita con la propria profondita' (view-model). */
export interface CatalogCollectionVM {
  readonly id: string;
  readonly name: string;
  readonly count: number;
  readonly depth: number;
  readonly parentId?: string;
  readonly endpoints: readonly CatalogEndpointVM[];
}

/** Figlio di un nodo del catalogo: endpoint o sotto-collection, nell'ordine unificato di rendering. */
export type CatalogChild =
  | { readonly kind: 'endpoint'; readonly endpoint: CatalogEndpointVM }
  | { readonly kind: 'collection'; readonly node: CatalogTreeNode };

/** Nodo dell'albero catalogo annidato: collection + figli misti ordinati (endpoint e sotto-collection). */
export interface CatalogTreeNode {
  readonly collection: CatalogCollectionVM;
  readonly children: readonly CatalogChild[];
}

/** Chiave del genitore "radice" nell'ordine unificato (collection di primo livello). */
const ROOT_ORDER_KEY = 'root';

export type TypeFilter = 'all' | 'mock' | 'handler' | 'middleware';
export type StatusFilter = 'all' | 'on' | 'off';

/**
 * Store della schermata Mocks (Fase A: sola lettura). Estrae la logica dati dal
 * container PrimeNG: carica catalogo + dettaglio, espone signals e il catalogo
 * gia' alberato. Le mutazioni arriveranno nelle fasi successive.
 */
@Injectable()
export class MocksStore {
  private readonly api = inject(MockAdminApiService);
  private readonly transloco = inject(TranslocoService);

  readonly mocks = signal<readonly MockSummary[]>([]);
  readonly collections = signal<readonly CollectionSummary[]>([]);
  /** Ordine unificato dei figli per nodo (parentKey → ref miste di id endpoint e/o id collection). */
  readonly childOrder = signal<Readonly<Record<string, readonly string[]>>>({});
  readonly selected = signal<MockDetail | undefined>(undefined);
  readonly loading = signal(false);
  readonly detailLoading = signal(false);
  readonly error = signal<string | undefined>(undefined);
  /** Id dell'endpoint con una mutazione in corso (per disabilitare i controlli). */
  readonly savingId = signal<string | undefined>(undefined);
  /** Creazione di una nuova definizione in corso (dialog "Nuovo"). */
  readonly creating = signal(false);

  /** Filtri del catalogo (Fase B). */
  readonly searchTerm = signal('');
  readonly typeFilter = signal<TypeFilter>('all');
  readonly statusFilter = signal<StatusFilter>('all');

  /** Mock filtrati per ricerca + tipo + stato. */
  private readonly filteredMocks = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    const type = this.typeFilter();
    const status = this.statusFilter();
    return this.mocks().filter((m) => {
      const matchesQuery =
        query === '' ||
        [m.method, m.path, m.type, m.configFilePath].some((v) => String(v).toLowerCase().includes(query));
      const matchesType = type === 'all' || m.type === type;
      const matchesStatus = status === 'all' || (status === 'on' && !m.disabled) || (status === 'off' && m.disabled);
      return matchesQuery && matchesType && matchesStatus;
    });
  });

  /** Foresta del catalogo (radici reali + Unsorted) costruita sui mock filtrati e su childOrder. */
  private readonly catalogForest = computed(() =>
    buildCatalogForest(this.filteredMocks(), this.collections(), this.childOrder()),
  );
  /** Collection di primo livello (Unsorted escluso), come albero annidato con figli misti ordinati. */
  readonly catalogTree = computed(() => this.catalogForest().roots);
  /** Nodo Unsorted (solo endpoint), o null se non ci sono non categorizzati. */
  readonly unsortedNode = computed(() => this.catalogForest().unsorted);
  /** True se non c'è nulla da mostrare (né collection radice né Unsorted). */
  readonly catalogIsEmpty = computed(() => this.catalogTree().length === 0 && this.unsortedNode() == null);
  /** Id collassabili (tutte le collection + Unsorted), per "collassa tutto". */
  readonly collapsibleIds = computed(() => [
    ...this.collections().map((collection) => collection.id),
    UNSORTED_COLLECTION_ID,
  ]);
  readonly totalEndpoints = computed(() => this.mocks().length);
  readonly totalCollections = computed(() => this.collections().length);
  readonly activeEndpoints = computed(() => this.mocks().filter((m) => !m.disabled).length);
  readonly selectedId = computed(() => this.selected()?.id);
  readonly hasActiveFilter = computed(
    () => this.searchTerm().trim() !== '' || this.typeFilter() !== 'all' || this.statusFilter() !== 'all',
  );
  /** Solo i filtri del menu (tipo/stato), per l'indicatore sull'icona Filtri (la ricerca ha il suo input). */
  readonly hasMenuFilter = computed(() => this.typeFilter() !== 'all' || this.statusFilter() !== 'all');

  /**
   * Carica l'elenco completo e, se non c'e' selezione, apre il primo endpoint — oppure quello che combacia
   * con `preselect` (metodo + route), usato dal monitor per il "Vai al mock".
   */
  loadCatalog(preselect?: { method: string; path: string }): void {
    this.loading.set(true);
    this.error.set(undefined);
    this.api
      .listMocks()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          if (this.selected() === undefined && res.items.length > 0) {
            const target = preselect
              ? res.items.find((m) => m.method === preselect.method && m.path === preselect.path)
              : undefined;
            this.selectMock((target ?? res.items[0]).id);
          }
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /** Ricarica dal disco catalogo + dettaglio selezionato (reload manuale, es. dopo modifiche ai file). */
  reload(): void {
    this.loading.set(true);
    this.error.set(undefined);
    const selId = this.selected()?.id;
    this.api
      .listMocks()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          if (selId && res.items.some((i) => i.id === selId)) {
            this.api.getMock(selId).subscribe({ next: (d) => this.selected.set(d), error: () => undefined });
          } else {
            this.selected.set(undefined);
            if (res.items.length > 0) this.selectMock(res.items[0].id);
          }
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /** Carica il dettaglio di un endpoint e lo rende selezionato. */
  selectMock(id: string): void {
    if (this.selected()?.id === id) {
      return;
    }
    this.detailLoading.set(true);
    this.error.set(undefined);
    this.api
      .getMock(id)
      .pipe(finalize(() => this.detailLoading.set(false)))
      .subscribe({
        next: (detail) => this.selected.set(detail),
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /**
   * Abilita/disabilita un endpoint (update ottimistico + `updateEndpoint`, che
   * richiede anche la description corrente → la legge da getMock). Ricarica il
   * catalogo e riallinea il dettaglio se l'endpoint toccato e' quello selezionato.
   */
  toggleEnabled(id: string, enabled: boolean): void {
    const previous = this.mocks();
    this.mocks.set(previous.map((m) => (m.id === id ? { ...m, disabled: !enabled } : m)));
    this.savingId.set(id);
    this.error.set(undefined);
    this.api
      .getMock(id)
      .pipe(
        switchMap((detail) => this.api.updateEndpoint(id, { description: detail.endpoint?.description ?? '', enabled })),
        switchMap((updated) => this.api.listMocks().pipe(map((res) => ({ updated, res })))),
        finalize(() => this.savingId.set(undefined)),
      )
      .subscribe({
        next: ({ updated, res }) => {
          this.applyCatalogResponse(res);
          if (this.selected()?.id === id) {
            this.selected.set(updated);
          }
        },
        error: (e) => {
          this.mocks.set(previous);
          this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError'));
        },
      });
  }

  /**
   * Cambia la response selezionata dell'endpoint aperto (`selectResponse`). Passa da
   * runDetailMutation così ricarica il catalogo: l'item riflette il tipo (mock/handler/
   * middleware) e lo status della response ora selezionata.
   */
  selectResponse(fileName: string): void {
    const sel = this.selected();
    if (!sel || sel.selectedResponseFile === fileName) {
      return;
    }
    this.runDetailMutation(sel.id, this.api.selectResponse(sel.id, { selectedResponseFile: fileName }));
  }

  /** Salva la response selezionata (body/headers/status/delay per mock, source per script). */
  saveResponse(payload: ResponseUpdateRequest, onSuccess?: () => void): void {
    const sel = this.selected();
    const fileName = sel?.selectedResponseFile;
    if (!sel || !fileName) {
      return;
    }
    this.runDetailMutation(sel.id, this.api.updateResponse(sel.id, fileName, payload), onSuccess);
  }

  /** Crea una nuova response per l'endpoint selezionato e la rende selezionata. */
  addResponse(payload: CreateResponseRequest, onSuccess?: () => void): void {
    const sel = this.selected();
    if (!sel) {
      return;
    }
    this.runDetailMutation(sel.id, this.api.createResponse(sel.id, payload), onSuccess);
  }

  /** Elimina la response selezionata dell'endpoint aperto. */
  removeResponse(onSuccess?: () => void): void {
    const sel = this.selected();
    const fileName = sel?.selectedResponseFile;
    if (!sel || !fileName) {
      return;
    }
    this.runDetailMutation(sel.id, this.api.deleteResponse(sel.id, fileName), onSuccess);
  }

  /** Carica un file per la response selezionata (la rende file-backed). */
  uploadResponseFile(file: File, onSuccess?: () => void): void {
    const sel = this.selected();
    const fileName = sel?.selectedResponseFile;
    if (!sel || !fileName) {
      return;
    }
    this.runDetailMutation(sel.id, this.api.uploadResponseFile(sel.id, fileName, file), onSuccess);
  }

  /** Aggiorna la descrizione dell'endpoint selezionato (preserva il flag enabled). */
  saveDescription(description: string, onSuccess?: () => void): void {
    const sel = this.selected();
    if (!sel) {
      return;
    }
    this.runDetailMutation(
      sel.id,
      this.api.updateEndpoint(sel.id, { description, enabled: !sel.disabled }),
      onSuccess,
    );
  }

  /** Elimina l'endpoint selezionato e apre il primo rimasto. */
  removeEndpoint(onSuccess?: () => void): void {
    const sel = this.selected();
    if (!sel) {
      return;
    }
    const id = sel.id;
    this.savingId.set(id);
    this.error.set(undefined);
    this.api
      .deleteMock(id)
      .pipe(
        switchMap(() => this.api.listMocks()),
        finalize(() => this.savingId.set(undefined)),
      )
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          this.selected.set(undefined);
          if (res.items.length > 0) {
            this.selectMock(res.items[0].id);
          }
          onSuccess?.();
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  // --- collection (Fase D2) ---

  /** Crea una nuova collection del catalogo e ricarica. */
  createCollection(label: string, parentId: string | undefined, onSuccess?: () => void): void {
    const trimmed = label.trim();
    if (trimmed === '') {
      return;
    }
    this.error.set(undefined);
    this.api
      .createCollection({ label: trimmed, parentId })
      .pipe(switchMap(() => this.api.listMocks()))
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          onSuccess?.();
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /** Assegna (o rimuove → Unsorted) la collection di un endpoint, con update ottimistico. */
  assignCollection(itemId: string, collectionId: string | undefined, targetIndex?: number): void {
    const normalized = collectionId?.trim() || undefined;
    const target = this.mocks().find((m) => m.id === itemId);
    if (!target || (target.collectionId || undefined) === normalized) {
      return;
    }
    const previousMocks = this.mocks();
    const previousChildOrder = this.childOrder();
    this.mocks.set(previousMocks.map((m) => (m.id === itemId ? { ...m, collectionId: normalized } : m)));
    this.applyChildMoveOptimistic(itemId, normalized ?? UNSORTED_COLLECTION_ID, targetIndex);
    this.savingId.set(itemId);
    this.error.set(undefined);
    this.api
      .assignDefinitionCollection(itemId, { collectionId: normalized, targetIndex })
      .pipe(
        switchMap((detail) => this.api.listMocks().pipe(map((res) => ({ detail, res })))),
        finalize(() => this.savingId.set(undefined)),
      )
      .subscribe({
        next: ({ detail, res }) => {
          this.applyCatalogResponse(res);
          if (this.selected()?.id === itemId) {
            this.selected.set(detail);
          }
        },
        error: (e) => {
          this.mocks.set(previousMocks);
          this.childOrder.set(previousChildOrder);
          this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError'));
        },
      });
  }

  /** Elimina una collection (gli endpoint tornano in Unsorted lato backend) e ricarica. */
  deleteCollection(id: string, onSuccess?: () => void): void {
    this.error.set(undefined);
    this.api
      .deleteCollection(id)
      .pipe(switchMap(() => this.api.listMocks()))
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          onSuccess?.();
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /** Abilita/disabilita in blocco tutti gli endpoint di una collection (e sotto-collection). */
  setCollectionEnabled(id: string, enabled: boolean): void {
    this.error.set(undefined);
    this.api.updateCollectionEnabled(id, { enabled }).subscribe({
      next: (res) => {
        this.applyCatalogResponse(res);
        const sel = this.selected();
        if (sel) {
          const updated = res.items.find((i) => i.id === sel.id);
          if (updated) {
            this.selected.set({ ...sel, disabled: updated.disabled });
          }
        }
      },
      error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
    });
  }

  /** Riordina le collection sorelle di un dato parent (l'API vuole i soli fratelli + parentId) e ricarica. */
  reorderCollections(parentId: string | undefined, orderedSiblingIds: string[]): void {
    const previous = this.collections();
    this.error.set(undefined);
    this.api
      .reorderCollections({ collectionIds: orderedSiblingIds, parentId })
      .pipe(switchMap(() => this.api.listMocks()))
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
        },
        error: (e) => {
          this.collections.set(previous);
          this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError'));
        },
      });
  }

  /** Annida una collection sotto un nuovo genitore (o la riporta a root), opzionalmente a un indice, e ricarica. */
  reparentCollection(id: string, parentId: string | undefined, targetIndex?: number): void {
    const previousCollections = this.collections();
    const previousChildOrder = this.childOrder();
    this.collections.set(previousCollections.map((c) => (c.id === id ? { ...c, parentId } : c)));
    this.applyChildMoveOptimistic(id, parentId ?? ROOT_ORDER_KEY, targetIndex);
    this.error.set(undefined);
    this.api
      .reparentCollection(id, { parentId: parentId ?? null, targetIndex })
      .pipe(switchMap(() => this.api.listMocks()))
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
        },
        error: (e) => {
          this.collections.set(previousCollections);
          this.childOrder.set(previousChildOrder);
          this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError'));
        },
      });
  }

  /** Sposta in modo ottimistico un ref (id endpoint o id collection) nel childOrder, prima del round-trip. */
  private applyChildMoveOptimistic(ref: string, targetParentKey: string, targetIndex?: number): void {
    const next: Record<string, readonly string[]> = {};
    for (const [key, refs] of Object.entries(this.childOrder())) {
      const filtered = refs.filter((candidate) => candidate !== ref);
      if (filtered.length > 0) next[key] = filtered;
    }
    const bucket = [...(next[targetParentKey] ?? [])];
    const at = targetIndex == null ? bucket.length : Math.max(0, Math.min(targetIndex, bucket.length));
    bucket.splice(at, 0, ref);
    next[targetParentKey] = bucket;
    this.childOrder.set(next);
  }

  /**
   * Persiste l'ordine unificato dei figli di un nodo (endpoint + sotto-collection intercalati) dopo
   * un drag-drop NELLO STESSO genitore, poi ricarica catalogo + childOrder. `parentKey` = "root",
   * "unsorted" o un id collection; `childRefs` = id endpoint e/o id collection nel nuovo ordine.
   */
  reorderChildren(parentKey: string, childRefs: string[]): void {
    const previousChildOrder = this.childOrder();
    // childRefs è già nel formato di childOrder (id endpoint + id collection) → update ottimistico.
    this.childOrder.set({ ...previousChildOrder, [parentKey]: [...childRefs] });
    this.error.set(undefined);
    this.api
      .reorderCollectionChildren(parentKey, { childRefs })
      .pipe(switchMap(() => this.api.listMocks()))
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
        },
        error: (e) => {
          this.childOrder.set(previousChildOrder);
          this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError'));
        },
      });
  }

  // --- creazione definizioni (Fase D1) ---

  /** Crea un nuovo mock e lo apre. */
  createMockDef(config: MockConfig, body: unknown, onDone?: (ok: boolean) => void): void {
    this.runCreate(this.api.createMock({ config, body }), onDone);
  }

  /** Copia un endpoint verso un nuovo metodo+path (opz. tutte le response); ricarica il catalogo e apre il duplicato. */
  copyEndpoint(id: string, request: EndpointCopyRequest, onDone?: (ok: boolean) => void): void {
    this.runCreate(this.api.copyEndpoint(id, request), onDone);
  }

  /** Crea un nuovo handler o middleware e lo apre. */
  createScriptDef(
    type: 'handler' | 'middleware',
    definition: HandlerDefinitionInput,
    source: string,
    onDone?: (ok: boolean) => void,
  ): void {
    const op =
      type === 'handler'
        ? this.api.createHandler({ type: 'handler', definition, source })
        : this.api.createMiddleware({ type: 'middleware', definition, source });
    this.runCreate(op, onDone);
  }

  /** Crea una definizione, ricarica il catalogo e la rende selezionata; `onDone(ok)` per chiudere il dialog solo a buon fine. */
  private runCreate(op: Observable<MockDetail>, onDone?: (ok: boolean) => void): void {
    this.creating.set(true);
    this.error.set(undefined);
    op.pipe(
      switchMap((detail) => this.api.listMocks().pipe(map((res) => ({ detail, res })))),
      finalize(() => this.creating.set(false)),
    ).subscribe({
      next: ({ detail, res }) => {
        this.applyCatalogResponse(res);
        this.selected.set(detail);
        onDone?.(true);
      },
      error: (e) => {
        this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError'));
        onDone?.(false);
      },
    });
  }

  /** Applica una risposta del catalogo: sincronizza insieme mocks, collections e childOrder. */
  private applyCatalogResponse(res: MockListResponse): void {
    this.mocks.set(res.items);
    this.collections.set(res.collections);
    this.childOrder.set(res.childOrder);
  }

  /**
   * Esegue una mutazione che restituisce il MockDetail aggiornato, poi ricarica il
   * catalogo e risincronizza `selected`/`mocks`/`collections`. `savingId` disabilita
   * i controlli durante la scrittura; `onSuccess` scatta solo a salvataggio riuscito
   * (es. per uscire dalla modalita' modifica preservando le bozze in caso di errore).
   */
  private runDetailMutation(savingId: string, op: Observable<MockDetail>, onSuccess?: () => void): void {
    this.savingId.set(savingId);
    this.error.set(undefined);
    op.pipe(
      switchMap((detail) => this.api.listMocks().pipe(map((res) => ({ detail, res })))),
      finalize(() => this.savingId.set(undefined)),
    ).subscribe({
      next: ({ detail, res }) => {
        this.selected.set(detail);
        this.applyCatalogResponse(res);
        onSuccess?.();
      },
      error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
    });
  }
}

/**
 * Costruisce la foresta del catalogo (radici reali + nodo Unsorted) ordinando i figli di ogni nodo
 * secondo `childOrder` (endpoint e sotto-collection intercalati). Gli endpoint nascosti dai filtri
 * vengono esclusi; i ref non ancora presenti in childOrder sono accodati (endpoint, poi collection)
 * per restare robusti durante gli update ottimistici.
 */
function buildCatalogForest(
  items: readonly MockSummary[],
  collections: readonly CollectionSummary[],
  childOrder: Readonly<Record<string, readonly string[]>>,
): { roots: CatalogTreeNode[]; unsorted: CatalogTreeNode | null } {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));

  const fallbackEndpointIdsByBucket = new Map<string, string[]>();
  for (const item of items) {
    const key = item.collectionId?.trim() || UNSORTED_COLLECTION_ID;
    const bucket = fallbackEndpointIdsByBucket.get(key) ?? [];
    bucket.push(item.id);
    fallbackEndpointIdsByBucket.set(key, bucket);
  }
  const fallbackCollectionIdsByParent = new Map<string, string[]>();
  for (const collection of collections) {
    const key = collection.parentId || ROOT_ORDER_KEY;
    const bucket = fallbackCollectionIdsByParent.get(key) ?? [];
    bucket.push(collection.id);
    fallbackCollectionIdsByParent.set(key, bucket);
  }

  const orderedRefsFor = (parentKey: string): string[] => {
    const fallbackEndpoints = fallbackEndpointIdsByBucket.get(parentKey) ?? [];
    const fallbackCollections = fallbackCollectionIdsByParent.get(parentKey) ?? [];
    const desired = new Set<string>([...fallbackEndpoints, ...fallbackCollections]);
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const ref of childOrder[parentKey] ?? []) {
      if (desired.has(ref) && !seen.has(ref)) {
        seen.add(ref);
        ordered.push(ref);
      }
    }
    for (const ref of [...fallbackEndpoints, ...fallbackCollections]) {
      if (!seen.has(ref)) {
        seen.add(ref);
        ordered.push(ref);
      }
    }
    return ordered;
  };

  const buildNode = (collection: CollectionSummary, depth: number): CatalogTreeNode => {
    const children: CatalogChild[] = [];
    const endpoints: CatalogEndpointVM[] = [];
    for (const ref of orderedRefsFor(collection.id)) {
      const childCollection = collectionById.get(ref);
      if (childCollection) {
        children.push({ kind: 'collection', node: buildNode(childCollection, depth + 1) });
        continue;
      }
      const item = itemById.get(ref);
      if (item) {
        const endpoint = toEndpointVM(item);
        endpoints.push(endpoint);
        children.push({ kind: 'endpoint', endpoint });
      }
    }
    return {
      collection: {
        id: collection.id,
        name: collection.label,
        count: endpoints.length,
        depth,
        parentId: collection.parentId || undefined,
        endpoints,
      },
      children,
    };
  };

  const roots: CatalogTreeNode[] = [];
  for (const ref of orderedRefsFor(ROOT_ORDER_KEY)) {
    const collection = collectionById.get(ref);
    if (collection) {
      roots.push(buildNode(collection, 0));
    }
  }

  const unsortedEndpoints: CatalogEndpointVM[] = [];
  for (const ref of orderedRefsFor(UNSORTED_COLLECTION_ID)) {
    const item = itemById.get(ref);
    if (item) {
      unsortedEndpoints.push(toEndpointVM(item));
    }
  }
  const unsorted: CatalogTreeNode | null = unsortedEndpoints.length > 0
    ? {
        collection: {
          id: UNSORTED_COLLECTION_ID,
          name: 'Unsorted',
          count: unsortedEndpoints.length,
          depth: 0,
          endpoints: unsortedEndpoints,
        },
        children: unsortedEndpoints.map((endpoint) => ({ kind: 'endpoint', endpoint }) as CatalogChild),
      }
    : null;

  return { roots, unsorted };
}

function toEndpointVM(item: MockSummary): CatalogEndpointVM {
  return {
    id: item.id,
    method: item.method,
    path: item.path,
    status: item.status,
    type: item.type,
    enabled: !item.disabled,
    responses: item.responseCount ?? 0,
    collectionId: item.collectionId,
  };
}

/** Messaggio del server da errori runtime/HttpErrorResponse, o undefined (fallback tradotto dal chiamante). */
function readErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error != null && 'error' in error) {
    const httpError = error as { error?: { message?: string; error?: string }; message?: string };
    return httpError.error?.message || httpError.error?.error || httpError.message || undefined;
  }
  return undefined;
}
