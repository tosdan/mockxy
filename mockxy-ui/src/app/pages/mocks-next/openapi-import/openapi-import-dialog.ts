import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideUpload, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiInput } from '../../../ui/ui-input/ui-input';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { MocksStore } from '../mocks-next.store';
import { routePathError } from '../../../mock-path-convention';
import type { OpenapiImportPreview } from '../../../mock-admin-api.types';

type ImportFilter = 'all' | 'create' | 'skip';

/** Attesa prima di ricalcolare il piano mentre si digita il prefisso. */
const PREFIX_DEBOUNCE_MS = 350;

/**
 * Mini-wizard di import OpenAPI: carica un documento (YAML/JSON), mostra l'anteprima degli endpoint
 * che verranno creati o saltati (con filtro rapido e conteggi), poi crea i mock mancanti.
 * Il prefisso opzionale (es. "/be") viene anteposto ai path importati: il piano si ricalcola lato
 * server a ogni modifica, così la lista mostra i path definitivi e i conteggi create/skip restano veri.
 * Aperto col viewContainerRef della pagina così vede il MocksStore page-scoped per ricaricare il catalogo.
 */
@Component({
  selector: 'mocks-next-openapi-import',
  imports: [NgIcon, UiButton, UiInput, TranslocoPipe],
  providers: [provideIcons({ lucideCheck, lucideUpload, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex max-h-[85vh] w-[min(92vw,680px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <span class="grid h-7 w-7 place-items-center rounded-md bg-muted text-brand ring-1 ring-border"><ng-icon name="lucideUpload" size="0.95rem" /></span>
        <h2 class="text-[15px] font-bold tracking-tight">{{ 'openapiImport.title' | transloco }}</h2>
        <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="close()" [disabled]="importing()"><ng-icon name="lucideX" size="0.95rem" /></button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
        <label
          class="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-input bg-black/20 px-4 py-6 text-sm text-muted-foreground transition hover:border-ring/40 hover:text-foreground"
          [style.borderColor]="dragging() ? 'var(--brand)' : null"
          [style.backgroundColor]="dragging() ? tint('var(--brand)', 12) : null"
          [style.color]="dragging() ? 'var(--foreground)' : null"
          (dragenter)="onDragOver($event)"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
        >
          <div class="pointer-events-none flex flex-col items-center gap-1.5 text-center">
            <ng-icon name="lucideUpload" size="1.35rem" [style.color]="dragging() ? 'var(--brand)' : null" />
            <span class="font-medium">@if (fileName()) {{{ fileName() }}} @else {{{ (dragging() ? 'openapiImport.dropToImport' : 'openapiImport.dropHint') | transloco }}}</span>
            @if (!fileName()) {
            <span class="text-[11px] opacity-70">.json · .yaml · .yml</span>
            }
          </div>
          <input type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" class="hidden" (change)="onFileSelected($event)" />
        </label>

        @if (loading()) {
        <p class="text-center text-[13px] text-muted-foreground">{{ 'openapiImport.analyzing' | transloco }}</p>
        }
        @if (error()) {
        <p class="text-[12.5px] text-destructive-soft">{{ error() }}</p>
        }

        @if (preview(); as p) {
        <div class="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <span class="rounded-lg bg-muted/60 px-2.5 py-1 ring-1 ring-border"><b class="tabular-nums" [style.color]="'var(--positive)'">{{ p.create }}</b> {{ 'openapiImport.toCreate' | transloco }}</span>
          <span class="rounded-lg bg-muted/60 px-2.5 py-1 ring-1 ring-border"><b class="tabular-nums text-foreground">{{ p.skip }}</b> {{ 'openapiImport.alreadyExisting' | transloco }}</span>
          <span class="rounded-lg bg-muted/60 px-2.5 py-1 ring-1 ring-border"><b class="tabular-nums text-foreground">{{ p.collections }}</b> {{ 'openapiImport.collections' | transloco }}</span>
        </div>

        <div class="flex items-center gap-2">
          @for (f of filters; track f.key) {
          <button (click)="filter.set(f.key)"
                  class="inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition"
                  [style.color]="filter() === f.key ? f.color : 'var(--muted-foreground)'"
                  [style.borderColor]="filter() === f.key ? tint(f.color, 40) : 'var(--input)'"
                  [style.background]="filter() === f.key ? tint(f.color, 10) : 'transparent'">{{ f.label | transloco }} <span class="tabular-nums opacity-80">{{ countFor(f.key) }}</span></button>
          }
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="openapi-import-prefix" class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'openapiImport.prefixLabel' | transloco }}</label>
          <input
            id="openapi-import-prefix"
            ui-input
            type="text"
            class="w-full font-mono text-[13px]"
            placeholder="/be"
            autocomplete="off"
            spellcheck="false"
            [value]="prefix()"
            [disabled]="importing()"
            (input)="onPrefixInput($any($event.target).value)"
          />
          @if (prefixError(); as err) {
          <span class="text-[11.5px] text-destructive-soft">{{ err | transloco }}</span>
          } @else {
          <span class="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
            {{ 'openapiImport.prefixHint' | transloco }}
            @if (p.suggestedPrefix && p.suggestedPrefix !== prefix().trim()) {
            <button type="button" class="rounded px-1.5 py-0.5 font-mono text-[11px] text-brand ring-1 ring-border transition hover:bg-muted/60" (click)="applySuggestedPrefix(p.suggestedPrefix)">{{ 'openapiImport.prefixUseSuggested' | transloco: { prefix: p.suggestedPrefix } }}</button>
            }
          </span>
          }
        </div>

        <div class="min-h-0 flex-1 overflow-auto mx-scroll rounded-lg border border-border">
          @for (item of filteredItems(); track item.method + ' ' + item.path) {
          <div class="flex items-center gap-2.5 border-b border-border-soft px-3 py-2 last:border-b-0" [class.opacity-45]="item.action === 'skip'">
            <span class="w-12 shrink-0 font-mono text-[12px] font-bold" [style.color]="methodColor(item.method)">{{ item.method }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground">{{ item.path }}</span>
            @if (item.collection) {
            <span class="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground ring-1 ring-border">{{ item.collection }}</span>
            }
            <span class="shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold"
                  [style.color]="item.action === 'create' ? 'var(--positive)' : 'var(--muted-foreground)'"
                  [style.background]="tint(item.action === 'create' ? 'var(--positive)' : 'var(--muted-foreground)', 14)">{{ (item.action === 'create' ? 'openapiImport.actionCreate' : 'openapiImport.actionExists') | transloco }}</span>
          </div>
          } @empty {
          <div class="px-3 py-6 text-center text-[12.5px] text-muted-foreground">{{ 'openapiImport.noEndpoints' | transloco }}</div>
          }
        </div>
        }
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button ui-button variant="outline" (click)="close()" [disabled]="importing()">{{ 'openapiImport.cancel' | transloco }}</button>
        <button ui-button (click)="runImport()" [disabled]="!canImport()">
          <ng-icon name="lucideCheck" size="0.9rem" /> {{ 'openapiImport.import' | transloco }}{{ preview() ? ' (' + preview()!.create + ')' : '' }}
        </button>
      </div>
    </div>
  `,
})
export class OpenapiImportDialog implements OnDestroy {
  private readonly api = inject(MockAdminApiService);
  private readonly store = inject(MocksStore);
  private readonly toast = inject(ToastService);
  private readonly dialogRef = inject(DialogRef);
  private readonly transloco = inject(TranslocoService);

  protected readonly fileName = signal('');
  protected readonly loading = signal(false);
  protected readonly importing = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly preview = signal<OpenapiImportPreview | undefined>(undefined);
  protected readonly filter = signal<ImportFilter>('all');
  protected readonly dragging = signal(false);
  /** Prefisso da anteporre ai path importati: vuoto = nessuno. */
  protected readonly prefix = signal('');
  /** Chiave i18n dell'errore sul prefisso (null se valido): blocca il ricalcolo e l'import. */
  protected readonly prefixError = signal<string | null>(null);
  /** Ricalcolo del piano in corso dopo una modifica del prefisso (l'anteprima resta visibile). */
  protected readonly refreshing = signal(false);

  private docText = '';
  /** Progressivo delle richieste di anteprima: scarta le risposte di quelle superate. */
  private previewSeq = 0;
  private prefixTimer?: ReturnType<typeof setTimeout>;

  protected readonly filters = [
    { key: 'all' as ImportFilter, label: 'openapiImport.filterAll', color: 'var(--brand-soft)' },
    { key: 'create' as ImportFilter, label: 'openapiImport.filterCreate', color: 'var(--positive)' },
    { key: 'skip' as ImportFilter, label: 'openapiImport.filterSkip', color: 'var(--status-4xx)' },
  ];

  protected readonly filteredItems = computed(() => {
    const current = this.preview();
    if (!current) return [];
    const active = this.filter();
    return active === 'all' ? current.items : current.items.filter((item) => item.action === active);
  });

  /** File scelto col picker: avvia la lettura (consente di riselezionare lo stesso file). */
  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.handleFile(file);
  }

  /** Evidenzia la dropzone mentre un file e' sopra (no-op durante l'import in corso). */
  protected onDragOver(event: DragEvent): void {
    if (this.importing()) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
  }

  /** Rilascio del file sulla dropzone: legge il primo file trascinato. */
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.importing()) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  /** Legge il file (picker o drop) e chiede l'anteprima (dryRun) al backend. */
  private handleFile(file: File): void {
    if (!isSupportedFile(file)) {
      this.fileName.set(file.name);
      this.preview.set(undefined);
      this.error.set(this.transloco.translate('openapiImport.errUnsupported'));
      return;
    }

    this.fileName.set(file.name);
    this.error.set(undefined);
    this.preview.set(undefined);
    this.filter.set('all');
    this.resetPrefix();
    this.loading.set(true);

    file.text().then(
      (text) => {
        this.docText = text;
        const seq = ++this.previewSeq;
        this.api.previewOpenapi(text).subscribe({
          next: (plan) => {
            if (seq !== this.previewSeq) return;
            // Se i `servers` del documento dichiarano un path, lo proponiamo già applicato
            // (l'utente conferma o svuota il campo): serve un secondo giro perché il prefisso
            // cambia anche il verdetto create/skip di ogni endpoint.
            if (plan.suggestedPrefix !== '') {
              this.prefix.set(plan.suggestedPrefix);
              this.requestPreview();
              return;
            }
            this.preview.set(plan);
            this.loading.set(false);
          },
          error: (e: unknown) => {
            if (seq !== this.previewSeq) return;
            this.loading.set(false);
            this.error.set(this.readError(e));
          },
        });
      },
      () => {
        this.loading.set(false);
        this.error.set(this.transloco.translate('openapiImport.errReadFile'));
      },
    );
  }

  /** Prefisso modificato a mano: valida subito e ricalcola il piano con un debounce. */
  protected onPrefixInput(value: string): void {
    this.prefix.set(value);
    this.prefixError.set(prefixError(value));
    clearTimeout(this.prefixTimer);
    if (this.prefixError() != null || this.docText === '') return;
    this.prefixTimer = setTimeout(() => this.requestPreview(), PREFIX_DEBOUNCE_MS);
  }

  /** Ripristina il prefisso suggerito dal documento (scorciatoia dell'hint). */
  protected applySuggestedPrefix(suggested: string): void {
    clearTimeout(this.prefixTimer);
    this.prefix.set(suggested);
    this.prefixError.set(null);
    this.requestPreview();
  }

  /** Ricalcola l'anteprima con il prefisso corrente; le risposte superate vengono scartate. */
  private requestPreview(): void {
    const seq = ++this.previewSeq;
    this.refreshing.set(true);
    this.api.previewOpenapi(this.docText, this.prefix().trim()).subscribe({
      next: (plan) => {
        if (seq !== this.previewSeq) return;
        this.preview.set(plan);
        this.error.set(undefined);
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: (e: unknown) => {
        if (seq !== this.previewSeq) return;
        this.loading.set(false);
        this.refreshing.set(false);
        this.error.set(this.readError(e));
      },
    });
  }

  private resetPrefix(): void {
    clearTimeout(this.prefixTimer);
    this.prefix.set('');
    this.prefixError.set(null);
    this.refreshing.set(false);
  }

  ngOnDestroy(): void {
    clearTimeout(this.prefixTimer);
  }

  /** Import possibile solo con un piano aggiornato, un prefisso valido e qualcosa da creare. */
  protected readonly canImport = computed(
    () => (this.preview()?.create ?? 0) > 0 && !this.importing() && !this.refreshing() && this.prefixError() == null,
  );

  /** Esegue l'import reale, mostra il riepilogo e ricarica il catalogo. */
  protected runImport(): void {
    if (this.docText === '' || !this.canImport()) return;
    this.importing.set(true);
    this.error.set(undefined);
    this.api.importOpenapi(this.docText, this.prefix().trim()).subscribe({
      next: (result) => {
        this.importing.set(false);
        this.toast.show({
          title: this.transloco.translate('openapiImport.toastTitle'),
          description: this.summarizeImport(result.created, result.skipped, result.failed),
          tone: result.created > 0 ? 'success' : 'info',
        });
        this.store.loadCatalog();
        this.dialogRef.close();
      },
      error: (e: unknown) => {
        this.importing.set(false);
        this.error.set(this.readError(e));
        this.toast.show({ title: this.transloco.translate('openapiImport.errorTitle'), description: this.readError(e), tone: 'error' });
      },
    });
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected countFor(key: ImportFilter): number {
    const current = this.preview();
    if (!current) return 0;
    return key === 'all' ? current.total : key === 'create' ? current.create : current.skip;
  }

  protected methodColor(method: string): string {
    return `var(--method-${method.toLowerCase()})`;
  }

  protected tint(color: string, pct: number): string {
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  }

  /** Riepilogo dell'esito import (conteggi tradotti) per il toast; il suffisso "falliti" solo se presente. */
  private summarizeImport(created: number, skipped: number, failed: number): string {
    const parts = [
      this.transloco.translate('openapiImport.resultCreated', { count: created }),
      this.transloco.translate('openapiImport.resultSkipped', { count: skipped }),
    ];
    if (failed > 0) parts.push(this.transloco.translate('openapiImport.resultFailed', { count: failed }));
    return parts.join(', ');
  }

  /** Messaggio leggibile dall'errore HTTP/runtime; ripiega su un testo tradotto. */
  private readError(error: unknown): string {
    return readErrorMessage(error) ?? this.transloco.translate('openapiImport.errImportFailed');
  }
}

/**
 * Chiave i18n dell'errore sul prefisso, null se valido (vuoto incluso: il campo è facoltativo).
 * "be" e "/be/" sono accettati — li normalizziamo come fa il server — poi vale la stessa
 * convenzione dei path del dialog "Nuovo", visto che il prefisso finisce dentro i path creati.
 */
function prefixError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '/') return null;
  const normalized = (trimmed.startsWith('/') ? trimmed : `/${trimmed}`).replace(/\/+$/, '');
  return routePathError(normalized);
}

/** Estensioni accettate come il picker; i file senza estensione passano e li valida il backend. */
function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return !name.includes('.') || /\.(json|ya?ml)$/.test(name);
}

/** Estrae un messaggio leggibile dagli errori HTTP o runtime (undefined se assente: il chiamante traduce il fallback). */
function readErrorMessage(error: unknown): string | undefined {
  if (isObject(error) && isObject(error['error']) && typeof error['error']['message'] === 'string') {
    return error['error']['message'];
  }
  if (isObject(error) && typeof error['message'] === 'string') {
    return error['message'];
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}
