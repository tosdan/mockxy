import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, Injector, OnInit, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { finalize, merge, type Subscription } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideCheck,
  lucideLayers,
  lucidePlus,
  lucideSearch,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiBadge } from '../../ui/ui-badge/ui-badge';
import { UiButton } from '../../ui/ui-button/ui-button';
import { UiCode } from '../../ui/ui-code/ui-code';
import { UiCollapsible } from '../../ui/ui-collapsible/ui-collapsible';
import { UiMenu } from '../../ui/ui-menu/ui-menu';
import { UiPageHeader } from '../../ui/ui-page-header/ui-page-header';
import { UiSelect, type UiSelectOption } from '../../ui/ui-select/ui-select';
import { UiTable } from '../../ui/ui-table/ui-table';
import { UiTooltip } from '../../ui/ui-tooltip/ui-tooltip';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { summarizeBatchAttention, type DumpCreateMocksResult, type DumpEntry, type DumpReadCursor, type DumpReadFilters, type DumpSelection, type MonitorDumpFile } from '../../mock-admin-api.types';
import { MOCK_METHODS } from '../../mock-admin-ui.constants';
import { listNavigationTarget, toggleListSelection } from '../../shared/list-selection';
import { readBatchPartialResult } from '../../shared/read-error-message';

const PAGE_SIZE = 300;
/** Sotto questo numero di voci, a filtro acceso, si continua a leggere: la lista va riempita. */
const FILL_THRESHOLD = 40;
/** Attesa dopo l'ultima battuta nella ricerca prima di rileggere l'archivio. */
const SEARCH_DEBOUNCE_MS = 250;
/** Altezza di una riga della lista (px), per lo scroll virtuale. */
const ROW_HEIGHT = 56;

/**
 * Pagina "Storico dump": browse READ-ONLY (non live) dei dump su disco con virtual scroll a cursore.
 * Legge solo dai file di dump (mai dall'array live delle 250 del monitor); l'utente seleziona singole
 * entry / un range (shift-click) / tutto un file e la creazione mock la fa il backend (createMocksFromDump).
 */
@Component({
  selector: 'app-storico-dump',
  imports: [
    DatePipe,
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
    UiPageHeader,
    UiSelect,
    UiTable,
    UiTooltip,
  ],
  providers: [provideIcons({ lucideArrowLeft, lucideCheck, lucideLayers, lucidePlus, lucideSearch, lucideTrash2, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="absolute inset-0 flex flex-col overflow-hidden bg-background text-foreground">
      <!-- TESTATA: come il catalogo, nome della vista e conteggio. Il "+" dice che scorrendo se ne
           caricano altre; sotto filtro il conteggio e' dei risultati, e prende il colore. -->
      <ui-page-header [title]="'viewRail.storico' | transloco">
        <ui-badge [tone]="hasFilter() ? 'brand' : 'neutral'" class="whitespace-nowrap" aria-live="polite">{{ entries().length }}{{ done() ? '' : '+' }}</ui-badge>
        <span class="text-[11.5px] text-muted-foreground">{{ 'storico.subtitle' | transloco }}</span>
        <ng-container actions>
          <button ui-button variant="outline" size="sm" [cdkMenuTriggerFor]="filesMenu" [disabled]="creating()"><ng-icon name="lucideLayers" size="0.9rem" /> {{ 'storico.files' | transloco: { count: files().length } }}</button>
          <!-- "Crea mock" e "Annulla" stanno nella barra in fondo alla lista, che compare con una
               selezione, come nel catalogo e nel Monitor. Qui resta il modo di spuntare tutto. -->
          <button ui-button variant="outline" size="sm" [disabled]="entries().length === 0" (click)="selectAllLoaded()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ 'storico.selectLoaded' | transloco }}</button>
        </ng-container>
      </ui-page-header>

      <!-- FILTRI: gli stessi del Monitor. Li applica il server mentre legge l'archivio, cosi' la
           ricerca guarda tutte le voci su disco e non solo le pagine gia' caricate. -->
      <div class="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/30 px-5 py-2">
        <label class="relative">
          <ng-icon name="lucideSearch" size="0.9rem" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input #searchInput type="text" [placeholder]="'monitor.filterPlaceholder' | transloco" [value]="search()" (input)="search.set($any($event.target).value)"
                 class="h-8 w-64 rounded-lg border border-input bg-black/30 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring/50 focus:ring-2 focus:ring-ring/20" />
          @if (search() !== '') {
          <button
            type="button"
            class="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
            [attr.aria-label]="'common.clearFilter' | transloco"
            (click)="search.set(''); searchInput.focus()"
          >
            <ng-icon name="lucideX" size="0.7rem" />
          </button>
          }
        </label>
        <ui-select class="w-40" [options]="methodOptions" [value]="methodFilter()" (valueChange)="methodFilter.set($any($event))" [ariaLabel]="'storico.methodFilterAria' | transloco" />
        @for (n of statusChips; track n) {
        <button type="button" (click)="toggleStatusClass(n)" [attr.aria-pressed]="statusClasses().has(n)"
                class="inline-flex h-8 items-center rounded-lg border px-3 text-[12.5px] font-medium transition"
                [style.color]="statusClasses().has(n) ? statusColorClass(n) : 'var(--muted-foreground)'"
                [style.borderColor]="statusClasses().has(n) ? tint(statusColorClass(n), 40) : 'var(--input)'"
                [style.background]="statusClasses().has(n) ? tint(statusColorClass(n), 10) : 'transparent'">{{ n }}xx</button>
        }
        <label class="inline-flex items-center gap-2">
          <span class="text-[11.5px] text-muted-foreground">{{ 'monitor.servedBy' | transloco }}</span>
          <ui-select class="w-40" [options]="sourceOptions" [value]="sourceFilter()" (valueChange)="sourceFilter.set($any($event))" />
        </label>
      </div>

      <!-- BODY: lista virtualizzata + dettaglio -->
      <div class="relative z-10 flex min-h-0 flex-1">
        <!-- Lista a selezione multipla, come il Monitor: le frecce spostano la voce attiva e la
             mostrano nel dettaglio, Spazio la spunta (Maiuscole+Spazio l'intervallo). Il clic sulla
             riga la apre e basta; spunta solo il clic sulla casella.
             A differenza del Monitor il fuoco resta sulla lista e la voce attiva la dice
             aria-activedescendant: la lista e' virtualizzata, e una riga a fuoco che esce dalla zona
             disegnata viene riciclata, portandosi via il fuoco e i tasti successivi.
             Se la voce attiva esce di vista scorrendo, la lista smette di indicarla (la sua riga puo'
             non esserci piu') e l'anello di fuoco passa alla lista intera; il primo tasto la riporta
             in vista, come il rientro da tastiera. -->
        <div class="flex min-h-0 shrink-0 flex-col border-r border-border" [style.width.px]="listWidth()">
        <cdk-virtual-scroll-viewport #viewport [itemSize]="rowHeight" class="group/list mx-scroll min-h-0 flex-1 focus-visible:outline-none" (scrolledIndexChange)="onScroll()" (focus)="onListFocus()"
                                     [class]="activeOptionId() ? '' : 'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70'"
                                     role="listbox" aria-multiselectable="true" tabindex="0" [attr.aria-label]="'storico.listLabel' | transloco"
                                     [attr.aria-activedescendant]="activeOptionId()" (keydown)="onListKeydown($event)">
          <div
            *cdkVirtualFor="let row of entries(); let i = index; trackBy: trackKey"
            role="option"
            [id]="optionId(i)"
            [attr.data-dump-key]="row.dumpKey"
            [attr.aria-posinset]="i + 1"
            [attr.aria-setsize]="done() ? entries().length : -1"
            [attr.aria-selected]="selectedKeys().has(row.dumpKey)"
            [attr.aria-current]="row.dumpKey === focusedKey() ? 'true' : null"
            (click)="onRowClick(row, $event)"
            class="group flex w-full cursor-pointer select-none items-center gap-2.5 border-b border-border-soft px-4 text-left transition hover:bg-white/[0.03]"
            [class]="row.dumpKey === focusedKey() ? 'mx-selected group-focus-visible/list:ring-2 group-focus-visible/list:ring-inset group-focus-visible/list:ring-ring/70' : ''"
            [style.height.px]="rowHeight"
          >
            <span data-check aria-hidden="true" class="grid size-4 shrink-0 place-items-center rounded border transition"
                  [class]="selectedKeys().has(row.dumpKey) || selectedCount() > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                  [style.borderColor]="selectedKeys().has(row.dumpKey) ? 'var(--brand)' : 'var(--input)'"
                  [style.background]="selectedKeys().has(row.dumpKey) ? 'var(--brand)' : 'transparent'">
              @if (selectedKeys().has(row.dumpKey)) { <ng-icon name="lucideCheck" size="0.7rem" class="text-white" /> }
            </span>
            <span class="w-12 shrink-0 font-mono text-[12px] font-bold" [style.color]="methodColor(row.method)">{{ row.method }}</span>
            <!-- Quando e da chi: in uno storico l'ora e' il dato principale, e la provenienza dice
                 cosa e' gia' un mock. Il path si tronca in testa, come nel catalogo. -->
            <span class="min-w-0 flex-1">
              <span class="block truncate text-left font-mono text-[12.5px]" dir="rtl" [title]="row.originalUrl"><bdi dir="ltr">{{ row.originalUrl }}</bdi></span>
              <span class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span class="size-1.5 rounded-full" [style.background]="sourceColor(row.source)"></span>{{ sourceLabel(row.source) }}
                <span aria-hidden="true">·</span>
                <span class="tabular-nums">{{ row.latencyMs }} ms</span>
              </span>
            </span>
            <span class="flex shrink-0 flex-col items-end gap-1">
              <span class="rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums" [style.color]="statusColor(row.status)" [style.background]="tint(statusColor(row.status), 12)">{{ row.status }}</span>
              <span class="font-mono text-[10.5px] tabular-nums text-muted-foreground">{{ row.timestamp | date: 'dd/MM HH:mm:ss' }}</span>
            </span>
          </div>
          @if (loading()) {
          <div class="px-4 py-3 text-center text-[12px] text-muted-foreground">{{ 'storico.loading' | transloco }}</div>
          }
        </cdk-virtual-scroll-viewport>
        @if (selectedCount() > 0) {
        <div class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] px-3 py-2">
          <span class="whitespace-nowrap text-[11.5px] font-bold text-foreground">{{ 'storico.selectedCount' | transloco: { count: selectedCount() } }}</span>
          <div class="ml-auto flex items-center gap-2">
            <button ui-button size="xs" [disabled]="creating()" (click)="createFromSelected()"><ng-icon name="lucidePlus" size="0.8rem" /> {{ 'storico.createMockShort' | transloco }}</button>
            <button ui-button variant="ghost" size="xs" (click)="clearSelection()" [uiTooltip]="'storico.deselect' | transloco" [attr.aria-label]="'storico.deselect' | transloco"><ng-icon name="lucideX" size="0.8rem" /></button>
          </div>
        </div>
        }
        </div>

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
              <!-- La chiave del dump (file#riga) resta nel tooltip: a chi legge serve quando, non dove. -->
              <span class="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" [title]="sel.dumpKey">
                <span class="size-1.5 rounded-full" [style.background]="sourceColor(sel.source)"></span>{{ sourceLabel(sel.source) }} · {{ sel.latencyMs }} ms · {{ sel.timestamp | date: 'dd/MM/yyyy HH:mm:ss.SSS' }}
              </span>
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
            {{ (hasFilter() ? 'storico.emptyFiltered' : 'storico.emptyDisk') | transloco }}
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
  private readonly injector = inject(Injector);
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
  /** Ultima voce spuntata: l'ancora degli intervalli (shift-click, Maiuscole+Spazio). */
  private selectionAnchor: string | null = null;
  /** Tratto della lista in vista (px): dice se la riga della voce attiva si vede. */
  private readonly scrollWindow = signal({ offset: 0, size: 0 });

  protected readonly rowHeight = ROW_HEIGHT;

  // --- filtri (stessi del Monitor) ---
  protected readonly search = signal('');
  /** La ricerca dopo la pausa di battitura: e' lei, non ogni tasto, a far rileggere l'archivio. */
  private readonly settledSearch = signal('');
  protected readonly methodFilter = signal('all');
  protected readonly sourceFilter = signal('all');
  protected readonly statusClasses = signal<ReadonlySet<number>>(new Set());
  protected readonly statusChips = [2, 3, 4, 5];
  protected readonly methodOptions: readonly UiSelectOption<string>[] = [
    { value: 'all', label: this.transloco.translate('monitor.allMethods') },
    ...MOCK_METHODS.map((m) => ({ value: m, label: m })),
  ];
  protected readonly sourceOptions: readonly UiSelectOption<string>[] = [
    { value: 'all', label: this.transloco.translate('monitor.allSources') },
    { value: 'real-backend', label: this.transloco.translate('monitor.sourceRealBackend') },
    { value: 'mock', label: 'Mock' },
    { value: 'backend', label: 'Proxy' },
    { value: 'handler', label: 'Handler' },
    { value: 'middleware', label: 'Middleware' },
    { value: 'mock-only-miss', label: 'Miss' },
  ];
  private readonly filters = computed<DumpReadFilters>(() => ({
    q: this.settledSearch().trim() || undefined,
    method: this.methodFilter() === 'all' ? undefined : this.methodFilter(),
    source: this.sourceFilter() === 'all' ? undefined : this.sourceFilter(),
    statusClasses: [...this.statusClasses()].sort(),
  }));
  protected readonly hasFilter = computed(() => {
    const f = this.filters();
    return !!(f.q || f.method || f.source || f.statusClasses?.length);
  });
  /** Lettura in corso, da annullare se i filtri cambiano prima che risponda. */
  private pending?: Subscription;
  private searchTimer?: ReturnType<typeof setTimeout>;
  /** Pagina distrutta: nessuna lettura riparte, nemmeno una continuazione gia' accodata. */
  private destroyed = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // Lasciando lo Storico la lettura si ferma: senza, una ricerca rara continuava a scorrere
    // l'archivio, una pagina dopo l'altra, anche dal Catalogo.
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.pending?.unsubscribe();
      clearTimeout(this.searchTimer);
    });
    effect(() => {
      const value = this.search();
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.settledSearch.set(value), value === '' ? 0 : SEARCH_DEBOUNCE_MS);
    });
    // Lo scroll e ogni nuovo disegno della lista (dati, misure) aggiornano il tratto in vista.
    // L'altezza cambia anche senza ridimensionare la finestra (la barra della selezione compare
    // e sparisce), e lo scroll virtuale la rimisura da solo solo in quel caso: qui la si avvisa.
    afterNextRender(() => {
      const viewport = this.viewport();
      const measure = () => this.scrollWindow.set({ offset: viewport.measureScrollOffset(), size: viewport.getViewportSize() });
      merge(viewport.elementScrolled(), viewport.renderedRangeStream).pipe(takeUntilDestroyed(destroyRef)).subscribe(measure);
      if (typeof ResizeObserver === 'undefined') return;
      const resize = new ResizeObserver(() => {
        viewport.checkViewportSize();
        measure();
      });
      resize.observe(viewport.elementRef.nativeElement);
      destroyRef.onDestroy(() => resize.disconnect());
    });
    // Ogni cambio di filtro rilegge l'archivio dall'inizio; la prima esecuzione e' il caricamento.
    effect(() => {
      this.filters();
      untracked(() => this.resetAndReload(false));
    });
  }

  protected toggleStatusClass(klass: number): void {
    const next = new Set(this.statusClasses());
    if (next.has(klass)) next.delete(klass);
    else next.add(klass);
    this.statusClasses.set(next);
  }

  protected readonly selectedCount = computed(() => this.selectedKeys().size);
  protected readonly focused = computed<DumpEntry | null>(
    () => this.entries().find((entry) => entry.dumpKey === this.focusedKey()) ?? null,
  );

  ngOnInit(): void {
    this.loadFiles();
  }

  private loadFiles(): void {
    this.api.listMonitorDumps().subscribe({
      next: (response) => this.files.set(response.files),
      error: () => this.files.set([]),
    });
  }

  protected loadMore(): void {
    if (this.destroyed || this.loading() || this.done()) return;
    this.loading.set(true);
    this.pending = this.api
      .readMonitorDumps(this.cursor(), PAGE_SIZE, this.filters())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (page) => {
          this.entries.update((list) => [...list, ...page.items]);
          this.cursor.set(page.nextCursor);
          this.done.set(page.done);
          if (this.focusedKey() == null && this.entries().length > 0) {
            this.focusedKey.set(this.entries()[0].dumpKey);
          }
          // Un filtro selettivo puo' tornare pagine quasi vuote: si continua finche' la lista non
          // si riempie o l'archivio non finisce, senza aspettare uno scroll che non puo' arrivare.
          if (this.hasFilter() && !page.done && this.entries().length < FILL_THRESHOLD) {
            queueMicrotask(() => this.loadMore());
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

  /**
   * Clic su una riga: sulla casella la spunta (con shift l'intervallo dall'ultima spuntata),
   * altrove la apre nel dettaglio. Prima ogni clic faceva entrambe le cose.
   */
  protected onRowClick(entry: DumpEntry, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('[data-check]')) {
      this.toggleSelection(entry.dumpKey, event.shiftKey);
    } else {
      this.focusedKey.set(entry.dumpKey);
    }
  }

  /** Spunta o toglie una voce; con `range` l'intervallo dall'ultima spuntata, fra le voci caricate. */
  protected toggleSelection(key: string, range = false): void {
    const ordered = this.entries().map((entry) => entry.dumpKey);
    const change = toggleListSelection(this.selectedKeys(), ordered, key, this.selectionAnchor, range);
    this.selectionAnchor = change.anchor;
    this.selectedKeys.set(change.selected);
  }

  /** Id dell'elemento della voce in posizione `index`, per aria-activedescendant. */
  protected optionId(index: number): string {
    return `storico-entry-${index}`;
  }

  /**
   * La voce attiva della lista, finche' la sua riga e' in vista. Scorrendo lontano lo scroll
   * virtuale toglie la riga dal DOM, e aria-activedescendant indicherebbe un elemento che non c'e'.
   */
  protected readonly activeOptionId = computed(() => {
    const index = this.entries().findIndex((entry) => entry.dumpKey === this.focusedKey());
    if (index < 0) return null;
    const { offset, size } = this.scrollWindow();
    const top = index * ROW_HEIGHT;
    return top < offset + size && top + ROW_HEIGHT > offset ? this.optionId(index) : null;
  });

  /** Rientrando nella lista da tastiera la voce attiva torna in vista; col mouse no, il clic va dove punta. */
  protected onListFocus(): void {
    const current = this.focusedKey();
    if (current != null && this.viewport().elementRef.nativeElement.matches(':focus-visible')) {
      this.scrollIntoView(current);
    }
  }

  /** Tastiera sulla lista: frecce, Home ed End aprono la voce di arrivo; Spazio spunta quella attiva. */
  protected onListKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const current = this.focusedKey();
    if (event.key === ' ') {
      event.preventDefault();
      if (current != null) {
        this.toggleSelection(current, event.shiftKey);
        // La voce si mostra spuntata, anche se era fuori vista. A disegno fatto: la prima spunta fa
        // comparire la barra delle azioni, che accorcia la lista e coprirebbe l'ultima riga.
        afterNextRender(() => this.scrollIntoView(current), { injector: this.injector });
      }
      return;
    }
    const ordered = this.entries().map((entry) => entry.dumpKey);
    const target = listNavigationTarget(event.key, ordered, current);
    if (target == null) return;
    event.preventDefault();
    this.focusedKey.set(target);
    this.scrollIntoView(target);
    // In fondo a quanto caricato si legge la pagina dopo, come scorrendo.
    if (ordered.indexOf(target) >= ordered.length - 10) this.loadMore();
  }

  /** Scorre la lista quanto basta perche' la riga di una voce sia in vista. */
  private scrollIntoView(key: string): void {
    const index = this.entries().findIndex((entry) => entry.dumpKey === key);
    if (index < 0) return;
    const viewport = this.viewport();
    const top = index * ROW_HEIGHT;
    const offset = viewport.measureScrollOffset();
    // L'altezza del momento, non quella memorizzata dallo scroll virtuale: la barra la cambia.
    const size = viewport.elementRef.nativeElement.clientHeight;
    if (top < offset) viewport.scrollToOffset(top);
    else if (top + ROW_HEIGHT > offset + size) viewport.scrollToOffset(top + ROW_HEIGHT - size);
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
    // Opzioni sempre esplicite (§13 C7): gli endpoint esistenti restano come sono, i nuovi sono serviti.
    this.api
      .createMocksFromDump({ ...selection, onConflict: 'skip', selectAddedVariants: false, newEndpointEnabled: true })
      .pipe(finalize(() => this.creating.set(false)))
      .subscribe({
        next: (result) => {
          // Anche con 201 un mock creato può non essere servito: lo dicono gli esiti per elemento.
          const attention = summarizeBatchAttention(result.items);
          const tone = attention.notServed + attention.withWarnings > 0 ? 'warning' : result.created + result.createdEmpty > 0 ? 'success' : 'error';
          this.toast.show({ title: this.transloco.translate('storico.toastMocksCreated'), description: this.summarizeResult(result), tone });
          this.clearSelection();
        },
        error: (error: unknown) => {
          // Un batch fallito può aver già creato dei mock: il fallimento resta evidente, ma il
          // riepilogo dice cosa c'è su disco.
          const partial = readBatchPartialResult<DumpCreateMocksResult>(error);
          const description = partial
            ? `${this.readError(error)} ${this.transloco.translate('storico.partialResult', { summary: this.summarizeResult(partial) })}`
            : this.readError(error);
          this.toast.show({ title: this.transloco.translate('common.error'), description, tone: 'error' });
        },
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

  private resetAndReload(reloadFiles = true): void {
    this.pending?.unsubscribe();
    this.loading.set(false);
    this.entries.set([]);
    this.cursor.set(null);
    this.done.set(false);
    this.selectedKeys.set(new Set());
    this.focusedKey.set(null);
    this.selectionAnchor = null;
    if (reloadFiles) this.loadFiles();
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
    return this.statusColorClass(Math.floor(status / 100));
  }

  protected statusColorClass(klass: number): string {
    return klass >= 2 && klass <= 5 ? `var(--status-${klass}xx)` : 'var(--muted-foreground)';
  }

  /** Colore della provenienza, lo stesso del Monitor. */
  protected sourceColor(source: string): string {
    switch (source) {
      case 'mock': return 'var(--type-mock)';
      case 'handler': return 'var(--type-handler)';
      case 'middleware': return 'var(--type-middleware)';
      case 'sse': return 'var(--brand)';
      case 'backend': return 'var(--brand-soft)';
      case 'mock-only':
      case 'mock-only-miss': return 'var(--foreground-faint)';
      default: return 'var(--muted-foreground)';
    }
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
    if (result.addedVariants > 0) parts.push(this.transloco.translate('storico.resultAddedVariants', { count: result.addedVariants }));
    const unavailable = (result.items ?? []).filter((item) => item.captureOutcome === 'unavailable').length;
    if (unavailable > 0) parts.push(this.transloco.translate('storico.resultUnavailable', { count: unavailable }));
    if (result.failed > 0) parts.push(this.transloco.translate('storico.resultFailed', { count: result.failed }));
    const { notServed, withWarnings } = summarizeBatchAttention(result.items);
    if (notServed > 0) parts.push(this.transloco.translate('storico.resultNotServed', { count: notServed }));
    if (withWarnings > 0) parts.push(this.transloco.translate('storico.resultWarnings', { count: withWarnings }));
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
