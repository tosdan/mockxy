import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ViewSwitcher } from '../../shared/view-switcher';
import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { finalize } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideCheck,
  lucideDatabase,
  lucideLayers,
  lucidePlus,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiBadge } from '../../ui/ui-badge/ui-badge';
import { UiButton } from '../../ui/ui-button/ui-button';
import { UiCode } from '../../ui/ui-code/ui-code';
import { UiCollapsible } from '../../ui/ui-collapsible/ui-collapsible';
import { UiMenu } from '../../ui/ui-menu/ui-menu';
import { UiTable } from '../../ui/ui-table/ui-table';
import { UiTooltip } from '../../ui/ui-tooltip/ui-tooltip';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import { MockAdminApiService } from '../../mock-admin-api.service';
import type { DumpCreateMocksResult, DumpEntry, DumpReadCursor, DumpSelection, MonitorDumpFile } from '../../mock-admin-api.types';

const PAGE_SIZE = 300;

/**
 * Pagina "Storico dump": browse READ-ONLY (non live) dei dump su disco con virtual scroll a cursore.
 * Legge solo dai file di dump (mai dall'array live delle 250 del monitor); l'utente seleziona singole
 * entry / un range (shift-click) / tutto un file e la creazione mock la fa il backend (createMocksFromDump).
 */
@Component({
  selector: 'app-storico-dump',
  imports: [
    ViewSwitcher,
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    CdkMenuTrigger,
    NgIcon,
    TranslocoPipe,
    UiBadge,
    UiButton,
    UiCode,
    UiCollapsible,
    UiMenu,
    UiTable,
    UiTooltip,
  ],
  providers: [provideIcons({ lucideArrowLeft, lucideCheck, lucideDatabase, lucideLayers, lucidePlus, lucideTrash2, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="absolute inset-0 flex flex-col overflow-hidden bg-background text-foreground">
      <!-- TOPBAR -->
      <header class="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-5">
        <app-view-switcher current="storico" />
        <span class="h-6 w-px shrink-0 bg-border"></span>
        <span class="grid h-8 w-8 place-items-center rounded-lg bg-muted text-brand ring-1 ring-border"><ng-icon name="lucideDatabase" size="1rem" /></span>
        <div class="leading-tight">
          <div class="text-sm font-bold tracking-tight">{{ 'storico.title' | transloco }}</div>
          <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--status-4xx)]">{{ 'storico.subtitle' | transloco }}</div>
        </div>
        <span class="text-[12px] text-muted-foreground">{{ 'storico.loaded' | transloco: { count: entries().length } }}{{ done() ? '' : '…' }}</span>

        <div class="ml-auto flex items-center gap-2">
          <button ui-button variant="outline" size="sm" [cdkMenuTriggerFor]="filesMenu" [disabled]="creating()"><ng-icon name="lucideLayers" size="0.9rem" /> {{ 'storico.files' | transloco: { count: files().length } }}</button>
          <button ui-button variant="outline" size="sm" [disabled]="entries().length === 0" (click)="selectAllLoaded()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ 'storico.selectLoaded' | transloco }}</button>
          @if (selectedCount() > 0) {
          <button ui-button variant="outline" size="sm" (click)="clearSelection()"><ng-icon name="lucideX" size="0.9rem" /> {{ 'storico.deselect' | transloco }}</button>
          }
          <button ui-button size="sm" [disabled]="selectedCount() === 0 || creating()" (click)="createFromSelected()"><ng-icon name="lucidePlus" size="0.9rem" /> {{ 'storico.createMock' | transloco: { count: selectedCount() } }}</button>
        </div>
      </header>

      <!-- BODY: lista virtualizzata + dettaglio -->
      <div class="relative z-10 flex min-h-0 flex-1">
        <cdk-virtual-scroll-viewport #viewport itemSize="48" class="mx-scroll min-h-0 shrink-0 border-r border-border" [style.width.px]="listWidth()" (scrolledIndexChange)="onScroll()">
          <button
            *cdkVirtualFor="let row of entries(); let i = index; trackBy: trackKey"
            type="button"
            (click)="onRowClick(row, i, $event)"
            class="flex w-full items-center gap-2.5 border-b border-border-soft px-4 text-left transition hover:bg-white/[0.03]"
            style="height: 48px"
            [class.mx-selected]="row.dumpKey === focusedKey()"
          >
            <span class="grid size-4 shrink-0 place-items-center rounded border transition"
                  [style.borderColor]="selectedKeys().has(row.dumpKey) ? 'var(--brand)' : 'var(--input)'"
                  [style.background]="selectedKeys().has(row.dumpKey) ? 'var(--brand)' : 'transparent'">
              @if (selectedKeys().has(row.dumpKey)) { <ng-icon name="lucideCheck" size="0.7rem" class="text-white" /> }
            </span>
            <span class="w-12 shrink-0 font-mono text-[12px] font-bold" [style.color]="methodColor(row.method)">{{ row.method }}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[12.5px]">{{ row.originalUrl }}</span>
            <span class="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums" [style.color]="statusColor(row.status)" [style.background]="tint(statusColor(row.status), 12)">{{ row.status }}</span>
          </button>
          @if (loading()) {
          <div class="px-4 py-3 text-center text-[12px] text-muted-foreground">{{ 'storico.loading' | transloco }}</div>
          }
        </cdk-virtual-scroll-viewport>

        <!-- divisore trascinabile: ridimensiona la lista (largh. persistita) -->
        <div
          class="relative z-20 -ml-px w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-brand/30"
          (pointerdown)="startResize($event)"
          (dblclick)="resetListWidth()"
          role="separator"
          aria-orientation="vertical"
          [title]="'storico.resizeHint' | transloco"
        ></div>

        <!-- DETTAGLIO della entry a fuoco (mostra anche la request, come nel monitor) -->
        <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          @if (focused(); as sel) {
          <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-4">
              <span class="font-mono text-[15px] font-bold" [style.color]="methodColor(sel.method)">{{ sel.method }}</span>
              <span class="font-mono text-[16px] font-semibold">{{ sel.originalUrl }}</span>
              <span class="rounded-md px-2 py-0.5 font-mono text-[13px] font-bold tabular-nums" [style.color]="statusColor(sel.status)" [style.background]="tint(statusColor(sel.status), 14)">{{ sel.status }}</span>
              <span class="text-[12px] text-muted-foreground">{{ sourceLabel(sel.source) }} · {{ sel.dumpKey }}</span>
            </div>
            <div class="flex min-h-0 flex-1 flex-col overflow-y-auto mx-scroll">
              <!-- Request · headers -->
              <div class="shrink-0 border-b border-border">
                <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
                  <div uiCollapsibleHeader class="flex items-center gap-2">
                    <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'storico.requestHeaders' | transloco }}</h3>
                    <ui-badge tone="neutral">{{ headerCount(sel.requestHeaders) }}</ui-badge>
                  </div>
                  <div class="overflow-x-auto bg-[var(--code)] mx-scroll">
                    <table ui-table class="font-mono text-[12px]">
                      <tbody>
                        @for (h of headerRows(sel.requestHeaders); track h[0]) {
                        <tr>
                          <td class="w-[30%] whitespace-nowrap py-1.5 pl-6 pr-4 align-top font-medium text-[var(--json-key)]">{{ h[0] }}</td>
                          <td class="break-all py-1.5 pr-6 align-top text-muted-foreground">{{ h[1] }}</td>
                        </tr>
                        } @empty {
                        <tr><td class="px-6 py-2 text-muted-foreground">{{ 'common.noHeaders' | transloco }}</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </ui-collapsible>
              </div>

              <!-- Request · body -->
              <div class="shrink-0 border-b border-border">
                <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
                  <div uiCollapsibleHeader class="flex items-center gap-2">
                    <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'storico.requestBody' | transloco }}</h3>
                    <span class="font-mono text-[11px] text-muted-foreground">{{ sel.requestBodyBytes }} B@if (sel.requestBodyTruncated) { · {{ 'storico.truncated' | transloco }}}</span>
                  </div>
                  @if (sel.requestBody) { <div class="px-6 py-3"><ui-code [code]="sel.requestBody" [language]="bodyLang(sel.requestBody)" /></div> }
                  @else { <p class="px-6 py-3 text-[12.5px] text-muted-foreground">{{ 'storico.noPayload' | transloco }}</p> }
                </ui-collapsible>
              </div>

              <!-- Response · headers -->
              <div class="shrink-0 border-b border-border">
                <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
                  <div uiCollapsibleHeader class="flex items-center gap-2">
                    <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'storico.responseHeaders' | transloco }}</h3>
                    <ui-badge tone="neutral">{{ headerCount(sel.responseHeaders) }}</ui-badge>
                  </div>
                  <div class="overflow-x-auto bg-[var(--code)] mx-scroll">
                    <table ui-table class="font-mono text-[12px]">
                      <tbody>
                        @for (h of headerRows(sel.responseHeaders); track h[0]) {
                        <tr>
                          <td class="w-[30%] whitespace-nowrap py-1.5 pl-6 pr-4 align-top font-medium text-[var(--json-key)]">{{ h[0] }}</td>
                          <td class="break-all py-1.5 pr-6 align-top text-muted-foreground">{{ h[1] }}</td>
                        </tr>
                        } @empty {
                        <tr><td class="px-6 py-2 text-muted-foreground">{{ 'common.noHeaders' | transloco }}</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </ui-collapsible>
              </div>

              <!-- Response · body: aperto di default; quando aperto riempie lo spazio residuo e scrolla
                   internamente (così si scorre solo il body, non tutto il pannello). Comunque collassabile. -->
              <div class="flex flex-col" [class.flex-1]="responseBodyOpen()" [style.min-height]="responseBodyOpen() ? '32rem' : null">
                <ui-collapsible class="flex flex-col" [class.min-h-0]="responseBodyOpen()" [class.flex-1]="responseBodyOpen()"
                                [open]="responseBodyOpen()" (openChange)="responseBodyOpen.set($event)" triggerClass="shrink-0 bg-white/5 px-6 py-2.5 hover:bg-white/10">
                  <div uiCollapsibleHeader class="flex items-center gap-2">
                    <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'storico.responseBody' | transloco }}</h3>
                    <span class="font-mono text-[11px] text-muted-foreground">{{ sel.responseBodyBytes ?? 0 }} B@if (sel.responseBodyTruncated) { · {{ 'storico.truncated' | transloco }}}</span>
                  </div>
                  @if (sel.responseBody) { <div class="min-h-0 flex-1 overflow-y-auto mx-scroll px-6 py-3"><ui-code [code]="sel.responseBody" [language]="bodyLang(sel.responseBody)" /></div> }
                  @else { <p class="px-6 py-3 text-[12.5px] text-muted-foreground">{{ 'storico.noResponseBody' | transloco }}</p> }
                </ui-collapsible>
              </div>
            </div>
          </div>
          } @else {
          <div class="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
            @if (entries().length === 0 && done()) {
            {{ 'storico.emptyDisk' | transloco }}
            } @else {
            {{ 'storico.selectRow' | transloco }}
            }
          </div>
          }
        </div>
      </div>

      <ng-template #filesMenu>
        <div ui-menu class="min-w-[20rem]">
          @for (f of files(); track f.name) {
          <div class="flex items-center gap-2 px-2 py-1.5">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-mono text-[12px]">{{ f.name }}</span>
              <span class="text-[10.5px] text-muted-foreground">{{ kb(f.size) }} KB</span>
            </span>
            <button ui-button variant="outline" size="sm" [disabled]="creating()" (click)="createFromFile(f)" [uiTooltip]="'storico.createFromFileTip' | transloco"><ng-icon name="lucidePlus" size="0.8rem" /> {{ 'common.all' | transloco }}</button>
            <button ui-button variant="ghost" size="icon" (click)="deleteFile(f)" [uiTooltip]="'storico.deleteDumpTip' | transloco"><ng-icon name="lucideTrash2" size="0.8rem" /></button>
          </div>
          } @empty {
          <div class="px-3 py-2 text-[12.5px] text-muted-foreground">{{ 'storico.noDumpFiles' | transloco }}</div>
          }
        </div>
      </ng-template>
    </div>
  `,
})
export class StoricoDumpPage implements OnInit {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly viewport = viewChild.required(CdkVirtualScrollViewport);

  protected readonly entries = signal<readonly DumpEntry[]>([]);
  protected readonly files = signal<readonly MonitorDumpFile[]>([]);
  protected readonly cursor = signal<DumpReadCursor | null>(null);
  protected readonly done = signal(false);
  protected readonly loading = signal(false);
  protected readonly creating = signal(false);
  protected readonly selectedKeys = signal<ReadonlySet<string>>(new Set());
  protected readonly focusedKey = signal<string | null>(null);
  /** Larghezza della lista (px), ridimensionabile col divisore e persistita in localStorage (min = altre view). */
  protected readonly listWidth = signal(clampListWidth(readStoredListWidth()));
  /** Apertura della sezione Response · body: quando aperta riempie lo spazio residuo e scrolla internamente. */
  protected readonly responseBodyOpen = signal(true);
  private lastIndex = -1;

  protected readonly selectedCount = computed(() => this.selectedKeys().size);
  protected readonly focused = computed<DumpEntry | null>(
    () => this.entries().find((entry) => entry.dumpKey === this.focusedKey()) ?? null,
  );

  ngOnInit(): void {
    this.loadFiles();
    this.loadMore();
  }

  private loadFiles(): void {
    this.api.listMonitorDumps().subscribe({
      next: (response) => this.files.set(response.files),
      error: () => this.files.set([]),
    });
  }

  protected loadMore(): void {
    if (this.loading() || this.done()) return;
    this.loading.set(true);
    this.api
      .readMonitorDumps(this.cursor(), PAGE_SIZE)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.entries.update((list) => [...list, ...page.items]);
          this.cursor.set(page.nextCursor);
          this.done.set(page.done);
          if (this.focusedKey() == null && this.entries().length > 0) {
            this.focusedKey.set(this.entries()[0].dumpKey);
          }
        },
        error: (error: unknown) => this.toast.show({ title: this.transloco.translate('common.error'), description: this.readError(error), tone: 'error' }),
      });
  }

  protected onScroll(): void {
    const range = this.viewport().getRenderedRange();
    if (range.end >= this.entries().length - 10) {
      this.loadMore();
    }
  }

  protected onRowClick(entry: DumpEntry, index: number, event: MouseEvent): void {
    this.focusedKey.set(entry.dumpKey);
    if (event.shiftKey && this.lastIndex >= 0) {
      const from = Math.min(this.lastIndex, index);
      const to = Math.max(this.lastIndex, index);
      const next = new Set(this.selectedKeys());
      for (let i = from; i <= to; i += 1) {
        const row = this.entries()[i];
        if (row) next.add(row.dumpKey);
      }
      this.selectedKeys.set(next);
    } else {
      const next = new Set(this.selectedKeys());
      if (next.has(entry.dumpKey)) next.delete(entry.dumpKey);
      else next.add(entry.dumpKey);
      this.selectedKeys.set(next);
      this.lastIndex = index;
    }
  }

  protected selectAllLoaded(): void {
    this.selectedKeys.set(new Set(this.entries().map((entry) => entry.dumpKey)));
  }

  protected clearSelection(): void {
    this.selectedKeys.set(new Set());
  }

  protected createFromSelected(): void {
    const keys = [...this.selectedKeys()];
    if (keys.length === 0) return;
    this.runCreate({ keys });
  }

  protected createFromFile(file: MonitorDumpFile): void {
    this.runCreate({ file: file.name });
  }

  private runCreate(selection: DumpSelection): void {
    this.creating.set(true);
    this.api
      .createMocksFromDump(selection)
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        next: (result) => {
          this.toast.show({ title: this.transloco.translate('storico.toastMocksCreated'), description: this.summarizeResult(result), tone: result.created + result.createdEmpty > 0 ? 'success' : 'error' });
          this.clearSelection();
        },
        error: (error: unknown) => this.toast.show({ title: this.transloco.translate('common.error'), description: this.readError(error), tone: 'error' }),
      });
  }

  protected deleteFile(file: MonitorDumpFile): void {
    this.api.deleteMonitorDump(file.name).subscribe({
      next: () => {
        this.toast.show({ title: this.transloco.translate('storico.toastDumpDeleted'), description: file.name, tone: 'success' });
        this.resetAndReload();
      },
      error: (error: unknown) => this.toast.show({ title: this.transloco.translate('common.error'), description: this.readError(error), tone: 'error' }),
    });
  }

  private resetAndReload(): void {
    this.entries.set([]);
    this.cursor.set(null);
    this.done.set(false);
    this.selectedKeys.set(new Set());
    this.focusedKey.set(null);
    this.lastIndex = -1;
    this.loadFiles();
    this.loadMore();
  }

  protected trackKey(_index: number, row: DumpEntry): string {
    return row.dumpKey;
  }

  /** Avvia il drag del divisore: aggiorna la larghezza della lista, la persiste a fine drag. */
  protected startResize(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.listWidth();
    const onMove = (e: PointerEvent) => this.listWidth.set(clampListWidth(startWidth + (e.clientX - startX)));
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.removeProperty('user-select');
      try {
        localStorage.setItem(LIST_WIDTH_KEY, String(this.listWidth()));
      } catch {
        /* localStorage non disponibile: ignora */
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.userSelect = 'none';
  }

  /** Doppio click sul divisore → larghezza di default. */
  protected resetListWidth(): void {
    this.listWidth.set(DEFAULT_LIST_WIDTH);
    try {
      localStorage.setItem(LIST_WIDTH_KEY, String(DEFAULT_LIST_WIDTH));
    } catch {
      /* ignora */
    }
  }

  protected methodColor(method: string): string {
    return `var(--method-${method.toLowerCase()})`;
  }

  protected statusColor(status: number): string {
    const klass = Math.floor(status / 100);
    return klass >= 2 && klass <= 5 ? `var(--status-${klass}xx)` : 'var(--muted-foreground)';
  }

  protected tint(color: string, pct: number): string {
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  }

  protected sourceLabel(source: string): string {
    switch (source) {
      case 'mock': return 'Mock';
      case 'handler': return 'Handler';
      case 'middleware': return 'Middleware';
      case 'backend': return 'Proxy';
      case 'mock-only':
      case 'mock-only-miss': return 'Miss';
      default: return source;
    }
  }

  protected bodyLang(text: string | undefined): 'json' | 'text' {
    const trimmed = (text ?? '').trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return 'text';
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      return 'text';
    }
  }

  /** Numero di header (per il badge dell'accordion). */
  protected headerCount(headers: Record<string, string | string[]> | undefined): number {
    return headers ? Object.keys(headers).length : 0;
  }

  /** Header (request o response) ordinati come coppie [nome, valore] per la tabella key/value. */
  protected headerRows(headers: Record<string, string | string[]> | undefined): [string, string][] {
    return Object.entries(headers ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]): [string, string] => [name, Array.isArray(value) ? value.join(', ') : String(value)]);
  }

  protected kb(bytes: number): string {
    return (bytes / 1024).toFixed(1);
  }

  /** Riepilogo dell'esito creazione mock (conteggi tradotti) per il toast. */
  private summarizeResult(result: DumpCreateMocksResult): string {
    const parts = [this.transloco.translate('storico.resultCreated', { count: result.created })];
    if (result.createdEmpty > 0) parts.push(this.transloco.translate('storico.resultSkeleton', { count: result.createdEmpty }));
    if (result.skippedExisting > 0) parts.push(this.transloco.translate('storico.resultExisting', { count: result.skippedExisting }));
    if (result.failed > 0) parts.push(this.transloco.translate('storico.resultFailed', { count: result.failed }));
    return parts.join(', ');
  }

  /** Messaggio leggibile dall'errore HTTP/runtime; ripiega su un testo tradotto. */
  private readError(error: unknown): string {
    if (error && typeof error === 'object') {
      const maybe = error as { error?: { message?: string; }; message?: string; };
      if (maybe.error && typeof maybe.error.message === 'string') return maybe.error.message;
      if (typeof maybe.message === 'string') return maybe.message;
    }
    return this.transloco.translate('common.operationFailed');
  }
}

const LIST_WIDTH_KEY = 'mx-storico-list-width';
const DEFAULT_LIST_WIDTH = 440;
const MIN_LIST_WIDTH = 380; // come MIN_CATALOG_WIDTH / MIN_LIST_WIDTH nelle altre view

/** Legge la larghezza lista salvata (o il default). */
function readStoredListWidth(): number {
  try {
    const raw = localStorage.getItem(LIST_WIDTH_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : DEFAULT_LIST_WIDTH;
  } catch {
    return DEFAULT_LIST_WIDTH;
  }
}

/** Vincola la larghezza tra il minimo e (viewport − spazio minimo per il dettaglio). */
function clampListWidth(width: number): number {
  const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const max = Math.max(MIN_LIST_WIDTH, viewport - 480);
  return Math.round(Math.max(MIN_LIST_WIDTH, Math.min(width, max)));
}
