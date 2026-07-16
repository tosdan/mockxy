export type MockType = 'mock' | 'middleware' | 'handler' | 'sse';

/** Un messaggio SSE: data obbligatorio (JSON o stringa), event/id facoltativi. */
export interface SseMessage {
  event?: string;
  id?: string;
  data: unknown;
}

/** Voce del copione di una variante sse: afterMs relativo al messaggio precedente. */
export interface SseScriptEntry extends SseMessage {
  afterMs: number;
}

/** Messaggio pronto della console (macro). */
export interface SsePreset extends SseMessage {
  label: string;
}

/** Definizione di una variante sse (normalizzata dal server). */
export interface SseVariantConfig {
  retryMs: number | null;
  script: SseScriptEntry[];
  onEnd: 'keep-open' | 'close' | 'loop';
  presets: SsePreset[];
}

/** Una connessione SSE aperta (console). */
export interface SseConnectionInfo {
  id: number;
  startedAt: number;
  eventsSent: number;
  scriptIndex: number;
  scriptLength: number;
}

/** Una voce dello storico della console: messaggio uscito, dal copione o dalla regia manuale. */
export interface SseHistoryEntry {
  at: number;
  origin: 'script' | 'manual';
  connectionId?: number;
  event?: string;
  id?: string;
  data: unknown;
}

export interface SseStateResponse {
  connections: SseConnectionInfo[];
  history: SseHistoryEntry[];
}

export interface SsePushResult {
  delivered: number;
  connections: number;
}
export type MockPayloadType = 'json' | 'text' | 'file' | 'none';
export const UNSORTED_COLLECTION_ID = 'unsorted';

export interface CollectionSummary {
  id: string;
  label: string;
  itemCount: number;
  parentId?: string;
}

export interface HandlerDefinitionInput {
  method: string;
  path: string;
  disabled?: boolean;
}

export interface MockConfig {
  method: string;
  path: string;
  status: number;
  disabled?: boolean;
  headers?: Record<string, string | number | boolean | string[]>;
  bodyFile?: string;
  file?: string;
  delayMs?: number;
  /** Templating del body/header ({{params.x}}, ...): opt-in per variante mock. */
  templated?: boolean;
}

/** Uno step di una sequenza di varianti: quale response e per quanto (times XOR forMs). */
export interface SequenceStep {
  response: string;
  /** Risponde a N richieste (intero >= 1). */
  times?: number;
  /** Risponde per N millisecondi dalla sua prima richiesta (intero >= 1). */
  forMs?: number;
}

/** Sequenza di varianti dell'endpoint: politica di selezione sopra le varianti esistenti. */
export interface SequenceConfig {
  enabled: boolean;
  steps: SequenceStep[];
  /** Esaurito l'ultimo step: 'stay' resta lì, 'loop' riparte dal primo. */
  onEnd: 'stay' | 'loop';
  /** Auto-reset: senza richieste per questo tempo si riparte dal primo step; null = mai. */
  resetAfterMs: number | null;
}

/** Cursore runtime di una sequenza (stato effimero del motore, non un file). */
export interface SequenceState {
  stepIndex: number;
  servedInStep: number;
  stepStartedAt: number | null;
  lastRequestAt: number | null;
}

export interface EndpointConfig {
  method: string;
  path: string;
  description?: string;
  enabled: boolean;
  responseFiles: string[];
  selectedResponseFile: string;
  /** Sequenza di varianti, quando definita (anche spenta: enabled false). */
  sequence?: SequenceConfig;
}

export interface ResponseSummary {
  fileName: string;
  type?: MockType;
  title?: string;
  sourceFile?: string;
  status?: number | null;
  /** Solo per le varianti mock: templating attivo. */
  templated?: boolean;
  selected?: boolean;
  missing?: boolean;
}

export interface MockSummary {
  id: string;
  type: MockType;
  method: string;
  path: string;
  status: number | null;
  disabled: boolean;
  configFilePath: string;
  collectionId?: string;
  payloadType?: MockPayloadType;
  bodyFile?: string;
  file?: string;
  delayMs?: number;
  selectedResponseFile?: string;
  responseTitle?: string;
  responseCount?: number;
  /** True quando l'endpoint sta servendo una sequenza di varianti (badge di catalogo). */
  sequenceActive?: boolean;
}

export interface MockDetail extends MockSummary {
  editable: boolean;
  definitionFilePath?: string;
  payloadFilePath?: string;
  responseFilePath?: string;
  sourceFilePath?: string;
  endpoint?: EndpointConfig;
  response?: Record<string, unknown>;
  responses?: ResponseSummary[];
  config?: MockConfig;
  body?: unknown;
  fileInfo?: {
    name: string;
    size: number;
  };
  definition?: {
    method: string;
    path: string;
    disabled: boolean;
  };
  source?: string;
  /** Cursore runtime della sequenza; presente solo quando l'endpoint ne ha una (GET dettaglio). */
  sequenceState?: SequenceState;
  /** Definizione della variante sse selezionata (copione, onEnd, presets). */
  sse?: SseVariantConfig;
}

/**
 * Ordine unificato dei figli per ogni nodo del catalogo: `parentKey` ("root", "unsorted" o un id
 * collection) → lista ordinata di ref miste (id endpoint e/o id sotto-collection). Permette di
 * intercalare le sotto-collection tra gli endpoint.
 */
export type ChildOrderMap = Record<string, string[]>;

export interface MockListResponse {
  items: MockSummary[];
  collections: CollectionSummary[];
  childOrder: ChildOrderMap;
}

export interface CollectionCreateRequest {
  label: string;
  parentId?: string;
}

export interface CollectionEraseResponse {
  deleted: number;
}

export interface MockCreateRequest {
  config: MockConfig;
  body: unknown;
  /** Descrizione endpoint opzionale; usata per marcare gli skeleton ("[da completare] …"). */
  description?: string;
}

export interface HandlerCreateRequest {
  type: 'handler';
  definition: HandlerDefinitionInput;
  source?: string;
}

export interface MiddlewareCreateRequest {
  type: 'middleware';
  definition: HandlerDefinitionInput;
  source?: string;
}

export interface AssignCollectionRequest {
  collectionId?: string;
  /** Posizione di inserimento tra i figli della collection di destinazione (drag-and-drop). */
  targetIndex?: number;
}

export interface SelectResponseRequest {
  selectedResponseFile: string;
}

export interface EndpointUpdateRequest {
  description: string;
  enabled?: boolean;
}

/** Copia un endpoint verso un nuovo metodo+path; `copyResponses` copia tutte le response (non solo la selezionata). */
export interface EndpointCopyRequest {
  method: string;
  path: string;
  copyResponses: boolean;
}

export interface ResponseMockUpdateRequest {
  type: 'mock';
  title?: string;
  status: number;
  headers?: Record<string, string | number | boolean | string[]>;
  delayMs?: number;
  body?: unknown;
  /** Templating del body/header ({{params.x}}, ...): opt-in per variante. */
  templated?: boolean;
}

export interface ResponseScriptUpdateRequest {
  type: 'handler' | 'middleware';
  title?: string;
  /** Sorgente JS. In creazione può essere omessa: il backend semina il template (o copia quella attuale se stesso tipo). */
  source?: string;
}

export interface ResponseSseUpdateRequest {
  type: 'sse';
  title?: string;
  retryMs?: number | null;
  script?: SseScriptEntry[];
  onEnd?: 'keep-open' | 'close' | 'loop';
  presets?: SsePreset[];
}

export type ResponseUpdateRequest = ResponseMockUpdateRequest | ResponseScriptUpdateRequest | ResponseSseUpdateRequest;

export type CreateResponseRequest = ResponseUpdateRequest | { title?: string };

export interface CollectionReorderRequest {
  collectionIds: string[];
  parentId?: string;
}

export interface CollectionReparentRequest {
  parentId?: string | null;
  targetIndex?: number;
}

export interface CollectionItemsReorderRequest {
  itemIds: string[];
}

/** Ordine unificato dei figli di un nodo: ref miste (id endpoint e/o id sotto-collection). */
export interface CollectionChildrenReorderRequest {
  childRefs: string[];
}

export interface CollectionEnabledUpdateRequest {
  enabled: boolean;
}

export interface MockUpdateRequest {
  config: MockConfig;
  body?: unknown;
}

export interface HandlerUpdateRequest {
  type: 'handler';
  definition: HandlerDefinitionInput;
  source?: string;
}

export interface MiddlewareUpdateRequest {
  type: 'middleware';
  definition: HandlerDefinitionInput;
  source?: string;
}

export type RequestMonitorSource = 'mock' | 'backend' | 'middleware' | 'handler' | 'mock-only' | 'mock-only-miss' | string;

export interface RequestMonitorEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  originalUrl: string;
  status: number;
  latencyMs: number;
  source: RequestMonitorSource;
  matchedRoutePath?: string;
  /** Endpoint con sequenza di varianti: lo step che ha servito questa richiesta. */
  sequenceStep?: {
    index: number;
    count: number;
    responseFile: string;
    responseTitle?: string;
  };
  middlewareRoutePath?: string;
  middlewareFilePath?: string;
  requestHeaders: Record<string, string | string[]>;
  requestBody?: string;
  requestBodyBytes: number;
  requestBodyTruncated: boolean;
  responseHeaders?: Record<string, string | string[]>;
  responseBody?: string;
  responseBodyBytes?: number;
  responseBodyTruncated?: boolean;
}

export interface RequestMonitorListResponse {
  items: RequestMonitorEntry[];
}

export interface MonitorDumpState {
  enabled: boolean;
  intervalMs: number;
  threshold: number;
  currentFile: string | null;
  pendingCount: number;
}

export interface MonitorDumpFile {
  name: string;
  size: number;
  mtime: number;
}

export interface MonitorDumpFilesResponse {
  files: MonitorDumpFile[];
}

export interface DumpReadCursor {
  fileIndex: number;
  lineIndex: number;
}

/** Una entry del dump = una RequestMonitorEntry con la chiave stabile assegnata dalla lettura. */
export type DumpEntry = RequestMonitorEntry & { dumpKey: string };

export interface DumpReadPage {
  items: DumpEntry[];
  nextCursor: DumpReadCursor | null;
  done: boolean;
}

/** Criterio di selezione per la creazione massiva: tutto un file o un insieme di chiavi. */
export type DumpSelection = { file: string } | { keys: string[] };

export interface DumpCreateMocksResult {
  created: number;
  createdEmpty: number;
  skippedExisting: number;
  failed: number;
}

/** Stato runtime di Mockxy: server on/off + "proxy all" (backend src/server-state.js). */
export interface ServerState {
  serverEnabled: boolean;
  proxyAll: boolean;
}

/** Voce del piano di import OpenAPI (anteprima): cosa verrà creato o saltato. */
export interface OpenapiImportItem {
  method: string;
  path: string;
  status?: number;
  collection?: string;
  action: 'create' | 'skip';
}

/** Anteprima (dryRun) dell'import OpenAPI: piano + conteggi, senza scrivere nulla. */
export interface OpenapiImportPreview {
  items: OpenapiImportItem[];
  total: number;
  create: number;
  skip: number;
  collections: number;
}

/** Esito dell'import OpenAPI reale. */
export interface OpenapiImportResult {
  created: number;
  skipped: number;
  failed: number;
  total: number;
  collections: number;
}

export interface RequestMonitorSnapshotEvent {
  type: 'snapshot';
  items: RequestMonitorEntry[];
}

export interface RequestMonitorRequestEvent {
  type: 'request';
  item: RequestMonitorEntry;
}

export interface RequestMonitorClearEvent {
  type: 'clear';
}

export type RequestMonitorStreamEvent =
  | RequestMonitorSnapshotEvent
  | RequestMonitorRequestEvent
  | RequestMonitorClearEvent;

/** Endpoint (handler o middleware) che referenzia un file dati con data('nome'). */
export interface DataFileUsage {
  /** Id admin dell'endpoint referenziante. */
  id: string;
  method: string;
  path: string;
  type: 'handler' | 'middleware';
}

/** File dati JSON (pagina Dati) referenziabile dagli handler via data('nome'). */
export interface DataFileSummary {
  /** Nome canonico senza estensione (sempre lowercase): è il riferimento per data(). */
  name: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: string;
  /**
   * Endpoint che referenziano questo file (riferimenti data('nome') letterali trovati nei sorgenti).
   * Best-effort: vuoto significa "nessun riferimento diretto trovato", non "sicuramente inutilizzato".
   */
  usedBy: DataFileUsage[];
}

/** Dettaglio di un file dati: metadati + contenuto testuale (per la preview). */
export interface DataFileDetail extends DataFileSummary {
  content: string;
}

/** Esito di una rinomina: il file rinominato + quanti riferimenti data() sono stati riscritti. */
export interface DataFileRenameResult extends DataFileSummary {
  referencesRewritten: number;
  referencingEndpoints: DataFileUsage[];
}
