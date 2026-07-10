import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import {
  AssignCollectionRequest,
  CollectionChildrenReorderRequest,
  CollectionCreateRequest,
  CollectionEraseResponse,
  CollectionEnabledUpdateRequest,
  CollectionItemsReorderRequest,
  CollectionReorderRequest,
  CollectionReparentRequest,
  CollectionSummary,
  CreateResponseRequest,
  EndpointCopyRequest,
  EndpointUpdateRequest,
  HandlerCreateRequest,
  MiddlewareCreateRequest,
  MiddlewareUpdateRequest,
  HandlerUpdateRequest,
  MockCreateRequest,
  MockDetail,
  MockListResponse,
  MockSummary,
  OpenapiImportPreview,
  OpenapiImportResult,
  DataFileDetail,
  DataFileRenameResult,
  DataFileSummary,
  RequestMonitorListResponse,
  RequestMonitorStreamEvent,
  MonitorDumpState,
  MonitorDumpFilesResponse,
  DumpReadCursor,
  DumpReadPage,
  DumpSelection,
  DumpCreateMocksResult,
  ResponseUpdateRequest,
  SelectResponseRequest,
  ServerState,
  UNSORTED_COLLECTION_ID,
  MockUpdateRequest,
} from './mock-admin-api.types';

interface ApiMockListResponse {
  items: MockListResponse['items'];
  collections?: MockListResponse['collections'];
  childOrder?: MockListResponse['childOrder'];
  folders?: unknown[];
}

interface ApiCollectionItemsReorderResponse {
  items: MockListResponse['items'];
}

/** Incapsula l'accesso alle API amministrative di Mockxy. */
@Injectable({
  providedIn: 'root',
})
export class MockAdminApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/_admin/api';

  /** Recupera tutte le definizioni di mock, handler e middleware disponibili. */
  listMocks(): Observable<MockListResponse> {
    return this.http.get<ApiMockListResponse>(`${this.baseUrl}/mocks`).pipe(
      map((response) => ({
        items: response.items,
        collections: response.collections || [],
        childOrder: response.childOrder || {},
      })),
    );
  }

  /** Recupera il dettaglio completo di una singola definizione. */
  getMock(id: string): Observable<MockDetail> {
    return this.http.get<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}`);
  }

  /**
   * Risolve una richiesta concreta (metodo + path con eventuale query, es. una entry del
   * monitor) nell'endpoint del catalogo che oggi la coprirebbe, disabilitati inclusi.
   * Fatto derivato calcolato dal motore col matching del serving; null se nessun endpoint copre.
   */
  resolveMock(method: string, path: string): Observable<MockSummary | null> {
    return this.http
      .get<{ mock: MockSummary | null }>(`${this.baseUrl}/mocks/resolve`, { params: { method, path } })
      .pipe(map((response) => response.mock));
  }

  /** Crea una nuova definizione mock nel file system locale. */
  createMock(request: MockCreateRequest): Observable<MockDetail> {
    return this.http.post<MockDetail>(`${this.baseUrl}/mocks`, request);
  }

  /** Crea una nuova definizione handler nel file system locale. */
  createHandler(request: HandlerCreateRequest): Observable<MockDetail> {
    return this.http.post<MockDetail>(`${this.baseUrl}/mocks`, request);
  }

  /** Crea una nuova definizione middleware nel file system locale. */
  createMiddleware(request: MiddlewareCreateRequest): Observable<MockDetail> {
    return this.http.post<MockDetail>(`${this.baseUrl}/mocks`, request);
  }

  /** Crea una nuova collection persistita del catalogo. */
  createCollection(request: CollectionCreateRequest): Observable<CollectionSummary> {
    return this.http.post<CollectionSummary>(`${this.baseUrl}/mocks/collections`, request);
  }

  /** Assegna o rimuove la collection logica di una definizione senza spostare i file. */
  assignDefinitionCollection(id: string, request: AssignCollectionRequest): Observable<MockDetail> {
    return this.http.put<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}/collection`, request);
  }

  /** Persiste il nuovo ordine delle collection personalizzate del catalogo. */
  reorderCollections(request: CollectionReorderRequest): Observable<CollectionSummary[]> {
    return this.http.patch<CollectionSummary[]>(`${this.baseUrl}/mocks/collections/order`, request);
  }

  /** Sposta una collection sotto un nuovo genitore (o al livello principale). */
  reparentCollection(id: string, request: CollectionReparentRequest): Observable<CollectionSummary[]> {
    return this.http.patch<CollectionSummary[]>(
      `${this.baseUrl}/mocks/collections/${encodeURIComponent(id)}/parent`,
      request,
    );
  }

  /** Elimina una collection persistita del catalogo. */
  deleteCollection(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/mocks/collections/${encodeURIComponent(id)}`);
  }

  /** Elimina una collection (o Unsorted) insieme a tutti gli endpoint contenuti. */
  eraseCollection(id: string): Observable<CollectionEraseResponse> {
    return this.http.delete<CollectionEraseResponse>(
      `${this.baseUrl}/mocks/collections/${encodeURIComponent(id)}/contents`,
    );
  }

  /** Abilita o disabilita massivamente gli endpoint dentro una collection persistita e le sue sotto-collection. */
  updateCollectionEnabled(id: string, request: CollectionEnabledUpdateRequest): Observable<MockListResponse> {
    return this.http.patch<MockListResponse>(
      `${this.baseUrl}/mocks/collections/${encodeURIComponent(id)}/enabled`,
      request,
    );
  }

  /** Persiste il nuovo ordine degli item di una collection, inclusa la collection virtuale Unsorted. */
  reorderCollectionItems(
    collectionId: string | undefined,
    request: CollectionItemsReorderRequest,
  ): Observable<void> {
    let normalizedCollectionId = collectionId;
    if (normalizedCollectionId == null || normalizedCollectionId.trim() === '') {
      normalizedCollectionId = UNSORTED_COLLECTION_ID;
    }

    return this.http
      .patch<ApiCollectionItemsReorderResponse>(
        `${this.baseUrl}/mocks/collections/${encodeURIComponent(normalizedCollectionId)}/items/order`,
        request,
      )
      .pipe(map(() => undefined));
  }

  /**
   * Persiste l'ordine unificato dei figli di un nodo (endpoint + sotto-collection intercalati).
   * `parentKey` è "root", "unsorted" o un id collection.
   */
  reorderCollectionChildren(
    parentKey: string,
    request: CollectionChildrenReorderRequest,
  ): Observable<void> {
    return this.http
      .patch<ApiCollectionItemsReorderResponse>(
        `${this.baseUrl}/mocks/collections/${encodeURIComponent(parentKey)}/children/order`,
        request,
      )
      .pipe(map(() => undefined));
  }

  /** Aggiorna configurazione e payload di un mock esistente. */
  updateMock(id: string, request: MockUpdateRequest): Observable<MockDetail> {
    return this.http.put<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}`, request);
  }

  /** Aggiorna solo i metadati modificabili dell'endpoint. */
  updateEndpoint(id: string, request: EndpointUpdateRequest): Observable<MockDetail> {
    return this.http.put<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}/endpoint`, request);
  }

  /** Copia un endpoint verso un nuovo metodo+path; con copyResponses copia tutte le response. */
  copyEndpoint(id: string, request: EndpointCopyRequest): Observable<MockDetail> {
    return this.http.post<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}/copy`, request);
  }

  /** Cambia la response selezionata per un endpoint. */
  selectResponse(id: string, request: SelectResponseRequest): Observable<MockDetail> {
    return this.http.put<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}`, request);
  }

  /** Crea una nuova response per l'endpoint selezionato partendo dai valori confermati dall'utente. */
  createResponse(id: string, request: CreateResponseRequest = {}): Observable<MockDetail> {
    return this.http.post<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}/responses`, request);
  }

  /** Aggiorna solo la response indicata per l'endpoint selezionato. */
  updateResponse(id: string, responseFileName: string, request: ResponseUpdateRequest): Observable<MockDetail> {
    return this.http.put<MockDetail>(
      `${this.baseUrl}/mocks/${encodeURIComponent(id)}/responses/${encodeURIComponent(responseFileName)}`,
      request,
    );
  }

  /** Carica un file (bytes grezzi) e rende la response file-backed; il MIME reale viaggia in query. */
  uploadResponseFile(id: string, responseFileName: string, file: File): Observable<MockDetail> {
    return this.http.put<MockDetail>(
      `${this.baseUrl}/mocks/${encodeURIComponent(id)}/responses/${encodeURIComponent(responseFileName)}/file`,
      file,
      {
        headers: { 'Content-Type': 'application/octet-stream' },
        params: { filename: file.name, contentType: file.type || 'application/octet-stream' },
      },
    );
  }

  /** Elimina solo la response indicata per l'endpoint selezionato. */
  deleteResponse(id: string, responseFileName: string): Observable<MockDetail> {
    return this.http.delete<MockDetail>(
      `${this.baseUrl}/mocks/${encodeURIComponent(id)}/responses/${encodeURIComponent(responseFileName)}`,
    );
  }

  /** Aggiorna la sorgente JavaScript e i metadati di un handler esistente. */
  updateHandler(id: string, request: HandlerUpdateRequest): Observable<MockDetail> {
    return this.http.put<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}`, request);
  }

  /** Aggiorna la sorgente JavaScript e i metadati di un middleware esistente. */
  updateMiddleware(id: string, request: MiddlewareUpdateRequest): Observable<MockDetail> {
    return this.http.put<MockDetail>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}`, request);
  }

  /** Elimina una definizione locale modificabile. */
  deleteMock(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/mocks/${encodeURIComponent(id)}`);
  }

  /** Elimina una definizione locale modificabile. */
  deleteDefinition(id: string): Observable<void> {
    return this.deleteMock(id);
  }

  /** Recupera lo storico corrente delle request intercettate dal monitor runtime. */
  listRequestMonitoring(): Observable<RequestMonitorListResponse> {
    return this.http.get<RequestMonitorListResponse>(`${this.baseUrl}/monitoring/requests`);
  }

  /** Svuota il log runtime delle request intercettate. */
  clearRequestMonitoring(): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/monitoring/requests`);
  }

  /** Stato del dump su disco del monitor (abilitato, intervallo, soglia, file corrente, pending). */
  getMonitorDumpState(): Observable<MonitorDumpState> {
    return this.http.get<MonitorDumpState>(`${this.baseUrl}/monitoring/dump`);
  }

  /** Abilita/disabilita il dump su disco e/o aggiorna intervallo/soglia. */
  setMonitorDumpState(
    request: Partial<{ enabled: boolean; intervalMs: number; threshold: number }>,
  ): Observable<MonitorDumpState> {
    return this.http.patch<MonitorDumpState>(`${this.baseUrl}/monitoring/dump`, request);
  }

  /** Flush manuale del pending su disco. */
  flushMonitorDump(): Observable<{ flushed: number } & Partial<MonitorDumpState>> {
    return this.http.post<{ flushed: number } & Partial<MonitorDumpState>>(
      `${this.baseUrl}/monitoring/dump/flush`,
      {},
    );
  }

  /** Elenca i file di dump su disco. */
  listMonitorDumps(): Observable<MonitorDumpFilesResponse> {
    return this.http.get<MonitorDumpFilesResponse>(`${this.baseUrl}/monitoring/dumps`);
  }

  /** Legge una pagina di entry dai dump (cursore in avanti per il virtual scroll). */
  readMonitorDumps(cursor: DumpReadCursor | null, limit: number): Observable<DumpReadPage> {
    const params: Record<string, string> = { limit: String(limit) };
    if (cursor) {
      params['fileIndex'] = String(cursor.fileIndex);
      params['lineIndex'] = String(cursor.lineIndex);
    }
    return this.http.get<DumpReadPage>(`${this.baseUrl}/monitoring/dumps/read`, { params });
  }

  /** Creazione massiva di mock dal dump (criterio: tutto un file oppure un insieme di chiavi). */
  createMocksFromDump(selection: DumpSelection): Observable<DumpCreateMocksResult> {
    return this.http.post<DumpCreateMocksResult>(`${this.baseUrl}/monitoring/dumps/create-mocks`, selection);
  }

  /** Elimina un file di dump. */
  deleteMonitorDump(file: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/monitoring/dumps/${encodeURIComponent(file)}`);
  }

  /** Elenca i file dati JSON (pagina Dati). */
  listDataFiles(): Observable<{ items: DataFileSummary[] }> {
    return this.http.get<{ items: DataFileSummary[] }>(`${this.baseUrl}/files`);
  }

  /** Legge metadati e contenuto di un file dati (per la preview). */
  getDataFile(name: string): Observable<DataFileDetail> {
    return this.http.get<DataFileDetail>(`${this.baseUrl}/files/${encodeURIComponent(name)}`);
  }

  /**
   * Carica (o sostituisce) un file dati: byte raw come octet-stream, così il server valida il
   * JSON prima di scrivere. Il nome viene normalizzato a lowercase dal server.
   */
  uploadDataFile(name: string, bytes: Blob): Observable<DataFileSummary> {
    return this.http.put<DataFileSummary>(`${this.baseUrl}/files/${encodeURIComponent(name)}`, bytes, {
      headers: { 'content-type': 'application/octet-stream' },
    });
  }

  /**
   * Rinomina un file dati (il server normalizza a lowercase; collisioni → 409). Con
   * rewriteReferences aggiorna anche le occorrenze data('vecchio') nei sorgenti degli handler.
   */
  renameDataFile(name: string, nextName: string, rewriteReferences = false): Observable<DataFileRenameResult> {
    return this.http.patch<DataFileRenameResult>(`${this.baseUrl}/files/${encodeURIComponent(name)}`, {
      name: nextName,
      rewriteReferences,
    });
  }

  /** Elimina un file dati. */
  deleteDataFile(name: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/files/${encodeURIComponent(name)}`);
  }

  /** Recupera lo stato runtime del server (server on/off + proxy all). */
  getServerState(): Observable<ServerState> {
    return this.http.get<ServerState>(`${this.baseUrl}/server`);
  }

  /** Aggiorna lo stato runtime del server (campi parziali: serverEnabled e/o proxyAll). */
  updateServerState(request: Partial<ServerState>): Observable<ServerState> {
    return this.http.patch<ServerState>(`${this.baseUrl}/server`, request);
  }

  /**
   * Anteprima (dryRun) dell'import di un documento OpenAPI: non scrive nulla.
   * Content-type application/yaml (vale anche per JSON, che ne è un sottoinsieme): il server
   * rifiuta apposta text/plain — una POST "simple" attraverserebbe le origini senza preflight
   * CORS (guardia anti-CSRF sull'unico endpoint mutante che non richiede JSON).
   */
  previewOpenapi(document: string): Observable<OpenapiImportPreview> {
    return this.http.post<OpenapiImportPreview>(`${this.baseUrl}/mocks/import/openapi`, document, {
      params: { dryRun: 'true' },
      headers: { 'Content-Type': 'application/yaml' },
    });
  }

  /** Importa un documento OpenAPI creando gli endpoint mancanti (stesso content-type dell'anteprima). */
  importOpenapi(document: string): Observable<OpenapiImportResult> {
    return this.http.post<OpenapiImportResult>(`${this.baseUrl}/mocks/import/openapi`, document, {
      headers: { 'Content-Type': 'application/yaml' },
    });
  }

  /** Apre uno stream SSE per ricevere snapshot iniziale e aggiornamenti incrementali del monitor. */
  streamRequestMonitoring(): Observable<RequestMonitorStreamEvent> {
    return new Observable<RequestMonitorStreamEvent>((subscriber) => {
      if (typeof EventSource === 'undefined') {
        subscriber.error(new Error('EventSource non disponibile nel browser corrente.'));
        return undefined;
      }

      const eventSource = new EventSource(`${this.baseUrl}/monitoring/requests/stream`);

      eventSource.onmessage = (event) => {
        try {
          subscriber.next(JSON.parse(event.data) as RequestMonitorStreamEvent);
        } catch (_error) {
          subscriber.error(new Error('Evento monitor non valido.'));
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        subscriber.error(new Error('Connessione live del monitor non disponibile.'));
      };

      return () => {
        eventSource.close();
      };
    });
  }
}
