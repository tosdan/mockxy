import { ChangeDetectionStrategy, Component, ElementRef, Injector, OnInit, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCheck,
  lucideClipboardCopy,
  lucideFileJson,
  lucidePencil,
  lucideRefreshCw,
  lucideRotateCcw,
  lucideTrash2,
  lucideTriangleAlert,
  lucideUpload,
  lucideX,
} from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ViewStateService } from '../../shared/view-state.service';
import { UiButton } from '../../ui/ui-button/ui-button';
import { UiCheckbox } from '../../ui/ui-checkbox/ui-checkbox';
import { UiCode } from '../../ui/ui-code/ui-code';
import { UiBadge } from '../../ui/ui-badge/ui-badge';
import { UiInput } from '../../ui/ui-input/ui-input';
import { UiPageHeader } from '../../ui/ui-page-header/ui-page-header';
import { UiTooltip } from '../../ui/ui-tooltip/ui-tooltip';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import { MockAdminApiService } from '../../mock-admin-api.service';
import type { DataFileSummary, DataFileUsage, SharedStateSummary } from '../../mock-admin-api.types';

/** Avviso non bloccante oltre questa dimensione: i file grandi si pagano a ogni chiamata data(). */
const LARGE_FILE_WARNING_BYTES = 5 * 1024 * 1024;

/** Chiave (ViewStateService) del file selezionato, ritrovato tornando sulla view. */
const SELECTED_FILE_STATE_KEY = 'dati-selected';

/**
 * Pagina "Dati": upload e gestione dei file JSON riusabili dagli handler/middleware via data('nome').
 * Lista a sinistra (nome canonico, dimensione, ultima modifica), preview del contenuto a destra.
 * L'upload accetta solo .json, il server valida il contenuto e normalizza il nome a lowercase.
 */
@Component({
  selector: 'app-dati',
  imports: [NgIcon, TranslocoPipe, UiBadge, UiButton, UiCheckbox, UiCode, UiInput, UiPageHeader, UiTooltip],
  providers: [
    provideIcons({
      lucideCheck,
      lucideClipboardCopy,
      lucideFileJson,
      lucidePencil,
      lucideRefreshCw,
      lucideRotateCcw,
      lucideTrash2,
      lucideTriangleAlert,
      lucideUpload,
      lucideX,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="absolute inset-0 flex flex-col overflow-hidden bg-background text-foreground"
      (dragenter)="onDragOver($event)"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <!-- TESTATA: come il catalogo, nome della vista e conteggio, che e' quello della scheda aperta. -->
      <ui-page-header [title]="'viewRail.dati' | transloco">
        <div class="flex items-center rounded-lg bg-muted p-0.5" role="tablist" [attr.aria-label]="'dati.tabsAria' | transloco">
          <button id="dati-files-tab" type="button" role="tab" aria-controls="dati-files-panel" class="rounded-md px-3 py-1.5 text-[12px] font-semibold transition" [class.bg-card]="activeTab() === 'files'" [attr.aria-selected]="activeTab() === 'files'" (click)="switchTab('files')">{{ 'dati.filesTab' | transloco }}</button>
          <button id="dati-runtime-tab" type="button" role="tab" aria-controls="dati-runtime-panel" class="rounded-md px-3 py-1.5 text-[12px] font-semibold transition" [class.bg-card]="activeTab() === 'runtime'" [attr.aria-selected]="activeTab() === 'runtime'" (click)="switchTab('runtime')">{{ 'dati.runtimeTab' | transloco }}</button>
        </div>
        <ui-badge class="whitespace-nowrap">{{ activeTab() === 'files' ? files().length : runtimeItems().length }}</ui-badge>
        @if (activeTab() === 'runtime') {
        <span class="text-[11.5px] text-muted-foreground tabular-nums">{{ formatSize(runtimeTotalBytes()) }}</span>
        }
        <ng-container actions>
          @if (activeTab() === 'files') {
          <button ui-button size="sm" [disabled]="busy()" (click)="fileInput.click()">
            <ng-icon name="lucideUpload" size="0.9rem" /> {{ 'dati.upload' | transloco }}
          </button>
          <input #fileInput type="file" class="hidden" accept=".json,application/json" multiple (change)="onFilesSelected($event)" />
          } @else {
          <button ui-button variant="outline" size="sm" [disabled]="runtimeLoading()" (click)="reloadRuntime()"><ng-icon name="lucideRefreshCw" size="0.9rem" /> {{ 'dati.runtimeRefresh' | transloco }}</button>
          @if (confirmingResetAll()) {
          <button ui-button variant="destructive" size="sm" data-confirm-reset-all [disabled]="runtimeBusyAll()" (click)="resetAllRuntime()"><ng-icon name="lucideRotateCcw" size="0.9rem" /> {{ 'dati.runtimeResetAllConfirm' | transloco: { count: runtimeItems().length } }}</button>
          <button ui-button variant="outline" size="sm" (click)="cancelResetAll()">{{ 'common.cancel' | transloco }}</button>
          } @else {
          <button ui-button variant="destructive" size="sm" data-reset-all [disabled]="runtimeItems().length === 0 || runtimeLoading()" (click)="askResetAll()"><ng-icon name="lucideRotateCcw" size="0.9rem" /> {{ 'dati.runtimeResetAll' | transloco }}</button>
          }
          }
        </ng-container>
      </ui-page-header>

      @if (activeTab() === 'files') {
      <!-- BODY: lista + preview -->
      <div id="dati-files-panel" class="relative z-10 flex min-h-0 flex-1" role="tabpanel" aria-labelledby="dati-files-tab">
        <div class="flex min-h-0 w-[420px] shrink-0 flex-col border-r border-border">
          @if (files().length === 0 && !loading()) {
          <div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <ng-icon name="lucideFileJson" size="2rem" class="text-muted-foreground/50" />
            <p class="text-[13px] text-muted-foreground">{{ 'dati.empty' | transloco }}</p>
            <p class="max-w-[32ch] text-[12px] text-muted-foreground/80">{{ 'dati.emptyHint' | transloco }}</p>
          </div>
          } @else {
          <div class="min-h-0 flex-1 overflow-y-auto mx-scroll">
            @for (f of files(); track f.name) {
            <button
              type="button"
              (click)="select(f.name)"
              class="flex w-full items-center gap-2.5 border-b border-border-soft px-4 py-3 text-left transition hover:bg-white/[0.03]"
              [class.mx-open]="f.name === selectedName()"
              [attr.aria-current]="f.name === selectedName() ? 'true' : null"
            >
              <ng-icon name="lucideFileJson" size="0.95rem" class="shrink-0 text-brand" />
              <span class="min-w-0 flex-1 truncate font-mono text-[13px]">{{ f.name }}</span>
              @if (f.usedBy.length > 0) {
              <span class="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] px-1.5 py-0.5 text-[10.5px] font-bold text-brand" [uiTooltip]="'dati.usedByBadgeTip' | transloco: { count: f.usedBy.length }">{{ 'dati.usedByBadge' | transloco: { count: f.usedBy.length } }}</span>
              }
              @if (f.sizeBytes > largeFileWarningBytes) {
              <span class="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--status-4xx)_14%,transparent)] px-1.5 py-0.5 text-[10.5px] font-bold text-[var(--status-4xx)]" [uiTooltip]="'dati.largeFileTip' | transloco">{{ 'dati.largeFile' | transloco }}</span>
              }
              <span class="shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground">{{ formatSize(f.sizeBytes) }}</span>
            </button>
            }
          </div>
          }
        </div>

        <!-- PREVIEW / DETTAGLIO -->
        <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-muted">
          @if (dragging()) {
          <div class="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-brand/10">
            <div class="flex items-center gap-2 text-[14px] font-semibold text-brand"><ng-icon name="lucideUpload" size="1.1rem" /> {{ 'dati.dropHere' | transloco }}</div>
          </div>
          }
          @if (selected(); as sel) {
          <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-6 py-3.5">
              @if (renaming()) {
              <input
                #renameInput
                ui-input
                class="w-64 font-mono text-[13px]"
                [value]="renameDraft()"
                (input)="renameDraft.set($any($event.target).value)"
                (keydown.enter)="confirmRename()"
                (keydown.escape)="cancelRename()"
                [attr.aria-label]="'dati.renameAria' | transloco"
              />
              <button ui-button variant="outline" size="icon" [disabled]="busy()" (click)="confirmRename()" [uiTooltip]="'dati.renameConfirmTip' | transloco" [attr.aria-label]="'dati.renameConfirmTip' | transloco"><ng-icon name="lucideCheck" size="0.9rem" /></button>
              <button ui-button variant="ghost" size="icon" (click)="cancelRename()" [uiTooltip]="'dati.renameCancelTip' | transloco" [attr.aria-label]="'dati.renameCancelTip' | transloco"><ng-icon name="lucideX" size="0.9rem" /></button>
              } @else {
              <span class="font-mono text-[15px] font-bold">{{ sel.name }}<span class="text-muted-foreground">.json</span></span>
              <button #renameButton ui-button variant="ghost" size="icon" (click)="startRename()" [uiTooltip]="'dati.renameTip' | transloco" [attr.aria-label]="'dati.renameTip' | transloco"><ng-icon name="lucidePencil" size="0.9rem" /></button>
              }
              <span class="font-mono text-[11.5px] text-muted-foreground">{{ formatSize(sel.sizeBytes) }} · {{ formatDate(sel.updatedAt) }}</span>

              <div class="ml-auto flex items-center gap-2">
                <button ui-button variant="outline" size="sm" (click)="copyReference()" [uiTooltip]="'dati.copyRefTip' | transloco">
                  <ng-icon name="lucideClipboardCopy" size="0.9rem" /> {{ 'dati.copyRef' | transloco }}
                </button>
                @if (confirmingDelete()) {
                <button #deleteConfirmButton ui-button variant="destructive" size="sm" [disabled]="busy()" (click)="confirmDelete()"><ng-icon name="lucideTrash2" size="0.85rem" /> {{ 'dati.deleteConfirm' | transloco }}</button>
                <button ui-button variant="outline" size="sm" (click)="cancelDelete()">{{ 'dati.deleteCancel' | transloco }}</button>
                } @else {
                <button #deleteButton ui-button variant="destructive" size="sm" [disabled]="busy()" (click)="askDelete()"><ng-icon name="lucideTrash2" size="0.85rem" /> {{ 'dati.delete' | transloco }}</button>
                }
              </div>
            </div>

            <!-- rinomina di un file referenziato: opzione per aggiornare anche i data() negli handler -->
            @if (renaming() && selectedUsedBy().length > 0) {
            <div class="flex shrink-0 items-center gap-2 border-b border-border bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] px-6 py-2 text-[12px]">
              <ui-checkbox [(checked)]="rewriteRefsOnRename" [ariaLabel]="'dati.renameRewriteAria' | transloco" />
              <span class="text-muted-foreground">{{ 'dati.renameRewrite' | transloco: { count: selectedUsedBy().length } }}</span>
            </div>
            }

            <!-- cancellazione di un file referenziato: avviso che gli endpoint si romperanno -->
            @if (confirmingDelete() && selectedUsedBy().length > 0) {
            <div class="flex shrink-0 items-start gap-2 border-b border-border bg-[color-mix(in_srgb,var(--status-4xx)_12%,transparent)] px-6 py-2 text-[12px] text-[var(--status-4xx)]">
              <ng-icon name="lucideTriangleAlert" size="0.9rem" class="mt-0.5 shrink-0" />
              <span>{{ 'dati.deleteWarnUsed' | transloco: { count: selectedUsedBy().length } }}</span>
            </div>
            }

            <!-- snippet d'uso: il riferimento pronto da incollare in un handler -->
            <div class="shrink-0 border-b border-border bg-black/20 px-6 py-2">
              <code class="font-mono text-[12px] text-muted-foreground">{{ referenceSnippet() }}</code>
            </div>

            <!-- Usato da: endpoint che referenziano questo file con data() -->
            <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-6 py-2.5">
              <span class="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground" [uiTooltip]="'dati.usedByCaveat' | transloco">{{ 'dati.usedByTitle' | transloco }}</span>
              @if (selectedUsedBy().length > 0) {
              @for (u of selectedUsedBy(); track u.id + u.type) {
              <span class="inline-flex items-center gap-1.5 rounded-md bg-black/20 px-2 py-0.5 font-mono text-[11.5px] ring-1 ring-border">
                <span class="font-bold text-foreground">{{ u.method }}</span>
                <span class="text-muted-foreground">{{ u.path }}</span>
                @if (u.type === 'middleware') { <span class="text-[9.5px] font-bold uppercase tracking-wide text-type-middleware">mw</span> }
              </span>
              }
              } @else {
              <span class="text-[12px] text-muted-foreground">{{ 'dati.usedByNone' | transloco }}</span>
              }
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4 mx-scroll">
              @if (previewText() != null) {
              <ui-code [code]="previewText()!" language="json" />
              } @else {
              <p class="text-[13px] text-muted-foreground">{{ 'dati.loadingPreview' | transloco }}</p>
              }
            </div>
          </div>
          } @else {
          <div class="grid flex-1 place-items-center p-6 text-sm text-muted-foreground">
            {{ files().length === 0 ? ('dati.emptyDetail' | transloco) : ('dati.selectFile' | transloco) }}
          </div>
          }
        </div>
      </div>
      } @else {
      <div id="dati-runtime-panel" class="relative z-10 min-h-0 flex-1 overflow-y-auto mx-scroll p-5" role="tabpanel" aria-labelledby="dati-runtime-tab">
        <p class="sr-only" aria-live="polite">{{ runtimeAnnouncement() }}</p>
        @if (runtimeLoading() && runtimeItems().length === 0) {
        <div class="grid h-full place-items-center text-[13px] text-muted-foreground">{{ 'dati.runtimeLoading' | transloco }}</div>
        } @else if (runtimeError(); as error) {
        <div class="grid h-full place-items-center p-8 text-center">
          <div>
            <ng-icon name="lucideTriangleAlert" size="2rem" class="text-destructive-soft" />
            <p class="mt-3 text-[13px] text-destructive-soft">{{ error }}</p>
            <button ui-button variant="outline" size="sm" class="mt-3" (click)="reloadRuntime()">{{ 'dati.runtimeRetry' | transloco }}</button>
          </div>
        </div>
        } @else if (runtimeItems().length === 0) {
        <div class="grid h-full place-items-center p-8 text-center">
          <div>
            <ng-icon name="lucideRefreshCw" size="2rem" class="text-muted-foreground/50" />
            <p class="mt-3 text-[13px] text-muted-foreground">{{ 'dati.runtimeEmpty' | transloco }}</p>
            <p class="mt-1 max-w-[52ch] text-[12px] text-muted-foreground/80">{{ 'dati.runtimeEmptyHint' | transloco }}</p>
          </div>
        </div>
        } @else {
        <div class="overflow-hidden rounded-xl border border-border bg-card">
          <table class="w-full border-collapse text-left text-[12px]">
            <thead class="bg-muted text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              <tr><th class="px-4 py-2.5">{{ 'dati.runtimeResource' | transloco }}</th><th class="px-4 py-2.5">{{ 'dati.runtimeStatus' | transloco }}</th><th class="px-4 py-2.5">{{ 'dati.runtimeSizeVersion' | transloco }}</th><th class="px-4 py-2.5">{{ 'dati.runtimeLastEndpoint' | transloco }}</th><th class="px-4 py-2.5 text-right">{{ 'dati.runtimeActions' | transloco }}</th></tr>
            </thead>
            <tbody>
              @for (item of runtimeItems(); track item.name) {
              <tr class="border-t border-border-soft" [class.mx-selected]="item.name === selectedRuntimeName()" [attr.data-shared-state-name]="item.name">
                <td class="px-4 py-3 align-top"><div class="font-mono text-[13px] font-bold">{{ item.name }}</div><div class="mt-1 font-mono text-[11px] text-muted-foreground">{{ item.seedKey }}</div></td>
                <td class="px-4 py-3 align-top"><span class="rounded-md bg-muted px-2 py-1 text-[10.5px] font-bold">{{ runtimeStatusLabel(item.status) | transloco }}</span></td>
                <td class="px-4 py-3 align-top font-mono tabular-nums"><div>{{ item.sizeBytes == null ? '—' : formatSize(item.sizeBytes) }}</div><div class="mt-1 text-[11px] text-muted-foreground">v{{ item.version ?? '—' }}</div></td>
                <td class="px-4 py-3 align-top"><div class="font-mono text-[11.5px]">{{ originLabel(item.lastAccessedBy ?? item.initializedBy) }}</div><div class="mt-1 text-[11px] text-muted-foreground">{{ formatRuntimeDate(item.lastAccessAt ?? item.initializedAt) }}</div></td>
                <td class="px-4 py-3 text-right align-top">
                  @if (confirmingRuntimeName() === item.name) {
                  <button ui-button variant="destructive" size="sm" data-confirm-reset [disabled]="runtimeBusyNames().has(item.name)" (click)="resetRuntime(item.name)">{{ 'dati.runtimeResetConfirm' | transloco }}</button>
                  <button ui-button variant="ghost" size="sm" (click)="cancelResetRuntime(item.name)">{{ 'common.cancel' | transloco }}</button>
                  } @else {
                  <button ui-button variant="outline" size="sm" data-reset [disabled]="runtimeBusyNames().has(item.name)" (click)="askResetRuntime(item.name)"><ng-icon name="lucideRotateCcw" size="0.8rem" /> {{ 'dati.runtimeReset' | transloco }}</button>
                  }
                </td>
              </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="mt-3 text-[11.5px] text-muted-foreground">{{ 'dati.runtimeTrafficCaveat' | transloco }}</p>
        }
      </div>
      }
    </div>
  `,
})
export class DatiPage implements OnInit {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly viewState = inject(ViewStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly files = signal<DataFileSummary[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  // Selezione ripristinata dall'ultima visita: reload() la convalida contro l'elenco corrente.
  protected readonly selectedName = signal<string | null>(this.viewState.read<string>(SELECTED_FILE_STATE_KEY));
  protected readonly previewText = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected readonly renaming = signal(false);
  protected readonly renameDraft = signal('');
  protected readonly rewriteRefsOnRename = signal(true);
  protected readonly confirmingDelete = signal(false);
  protected readonly largeFileWarningBytes = LARGE_FILE_WARNING_BYTES;
  protected readonly activeTab = signal<'files' | 'runtime'>(
    this.route.snapshot.queryParamMap.get('tab') === 'runtime' ? 'runtime' : 'files',
  );
  protected readonly runtimeItems = signal<SharedStateSummary[]>([]);
  protected readonly runtimeTotalBytes = signal(0);
  protected readonly runtimeLoading = signal(false);
  protected readonly runtimeError = signal<string | null>(null);
  protected readonly runtimeBusyAll = signal(false);
  protected readonly runtimeBusyNames = signal<ReadonlySet<string>>(new Set());
  protected readonly confirmingRuntimeName = signal<string | null>(null);
  protected readonly confirmingResetAll = signal(false);
  protected readonly selectedRuntimeName = signal<string | null>(this.route.snapshot.queryParamMap.get('name'));
  protected readonly runtimeAnnouncement = signal('');

  protected readonly selected = computed(() => this.files().find((f) => f.name === this.selectedName()) ?? null);
  protected readonly selectedUsedBy = computed<DataFileUsage[]>(() => this.selected()?.usedBy ?? []);
  protected readonly referenceSnippet = computed(() => {
    const name = this.selectedName();
    if (name == null) {
      return '';
    }
    return `const ${this.toIdentifier(name)} = await data('${name}');`;
  });

  ngOnInit(): void {
    if (this.activeTab() === 'runtime') {
      this.reloadRuntime();
    } else {
      this.reload();
    }
  }

  protected switchTab(tab: 'files' | 'runtime'): void {
    if (tab === this.activeTab()) {
      return;
    }
    this.activeTab.set(tab);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: tab === 'runtime' ? { tab: 'runtime' } : { tab: null, name: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    if (tab === 'runtime') {
      this.reloadRuntime();
    } else if (this.files().length === 0) {
      this.reload();
    }
  }

  protected reloadRuntime(): void {
    this.runtimeLoading.set(true);
    this.runtimeError.set(null);
    this.api.listSharedState().pipe(finalize(() => this.runtimeLoading.set(false))).subscribe({
      next: (response) => {
        this.runtimeItems.set(response.items);
        this.runtimeTotalBytes.set(response.totalBytes);
        const requested = this.selectedRuntimeName();
        if (requested != null && !response.items.some((item) => item.name === requested)) {
          this.selectedRuntimeName.set(null);
        }
      },
      error: (error) => {
        this.runtimeError.set(this.errorMessage(error));
        this.showError(error);
      },
    });
  }

  protected resetRuntime(name: string): void {
    this.runtimeBusyNames.update((current) => new Set([...current, name]));
    this.api.resetSharedState(name).pipe(finalize(() => {
      this.runtimeBusyNames.update((current) => {
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    })).subscribe({
      next: ({ reset }) => {
        this.confirmingRuntimeName.set(null);
        // La risorsa azzerata esce dall'elenco con la sua riga, e «Aggiorna» e' disabilitato mentre
        // l'elenco si ricarica: il fuoco va sulla scheda, che resta e risponde alle frecce.
        this.focusAfterRender(() => this.host.nativeElement.querySelector<HTMLElement>('#dati-runtime-tab'));
        this.runtimeAnnouncement.set(this.transloco.translate(
          reset ? 'dati.runtimeResetDone' : 'dati.runtimeAlreadyAbsent',
          { name },
        ));
        this.reloadRuntime();
      },
      error: (error) => this.showError(error),
    });
  }

  protected resetAllRuntime(): void {
    this.runtimeBusyAll.set(true);
    this.api.resetAllSharedState().pipe(finalize(() => this.runtimeBusyAll.set(false))).subscribe({
      next: ({ resetCount }) => {
        this.confirmingResetAll.set(false);
        this.focusAfterRender(() => this.host.nativeElement.querySelector<HTMLElement>('#dati-runtime-tab'));
        this.selectedRuntimeName.set(null);
        this.runtimeAnnouncement.set(this.transloco.translate('dati.runtimeResetAllDone', { count: resetCount }));
        this.reloadRuntime();
      },
      error: (error) => this.showError(error),
    });
  }

  /** Chiave i18n dello stato di una risorsa; uno stato che il motore aggiungesse resta com'e'. */
  protected runtimeStatusLabel(status: string): string {
    return { ready: 'dati.runtimeStatusReady', initializing: 'dati.runtimeStatusInitializing' }[status] ?? status;
  }

  protected originLabel(origin: SharedStateSummary['initializedBy']): string {
    if (origin.method == null && origin.path == null) {
      return '—';
    }
    return `${origin.method ?? ''} ${origin.path ?? ''}`.trim();
  }

  protected formatRuntimeDate(timestamp: number | null): string {
    return timestamp == null ? '—' : new Date(timestamp).toLocaleString();
  }

  /** `afterLoad`: da eseguire con l'elenco nuovo in pagina (per esempio, dove portare il fuoco). */
  private reload(keepSelection = true, afterLoad?: () => void): void {
    this.loading.set(true);
    this.api.listDataFiles().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ items }) => {
        this.files.set(items);
        afterLoad?.();
        const current = this.selectedName();
        if (!keepSelection || current == null || !items.some((f) => f.name === current)) {
          this.select(items[0]?.name ?? null);
        } else if (this.previewText() == null) {
          // Selezione mantenuta ma senza preview: il caso del ripristino dall'ultima visita.
          this.loadPreview(current);
        }
      },
      error: (error) => this.showError(error),
    });
  }

  protected select(name: string | null): void {
    if (name === this.selectedName()) {
      return;
    }
    this.setSelectedName(name);
    this.previewText.set(null);
    this.renaming.set(false);
    this.confirmingDelete.set(false);
    if (name == null) {
      return;
    }
    this.loadPreview(name);
  }

  /** Rende selezionato un file e lo persiste (ViewStateService): tornando sulla view è lo stesso. */
  private setSelectedName(name: string | null): void {
    this.selectedName.set(name);
    this.viewState.write(SELECTED_FILE_STATE_KEY, name);
  }

  private loadPreview(name: string): void {
    this.api.getDataFile(name).subscribe({
      next: (detail) => {
        // La risposta arrivata per ultima potrebbe riferirsi a una selezione già cambiata.
        if (this.selectedName() === detail.name) {
          this.previewText.set(this.prettyPreview(detail.content));
        }
      },
      error: (error) => this.showError(error),
    });
  }

  /** Contenuto formattato per la preview (se il file è minificato lo espande; già valido per contratto). */
  private prettyPreview(content: string): string {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }

  // --- upload ---------------------------------------------------------------------------------

  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.uploadAll(files);
  }

  protected onDragOver(event: DragEvent): void {
    if (this.activeTab() !== 'files') return;
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    // Il dragleave scatta anche entrando in un figlio: spegni solo uscendo dalla pagina.
    if (event.relatedTarget == null) {
      this.dragging.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.activeTab() !== 'files') return;
    this.uploadAll(Array.from(event.dataTransfer?.files ?? []));
  }

  private uploadAll(files: File[]): void {
    const jsonFiles = files.filter((f) => f.name.toLowerCase().endsWith('.json'));
    if (files.length > 0 && jsonFiles.length === 0) {
      this.toast.show({ title: this.t('dati.toastOnlyJsonTitle'), description: this.t('dati.toastOnlyJsonDesc'), tone: 'error' });
      return;
    }
    if (jsonFiles.length === 0) {
      return;
    }

    this.busy.set(true);
    const existing = new Set(this.files().map((f) => f.name));
    let remaining = jsonFiles.length;
    let lastUploaded: string | null = null;

    // All'ultimo upload completato: seleziona l'ultimo file caricato e azzera preview e stati
    // transitori, così reload() ricarica la preview dal server. select() non basterebbe: su un
    // upload che sostituisce il file già selezionato il nome non cambia e la preview resterebbe
    // quella del contenuto precedente.
    const done = () => {
      if (--remaining > 0) {
        return;
      }
      this.busy.set(false);
      if (lastUploaded != null) {
        this.setSelectedName(lastUploaded);
        this.previewText.set(null);
        this.renaming.set(false);
        this.confirmingDelete.set(false);
      }
      this.reload();
    };

    for (const file of jsonFiles) {
      const name = file.name.replace(/\.json$/i, '');
      const replaced = existing.has(name.toLowerCase());
      this.api.uploadDataFile(name, file).subscribe({
        next: (detail) => {
          lastUploaded = detail.name;
          this.toast.show({
            title: this.t(replaced ? 'dati.toastReplacedTitle' : 'dati.toastUploadedTitle'),
            description: `${detail.fileName} · ${this.formatSize(detail.sizeBytes)}`,
            tone: 'success',
          });
          if (detail.sizeBytes > LARGE_FILE_WARNING_BYTES) {
            this.toast.show({ title: this.t('dati.toastLargeTitle'), description: this.t('dati.toastLargeDesc'), tone: 'warning' });
          }
          done();
        },
        error: (error) => {
          this.showError(error, file.name);
          done();
        },
      });
    }
  }

  // --- rinomina / cancellazione ---------------------------------------------------------------

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  // read: ElementRef perche' sui pulsanti c'e' il componente ui-button: senza, si avrebbe lui.
  private readonly renameInput = viewChild('renameInput', { read: ElementRef<HTMLInputElement> });
  private readonly renameButton = viewChild('renameButton', { read: ElementRef<HTMLButtonElement> });
  private readonly deleteButton = viewChild('deleteButton', { read: ElementRef<HTMLButtonElement> });
  private readonly deleteConfirmButton = viewChild('deleteConfirmButton', { read: ElementRef<HTMLButtonElement> });

  /**
   * Porta il fuoco su un elemento appena disegnato. Il pulsante cliccato sparisce col clic (la
   * matita, «Elimina»): senza, il fuoco cadeva sul body e da tastiera si perdeva il punto.
   */
  private focusAfterRender(target: () => ElementRef<HTMLElement> | HTMLElement | null | undefined, select = false): void {
    afterNextRender(() => {
      const found = target();
      const element = found instanceof ElementRef ? found.nativeElement : found;
      element?.focus();
      if (select && element instanceof HTMLInputElement) element.select();
    }, { injector: this.injector });
  }

  /** Rinomina ed eliminazione si escludono: aprirne una chiude l'altra. */
  protected startRename(): void {
    this.confirmingDelete.set(false);
    this.renameDraft.set(this.selectedName() ?? '');
    this.rewriteRefsOnRename.set(true);
    this.renaming.set(true);
    this.focusAfterRender(this.renameInput, true);
  }

  protected cancelRename(): void {
    this.renaming.set(false);
    this.focusAfterRender(this.renameButton);
  }

  protected askDelete(): void {
    this.renaming.set(false);
    this.confirmingDelete.set(true);
    this.focusAfterRender(this.deleteConfirmButton);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
    this.focusAfterRender(this.deleteButton);
  }

  /** Conferme dello stato runtime: stesso trattamento del fuoco, sulla riga della risorsa. */
  private runtimeRow(name: string): HTMLElement | undefined {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-shared-state-name]')).find(
      (row) => row.getAttribute('data-shared-state-name') === name,
    );
  }

  protected askResetRuntime(name: string): void {
    this.confirmingRuntimeName.set(name);
    this.focusAfterRender(() => this.runtimeRow(name)?.querySelector<HTMLElement>('[data-confirm-reset]'));
  }

  protected cancelResetRuntime(name: string): void {
    this.confirmingRuntimeName.set(null);
    this.focusAfterRender(() => this.runtimeRow(name)?.querySelector<HTMLElement>('[data-reset]'));
  }

  protected askResetAll(): void {
    this.confirmingResetAll.set(true);
    this.focusAfterRender(() => this.host.nativeElement.querySelector<HTMLElement>('[data-confirm-reset-all]'));
  }

  protected cancelResetAll(): void {
    this.confirmingResetAll.set(false);
    this.focusAfterRender(() => this.host.nativeElement.querySelector<HTMLElement>('[data-reset-all]'));
  }

  protected confirmRename(): void {
    const current = this.selectedName();
    const next = this.renameDraft().trim();
    if (current == null || next === '' || this.busy()) {
      return;
    }
    this.busy.set(true);
    // Riscrive i riferimenti solo se il file è usato e l'opzione (pre-selezionata) è attiva.
    const rewriteReferences = this.selectedUsedBy().length > 0 && this.rewriteRefsOnRename();
    this.api
      .renameDataFile(current, next, rewriteReferences)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (result) => {
          this.renaming.set(false);
          this.setSelectedName(result.name);
          // Con riferimenti riscritti il toast lo segnala e ricorda i data() dinamici non rilevabili.
          const description = result.referencesRewritten > 0
            ? this.transloco.translate('dati.toastRenamedRewritten', { count: result.referencesRewritten })
            : result.fileName;
          this.toast.show({ title: this.t('dati.toastRenamedTitle'), description, tone: 'success' });
          // Col nome nuovo il dettaglio si ridisegna quando arriva l'elenco: il fuoco va alla matita
          // nuova, non a quella di prima.
          this.reload(true, () => this.focusAfterRender(this.renameButton));
        },
        error: (error) => this.showError(error),
      });
  }

  protected confirmDelete(): void {
    const current = this.selectedName();
    if (current == null || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.api.deleteDataFile(current).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        this.confirmingDelete.set(false);
        this.toast.show({ title: this.t('dati.toastDeletedTitle'), description: `${current}.json`, tone: 'success' });
        this.reload(false);
      },
      error: (error) => this.showError(error),
    });
  }

  protected copyReference(): void {
    navigator.clipboard?.writeText(this.referenceSnippet()).then(
      () => this.toast.show({ title: this.t('common.copied'), description: this.referenceSnippet(), tone: 'success' }),
      () => this.toast.show({ title: this.t('common.error'), description: this.t('common.operationFailed'), tone: 'error' }),
    );
  }

  // --- helper ---------------------------------------------------------------------------------

  protected formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} kB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  /**
   * Deriva un identificatore JS valido dal nome del file per lo snippet `const <id> = await data(...)`.
   * I nomi ammettono '-', '.', '_', che non stanno in un identificatore: le parti si uniscono in
   * camelCase; un nome che inizia con una cifra prende il prefisso '_'.
   */
  private toIdentifier(name: string): string {
    const camel = name
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('');
    if (camel === '') {
      return 'dati';
    }
    return /^[0-9]/.test(camel) ? `_${camel}` : camel;
  }

  private t(key: string): string {
    return this.transloco.translate(key);
  }

  private showError(error: unknown, context?: string): void {
    const message = this.errorMessage(error);
    this.toast.show({
      title: context ? `${this.t('common.error')} — ${context}` : this.t('common.error'),
      description: message,
      tone: 'error',
    });
  }

  private errorMessage(error: unknown): string {
    return (error as { error?: { message?: string } })?.error?.message
      ?? this.t('common.unexpectedError');
  }
}
