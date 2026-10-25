import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, TemplateRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { finalize, type Observable } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideArrowLeft,
  lucideCheck,
  lucideCopy,
  lucideDatabase,
  lucideDownload,
  lucideEllipsisVertical,
  lucideListChecks,
  lucideListTree,
  lucidePlus,
  lucideRows3,
  lucideSearch,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiBadge } from '../../ui/ui-badge/ui-badge';
import { UiButton } from '../../ui/ui-button/ui-button';
import { UiCheckbox } from '../../ui/ui-checkbox/ui-checkbox';
import { UiMenu, UiMenuItemCheckbox } from '../../ui/ui-menu/ui-menu';
import { UiPageHeader } from '../../ui/ui-page-header/ui-page-header';
import { UiSelect, type UiSelectOption } from '../../ui/ui-select/ui-select';
import { UiTooltip } from '../../ui/ui-tooltip/ui-tooltip';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import { UiDialog } from '../../ui/ui-dialog/ui-dialog';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { MonitorStreamStore } from '../../shared/monitor-stream.store';
import { ViewStateService } from '../../shared/view-state.service';
import { RESPONSE_SOURCE_ICONS, SEQUENCE_ICON, isUnmockedSource, responseSourceMeta } from '../../shared/response-source';
import { summarizeBatchAttention, type CaptureBatchOptions, type CaptureItemOutcome, type MockSummary, type MonitorCreateMocksResult, type RequestMonitorEntry } from '../../mock-admin-api.types';
import { readBatchPartialResult } from '../../shared/read-error-message';
import { MOCK_METHODS } from '../../mock-admin-ui.constants';
import { listNavigationTarget, toggleListSelection } from '../../shared/list-selection';
import { isSelectionEscape } from '../../shared/selection-escape';
import { ResizableListWidth } from '../../shared/resizable-list-width';
import { TrafficDetail } from '../../shared/traffic-detail';
import { methodColor, statusClassColor, statusColor, tint } from '../../shared/traffic-format';

/** Chiave (ViewStateService) della densita' del Monitor: 'compact', o assente per quella normale. */
const DENSITY_STATE_KEY = 'monitor-density';

/**
 * Monitor live delle request intercettate, ridisegnato sui token del design system (gemello visivo di
 * mocks-next). Stream/lista/clear/pausa, filtri, ricerca, statistiche, copia-cURL ed export sono cablati
 * ai dati reali, così come la cattura della response e la creazione di mock dal traffico catturato
 * ("Crea mock da questa" e creazione massiva dalle entry selezionate). Quando il body della response è
 * binario/compresso/troncato il mock viene creato come skeleton (body vuoto + descrizione "[da completare]…",
 * gemello del batch dello storico): status e header sono comunque preservati.
 */
@Component({
  selector: 'app-monitor-next',
  imports: [TrafficDetail, CdkMenuTrigger, DatePipe, NgIcon, TranslocoPipe, UiBadge, UiButton, UiCheckbox, UiMenu, UiMenuItemCheckbox, UiPageHeader, UiSelect, UiTooltip],
  providers: [
    provideIcons({
      lucideActivity, lucideArrowLeft, lucideCheck, lucideCopy, lucideDatabase, lucideDownload, lucideEllipsisVertical, lucideListChecks, lucideListTree,
      lucidePlus, lucideRows3, lucideSearch, lucideTrash2, lucideX, ...RESPONSE_SOURCE_ICONS,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
  template: `
    <div class="absolute inset-0 flex flex-col overflow-hidden bg-background text-foreground mx-scroll">
      <!-- TESTATA: come il catalogo, nome della vista e conteggio. "Live" non si ripete: lo dicono
           la barra in alto e il punto sulla voce Monitor. Resta solo la pausa, che spiega perche'
           la lista non si muove. -->
      <ui-page-header [title]="'viewRail.monitor' | transloco">
        <ui-badge [tone]="hasFilter() ? 'brand' : 'neutral'" class="whitespace-nowrap" aria-live="polite">{{ hasFilter() ? ('common.shownOfTotal' | transloco: { shown: filtered().length, total: total() }) : total() }}</ui-badge>
        @if (!streaming()) {
        <span class="inline-flex items-center gap-1.5 text-[11.5px] font-semibold" [style.color]="'var(--status-4xx)'">
          <span class="size-1.5 rounded-full" [style.background]="'var(--status-4xx)'"></span> {{ 'monitor.paused' | transloco }}
        </span>
        }
        <!-- Niente piu' modalita' "Seleziona": come nel catalogo la casella di ogni riga c'e' sempre,
             e le azioni sulle voci spuntate stanno nella barra in fondo alla lista. -->
        <ng-container actions>
          <button ui-button variant="outline" size="sm" [disabled]="clearing()" (click)="clearLog()"><ng-icon name="lucideTrash2" size="0.9rem" /> {{ 'monitor.clear' | transloco }}</button>
          <button ui-button variant="outline" size="sm" [disabled]="filtered().length === 0" (click)="exportJson()"><ng-icon name="lucideDownload" size="0.9rem" /> {{ 'monitor.export' | transloco }}</button>
          <!-- Modalita' selezione, come nel catalogo: un clic sulla riga la spunta. Ctrl+clic e
               Maiusc+clic (l'intervallo) spuntano anche fuori modalita'. -->
          <button
            ui-button
            variant="outline"
            size="icon"
            [class]="selectionMode() ? 'size-8 !border-selection/60 !bg-selection/15 !text-selection-foreground' : 'size-8'"
            [attr.aria-pressed]="selectionMode()"
            [uiTooltip]="'common.selectionModeTipRange' | transloco"
            [attr.aria-label]="'common.selectionModeLabel' | transloco"
            (click)="toggleSelectionMode()"
          >
            <ng-icon name="lucideListChecks" size="0.95rem" />
          </button>
          <!-- Opzioni di vista, come nel catalogo: per ora la densita'. -->
          <button ui-button variant="outline" size="icon" class="size-8" [uiTooltip]="'monitor.viewActionsTip' | transloco" [attr.aria-label]="'monitor.viewActionsTip' | transloco" [cdkMenuTriggerFor]="viewMenu">
            <ng-icon name="lucideEllipsisVertical" size="0.95rem" />
          </button>
        </ng-container>
      </ui-page-header>

      <!-- STATS STRIP. Gli errori non hanno piu' un conteggio a parte: 4xx e 5xx si contano sui
           chip dei filtri, che dividono le due cose e con un clic le isolano. -->
      <div class="relative z-20 flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border bg-card/60 px-5 py-2">
        <!-- Le non mockate, segnate in lista dalla barra ambra a sinistra: lo stesso segno qui ne
             spiega il senso, e il clic mostra solo loro (il filtro "Servita da: backend reale"). -->
        <button type="button" (click)="toggleUnmockedFilter()" [attr.aria-pressed]="sourceFilter() === 'real-backend'" [uiTooltip]="'monitor.unmockedTip' | transloco"
                class="flex items-center gap-2 rounded-lg px-3 py-1 ring-1 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                [class]="sourceFilter() === 'real-backend' ? 'bg-[color-mix(in_srgb,var(--status-4xx)_10%,transparent)] ring-[color-mix(in_srgb,var(--status-4xx)_40%,transparent)]' : 'bg-muted/60 ring-border'">
          <span aria-hidden="true" class="h-4 w-0.5 rounded-full" [style.background]="tint('var(--status-4xx)', 45)"></span>
          <span class="flex items-baseline gap-1.5"><span class="text-[15px] font-bold tabular-nums">{{ unmockedCount() }}</span>&ngsp;<span class="text-[11.5px] text-muted-foreground">{{ 'monitor.unmocked' | transloco }}</span></span>
        </button>
        <div class="flex items-baseline gap-1.5 rounded-lg bg-muted/60 px-3 py-1 ring-1 ring-border">
          <span class="text-[15px] font-bold tabular-nums">{{ avgLatency() }}</span>&ngsp;<span class="text-[11.5px] text-muted-foreground">{{ 'monitor.avgMs' | transloco }}</span>
        </div>
        <span class="ml-1 inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
          @for (s of sourceBreakdown(); track s.source) {
          <span class="inline-flex items-center gap-1.5"><ng-icon [name]="s.icon" size="0.75rem" [style.color]="s.color" />{{ s.label }} {{ s.count }}</span>
          } @empty {
          <span class="text-foreground/40">{{ 'monitor.noTraffic' | transloco }}</span>
          }
        </span>
      </div>

      <!-- FILTRI -->
      <div class="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card/30 px-5 py-2">
        <label class="relative">
          <ng-icon name="lucideSearch" size="0.9rem" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <!-- pr-8 anche a campo vuoto: il testo non deve spostarsi quando il pulsante compare. -->
          <input #searchInput type="text" [placeholder]="'monitor.filterPlaceholder' | transloco" [value]="search()" (input)="search.set($any($event.target).value)"
                 class="h-8 w-64 rounded-lg border border-input bg-black/30 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring/70 focus:ring-2 focus:ring-ring/20" />
          @if (search() !== '') {
          <button
            type="button"
            class="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
            [attr.aria-label]="'common.clearFilter' | transloco"
            (click)="clearSearch(searchInput)"
          >
            <ng-icon name="lucideX" size="0.7rem" />
          </button>
          }
        </label>
        <ui-select class="w-40" [options]="methodOptions" [value]="methodFilter()" (valueChange)="methodFilter.set($any($event))" [ariaLabel]="'monitor.methodFilterAria' | transloco" />
        <!-- Ogni chip conta le sue voci fra quelle che passano gli altri filtri: 4xx e 5xx sono il
             conteggio degli errori, diviso fra chi ha sbagliato la richiesta e chi ha fallito. -->
        @for (n of statusChips; track n) {
        <button type="button" (click)="toggleStatusClass(n)" [attr.aria-pressed]="statusClasses().has(n)"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition"
                [style.color]="statusClasses().has(n) ? statusColorClass(n) : 'var(--muted-foreground)'"
                [style.borderColor]="statusClasses().has(n) ? tint(statusColorClass(n), 40) : 'var(--input)'"
                [style.background]="statusClasses().has(n) ? tint(statusColorClass(n), 10) : 'transparent'">
          {{ n }}xx
          <span class="font-mono text-[11.5px] font-bold tabular-nums" [style.color]="n >= 4 && statusCounts()[n] > 0 ? statusColorClass(n) : null">{{ statusCounts()[n] }}</span>
        </button>
        }
        <label class="inline-flex items-center gap-2">
          <span class="text-[11.5px] text-muted-foreground">{{ 'monitor.servedBy' | transloco }}</span>
          <ui-select class="w-40" [options]="sourceOptions" [value]="sourceFilter()" (valueChange)="sourceFilter.set($any($event))" />
        </label>
      </div>

      <!-- BODY: lista + dettaglio -->
      <div class="relative z-10 flex min-h-0 flex-1">
        <!-- LISTA -->
        <div class="flex min-h-0 shrink-0 flex-col border-r border-border" [style.width.px]="list.width()">
          <div class="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <span>{{ 'monitor.colRequest' | transloco }}</span><span>{{ 'monitor.colLatTime' | transloco }}</span>
          </div>
          @if (selectionMode()) {
          <div role="status" class="mx-2 mt-2 flex shrink-0 items-center gap-2 rounded-lg bg-selection/15 py-1.5 pl-2.5 pr-1.5 text-[12px]">
            <span class="min-w-0 flex-1">
              <span class="font-semibold text-selection-foreground">{{ 'common.selectionModeTitle' | transloco }}</span>
              <span class="text-muted-foreground"> · {{ 'common.selectionModeHint' | transloco }}</span>
            </span>
            <button ui-button variant="outline" size="xs" class="!border-selection/60 !text-selection-foreground" (click)="selectionMode.set(false)">{{ 'common.selectionModeDone' | transloco }}</button>
          </div>
          }
          <!-- Lista a selezione multipla, come il catalogo: un solo punto di Tab, le frecce spostano
               il fuoco e mostrano la voce nel dettaglio, Spazio la spunta (Maiuscole+Spazio spunta
               l'intervallo). Niente caselle: col mouse si spunta in modalita' selezione, con
               Ctrl+clic o con Maiusc+clic; la riga spuntata ha la tinta e il bordo sinistro indaco. -->
          <!-- Densita' compatta: una riga sola per voce; le righe la leggono con in-[.mx-compact]. -->
          <div class="min-h-0 flex-1 overflow-auto mx-scroll" [class.mx-compact]="compact()" role="listbox" aria-multiselectable="true" [attr.aria-label]="'monitor.listLabel' | transloco" (keydown)="onListKeydown($event)">
            @for (row of filtered(); track row.id) {
            <div
              role="option"
              [attr.data-entry-id]="row.id"
              [attr.aria-selected]="selectedIds().has(row.id)"
              [attr.aria-current]="row.id === selected()?.id ? 'true' : null"
              [attr.tabindex]="row.id === selected()?.id ? 0 : -1"
              (click)="onRowClick(row.id, $event)"
              class="group relative grid w-full cursor-pointer select-none grid-cols-[1fr_auto] items-center gap-2 border-b border-border-soft px-4 py-2.5 text-left transition hover:bg-white/[0.03] in-[.mx-compact]:py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
              [class.mx-open]="row.id === selected()?.id"
              [class.mx-checked]="selectedIds().has(row.id)"
              [style.boxShadow]="unmockedEdge(row)"
            >
              <span class="flex min-w-0 items-center gap-2.5">
                <span class="w-12 shrink-0 font-mono text-[12px] font-bold" [style.color]="methodColor(row.method)">{{ row.method }}</span>
                <!-- In densita' compatta la provenienza resta come icona davanti al path; per un passo di
                     sequenza l'icona SEQ, che dice di piu' di "mock". Il nome lo legge lo screen reader. -->
                <span class="hidden shrink-0 in-[.mx-compact]:inline-flex" [title]="compactSourceText(row)">
                  <ng-icon [name]="row.sequenceStep ? sequenceIcon : sourceIcon(row.source)" size="0.8rem" [style.color]="row.sequenceStep ? 'var(--brand)' : sourceColor(row.source)" />
                  <span class="sr-only">{{ compactSourceText(row) }}</span>
                </span>
                <span class="min-w-0 flex-1">
                  <!-- Il path si tronca in testa, come nel catalogo: la coda e' cio' che distingue. -->
                  <span class="block truncate text-left font-mono text-[13px] text-foreground in-[.mx-compact]:text-[12.5px]" dir="rtl" [title]="row.originalUrl"><bdi dir="ltr">{{ row.originalUrl }}</bdi></span>
                  <span class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground in-[.mx-compact]:hidden">
                    <ng-icon [name]="sourceIcon(row.source)" size="0.75rem" [style.color]="sourceColor(row.source)" />{{ sourceLabel(row.source) }}
                    @if (row.sequenceStep; as seq) {
                    <span class="mx-seq-badge inline-flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] px-1 text-[10px] font-bold tracking-wide text-brand-soft" [uiTooltip]="'trafficDetail.sequenceStepTip' | transloco"><ng-icon [name]="sequenceIcon" size="0.65rem" />SEQ {{ seq.index + 1 }}/{{ seq.count }}</span>
                    }
                  </span>
                </span>
                <span class="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-bold tabular-nums" [style.color]="statusColor(row.status)" [style.background]="tint(statusColor(row.status), 12)">{{ row.status }}</span>
              </span>
              <span class="text-right in-[.mx-compact]:flex in-[.mx-compact]:items-baseline in-[.mx-compact]:gap-2">
                <!-- In riga la latenza ha larghezza fissa, e non va a capo: "1503 ms" non deve spostare gli
                     status, e dai 10 secondi in su si scrive in secondi per starci. -->
                <span class="block whitespace-nowrap font-mono text-[12px] tabular-nums text-foreground/80 in-[.mx-compact]:w-[7ch] in-[.mx-compact]:text-[11.5px]">{{ formatLatency(row.latencyMs) }}</span>
                <span class="block font-mono text-[10.5px] tabular-nums text-muted-foreground">{{ row.timestamp | date: 'HH:mm:ss' }}</span>
              </span>
            </div>
            } @empty {
            <div class="px-5 py-10 text-center text-sm text-muted-foreground">
              @if (loading()) {
              {{ 'monitor.connecting' | transloco }}
              } @else {
              {{ (total() === 0 ? 'monitor.emptyNoRequests' : 'monitor.emptyFiltered') | transloco }}
              }
            </div>
            }
          </div>
          <!-- Azioni sulle voci spuntate: compaiono solo con una selezione, in fondo alla lista. -->
          @if (selectedCount() > 0) {
          <div class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border bg-selection/10 px-3 py-2">
            @if (!selectionMode()) {
            <span class="basis-full text-[11px] leading-4 text-muted-foreground">{{ 'common.selectionShortcutsRangeHint' | transloco }}</span>
            }
            <span class="whitespace-nowrap text-[11.5px] font-bold text-foreground">{{ 'monitor.selectedCount' | transloco: { count: selectedCount() } }}</span>
            <div class="ml-auto flex items-center gap-2">
              <label class="flex items-center gap-2 text-[12px] text-muted-foreground" [uiTooltip]="'monitor.activateNewTip' | transloco">
                <ui-checkbox [(checked)]="activateNewMocks" [ariaLabel]="'monitor.activateNew' | transloco" />
                {{ 'monitor.activateNew' | transloco }}
              </label>
              <button ui-button size="xs" [disabled]="creatingMock()" (click)="createMocksFromSelected()"><ng-icon name="lucidePlus" size="0.8rem" /> {{ 'monitor.createMock' | transloco }}</button>
              <button ui-button variant="ghost" size="xs" (click)="clearSelection()" [uiTooltip]="'monitor.clearSelection' | transloco" [attr.aria-label]="'monitor.clearSelection' | transloco"><ng-icon name="lucideX" size="0.8rem" /></button>
            </div>
          </div>
          }
        </div>

        <!-- divisore trascinabile: ridimensiona la lista (largh. persistita) -->
        <div
          class="relative z-20 -ml-px w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-brand/30"
          (pointerdown)="list.startResize($event)"
          (dblclick)="list.reset()"
          role="separator"
          aria-orientation="vertical"
          [title]="'common.resizeHint' | transloco"
        ></div>

        <!-- DETTAGLIO -->
        <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div class="mx-glow"></div>
          @if (selected(); as sel) {
          <!-- Testata e sezioni sono condivise con lo Storico (app-traffic-detail); qui le azioni della pagina. -->
          <app-traffic-detail class="relative z-10" [entry]="sel">
            <ng-container actions>
              @if (sel.sharedStateError?.name; as sharedStateName) {
              <button ui-button variant="outline" size="sm" (click)="goToSharedState(sharedStateName)" [uiTooltip]="'monitor.openSharedStateTip' | transloco"><ng-icon name="lucideDatabase" size="0.85rem" /> {{ 'monitor.openSharedState' | transloco }}</button>
              }
              @if (sel.source === 'mock' || sel.source === 'handler') {
              <button ui-button variant="outline" size="sm" (click)="goToDefinition(sel)" [uiTooltip]="'monitor.goToDefinitionTip' | transloco"><ng-icon name="lucideListTree" size="0.85rem" /> {{ 'monitor.goToMock' | transloco }}</button>
              } @else if (coveringMock(); as covering) {
              <button ui-button variant="outline" size="sm" (click)="goToCoveringMock(covering)" [uiTooltip]="(covering.disabled ? 'monitor.coveringMockDisabledTip' : 'monitor.coveringMockTip') | transloco">
                <ng-icon name="lucideListTree" size="0.85rem" /> {{ 'monitor.goToMock' | transloco }}
                @if (covering.disabled) { <ui-badge tone="neutral">{{ 'monitor.coveringMockDisabledBadge' | transloco }}</ui-badge> }
              </button>
              }
              <!-- Senza spunta il nuovo endpoint nasce disattivato: la risposta servita non cambia. -->
              <label class="flex items-center gap-2 text-[12px] text-muted-foreground" [uiTooltip]="'monitor.activateNewTip' | transloco">
                <ui-checkbox [(checked)]="activateNewMocks" [ariaLabel]="'monitor.activateNew' | transloco" />
                {{ 'monitor.activateNew' | transloco }}
              </label>
              <button ui-button size="sm" [disabled]="creatingMock()" (click)="createMockFromEntry(sel)"><ng-icon name="lucidePlus" size="0.85rem" /> {{ 'monitor.createMockFromThis' | transloco }}</button>
              <button ui-button variant="outline" size="sm" (click)="copyCurl(sel)"><ng-icon name="lucideCopy" size="0.85rem" /> cURL</button>
            </ng-container>
          </app-traffic-detail>
          } @else {
          <div class="grid h-full place-items-center px-6 text-center">
            <div class="max-w-sm">
              <div class="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border"><ng-icon name="lucideActivity" size="1.4rem" /></div>
              <h2 class="mt-4 text-lg font-semibold text-foreground">{{ 'monitor.waitingTitle' | transloco }}</h2>
              <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">{{ 'monitor.waitingDesc' | transloco }}</p>
            </div>
          </div>
          }
        </div>
      </div>
    </div>

    <!-- Dialog: l'endpoint esiste già → proponi la response catturata come nuova variante -->
    <ng-template #mockExistsDialog>
      @if (mockExistsPrompt(); as prompt) {
      <div class="flex w-[min(92vw,480px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
        <div class="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <h2 id="mx-mock-exists-dialog-title" class="text-[15px] font-bold tracking-tight">{{ 'monitor.mockExistsTitle' | transloco }}</h2>
          <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="cancelAddResponseToExisting()" [attr.aria-label]="'common.close' | transloco"><ng-icon name="lucideX" size="0.95rem" /></button>
        </div>
        <div class="px-5 py-4 text-[13.5px] leading-relaxed text-muted-foreground">
          <p>
            {{ 'monitor.mockExistsDesc' | transloco }}
            <span class="font-mono text-foreground">{{ prompt.method }} {{ prompt.path }}</span>
          </p>
          <p class="mt-2">{{ 'monitor.mockExistsQuestion' | transloco }}</p>
        </div>
        <div class="flex justify-end gap-2 border-t border-border px-5 py-3.5">
          <button ui-button variant="outline" size="sm" (click)="cancelAddResponseToExisting()">{{ 'monitor.mockExistsCancel' | transloco }}</button>
          <button ui-button variant="outline" size="sm" (click)="confirmAddResponseToExisting(false)">{{ 'monitor.mockExistsConfirmInactive' | transloco }}</button>
          <button ui-button size="sm" (click)="confirmAddResponseToExisting()"><ng-icon name="lucidePlus" size="0.85rem" /> {{ 'monitor.mockExistsConfirm' | transloco }}</button>
        </div>
      </div>
      }
    </ng-template>

    <!-- opzioni di vista, come quelle del catalogo -->
    <ng-template #viewMenu>
      <div ui-menu class="min-w-[14rem]">
        <button ui-menu-item-checkbox [checked]="compact()" (triggered)="toggleCompact()">
          <ng-icon name="lucideRows3" size="0.9rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'monitor.compactDensity' | transloco }}</span>
          @if (compact()) {
          <ng-icon name="lucideCheck" size="0.85rem" class="text-brand" />
          }
        </button>
      </div>
    </ng-template>
  `,
})
export class MonitorNextPage {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly stream = inject(MonitorStreamStore);
  private readonly transloco = inject(TranslocoService);
  private readonly dialog = inject(UiDialog);
  private readonly viewState = inject(ViewStateService);

  /** Densita' compatta della lista, ricordata come quella del catalogo. */
  protected readonly compact = signal(this.viewState.read<string>(DENSITY_STATE_KEY) === 'compact');

  protected toggleCompact(): void {
    const next = !this.compact();
    this.compact.set(next);
    this.viewState.write(DENSITY_STATE_KEY, next ? 'compact' : null);
  }

  /**
   * Conflitto di creazione in sospeso: il server ha saltato la cattura perché l'endpoint esiste già
   * (id, metodo e rotta arrivano nell'esito) e il dialog chiede se aggiungere la response
   * catturata come nuova variante di quell'endpoint.
   */
  protected readonly mockExistsPrompt = signal<{
    readonly existingMockId: string;
    readonly method: string;
    readonly path: string;
    readonly entry: RequestMonitorEntry;
    /** Il runtime della cattura, confermato dal server: dopo un riavvio lo stesso ID è un'altra richiesta. */
    readonly runtimeId: string;
  } | null>(null);
  private readonly mockExistsDialogTpl = viewChild.required<TemplateRef<unknown>>('mockExistsDialog');
  private mockExistsDialogRef: { close: (result?: unknown) => void } | null = null;

  /** Storico/stato della cattura live: vivono nello store root-scoped, pilotati dalla barra globale. */
  protected readonly entries = this.stream.entries;
  protected readonly streaming = this.stream.streaming;
  protected readonly loading = this.stream.loading;
  protected readonly clearing = this.stream.clearing;

  protected readonly selectedId = signal<string | undefined>(undefined);
  protected readonly creatingMock = signal(false);
  /**
   * Creazione di endpoint nuovi dal traffico: attivi subito (default) o solo preparati, disattivati.
   * Lo si dichiara sempre al server: una cattura non attiva mai niente in modo implicito.
   */
  protected readonly activateNewMocks = signal(true);
  /** Larghezza della lista, ridimensionabile col divisore e ricordata (min = altre view). */
  protected readonly list = new ResizableListWidth('mx-monitor-list-width');

  protected readonly search = signal('');

  /**
   * Svuota il filtro e rimette il fuoco nel campo: chi lo azzera di solito sta per riscriverci,
   * e perdere il fuoco costringerebbe a un click in piu'.
   */
  protected clearSearch(input: HTMLInputElement): void {
    this.search.set('');
    input.focus();
  }
  protected readonly methodFilter = signal('all');
  protected readonly sourceFilter = signal('all');
  protected readonly statusClasses = signal<ReadonlySet<number>>(new Set());
  /** Ultima voce spuntata: l'ancora degli intervalli (shift-click, Maiuscole+Spazio). */
  private selectionAnchor: string | null = null;
  /**
   * Le voci spuntate e il runtime a cui appartengono: dopo un riavvio gli stessi ID sono altre
   * richieste, quindi una selezione di un altro runtime non vale più e non si mostra.
   */
  private readonly selection = signal<{ readonly runtimeId: string | null; readonly ids: ReadonlySet<string> }>({ runtimeId: null, ids: new Set() });
  protected readonly selectedIds = computed<ReadonlySet<string>>(() => {
    const { runtimeId, ids } = this.selection();
    return runtimeId === this.stream.runtimeId() ? ids : new Set();
  });
  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly methodOptions: readonly UiSelectOption<string>[] = [
    { value: 'all', label: this.transloco.translate('monitor.allMethods') },
    ...MOCK_METHODS.map((m) => ({ value: m, label: m })),
  ];
  protected readonly sourceOptions: readonly UiSelectOption<string>[] = [
    { value: 'all', label: this.transloco.translate('monitor.allSources') },
    // Voce combinata: tutto ciò che NON è uscito dai mock/handler dell'utente (proxy,
    // middleware, miss). Ha sostituito il vecchio pulsante-filtro "Non mockate".
    { value: 'real-backend', label: this.transloco.translate('monitor.sourceRealBackend') },
    { value: 'mock', label: 'Mock' },
    { value: 'backend', label: 'Proxy' },
    { value: 'handler', label: 'Handler' },
    { value: 'middleware', label: 'Middleware' },
    { value: 'mock-only-miss', label: 'Miss' },
  ];
  protected readonly statusChips = [2, 3, 4, 5];

  protected readonly hasFilter = computed(
    () => this.search().trim() !== '' || this.methodFilter() !== 'all' || this.sourceFilter() !== 'all' || this.statusClasses().size > 0,
  );

  /** Lista filtrata per ricerca + metodo + classe di status + provenienza della risposta. */
  protected readonly filtered = computed(() => {
    const classes = this.statusClasses();
    return this.entries().filter((entry) => this.matchesOtherFilters(entry) && (classes.size === 0 || classes.has(Math.floor(entry.status / 100))));
  });

  /**
   * Voci per classe di status (2 = 2xx...) fra quelle che passano gli altri filtri: il numero sul
   * chip dice quante ne mostrerebbe accenderlo.
   */
  protected readonly statusCounts = computed(() => {
    const counts: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const entry of this.entries()) {
      if (!this.matchesOtherFilters(entry)) continue;
      const klass = Math.floor(entry.status / 100);
      if (klass in counts) counts[klass] += 1;
    }
    return counts;
  });

  /** Le voci servite dal backend reale, segnate in lista dalla barra ambra. */
  protected readonly unmockedCount = computed(() => this.entries().filter((entry) => this.isUnmocked(entry.source)).length);

  /** Il chip delle non mockate accende e spegne il filtro "Servita da: backend reale". */
  protected toggleUnmockedFilter(): void {
    this.sourceFilter.set(this.sourceFilter() === 'real-backend' ? 'all' : 'real-backend');
  }

  /** Ricerca, metodo e provenienza: tutti i filtri tranne la classe di status. */
  private matchesOtherFilters(entry: RequestMonitorEntry): boolean {
    const query = this.search().trim().toLowerCase();
    if (query !== '' && !`${entry.originalUrl} ${entry.method}`.toLowerCase().includes(query)) return false;
    const method = this.methodFilter();
    if (method !== 'all' && entry.method !== method) return false;
    const source = this.sourceFilter();
    if (source === 'real-backend') return this.isUnmocked(entry.source);
    return source === 'all' || entry.source === source;
  }

  /** Entry selezionata (o la prima della lista filtrata; undefined se la lista è vuota). */
  protected readonly selected = computed<RequestMonitorEntry | undefined>(() => {
    const list = this.filtered();
    return list.find((entry) => entry.id === this.selectedId()) ?? list[0];
  });

  /**
   * Mock del catalogo che OGGI coprirebbe la entry selezionata. È un fatto derivato,
   * chiesto al motore al momento (mai persistito sulla entry, che resta il puro fatto
   * storico del traffico intercettato): per questo si aggiorna da solo se il mock viene
   * creato, cancellato o disabilitato dopo la cattura.
   */
  protected readonly coveringMock = signal<MockSummary | null>(null);
  /** Id della entry per cui è in volo (o valida) la risoluzione: scarta le risposte stantie. */
  private coveringMockEntryId: string | undefined;

  private readonly coveringMockLookup = effect(() => {
    const sel = this.selected();
    this.coveringMock.set(null);
    this.coveringMockEntryId = sel?.id;
    this.lookupCoveringMock(sel);
  });

  /** Risolve il mock che oggi coprirebbe la entry (anche dopo averne creato uno da lì). */
  private lookupCoveringMock(sel: RequestMonitorEntry | undefined): void {
    // Le entry servite da mock/handler hanno già il loro link diretto (goToDefinition).
    if (sel == null || sel.source === 'mock' || sel.source === 'handler') return;

    const concretePath = sel.originalUrl.startsWith('/') ? sel.originalUrl : sel.path;
    this.api.resolveMock(sel.method, concretePath).subscribe({
      next: (mock) => {
        if (this.coveringMockEntryId === sel.id) this.coveringMock.set(mock);
      },
      error: () => {
        /* lookup best-effort: senza risposta, semplicemente niente scorciatoia */
      },
    });
  }

  // --- statistiche su TUTTE le entry (non filtrate) ---
  protected readonly total = computed(() => this.entries().length);
  protected readonly avgLatency = computed(() => {
    const list = this.entries();
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, entry) => sum + entry.latencyMs, 0) / list.length);
  });
  protected readonly sourceBreakdown = computed(() => {
    const counts = new Map<string, number>();
    for (const entry of this.entries()) counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1);
    return [...counts.entries()].map(([source, count]) => ({ source, count, ...responseSourceMeta(source) }));
  });
  protected selectEntry(id: string): void {
    this.selectedId.set(id);
  }

  /** Modalita' selezione: un clic sulla riga la spunta invece di aprirla. */
  protected readonly selectionMode = signal(false);

  protected toggleSelectionMode(): void {
    this.selectionMode.update((on) => !on);
  }

  /**
   * Clic su una riga: la apre, oppure la spunta in modalita' selezione e con Ctrl (Cmd su Mac).
   * Maiusc spunta l'intervallo dall'ultima spuntata, in modalita' o fuori: in una lista in ordine
   * di tempo un intervallo e' una raffica di richieste consecutive.
   */
  protected onRowClick(id: string, event: MouseEvent): void {
    if (event.shiftKey || this.selectionMode() || event.ctrlKey || event.metaKey) {
      this.toggleSelection(id, event.shiftKey);
      return;
    }
    this.selectEntry(id);
  }

  /** Esc annulla la selezione e chiude la modalita', da qualunque punto della pagina (isSelectionEscape). */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.selectionMode() && this.selectedCount() === 0) return;
    if (!isSelectionEscape(event)) return;
    this.selectionMode.set(false);
    this.clearSelection();
    event.preventDefault();
  }

  /** Tastiera sulla lista: frecce, Home ed End aprono la voce di arrivo; Spazio spunta quella a fuoco. */
  protected onListKeydown(event: KeyboardEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    if (!row || event.ctrlKey || event.metaKey || event.altKey) return;
    const current = row.dataset['entryId'] ?? null;
    if (event.key === ' ') {
      event.preventDefault();
      if (current != null) this.toggleSelection(current, event.shiftKey);
      return;
    }
    const target = listNavigationTarget(event.key, this.filtered().map((entry) => entry.id), current);
    if (target == null) return;
    event.preventDefault();
    this.selectEntry(target);
    this.focusEntry(target);
  }

  /** Porta il fuoco sulla riga di una voce (la lista non e' virtualizzata: la riga c'e' gia'). */
  private focusEntry(id: string): void {
    queueMicrotask(() =>
      Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((row) => row.dataset['entryId'] === id)
        ?.focus(),
    );
  }



  protected toggleStatusClass(n: number): void {
    const next = new Set(this.statusClasses());
    next.has(n) ? next.delete(n) : next.add(n);
    this.statusClasses.set(next);
  }

  /** Svuota lo storico via store; la selezione locale viene ricalcolata dal computed `selected`. */
  protected clearLog(): void {
    this.stream.clear();
    this.selectedId.set(undefined);
    this.clearSelection();
  }

  /** Costruisce il comando cURL equivalente alla request catturata. */
  protected buildCurl(entry: RequestMonitorEntry): string {
    const parts = [`curl -X ${entry.method} '${entry.originalUrl}'`];
    for (const [name, value] of Object.entries(entry.requestHeaders ?? {})) {
      if (['host', 'content-length'].includes(name.toLowerCase())) continue;
      const flat = Array.isArray(value) ? value.join(', ') : value;
      parts.push(`-H '${name}: ${flat}'`);
    }
    if (entry.requestBody) parts.push(`--data '${entry.requestBody.replace(/'/g, "'\\''")}'`);
    return parts.join(' \\\n  ');
  }

  /** Copia la request selezionata come comando cURL negli appunti. */
  protected copyCurl(entry: RequestMonitorEntry): void {
    navigator.clipboard?.writeText(this.buildCurl(entry)).then(
      () => this.toast.show({ title: this.transloco.translate('monitor.toastCopied'), description: this.transloco.translate('monitor.toastCurlClipboard'), tone: 'success' }),
      () => this.toast.show({ title: this.transloco.translate('common.error'), description: this.transloco.translate('monitor.toastCopyFailed'), tone: 'error' }),
    );
  }

  /** Esporta le entry filtrate come file JSON. */
  protected exportJson(): void {
    const blob = new Blob([JSON.stringify(this.filtered(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'monitor-requests.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Crea mock dalle catture sul server (§13 C7), con le regole condivise con lo Storico: la pagina
   * non trasforma più nulla da sé. Manda il runtime a cui appartengono le voci mostrate, dichiarato
   * dallo snapshot dello stream; senza non si può creare niente di affidabile.
   */
  private createFromCaptures(runtimeId: string | null, ids: string[], options: CaptureBatchOptions): Observable<MonitorCreateMocksResult> | null {
    if (runtimeId == null) {
      this.toast.show({ title: this.transloco.translate('monitor.toastMonitorNotReady'), description: this.transloco.translate('monitor.toastMonitorNotReadyDesc'), tone: 'error' });
      return null;
    }
    return this.api.createMocksFromMonitor({ runtimeId, ids, ...options });
  }

  /** Crea un singolo mock dal traffico catturato; se l'endpoint esiste già propone di aggiungere una variante. */
  protected createMockFromEntry(entry: RequestMonitorEntry): void {
    // Le opzioni restano quelle mandate: la casella può cambiare mentre la richiesta è in corso.
    const options: CaptureBatchOptions = { onConflict: 'skip', selectAddedVariants: false, newEndpointEnabled: this.activateNewMocks() };
    const request = this.createFromCaptures(this.stream.runtimeId(), [entry.id], options);
    if (request == null) return;
    this.creatingMock.set(true);
    request.pipe(finalize(() => this.creatingMock.set(false))).subscribe({
      next: (result) => {
        const item = result.items[0];
        if (item == null || item.captureOutcome === 'unavailable') {
          this.showCaptureUnavailable();
        } else if (item.writeOutcome === 'created') {
          this.showCreated(entry, item, options.newEndpointEnabled);
        } else if (item.writeOutcome === 'skipped' && item.id != null) {
          // Endpoint già esistente: invece dell'errore, proponi di aggiungere la response
          // catturata come nuova variante di quell'endpoint.
          this.mockExistsPrompt.set({ existingMockId: item.id, method: item.method ?? entry.method, path: item.path ?? entry.path, entry, runtimeId: result.runtimeId });
          this.mockExistsDialogRef = this.dialog.open(this.mockExistsDialogTpl(), { ariaLabelledBy: 'mx-mock-exists-dialog-title' });
        } else {
          this.toast.show({ title: this.transloco.translate('common.error'), description: item.error ?? this.transloco.translate('common.operationFailed'), tone: 'error' });
        }
      },
      error: (e: unknown) => this.showCreateError(e),
    });
  }

  private showCreated(entry: RequestMonitorEntry, item: CaptureItemOutcome, enabled: boolean): void {
    const params = { method: item.method ?? entry.method, path: item.path ?? entry.path };
    if (item.runtimeOutcome === 'not_applied') {
      this.showNotServed(item, params);
    } else {
      this.showWritten(item, params, enabled);
    }
    // La entry selezionata ora è coperta: aggiorna la scorciatoia nel dettaglio.
    if (this.coveringMockEntryId === entry.id) this.lookupCoveringMock(entry);
  }

  private showWritten(item: CaptureItemOutcome, params: { method: string; path: string }, enabled: boolean): void {
    const incomplete = item.captureOutcome === 'incomplete';
    const prepared = !enabled;
    const title = prepared ? 'monitor.toastMockPrepared' : incomplete ? 'monitor.toastMockCreatedSkeleton' : 'monitor.toastMockCreated';
    const description = prepared
      ? (incomplete ? 'monitor.toastMockPreparedSkeletonDesc' : 'monitor.toastMockPreparedDesc')
      : (incomplete ? 'monitor.toastMockCreatedSkeletonDesc' : 'monitor.toastMockCreatedDesc');
    this.toast.show({
      title: this.transloco.translate(title),
      description: this.transloco.translate(description, params),
      tone: incomplete ? 'warning' : 'success',
      // Scorciatoia al mock appena creato: metodo e rotta dall'esito del server.
      action: {
        label: this.transloco.translate('monitor.toastOpenCreatedMock'),
        run: () => this.router.navigate(['/mocks'], { queryParams: { m: params.method, p: params.path } }),
      },
    });
  }

  /**
   * Anche con 201 un elemento scritto può non essere servito (§13 C1): lo si dice, con il motivo,
   * invece di presentarlo come un successo.
   */
  private showNotServed(item: CaptureItemOutcome, params: { method: string; path: string }): void {
    const description = this.transloco.translate('monitor.toastNotServedDesc', params);
    this.toast.show({
      title: this.transloco.translate('monitor.toastNotServed'),
      description: item.error ? `${description} ${item.error}` : description,
      tone: 'warning',
      action: {
        label: this.transloco.translate('monitor.toastOpenMock'),
        run: () => this.router.navigate(['/mocks'], { queryParams: { m: params.method, p: params.path } }),
      },
    });
  }

  /**
   * Conferma del dialog: aggiunge la response catturata come nuova variante dell'endpoint esistente.
   * `activate: false` la conserva senza attivarla: la risposta servita resta quella di prima.
   */
  protected confirmAddResponseToExisting(activate = true): void {
    const prompt = this.mockExistsPrompt();
    this.closeMockExistsDialog();
    if (prompt == null) return;

    const { entry, method, path, runtimeId } = prompt;
    // Se l'endpoint sparisce mentre il dialog è aperto, il server lo ricrea: anche quello segue la
    // scelta, e «Aggiungi senza attivare» non attiva niente.
    const options: CaptureBatchOptions = { onConflict: 'add-variant', selectAddedVariants: activate, newEndpointEnabled: activate };
    const request = this.createFromCaptures(runtimeId, [entry.id], options);
    if (request == null) return;
    this.creatingMock.set(true);
    request.pipe(finalize(() => this.creatingMock.set(false))).subscribe({
      next: (result) => {
        const item = result.items[0];
        if (item == null || item.captureOutcome === 'unavailable') {
          this.showCaptureUnavailable();
          return;
        }
        if (item.writeOutcome === 'created') {
          this.showCreated(entry, item, options.newEndpointEnabled);
          return;
        }
        if (item.writeOutcome !== 'variant_added') {
          this.toast.show({ title: this.transloco.translate('common.error'), description: item.error ?? this.transloco.translate('common.operationFailed'), tone: 'error' });
          return;
        }
        if (item.runtimeOutcome === 'not_applied') {
          this.showNotServed(item, { method, path });
          return;
        }
        const incomplete = item.captureOutcome === 'incomplete';
        const description = this.transloco.translate(activate ? 'monitor.toastResponseAddedDesc' : 'monitor.toastResponsePreparedDesc', { method, path });
        this.toast.show({
          title: this.transloco.translate(activate ? 'monitor.toastResponseAdded' : 'monitor.toastResponsePrepared'),
          // Una bozza incompleta si dichiara prima di un'eventuale attivazione.
          description: incomplete ? `${description} ${this.transloco.translate('monitor.incompleteHint')}` : description,
          tone: incomplete ? 'warning' : 'success',
          action: {
            label: this.transloco.translate('monitor.toastOpenMock'),
            run: () => this.router.navigate(['/mocks'], { queryParams: { m: method, p: path } }),
          },
        });
      },
      error: (e: unknown) => this.showCreateError(e),
    });
  }

  private showCaptureUnavailable(): void {
    this.toast.show({ title: this.transloco.translate('monitor.toastCaptureUnavailable'), description: this.transloco.translate('monitor.toastCaptureUnavailableDesc'), tone: 'error' });
  }

  /**
   * Errori di un batch di creazione. Motore ripartito: le catture mostrate sono dell'esecuzione
   * precedente. Nessuna risposta: l'esito è sconosciuto e non si ripete in automatico (un batch non è
   * idempotente). Un batch fallito dopo aver scritto dice anche cosa è rimasto su disco.
   */
  private showCreateError(e: unknown): void {
    const status = (e as { status?: unknown } | null)?.status;
    const code = (e as { error?: { details?: { code?: unknown } } } | null)?.error?.details?.code;
    if (code === 'RUNTIME_CHANGED') {
      this.toast.show({ title: this.transloco.translate('monitor.toastRuntimeChanged'), description: this.transloco.translate('monitor.toastRuntimeChangedDesc'), tone: 'error' });
      return;
    }
    if (status === 0) {
      this.toast.show({ title: this.transloco.translate('monitor.toastOutcomeUnknown'), description: this.transloco.translate('monitor.toastOutcomeUnknownDesc'), tone: 'error' });
      return;
    }
    const partial = readBatchPartialResult<MonitorCreateMocksResult>(e);
    const message = this.readErrorMessage(e);
    this.toast.show({
      title: this.transloco.translate('common.error'),
      description: partial ? `${message} ${this.transloco.translate('monitor.partialResult', { summary: this.summarizeBatch(partial) })}` : message,
      tone: 'error',
    });
  }

  protected cancelAddResponseToExisting(): void {
    this.closeMockExistsDialog();
  }

  private closeMockExistsDialog(): void {
    this.mockExistsDialogRef?.close();
    this.mockExistsDialogRef = null;
    this.mockExistsPrompt.set(null);
  }

  /** Apre nel catalogo il mock che oggi coprirebbe la entry selezionata (lookup derivato). */
  protected goToCoveringMock(covering: MockSummary): void {
    this.router.navigate(['/mocks'], { queryParams: { m: covering.method, p: covering.path } });
  }

  // --- selezione multipla + crea mock massivo ---
  protected clearSelection(): void {
    this.selection.set({ runtimeId: null, ids: new Set() });
    this.selectionAnchor = null;
  }

  /**
   * Spunta o toglie una voce; con `range` spunta l'intervallo dall'ultima spuntata, fra le voci
   * che il filtro mostra. Le voci spuntate appartengono al runtime delle voci mostrate; quelle di
   * un altro si perdono.
   */
  protected toggleSelection(id: string, range = false): void {
    const ordered = this.filtered().map((entry) => entry.id);
    const change = toggleListSelection(this.selectedIds(), ordered, id, this.selectionAnchor, range);
    this.selectionAnchor = change.anchor;
    this.selection.set({ runtimeId: this.stream.runtimeId(), ids: change.selected });
  }

  /**
   * Crea mock dalle entry selezionate in una sola richiesta, nell'ordine di cattura; gli endpoint
   * esistenti restano come sono. Riepilogo per esito a fine batch.
   */
  protected createMocksFromSelected(): void {
    const ids = [...this.selectedIds()].sort((left, right) => Number(left) - Number(right));
    if (ids.length === 0) return;
    const options: CaptureBatchOptions = { onConflict: 'skip', selectAddedVariants: false, newEndpointEnabled: this.activateNewMocks() };
    const request = this.createFromCaptures(this.selection().runtimeId, ids, options);
    if (request == null) return;
    this.creatingMock.set(true);
    request.pipe(finalize(() => this.creatingMock.set(false))).subscribe({
      next: (result) => {
        const { created, incomplete } = result.counts;
        const attention = summarizeBatchAttention(result.items);
        const warning = incomplete > 0 || result.counts.failed > 0 || attention.notServed + attention.withWarnings > 0;
        this.toast.show({
          title: created > 0 ? this.transloco.translate('monitor.toastMocksCreated') : this.transloco.translate('monitor.toastNoMocksCreated'),
          description: this.summarizeBatch(result),
          tone: created === 0 ? 'error' : warning ? 'warning' : 'success',
        });
        this.clearSelection();
      },
      error: (e: unknown) => this.showCreateError(e),
    });
  }

  /** Riepilogo tradotto degli esiti di un batch del Monitor. */
  private summarizeBatch(result: MonitorCreateMocksResult): string {
    const { created, addedVariants, incomplete, skipped, unavailable, failed } = result.counts;
    const parts = [this.transloco.translate('monitor.batchCreated', { count: created })];
    if (addedVariants > 0) parts.push(this.transloco.translate('monitor.batchAddedVariants', { count: addedVariants }));
    if (incomplete > 0) parts.push(this.transloco.translate('monitor.batchSkeleton', { count: incomplete }));
    if (skipped > 0) parts.push(this.transloco.translate('monitor.batchSkipped', { count: skipped }));
    if (unavailable > 0) parts.push(this.transloco.translate('monitor.batchUnavailable', { count: unavailable }));
    if (failed > 0) parts.push(this.transloco.translate('monitor.batchFailed', { count: failed }));
    // I conteggi dicono cosa è su disco; cosa il runtime non serve lo dicono gli esiti per elemento.
    const { notServed, withWarnings } = summarizeBatchAttention(result.items);
    if (notServed > 0) parts.push(this.transloco.translate('monitor.batchNotServed', { count: notServed }));
    if (withWarnings > 0) parts.push(this.transloco.translate('monitor.batchWarnings', { count: withWarnings }));
    return parts.join(', ');
  }

  /** Apre nel catalogo la definizione (mock/handler) che ha servito questa request. */
  protected goToDefinition(entry: RequestMonitorEntry): void {
    this.router.navigate(['/mocks'], { queryParams: { m: entry.method, p: entry.matchedRoutePath } });
  }

  protected goToSharedState(name: string): void {
    this.router.navigate(['/dati'], { queryParams: { tab: 'runtime', name } });
  }

  // --- helper di presentazione (colori sui token, come mocks-next) ---
  protected methodColor(method: string): string {
    return methodColor(method);
  }

  /** Colore della classe di status (2xx–5xx); fallback neutro fuori range. */
  protected statusColorClass(klass: number): string {
    return statusClassColor(klass);
  }

  protected statusColor(status: number): string {
    return statusColor(status);
  }


  protected sourceLabel(source: string): string {
    return responseSourceMeta(source).label;
  }

  protected sourceColor(source: string): string {
    return responseSourceMeta(source).color;
  }

  protected sourceIcon(source: string): string {
    return responseSourceMeta(source).icon;
  }

  protected readonly sequenceIcon = SEQUENCE_ICON;

  /** Il nome della provenienza dietro l'icona della riga compatta, col passo se e' una sequenza. */
  protected compactSourceText(row: RequestMonitorEntry): string {
    const label = this.sourceLabel(row.source);
    return row.sequenceStep ? `${label} · SEQ ${row.sequenceStep.index + 1}/${row.sequenceStep.count}` : label;
  }

  /**
   * Latenza per la lista: in millisecondi fino a 9999, poi in secondi con un decimale ("10,0 s"),
   * e senza decimali dai 100 secondi. Sta sempre in 7 caratteri, la colonna della riga compatta.
   */
  protected formatLatency(ms: number): string {
    if (ms < 10_000) return `${ms} ms`;
    const decimals = ms < 100_000 ? 1 : 0;
    const seconds = new Intl.NumberFormat(this.transloco.getActiveLang(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(ms / 1000);
    return `${seconds} s`;
  }

  /**
   * "Non mockata": non servita da una response locale (mock/handler/sse/ws). Sono proxy e
   * middleware, ma anche i miss rimasti senza mock ne' backend a cui girarli (mock-only-miss,
   * backend-unconfigured), che rispondono in locale con un errore.
   */
  protected isUnmocked(source: string): boolean {
    return isUnmockedSource(source);
  }

  /**
   * Barra ambra a sinistra delle righe non mockate. Resta anche sulla riga aperta: quella si segna a
   * destra (.mx-open), quindi i due bordi stanno insieme. Lo stile in linea vince sulla classe, per
   * questo la riga aperta e non mockata ripete qui anche il bordo destro. Da spuntata il bordo
   * sinistro e' della spunta (.mx-checked): che la richiesta non sia mockata lo dice la provenienza.
   */
  protected unmockedEdge(row: RequestMonitorEntry): string | null {
    if (!this.isUnmocked(row.source)) return null;
    const open = row.id === this.selected()?.id;
    if (this.selectedIds().has(row.id)) return open ? 'inset -2px 0 0 0 var(--brand-soft)' : null;
    const edge = 'inset 2px 0 0 0 ' + this.tint('var(--status-4xx)', 45);
    return open ? edge + ', inset -2px 0 0 0 var(--brand-soft)' : edge;
  }

  /** Tinta trasparente di un colore (per fondi/bordi tenui), via color-mix. */
  protected tint(color: string, pct: number): string {
    return tint(color, pct);
  }




  /** Estrae un messaggio leggibile dagli errori HTTP o runtime; ripiega su un testo tradotto. */
  private readErrorMessage(error: unknown): string {
    if (isObject(error) && isObject(error['error']) && typeof error['error']['message'] === 'string') {
      return error['error']['message'];
    }
    if (isObject(error) && typeof error['message'] === 'string') {
      return error['message'];
    }
    return this.transloco.translate('common.operationFailed');
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

