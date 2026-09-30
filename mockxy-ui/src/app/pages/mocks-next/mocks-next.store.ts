import { computed, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, catchError, concatMap, defer, filter, finalize, from, map, of, switchMap, throwError, toArray, type MonoTypeOperatorFunction } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { isNotFoundError, isReadInconsistentError, readRevisionConflict } from '../../shared/read-error-message';
import { ViewStateService } from '../../shared/view-state.service';
import { RuntimeSyncStore, affects, type RuntimeSyncEvent } from '../../shared/runtime-sync.store';
import {
  CollectionSummary,
  CreateResponseRequest,
  EndpointCopyRequest,
  HandlerDefinitionInput,
  MockConfig,
  MockDetail,
  MockDetailAfterMutation,
  isDetailUnavailable,
  MockListResponse,
  MockLoadError,
  MockSummary,
  MockType,
  ResponseSequenceCreateRequest,
  ResponseSequenceUpdateRequest,
  ResponseUpdateRequest,
  UNSORTED_COLLECTION_ID,
  type DraftTarget,
  type RevisionConflict,
} from '../../mock-admin-api.types';

/**
 * Salvataggio da bozza (piano agent/API, §13 C4): il bersaglio fissato all'apertura, con la
 * revisione letta, e i gestori di un conflitto o di una risorsa sparita. Senza gestori quei casi
 * diventano un errore come gli altri.
 */
export interface DraftSave {
  target: DraftTarget;
  onConflict?: (conflict: RevisionConflict) => void;
  onMissing?: () => void;
}

/** Riga endpoint del catalogo (view-model). */
export interface CatalogEndpointVM {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly status: number | null;
  readonly type: MockType;
  readonly enabled: boolean;
  readonly responses: number;
  readonly sequenceActive: boolean;
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

/** Chiave (ViewStateService) dell'endpoint selezionato, ritrovato tornando sulla view. */
const SELECTED_ENDPOINT_STATE_KEY = 'mocks-selected';

export type TypeFilter = 'all' | MockType;
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
  private readonly viewState = inject(ViewStateService);
  private syncing = false;
  private syncQueued = false;
  // Una mutazione riuscita può restituire solo l’id: resta il bersaglio da rileggere,
  // anche quando il dettaglio conservato appartiene all’endpoint aperto prima della creazione.
  private readonly unavailableDetailId = signal<string | undefined>(undefined);
  // Cresce a ogni cambio di workspace: una lettura partita prima non installa niente dopo, perché
  // lo stesso id nella nuova istanza è un'altra risorsa.
  private workspaceEpoch = 0;

  constructor() {
    inject(RuntimeSyncStore)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => this.onSyncEvent(event));
  }

  readonly mocks = signal<readonly MockSummary[]>([]);
  readonly collections = signal<readonly CollectionSummary[]>([]);
  /** Ordine unificato dei figli per nodo (parentKey → ref miste di id endpoint e/o id collection). */
  readonly childOrder = signal<Readonly<Record<string, readonly string[]>>>({});
  /** Definizioni presenti su disco ma scartate dal caricamento (es. formato legacy): il catalogo le segnala invece di farle sparire in silenzio. */
  readonly loadErrors = signal<readonly MockLoadError[]>([]);
  readonly selected = signal<MockDetail | undefined>(undefined);
  /** La sincronizzazione non trova più l'endpoint aperto: il dettaglio resta, le bozze non si salvano. */
  readonly selectedGone = signal(false);
  /**
   * Il runtime ora serve un altro workspace: il dettaglio aperto appartiene al precedente e non si
   * aggiorna né si salva, neanche se la nuova istanza ha un endpoint con lo stesso id. Finisce
   * quando l'utente apre un endpoint della nuova istanza.
   */
  readonly staleWorkspace = signal(false);
  /** Cresce quando si apre una risorsa della nuova istanza: le bozze del workspace precedente decadono. */
  readonly workspaceGeneration = signal(0);
  /** Cresce a ogni rilettura di sincronizzazione applicata: le bozze su varianti non selezionate si ricontrollano. */
  readonly syncTick = signal(0);
  /**
   * Motivo per cui il dettaglio dell'endpoint selezionato non è leggibile dopo una mutazione
   * RIUSCITA. Non è un errore dell'operazione: la modifica è su disco, è la sua descrizione a
   * mancare finché il workspace non torna leggibile.
   */
  readonly detailUnavailable = signal<string | undefined>(undefined);
  readonly loading = signal(false);
  readonly detailLoading = signal(false);
  readonly error = signal<string | undefined>(undefined);
  /** Id dell'endpoint con una mutazione in corso (per disabilitare i controlli). */
  readonly savingId = signal<string | undefined>(undefined);
  readonly erasingCollectionId = signal<string | undefined>(undefined);
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

  /** Numero ricorsivo di endpoint interessati da un'azione massiva sulla collection. */
  collectionEndpointCount(id: string): number {
    if (id === UNSORTED_COLLECTION_ID) {
      return this.mocks().filter((item) => item.collectionId == null).length;
    }
    const subtreeIds = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const collection of this.collections()) {
        if (collection.parentId != null && subtreeIds.has(collection.parentId) && !subtreeIds.has(collection.id)) {
          subtreeIds.add(collection.id);
          changed = true;
        }
      }
    }
    return this.mocks().filter(
      (item) => item.collectionId != null && subtreeIds.has(item.collectionId),
    ).length;
  }
  readonly activeEndpoints = computed(() => this.mocks().filter((m) => !m.disabled).length);
  readonly selectedId = computed(() => this.unavailableDetailId() ?? this.selected()?.id);
  readonly hasActiveFilter = computed(
    () => this.searchTerm().trim() !== '' || this.typeFilter() !== 'all' || this.statusFilter() !== 'all',
  );
  /** Solo i filtri del menu (tipo/stato), per l'indicatore sull'icona Filtri (la ricerca ha il suo input). */
  readonly hasMenuFilter = computed(() => this.typeFilter() !== 'all' || this.statusFilter() !== 'all');

  /**
   * Carica l'elenco completo e, se non c'e' selezione, apre il primo endpoint — oppure quello che
   * combacia con `preselect` (metodo + route), usato dal monitor per il "Vai al mock" — oppure,
   * senza preselect, l'ultimo selezionato (persistito): tornando sulla view la si ritrova com'era.
   */
  loadCatalog(preselect?: { method: string; path: string }): void {
    this.loading.set(true);
    this.error.set(undefined);
    const epoch = this.workspaceEpoch;
    this.api
      .listMocks()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          // Partita prima di un cambio di workspace: l'elenco può essere del precedente, e quello
          // della nuova istanza lo porta la rilettura seguita al cambio.
          if (epoch !== this.workspaceEpoch) return;
          this.applyCatalogResponse(res);
          if (this.selected() === undefined && res.items.length > 0) {
            const rememberedId = this.viewState.read<string>(SELECTED_ENDPOINT_STATE_KEY);
            const target = preselect
              ? res.items.find((m) => m.method === preselect.method && m.path === preselect.path)
              : res.items.find((m) => m.id === rememberedId);
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
    // Col workspace cambiato il dettaglio aperto è del precedente: si riparte da una selezione nuova.
    const selId = this.staleWorkspace() ? undefined : this.selectedId();
    const epoch = this.workspaceEpoch;
    this.api
      .listMocks()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          // Come per la rilettura di sincronizzazione: un cambio di workspace intervenuto nel
          // frattempo annulla sia l'elenco sia la lettura del dettaglio omonimo.
          if (epoch !== this.workspaceEpoch) return;
          this.applyCatalogResponse(res);
          if (selId && res.items.some((i) => i.id === selId)) {
            // Il dettaglio aperto resta quello di prima; solo una lettura incompleta va segnalata.
            this.api.getMock(selId).subscribe({
              next: (d) => {
                if (epoch === this.workspaceEpoch) this.setSelected(d);
              },
              error: (e) => {
                if (isReadInconsistentError(e)) this.error.set(this.detailReadErrorMessage(e));
              },
            });
          } else {
            this.clearSelected();
            this.leaveStaleWorkspace();
            if (res.items.length > 0) this.selectMock(res.items[0].id);
          }
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /**
   * Carica il dettaglio di un endpoint e lo rende selezionato. Dopo un cambio di workspace anche lo
   * stesso id si rilegge: è una risorsa della nuova istanza, e aprirla chiude lo stato stantio.
   */
  selectMock(id: string): void {
    if (this.selected()?.id === id && !this.staleWorkspace() && !this.detailUnavailable()) {
      return;
    }
    this.detailLoading.set(true);
    this.error.set(undefined);
    const epoch = this.workspaceEpoch;
    this.api
      .getMock(id)
      .pipe(finalize(() => this.detailLoading.set(false)))
      .subscribe({
        next: (detail) => {
          if (epoch !== this.workspaceEpoch) return;
          this.leaveStaleWorkspace();
          this.setSelected(detail);
        },
        error: (e) => this.error.set(this.detailReadErrorMessage(e)),
      });
  }

  private onSyncEvent(event: RuntimeSyncEvent): void {
    if (event.kind === 'runtime' && event.workspaceChanged) {
      this.onWorkspaceChanged();
      return;
    }
    if (affects(event, 'catalog')) {
      this.syncRefresh();
    }
  }

  /**
   * Rilettura di sincronizzazione (piano agent/API, §7 S4): catalogo e dettaglio aperto, senza
   * indicatori di caricamento né toast. Una alla volta; se ne serve un'altra nel frattempo, una sola
   * segue. Il risultato si scarta se, mentre era in volo, lo stato è cambiato per un'altra strada
   * (mutazione, selezione, ricarica) o una mutazione è in corso: una rilettura in ritardo non
   * sovrascrive una risposta più recente. Le bozze non si toccano: il dettaglio cambia, i loro
   * bersagli e le loro basi no.
   */
  syncRefresh(): void {
    if (this.syncing) {
      this.syncQueued = true;
      return;
    }
    if (this.mutationInFlight()) {
      return;
    }
    this.syncing = true;
    const epoch = this.workspaceEpoch;
    const before = { mocks: this.mocks(), collections: this.collections(), childOrder: this.childOrder(), selected: this.selected(), selectedId: this.selectedId() };
    // Col workspace cambiato il dettaglio aperto non si rilegge: lo stesso id nella nuova istanza è
    // un'altra risorsa.
    const selectedId = this.staleWorkspace() ? undefined : before.selectedId;
    this.api
      .listMocks()
      .pipe(
        switchMap((res) =>
          // Workspace cambiato mentre l'elenco era in volo: niente dettaglio, niente risultato. La
          // rilettura in coda riparte dallo stato stantio.
          epoch !== this.workspaceEpoch
            ? EMPTY
            : selectedId != null && res.items.some((item) => item.id === selectedId)
            ? this.api.getMock(selectedId).pipe(
                map((detail): MockDetail | null => detail),
                // Dettaglio non leggibile adesso: resta quello mostrato, senza un toast a ogni giro.
                catchError(() => of(null)),
                map((detail) => ({ res, detail })),
              )
            : of({ res, detail: null }),
        ),
        finalize(() => {
          this.syncing = false;
          if (this.syncQueued) {
            this.syncQueued = false;
            this.syncRefresh();
          }
        }),
      )
      .subscribe({
        next: ({ res, detail }) => {
          const unchanged =
            this.mocks() === before.mocks &&
            this.collections() === before.collections &&
            this.childOrder() === before.childOrder &&
            this.selected() === before.selected &&
            this.selectedId() === before.selectedId;
          if (!unchanged || epoch !== this.workspaceEpoch || this.mutationInFlight()) {
            return;
          }
          this.applyCatalogResponse(res);
          if (selectedId != null) {
            this.selectedGone.set(!res.items.some((item) => item.id === selectedId));
            if (detail) {
              this.setSelected(detail);
            }
          }
          this.syncTick.update((tick) => tick + 1);
        },
        // Motore irraggiungibile: lo dice lo stato di collegamento nella status bar.
        error: () => undefined,
      });
  }

  /** Il runtime serve un altro workspace: si mostra il suo catalogo, il dettaglio aperto resta del precedente. */
  private onWorkspaceChanged(): void {
    this.workspaceEpoch += 1;
    // Le mutazioni in volo appartengono al runtime precedente: i loro esiti non toccheranno più la
    // GUI (vedi `sameWorkspace`), e i loro indicatori non bloccano la nuova istanza.
    this.savingId.set(undefined);
    this.erasingCollectionId.set(undefined);
    this.creating.set(false);
    this.staleWorkspace.set(this.selectedId() != null);
    this.selectedGone.set(false);
    this.syncRefresh();
  }

  /**
   * Lega gli esiti di una mutazione al workspace in cui è partita (piano agent/API, §13 C4): se nel
   * frattempo il runtime serve un altro workspace, risultato ed errore si scartano, quindi niente
   * dettaglio o catalogo installati, niente riletture concatenate né callback. La mutazione sul
   * server non si annulla. Va dopo la mutazione, perché la rilettura concatenata non parta, e in
   * coda, perché non si applichi una rilettura già in volo.
   */
  private sameWorkspace<T>(): MonoTypeOperatorFunction<T> {
    return (source) =>
      defer(() => {
        const epoch = this.workspaceEpoch;
        const current = () => epoch === this.workspaceEpoch;
        return source.pipe(
          filter(current),
          catchError((error: unknown) => (current() ? throwError(() => error) : EMPTY)),
        );
      });
  }

  /**
   * Richieste in sequenza di un'azione di massa, legate al workspace in cui è partita: ognuna
   * ricontrolla il workspace subito prima di partire e, se è cambiato, il batch si interrompe e le
   * richieste non ancora inviate non partono (non devono colpire la nuova istanza). Quelle già
   * eseguite restano sul server. L'interruzione arriva come errore, che `sameWorkspace` scarta.
   */
  private batchInWorkspace<T, R>(items: readonly T[], request: (item: T) => Observable<R>): Observable<R[]> {
    return defer(() => {
      const epoch = this.workspaceEpoch;
      return from(items).pipe(
        concatMap((item) =>
          defer(() => (epoch === this.workspaceEpoch ? request(item) : throwError(() => new Error('Workspace changed during the batch.')))),
        ),
        toArray(),
      );
    });
  }

  /** Come `finalize`, ma solo nello stesso workspace: gli indicatori della nuova istanza non si toccano. */
  private settle<T>(done: () => void): MonoTypeOperatorFunction<T> {
    return (source) =>
      defer(() => {
        const epoch = this.workspaceEpoch;
        return source.pipe(
          finalize(() => {
            if (epoch === this.workspaceEpoch) done();
          }),
        );
      });
  }

  /** Si apre una risorsa della nuova istanza: le bozze del workspace precedente decadono. */
  private leaveStaleWorkspace(): void {
    if (this.staleWorkspace()) {
      this.staleWorkspace.set(false);
      this.workspaceGeneration.update((generation) => generation + 1);
    }
  }

  private mutationInFlight(): boolean {
    return this.savingId() != null || this.erasingCollectionId() != null || this.creating();
  }

  /**
   * Abilita/disabilita un endpoint (update ottimistico + `updateEndpoint` col solo `enabled`: una
   * descrizione letta prima dell'azione e reinviata cancellerebbe una modifica concorrente).
   * Ricarica il catalogo e riallinea il dettaglio se l'endpoint toccato e' quello selezionato.
   */
  toggleEnabled(id: string, enabled: boolean): void {
    const previous = this.mocks();
    this.mocks.set(previous.map((m) => (m.id === id ? { ...m, disabled: !enabled } : m)));
    this.savingId.set(id);
    this.error.set(undefined);
    this.api
      .updateEndpoint(id, { enabled })
      .pipe(
        this.sameWorkspace(),
        switchMap((updated) => this.api.listMocks().pipe(map((res) => ({ updated, res })))),
        this.sameWorkspace(),
        this.settle(() => this.savingId.set(undefined)),
      )
      .subscribe({
        next: ({ updated, res }) => {
          this.applyCatalogResponse(res);
          if (this.selectedId() === id) {
            this.applyMutationDetail(updated);
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

  /** Crea una nuova variante sequence: la seleziona, salvo `select: false` (preparazione). */
  createSequence(sequence: ResponseSequenceCreateRequest, onSuccess?: () => void): void {
    const sel = this.selected();
    if (!sel) {
      return;
    }
    this.runDetailMutation(sel.id, this.api.createSequence(sel.id, sequence), onSuccess);
  }

  /**
   * Aggiorna una variante sequence per filename. Da bozza (`draft`) salva sul bersaglio fissato
   * all'apertura con la sua revisione; altrimenti sulla variante selezionata, senza precondizione.
   */
  updateSequence(sequence: ResponseSequenceUpdateRequest, onSuccess?: () => void, draft?: DraftSave): void {
    const target = this.responseTarget(draft);
    if (!target) {
      return;
    }
    this.runDetailMutation(
      target.endpointId,
      this.api.updateSequence(target.endpointId, target.responseFile, { ...sequence, ...target.precondition }),
      onSuccess,
      draft,
    );
  }

  /**
   * Salva una response (body/headers/status/delay per mock, source per script). Da bozza (`draft`)
   * salva sul bersaglio fissato all'apertura con la sua revisione: una modifica ad A non finisce
   * in B se nel frattempo la selezione è cambiata. Le azioni immediate (status, delay, templating
   * in linea) salvano la selezionata senza precondizione.
   */
  saveResponse(payload: ResponseUpdateRequest, onSuccess?: () => void, draft?: DraftSave): void {
    const target = this.responseTarget(draft);
    if (!target) {
      return;
    }
    this.runDetailMutation(
      target.endpointId,
      this.api.updateResponse(target.endpointId, target.responseFile, { ...payload, ...target.precondition }),
      onSuccess,
      draft,
    );
  }

  /** Bersaglio di un salvataggio di variante: quello della bozza, o la variante selezionata. */
  private responseTarget(draft?: DraftSave): { endpointId: string; responseFile: string; precondition: { expectedRevision?: string } } | null {
    if (draft?.target.responseFile) {
      return {
        endpointId: draft.target.endpointId,
        responseFile: draft.target.responseFile,
        precondition: draft.target.baseRevision ? { expectedRevision: draft.target.baseRevision } : {},
      };
    }
    const sel = this.selected();
    const fileName = sel?.selectedResponseFile;
    return sel && fileName ? { endpointId: sel.id, responseFile: fileName, precondition: {} } : null;
  }

  /**
   * Crea una nuova response per l'endpoint selezionato: la rende selezionata, salvo
   * `select: false` (preparazione senza attivazione). `onSuccess` riceve il filename creato.
   */
  addResponse(payload: CreateResponseRequest, onSuccess?: (createdResponseFile?: string) => void): void {
    const sel = this.selected();
    if (!sel) {
      return;
    }
    this.runDetailMutation(sel.id, this.api.createResponse(sel.id, payload), (result) => onSuccess?.(result.createdResponseFile));
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

  /**
   * Carica un file per una response (la rende file-backed). Di default la variante selezionata;
   * dopo una creazione senza attivazione, quella creata; da bozza, il bersaglio della bozza con la
   * sua revisione nell'header della precondizione.
   */
  uploadResponseFile(file: File, onSuccess?: () => void, targetResponseFile?: string, draft?: DraftSave): void {
    const sel = this.selected();
    const endpointId = draft?.target.endpointId ?? sel?.id;
    const fileName = draft?.target.responseFile ?? targetResponseFile ?? sel?.selectedResponseFile;
    if (!endpointId || !fileName) {
      return;
    }
    this.runDetailMutation(
      endpointId,
      this.api.uploadResponseFile(endpointId, fileName, file, draft?.target.baseRevision),
      onSuccess,
      draft,
    );
  }

  /**
   * Aggiorna la descrizione dell'endpoint selezionato. Invia solo `description`: il flag `enabled`
   * letto col dettaglio può essere vecchio, e reinviarlo riabiliterebbe (o disabiliterebbe)
   * l'endpoint annullando un toggle fatto nel frattempo.
   */
  saveDescription(description: string, onSuccess?: () => void, draft?: DraftSave): void {
    const endpointId = draft?.target.endpointId ?? this.selected()?.id;
    if (!endpointId) {
      return;
    }
    const expectedRevision = draft?.target.baseRevision;
    this.runDetailMutation(
      endpointId,
      this.api.updateEndpoint(endpointId, expectedRevision ? { description, expectedRevision } : { description }),
      onSuccess,
      draft,
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
        this.sameWorkspace(),
        switchMap(() => this.api.listMocks()),
        this.sameWorkspace(),
        this.settle(() => this.savingId.set(undefined)),
      )
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          this.clearSelected();
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
      .pipe(this.sameWorkspace(), switchMap(() => this.api.listMocks()), this.sameWorkspace())
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
        this.sameWorkspace(),
        switchMap((detail) => this.api.listMocks().pipe(map((res) => ({ detail, res })))),
        this.sameWorkspace(),
        this.settle(() => this.savingId.set(undefined)),
      )
      .subscribe({
        next: ({ detail, res }) => {
          this.applyCatalogResponse(res);
          if (this.selectedId() === itemId) {
            this.applyMutationDetail(detail);
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
      .pipe(this.sameWorkspace(), switchMap(() => this.api.listMocks()), this.sameWorkspace())
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          onSuccess?.();
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /** Elimina Unsorted o una collection persistita insieme a tutti gli endpoint contenuti. */
  eraseCollection(id: string, onSuccess?: () => void): void {
    if (this.erasingCollectionId() != null) {
      return;
    }
    this.erasingCollectionId.set(id);
    this.error.set(undefined);
    this.api
      .eraseCollection(id)
      .pipe(
        this.sameWorkspace(),
        switchMap(() => this.api.listMocks()),
        this.sameWorkspace(),
        this.settle(() => this.erasingCollectionId.set(undefined)),
      )
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          const selectedId = this.selectedId();
          if (selectedId != null && !res.items.some((item) => item.id === selectedId)) {
            this.clearSelected();
          }
          onSuccess?.();
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /** Abilita/disabilita in blocco tutti gli endpoint di una collection (e sotto-collection). */
  setCollectionEnabled(id: string, enabled: boolean): void {
    this.error.set(undefined);
    this.api.updateCollectionEnabled(id, { enabled }).pipe(this.sameWorkspace()).subscribe({
      next: (res) => {
        this.applyCatalogResponse(res);
        const sel = this.selected();
        if (sel && !this.detailUnavailable()) {
          const updated = res.items.find((i) => i.id === sel.id);
          if (updated) {
            this.setSelected({ ...sel, disabled: updated.disabled });
          }
        }
      },
      error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
    });
  }

  /**
   * Accende o spegne un elenco di endpoint in una sola chiamata (PATCH /mocks/enabled): il
   * backend la tratta come tutto-o-niente, con un solo reload del motore. Da qui passano le
   * azioni di massa della selezione multipla.
   */
  setEndpointsEnabled(ids: readonly string[], enabled: boolean, onSuccess?: () => void): void {
    if (ids.length === 0) {
      return;
    }
    this.error.set(undefined);
    this.api.setEndpointsEnabled({ ids: [...ids], enabled }).pipe(this.sameWorkspace()).subscribe({
      next: (res) => {
        this.applyCatalogResponse(res);
        // Il dettaglio aperto potrebbe essere uno di quelli toccati: allinea il suo interruttore.
        const sel = this.selected();
        if (sel && !this.detailUnavailable()) {
          const updated = res.items.find((item) => item.id === sel.id);
          if (updated) {
            this.setSelected({ ...sel, disabled: updated.disabled });
          }
        }
        onSuccess?.();
      },
      error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
    });
  }

  /**
   * Sposta più endpoint in una collection. Qui non c'è una rotta di massa: sono N chiamate in
   * sequenza (concatMap, non merge: l'ordine di inserimento conta) e un solo ricaricamento finale.
   */
  assignCollectionToMany(ids: readonly string[], collectionId: string | undefined, onSuccess?: () => void): void {
    if (ids.length === 0) {
      return;
    }
    this.error.set(undefined);
    this.batchInWorkspace(ids, (id) => this.api.assignDefinitionCollection(id, { collectionId }))
      .pipe(
        this.sameWorkspace(),
        switchMap(() => this.api.listMocks()),
        this.sameWorkspace(),
      )
      .subscribe({
        next: (res) => {
          this.applyCatalogResponse(res);
          onSuccess?.();
        },
        error: (e) => this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError')),
      });
  }

  /**
   * Elimina più endpoint. Come lo spostamento, N chiamate: se una fallisce le precedenti restano
   * eliminate, quindi l'elenco si ricarica comunque per mostrare lo stato reale.
   */
  removeEndpoints(ids: readonly string[], onSuccess?: () => void): void {
    if (ids.length === 0) {
      return;
    }
    this.error.set(undefined);
    const selectedId = this.selectedId();
    this.batchInWorkspace(ids, (id) => this.api.deleteDefinition(id))
      .pipe(
        this.sameWorkspace(),
        this.settle(() => this.loadCatalog()),
      )
      .subscribe({
        next: () => {
          // Il dettaglio aperto è appena sparito: loadCatalog ne selezionerà un altro.
          if (selectedId != null && ids.includes(selectedId)) {
            this.clearSelected();
          }
          onSuccess?.();
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
      .pipe(this.sameWorkspace(), switchMap(() => this.api.listMocks()), this.sameWorkspace())
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
      .pipe(this.sameWorkspace(), switchMap(() => this.api.listMocks()), this.sameWorkspace())
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
      .pipe(this.sameWorkspace(), switchMap(() => this.api.listMocks()), this.sameWorkspace())
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
  private runCreate(op: Observable<MockDetailAfterMutation>, onDone?: (ok: boolean) => void): void {
    this.creating.set(true);
    this.error.set(undefined);
    op.pipe(
      this.sameWorkspace(),
      switchMap((detail) => this.api.listMocks().pipe(map((res) => ({ detail, res })))),
      this.sameWorkspace(),
      this.settle(() => this.creating.set(false)),
    ).subscribe({
      next: ({ detail, res }) => {
        this.applyCatalogResponse(res);
        // Anche qui la creazione è avvenuta: il dialog si chiude a buon fine e il catalogo la
        // elenca. Se il dettaglio non si compone non la si può aprire, e il pannello lo dice.
        this.applyMutationDetail(detail);
        onDone?.(true);
      },
      error: (e) => {
        this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError'));
        onDone?.(false);
      },
    });
  }

  /**
   * Rende selezionato un dettaglio e ne persiste l'id (ViewStateService): tornando sulla view
   * l'endpoint aperto è lo stesso. Le transizioni verso "nessuna selezione" restano set diretti:
   * l'ultimo id persistito è comunque validato al ripristino contro il catalogo corrente.
   */
  /**
   * Applica al pannello il risultato di una mutazione RIUSCITA. Il ramo "dettaglio non
   * componibile" non è un fallimento: la modifica è già su disco, manca la sua descrizione.
   * Il pannello non va aggiornato col dettaglio precedente — mostrare stato stantio dopo una
   * modifica andata a buon fine è proprio la confusione che questo ramo serve a evitare.
   */
  private applyMutationDetail(detail: MockDetailAfterMutation): void {
    if (isDetailUnavailable(detail)) {
      this.unavailableDetailId.set(detail.id);
      this.detailUnavailable.set(detail.detailUnavailable.message);
      this.viewState.write(SELECTED_ENDPOINT_STATE_KEY, detail.id);
      return;
    }
    this.setSelected(detail);
  }

  /**
   * Rilegge il dettaglio dell'endpoint selezionato: è l'azione dello stato "non leggibile" e della
   * ricarica di una bozza in conflitto. `onLoaded` riceve il dettaglio riletto.
   */
  reloadSelectedDetail(onLoaded?: (detail: MockDetail) => void): void {
    const id = this.selectedId();
    if (id == null) {
      return;
    }
    this.detailLoading.set(true);
    this.error.set(undefined);
    const epoch = this.workspaceEpoch;
    const selected = this.selected();
    const pendingId = this.unavailableDetailId();
    const current = () => epoch === this.workspaceEpoch && this.selected() === selected && this.unavailableDetailId() === pendingId;
    this.api
      .getMock(id)
      .pipe(finalize(() => this.detailLoading.set(false)))
      .subscribe({
        next: (detail) => {
          if (!current()) return;
          // Con il workspace cambiato, rileggere su richiesta è aprire la risorsa della nuova
          // istanza: lo stato stantio finisce e le bozze del precedente decadono.
          this.leaveStaleWorkspace();
          this.setSelected(detail);
          onLoaded?.(detail);
        },
        error: (e) => { if (current()) this.error.set(this.detailReadErrorMessage(e)); },
      });
  }

  /**
   * Messaggio per una lettura del dettaglio non riuscita. `READ_INCONSISTENT` arriva qui dopo il
   * solo tentativo ripetuto dal servizio: si segnala che la lettura non è disponibile, senza
   * altri tentativi automatici; il dettaglio aperto e le bozze restano come sono.
   */
  detailReadErrorMessage(error: unknown): string {
    const message = readErrorMessage(error);
    if (isReadInconsistentError(error)) {
      return this.transloco.translate('common.detailReadUnavailable', { message: message ?? '' });
    }
    return message ?? this.transloco.translate('common.unexpectedError');
  }

  /** Abbandonare la selezione abbandona anche il dettaglio ancora da recuperare. */
  private clearSelected(): void {
    this.selected.set(undefined);
    this.unavailableDetailId.set(undefined);
    this.detailUnavailable.set(undefined);
    this.selectedGone.set(false);
  }

  private setSelected(detail: MockDetail): void {
    this.selected.set(detail);
    this.unavailableDetailId.set(undefined);
    this.selectedGone.set(false);
    // Un dettaglio letto per intero chiude qualunque segnalazione di illeggibilità precedente,
    // da qualunque strada arrivi (ricarica, cambio di endpoint, mutazione successiva riuscita).
    this.detailUnavailable.set(undefined);
    this.viewState.write(SELECTED_ENDPOINT_STATE_KEY, detail.id);
  }

  /** Applica una risposta del catalogo: sincronizza insieme mocks, collections e childOrder. */
  private applyCatalogResponse(res: MockListResponse): void {
    this.mocks.set(res.items);
    this.collections.set(res.collections);
    this.childOrder.set(res.childOrder);
    // Alcune mutazioni (es. PATCH collections/:id/enabled) rispondono senza rifare la scansione
    // da disco: in quel caso le segnalazioni note restano valide e non vanno azzerate.
    if (res.loadErrors != null) {
      this.loadErrors.set(res.loadErrors);
    }
  }

  /**
   * Esegue una mutazione che restituisce il MockDetail aggiornato, poi ricarica il
   * catalogo e risincronizza `selected`/`mocks`/`collections`. `savingId` disabilita
   * i controlli durante la scrittura; `onSuccess` scatta solo a salvataggio riuscito
   * (es. per uscire dalla modalita' modifica preservando le bozze in caso di errore).
   */
  private runDetailMutation<T extends MockDetailAfterMutation>(
    savingId: string,
    op: Observable<T>,
    onSuccess?: (result: T) => void,
    draft?: DraftSave,
  ): void {
    this.savingId.set(savingId);
    this.error.set(undefined);
    op.pipe(
      this.sameWorkspace(),
      switchMap((detail) => this.api.listMocks().pipe(map((res) => ({ detail, res })))),
      this.sameWorkspace(),
      this.settle(() => this.savingId.set(undefined)),
    ).subscribe({
      next: ({ detail, res }) => {
        this.applyMutationDetail(detail);
        this.applyCatalogResponse(res);
        onSuccess?.(detail);
      },
      error: (e) => {
        // Un salvataggio da bozza gestisce da sé conflitto e risorsa sparita: il testo resta.
        const conflict = readRevisionConflict(e);
        if (conflict && draft?.onConflict) {
          draft.onConflict(conflict);
          return;
        }
        if (isNotFoundError(e) && draft?.onMissing) {
          draft.onMissing();
          return;
        }
        this.error.set(readErrorMessage(e) ?? this.transloco.translate('common.unexpectedError'));
      },
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
    sequenceActive: item.sequenceActive === true,
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
