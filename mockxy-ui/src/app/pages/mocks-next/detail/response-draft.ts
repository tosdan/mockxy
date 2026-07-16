import { computed, signal } from '@angular/core';
import {
  JSON_CONTENT_TYPE,
  contentTypeLabel,
  isDefaultBody,
  mergeHeaders,
  upsertContentType,
  type HeaderBundle,
  type ResponsePreset,
} from '../response-presets';
import { scriptTemplate } from '../script-templates';
import type { CreateResponseRequest, MockType, ResponseUpdateRequest } from '../../../mock-admin-api.types';

export type DraftPayloadType = 'json' | 'text' | 'file';
export type DraftScriptType = 'handler' | 'middleware' | null;

export interface DraftHeaderRow {
  key: string;
  value: string;
}

export interface DraftSeed {
  title: string;
  status: number | null;
  delay: number;
  headers: DraftHeaderRow[];
  payloadType: DraftPayloadType;
  body: string;
  scriptType: DraftScriptType;
  templated?: boolean;
}

/**
 * Bozza della response nel form di modifica/creazione: stato (titolo/status/delay/header/body/file),
 * regole (validazione JSON, content-type esplicito, preset) e costruzione dei payload verso l'API.
 * Classe pura (signals, niente DI): il componente la istanzia e la passa al form.
 */
export class ResponseDraft {
  readonly title = signal('');
  readonly status = signal<number | null>(200);
  readonly delay = signal(0);
  readonly headers = signal<DraftHeaderRow[]>([]);
  readonly body = signal('');
  /** Formato del body: JSON (validato), testo libero, o file (upload, file-backed). */
  readonly payloadType = signal<DraftPayloadType>('json');
  /** Tipo script quando la bozza è handler/middleware (governa form e payload), null per i mock. */
  readonly scriptType = signal<DraftScriptType>(null);
  /** Templating del body/header ({{params.x}}, ...): opt-in per variante mock (mai per i file). */
  readonly templated = signal(false);
  /** File scelto in creazione (modalità File): caricato sulla response solo dopo che è stata creata. */
  readonly file = signal<File | null>(null);
  /** Preset response in attesa di conferma quando il body corrente non è vuoto/di default. */
  readonly pendingPreset = signal<ResponsePreset | null>(null);

  readonly isScript = computed(() => this.scriptType() !== null);

  /** JSON non valido nella bozza body (solo mock json; lo script è testo libero). */
  readonly bodyInvalid = computed(() => {
    if (this.isScript() || this.payloadType() !== 'json') return false;
    try {
      JSON.parse(this.body());
      return false;
    } catch {
      return true;
    }
  });

  /** Media type corrente derivato dall'header content-type della bozza (etichetta senza parametri). */
  readonly contentType = computed(() => {
    const row = this.headers().find((h) => h.key.trim().toLowerCase() === 'content-type');
    return row ? contentTypeLabel(row.value) : 'content-type';
  });

  /** Semina la bozza dalla response selezionata (modifica in posto). */
  seedForEdit(seed: DraftSeed): void {
    this.title.set(seed.title);
    this.status.set(seed.status);
    this.delay.set(seed.delay);
    this.headers.set(seed.headers);
    this.payloadType.set(seed.payloadType);
    this.body.set(seed.body);
    this.scriptType.set(seed.scriptType);
    this.templated.set(seed.templated === true);
    this.clearTransient();
  }

  /**
   * Semina la bozza per una NUOVA response del tipo scelto: script = template (o sorgente seminata
   * dal mock corrente), mock = body JSON con content-type esplicito.
   */
  seedForCreate(type: MockType, seededSource?: string): void {
    this.title.set('');
    this.status.set(200);
    this.delay.set(0);
    if (type === 'handler' || type === 'middleware') {
      this.scriptType.set(type);
      this.body.set(seededSource ?? scriptTemplate(type));
      this.headers.set([]);
      this.payloadType.set('json');
    } else {
      this.scriptType.set(null);
      this.headers.set([{ key: 'content-type', value: 'application/json; charset=utf-8' }]);
      this.payloadType.set('json');
      this.body.set('{\n  \n}');
    }
    this.templated.set(false);
    this.clearTransient();
  }

  /** Azzera lo stato volatile (file in bozza, preset in attesa) senza toccare i campi. */
  clearTransient(): void {
    this.file.set(null);
    this.pendingPreset.set(null);
  }

  // --- header rows ---
  addHeaderRow(): void {
    this.headers.update((rows) => [...rows, { key: '', value: '' }]);
  }
  removeHeaderRow(index: number): void {
    this.headers.update((rows) => rows.filter((_, i) => i !== index));
  }
  setHeaderKey(index: number, key: string): void {
    this.headers.update((rows) => rows.map((r, i) => (i === index ? { ...r, key } : r)));
  }
  setHeaderValue(index: number, value: string): void {
    this.headers.update((rows) => rows.map((r, i) => (i === index ? { ...r, value } : r)));
  }

  /**
   * Cambia il formato del body e tiene esplicito il content-type negli header
   * (JSON→application/json, Testo→text/plain): lo aggiunge se manca, o lo aggiorna se l'attuale
   * è un default automatico — senza calpestare un content-type custom dell'utente. Per File è
   * l'upload a impostarlo dal MIME del file.
   */
  setBodyFormat(format: DraftPayloadType): void {
    this.payloadType.set(format);
    if (format === 'file') return;
    const wanted = format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
    const rows = this.headers();
    const idx = rows.findIndex((h) => h.key.trim().toLowerCase() === 'content-type');
    if (idx < 0) {
      this.headers.set([...rows, { key: 'content-type', value: wanted }]);
      return;
    }
    const current = rows[idx].value.trim().toLowerCase();
    if (current.startsWith('application/json') || current.startsWith('text/plain')) {
      this.headers.update((rs) => rs.map((h, i) => (i === idx ? { ...h, value: wanted } : h)));
    }
  }

  // --- preset comuni: bundle header, preset response, content-type ---
  /** Inserisce in blocco gli header di un bundle nella bozza (merge non distruttivo). */
  applyHeaderBundle(bundle: HeaderBundle): void {
    this.headers.set(mergeHeaders(this.headers(), bundle.headers));
  }

  /** Applica un preset response; se il body corrente non è vuoto/di default chiede conferma. */
  choosePreset(preset: ResponsePreset): void {
    if (isDefaultBody(this.body())) this.applyPreset(preset);
    else this.pendingPreset.set(preset);
  }

  applyPendingPreset(): void {
    const preset = this.pendingPreset();
    if (preset) this.applyPreset(preset);
    this.pendingPreset.set(null);
  }

  private applyPreset(preset: ResponsePreset): void {
    this.status.set(preset.status);
    this.payloadType.set('json');
    this.body.set(JSON.stringify(preset.body, null, 2));
    let headers = upsertContentType(this.headers(), JSON_CONTENT_TYPE);
    if (preset.headers?.length) headers = mergeHeaders(headers, preset.headers);
    this.headers.set(headers);
  }

  /** Quick-pick del content-type: aggiorna solo l'header (non tocca il formato JSON/Testo/File). */
  chooseContentType(contentType: string): void {
    this.headers.set(upsertContentType(this.headers(), contentType));
  }

  /** Ripristina la sorgente (handler/middleware) al template di partenza. */
  regenerateSource(): void {
    const type = this.scriptType();
    if (type) this.body.set(scriptTemplate(type));
  }

  /** Header della bozza come oggetto, scartando le chiavi vuote. */
  headersObject(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { key, value } of this.headers()) {
      const k = key.trim();
      if (k !== '') out[k] = value;
    }
    return out;
  }

  /** Payload di aggiornamento della response selezionata; null se il body JSON non è valido. */
  buildUpdatePayload(): ResponseUpdateRequest | null {
    const script = this.scriptType();
    const title = this.title().trim();
    if (script) {
      return { type: script, title, source: this.body() };
    }
    if (this.payloadType() === 'file') {
      // file mode: aggiorna solo i metadati (status/headers/delay); il file resta quello caricato.
      // Niente templated: i payload file non si templano (regola del motore).
      return { type: 'mock', title, status: this.status() ?? 0, headers: this.headersObject(), delayMs: this.delay() };
    }
    const body = this.parsedBody();
    if (body === INVALID_BODY) return null;
    return { type: 'mock', title, status: this.status() ?? 0, headers: this.headersObject(), delayMs: this.delay(), body, templated: this.templated() };
  }

  /**
   * Payload di creazione della response in bozza; null se il body JSON non è valido.
   * In modalità File il body è un segnaposto: l'upload del file avviene dopo la create.
   */
  buildCreatePayload(): CreateResponseRequest | null {
    const script = this.scriptType();
    const title = this.title().trim();
    if (script) {
      return { type: script, title, source: this.body() };
    }
    if (this.payloadType() === 'file') {
      return { type: 'mock', title, status: this.status() ?? 0, headers: this.headersObject(), delayMs: this.delay(), body: {} };
    }
    const body = this.parsedBody();
    if (body === INVALID_BODY) return null;
    return { type: 'mock', title, status: this.status() ?? 0, headers: this.headersObject(), delayMs: this.delay(), body, templated: this.templated() };
  }

  private parsedBody(): unknown {
    if (this.payloadType() === 'text') {
      return this.body();
    }
    try {
      return JSON.parse(this.body());
    } catch {
      return INVALID_BODY;
    }
  }
}

/** Sentinella per "body JSON non valido" (distinta da qualsiasi valore JSON legittimo). */
const INVALID_BODY = Symbol('invalid-body');
