export type MockType = 'mock' | 'middleware' | 'handler' | 'sse' | 'ws' | 'sequence';
export type EndpointCreateType = 'mock' | 'middleware' | 'handler';

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

/** Un messaggio WS: solo data (JSON — serializzato sul filo — o stringa). */
export interface WsMessage {
  data: unknown;
}

/** Voce del copione (o del reply di una regola): afterMs relativo al messaggio precedente. */
export interface WsScriptEntry extends WsMessage {
  afterMs: number;
}

/** Messaggio pronto della console WS (macro). */
export interface WsPreset extends WsMessage {
  label: string;
}

/** Il match di una regola: esattamente uno tra equals, contains e json (subset di primo livello). */
export interface WsRuleMatch {
  equals?: string;
  contains?: string;
  json?: Record<string, unknown>;
}

/** Regola dichiarativa sui messaggi in ingresso: prima che matcha vince, reply alla sola connessione. */
export interface WsRule {
  match: WsRuleMatch;
  reply: WsScriptEntry[];
}

/** Definizione di una variante ws (normalizzata dal server). */
export interface WsVariantConfig {
  script: WsScriptEntry[];
  onEnd: 'keep-open' | 'close' | 'loop';
  closeCode: number | null;
  closeReason: string | null;
  rules: WsRule[];
  presets: WsPreset[];
}

/** Una connessione WS aperta (console). */
export interface WsConnectionInfo {
  id: number;
  startedAt: number;
  messagesSent: number;
  messagesReceived: number;
  scriptIndex: number;
  scriptLength: number;
}

/** Una voce del transcript bidirezionale della console WS. */
export interface WsTranscriptEntry {
  at: number;
  direction: 'in' | 'out';
  origin: 'script' | 'rule' | 'manual' | 'received';
  connectionId?: number;
  data: unknown;
}

export interface WsStateResponse {
  connections: WsConnectionInfo[];
  transcript: WsTranscriptEntry[];
}

export interface WsPushResult {
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

/** Variante sequence normalizzata: selezionarla è l'unico modo per attivarla. */
export interface SequenceVariantConfig {
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

export interface SequenceStateResponse {
  sequenceFile: string;
  sequenceState: SequenceState | null;
}

export interface EndpointConfig {
  method: string;
  path: string;
  description?: string;
  enabled: boolean;
  responseFiles: string[];
  selectedResponseFile: string;
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
  /** Il file c'è ma non è leggibile come definizione: `error` dice perché, il resto è assente. */
  invalid?: boolean;
  error?: string;
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
  /** Revisione della descrizione: precondizione di una bozza della descrizione (§13 C4). */
  descriptionRevision?: string;
  /** Revisione della variante selezionata, calcolata dagli stessi dati del dettaglio. */
  responseRevision?: string;
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
  /** Definizione della variante sequence selezionata. */
  sequence?: SequenceVariantConfig;
  /** Cursore runtime; presente solo quando la variante selezionata è sequence. */
  sequenceState?: SequenceState;
  /** Definizione della variante sse selezionata (copione, onEnd, presets). */
  sse?: SseVariantConfig;
  /** Definizione della variante ws selezionata (copione, regole, presets). */
  ws?: WsVariantConfig;
}

/**
 * Risposta di una mutazione che è andata a buon fine ma il cui dettaglio non è componibile
 * (variante selezionata illeggibile, asset sparito a mano, `.collections.json` rotto). La
 * modifica È su disco: non va trattata come un errore, ma il dettaglio a schermo non si può
 * aggiornare finché il workspace non torna leggibile.
 */
export interface MockDetailUnavailable {
  id: string;
  detailUnavailable: { message: string };
}

/** Ciò che risponde una mutazione: il dettaglio aggiornato, oppure il motivo per cui manca. */
export type MockDetailAfterMutation = MockDetail | MockDetailUnavailable;

export function isDetailUnavailable(
  detail: MockDetailAfterMutation,
): detail is MockDetailUnavailable {
  return 'detailUnavailable' in detail;
}

/**
 * Ordine unificato dei figli per ogni nodo del catalogo: `parentKey` ("root", "unsorted" o un id
 * collection) → lista ordinata di ref miste (id endpoint e/o id sotto-collection). Permette di
 * intercalare le sotto-collection tra gli endpoint.
 */
export type ChildOrderMap = Record<string, string[]>;

/** Definizione presente su disco ma scartata dal caricamento (JSON invalido, formato legacy...). */
export interface MockLoadError {
  configFilePath: string;
  message: string;
}

export interface MockListResponse {
  items: MockSummary[];
  collections: CollectionSummary[];
  childOrder: ChildOrderMap;
  /** Presente solo nelle risposte che rifanno la scansione da disco (GET /mocks). */
  loadErrors?: MockLoadError[];
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

/**
 * Aggiornamento parziale dei metadati: si invia solo il campo che l'azione modifica. Reinviare un
 * valore letto prima (la descrizione col toggle, `enabled` col salvataggio della descrizione)
 * cancellerebbe una modifica fatta nel frattempo da un altro client.
 */
export interface EndpointUpdateRequest {
  description?: string | null;
  enabled?: boolean;
  /** Precondizione sulla sola descrizione: da inviare con `description` e senza `enabled`. */
  expectedRevision?: string;
}

/** Una variante per filename, attiva o no, con la sua revisione (GET /mocks/:id/responses/:file). */
export interface ResponseVariantRead {
  id: string;
  responseFile: string;
  selected: boolean;
  active: boolean;
  response: Record<string, unknown> & { type: MockType; title?: string };
  source: string | null;
  fileInfo: { name: string; size: number } | null;
  revision: string;
}

/** Bersaglio di una bozza, fissato all'apertura: un salvataggio non cambia mai risorsa. */
export interface DraftTarget {
  endpointId: string;
  /** Variante della bozza; null per la descrizione. */
  responseFile: string | null;
  /** Revisione letta all'apertura; assente con un motore che non espone revisioni. */
  baseRevision?: string;
}

/** Dettagli di un `409 REVISION_CONFLICT`: la risorsa è cambiata dopo la lettura della bozza. */
export interface RevisionConflict {
  code: 'REVISION_CONFLICT';
  resource: { kind: 'description' | 'response'; endpointId: string; responseFile?: string };
  expectedRevision: string;
  currentRevision: string;
}

/** Esito di un aggiornamento di variante: il dettaglio più la variante aggiornata e la sua revisione. */
export type ResponseUpdatedResult = MockDetailAfterMutation & {
  updatedResponseFile?: string;
  updatedResponseRevision?: string | null;
};

/** Copia un endpoint verso un nuovo metodo+path; `copyResponses` copia tutte le response (non solo la selezionata). */
export interface EndpointCopyRequest {
  method: string;
  path: string;
  copyResponses: boolean;
}

export interface EndpointCopyPreview {
  dryRun: true;
  target: { method: string; path: string };
  copyResponses: boolean;
  responseFiles: string[];
  assetFiles: string[];
  sharedStateRefs: string[];
  warnings: Array<{
    code: 'SHARED_STATE_REFERENCES_PRESERVED' | string;
    names: string[];
  }>;
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

export interface ResponseWsUpdateRequest {
  type: 'ws';
  title?: string;
  script?: WsScriptEntry[];
  onEnd?: 'keep-open' | 'close' | 'loop';
  closeCode?: number | null;
  closeReason?: string | null;
  rules?: WsRule[];
  presets?: WsPreset[];
}

export interface ResponseSequenceUpdateRequest {
  type: 'sequence';
  title?: string;
  steps?: SequenceStep[];
  onEnd?: 'stay' | 'loop';
  resetAfterMs?: number | null;
}

export interface ResponseSequenceCreateRequest extends Omit<ResponseSequenceUpdateRequest, 'steps'> {
  steps: SequenceStep[];
  /** `false` prepara la sequence senza attivarla: risposta servita e scenario non cambiano. */
  select?: boolean;
}

export type ResponseUpdateRequest = (
  | ResponseMockUpdateRequest
  | ResponseScriptUpdateRequest
  | ResponseSseUpdateRequest
  | ResponseWsUpdateRequest
  | ResponseSequenceUpdateRequest
) & { expectedRevision?: string };

/**
 * Creazione di una variante. `select: false` la prepara senza attivarla: selezione, cursore della
 * sequence e memoria handler restano quelli di prima (omesso = la variante creata viene selezionata).
 */
export type CreateResponseRequest = (
  | Exclude<ResponseUpdateRequest, ResponseSequenceUpdateRequest>
  | ResponseSequenceCreateRequest
  | { title?: string }
) & { select?: boolean };

/** Esito di una creazione di variante: il dettaglio più il filename della variante creata. */
export type ResponseCreatedResult = MockDetailAfterMutation & { createdResponseFile: string };

/** Accende o spegne un elenco arbitrario di endpoint in una sola chiamata, tutto-o-niente. */
export interface EndpointsEnabledUpdateRequest {
  ids: string[];
  enabled: boolean;
}

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
  /** Diagnostica amministrativa di un errore shared-state; mai inclusa nel body pubblico. */
  sharedStateError?: SharedStateErrorMetadata;
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

export interface SharedStateErrorMetadata {
  code: string;
  name?: string;
  requestedSeedKey?: string;
  currentSeedKey?: string;
  actualBytes?: number;
  limitBytes?: number;
  actualEntries?: number;
  limitEntries?: number;
  actualDepth?: number;
  limitDepth?: number;
  responseFile?: string;
}

export interface SharedStateOrigin {
  method?: string;
  path?: string;
  responseFile?: string;
}

export interface SharedStateSummary {
  name: string;
  seedKey: string;
  status: 'initializing' | 'ready';
  version: number | null;
  sizeBytes: number | null;
  initializedAt: number | null;
  updatedAt: number | null;
  lastAccessAt: number | null;
  initializedBy: SharedStateOrigin;
  lastAccessedBy: SharedStateOrigin | null;
}

export interface SharedStateListResponse {
  items: SharedStateSummary[];
  totalBytes: number;
  limits: {
    maxEntries: number;
    maxEntryBytes: number;
    maxTotalBytes: number;
    maxDepth: number;
  };
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
/**
 * Opzioni della creazione di mock dal traffico (piano agent/API, §13 C7): cosa fare con un
 * endpoint che esiste già, se selezionare le varianti aggiunte e se servire i nuovi endpoint.
 */
export interface CaptureBatchOptions {
  onConflict: 'skip' | 'add-variant';
  selectAddedVariants?: boolean;
  newEndpointEnabled: boolean;
}

/** Selezione dello Storico; le opzioni hanno i default storici, ma un flusso esplicito le manda. */
export type DumpSelection = ({ file: string } | { keys: string[] }) & Partial<CaptureBatchOptions>;

/**
 * Esito di un elemento di un batch (import OpenAPI, creazione dallo storico). `writeOutcome` dice
 * cosa è successo su disco, `runtimeOutcome` se il runtime lo serve: un elemento creato può non
 * essere servito (`not_applied`, con il motivo in `error`) anche con una risposta 201.
 */
export interface BatchItemOutcome {
  method: string;
  path: string;
  id: string | null;
  responseFile: string | null;
  writeOutcome: 'created' | 'skipped' | 'failed';
  runtimeOutcome: 'applied' | 'not_applied' | 'not_applicable';
  error: string | null;
}

/** Stato del runtime dopo il reload finale di un batch; `degraded` = errori di caricamento. */
export interface BatchRuntime {
  status: 'applied' | 'degraded' | 'failed';
  errors: { filePath: string; message: string }[];
}

/** Avviso di un elemento: bozza non fedele, o selezione superata da un elemento successivo. */
export interface CaptureWarning {
  code: 'INCOMPLETE_CAPTURE' | 'SUPERSEDED';
  reason?: 'truncated' | 'binary';
  by?: string;
}

/** Esito di una cattura trasformata in mock (Monitor e Storico). */
export interface CaptureItemOutcome extends Omit<BatchItemOutcome, 'method' | 'path' | 'writeOutcome'> {
  method: string | null;
  path: string | null;
  writeOutcome: 'created' | 'variant_added' | 'skipped' | 'failed';
  captureOutcome: 'complete' | 'incomplete' | 'unavailable';
  warnings: CaptureWarning[];
  candidates?: string[];
}

export interface MonitorCreateMocksRequest extends CaptureBatchOptions {
  /** Il runtime delle catture: gli ID ripartono a ogni avvio. */
  runtimeId: string;
  ids: string[];
}

export interface MonitorCreateMocksResult {
  runtimeId: string;
  counts: { created: number; addedVariants: number; skipped: number; unavailable: number; failed: number; incomplete: number };
  items: (CaptureItemOutcome & { requestId: string })[];
  runtime: BatchRuntime;
}

export interface DumpCreateMocksResult {
  created: number;
  createdEmpty: number;
  skippedExisting: number;
  failed: number;
  addedVariants: number;
  items: (CaptureItemOutcome & { key: string | null })[];
  runtime: BatchRuntime;
}

/** Revisioni informative di GET /info: crescono quando cambia la risorsa, non sono precondizioni. */
export interface RuntimeRevisions {
  catalog: number;
  server: number;
  dump: number;
  diagnostics: number;
  config: number;
}

/** Identità del runtime e del workspace che serve, con le revisioni delle risorse (GET /info). */
export interface RuntimeInfo {
  version: string;
  /** Nuovo a ogni avvio del motore. */
  runtimeId: string;
  startedAt: string;
  workspace: { id: string; root: string | null; mocksDir: string; filesDir: string | null };
  listener: { host: string; port: number } | null;
  watcher: { state: 'disabled' | 'starting' | 'ready' | 'error'; polling: boolean; lastError: string | null };
  revisions: RuntimeRevisions;
}

/** Errore di caricamento di un file nel registro installato (GET /runtime/status). */
export interface RuntimeLoadError {
  endpointId: string | null;
  /** Relativo alla cartella dei mock, con separatori `/`. */
  filePath: string;
  message: string;
  /** `retained`: il runtime serve ancora la versione precedente; `missing`: nulla la serve. */
  serving: 'retained' | 'missing';
}

/** Esito dell'ultimo caricamento del workspace (GET /runtime/status). */
export interface RuntimeStatusReport {
  runtimeId: string;
  lastAttempt: {
    id: number;
    startedAt: string;
    completedAt: string;
    reasons: ('startup' | 'admin' | 'watcher')[];
    status: 'applied' | 'degraded' | 'failed';
  } | null;
  lastAppliedAttemptId: number | null;
  errors: RuntimeLoadError[];
  fatalError: { message: string } | null;
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

/**
 * Anteprima (dryRun) dell'import OpenAPI: piano + conteggi, senza scrivere nulla.
 * `prefix` è quello effettivamente applicato ai path del piano (normalizzato dal server),
 * `suggestedPrefix` quello ricavato dai `servers` del documento, da proporre all'utente.
 */
export interface OpenapiImportPreview {
  items: OpenapiImportItem[];
  total: number;
  create: number;
  skip: number;
  collections: number;
  prefix: string;
  suggestedPrefix: string;
}

/** Esito dell'import OpenAPI reale. */
export interface OpenapiImportResult {
  created: number;
  skipped: number;
  failed: number;
  total: number;
  collections: number;
  prefix: string;
  items: BatchItemOutcome[];
  runtime: BatchRuntime;
}

/**
 * Elementi di un batch che richiedono attenzione pur essendo stati creati: `notServed` sono
 * scritti ma non serviti dal runtime, `withWarnings` serviti ma con un avviso (es. collection
 * non assegnata).
 */
export function summarizeBatchAttention(items: readonly (Pick<BatchItemOutcome, 'runtimeOutcome' | 'error'> & { writeOutcome: string })[] | undefined): {
  notServed: number;
  withWarnings: number;
} {
  // Endpoint creati e varianti aggiunte: entrambi possono restare non serviti.
  const created = (items ?? []).filter((item) => item.writeOutcome === 'created' || item.writeOutcome === 'variant_added');
  return {
    notServed: created.filter((item) => item.runtimeOutcome === 'not_applied').length,
    withWarnings: created.filter((item) => item.runtimeOutcome !== 'not_applied' && item.error != null).length,
  };
}

export interface RequestMonitorSnapshotEvent {
  type: 'snapshot';
  /** Il runtime delle voci (motori dopo S7); gli ID ripartono a ogni avvio. */
  runtimeId?: string | null;
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
