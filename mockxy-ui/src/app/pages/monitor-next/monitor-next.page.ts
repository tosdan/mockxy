import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, TemplateRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { finalize, type Observable } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideActivity,
  lucideArrowLeft,
  lucideCheck,
  lucideCopy,
  lucideDatabase,
  lucideDownload,
  lucideListTree,
  lucidePlus,
  lucideSearch,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiBadge } from '../../ui/ui-badge/ui-badge';
import { UiButton } from '../../ui/ui-button/ui-button';
import { UiCheckbox } from '../../ui/ui-checkbox/ui-checkbox';
import { UiCode } from '../../ui/ui-code/ui-code';
import { UiCollapsible } from '../../ui/ui-collapsible/ui-collapsible';
import { UiSelect, type UiSelectOption } from '../../ui/ui-select/ui-select';
import { UiTable } from '../../ui/ui-table/ui-table';
import { UiTooltip } from '../../ui/ui-tooltip/ui-tooltip';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import { UiDialog } from '../../ui/ui-dialog/ui-dialog';
import { MockAdminApiService } from '../../mock-admin-api.service';
import { MonitorStreamStore } from '../../shared/monitor-stream.store';
import { summarizeBatchAttention, type CaptureBatchOptions, type CaptureItemOutcome, type MockSummary, type MonitorCreateMocksResult, type RequestMonitorEntry } from '../../mock-admin-api.types';
import { readBatchPartialResult } from '../../shared/read-error-message';
import { MOCK_METHODS } from '../../mock-admin-ui.constants';

interface SourceMeta {
  readonly label: string;
  readonly color: string;
}

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
  imports: [DatePipe, NgIcon, TranslocoPipe, UiBadge, UiButton, UiCheckbox, UiCode, UiCollapsible, UiSelect, UiTable, UiTooltip],
  providers: [
    provideIcons({
      lucideActivity, lucideArrowLeft, lucideCheck, lucideCopy, lucideDatabase, lucideDownload, lucideListTree,
      lucidePlus, lucideSearch, lucideTrash2, lucideX,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="absolute inset-0 flex flex-col overflow-hidden bg-background text-foreground mx-scroll">
      <!-- TOPBAR -->
      <header class="relative z-30 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-5">
        <div class="flex items-center gap-2.5">
          <span class="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-[var(--brand-deep)] text-white ring-1 ring-white/10">
            <ng-icon name="lucideActivity" size="1.05rem" />
          </span>
          <div class="leading-tight">
            <div class="text-sm font-bold tracking-tight text-foreground">Mockxy</div>
            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">Monitor</div>
          </div>
        </div>
        @if (streaming()) {
        <span class="inline-flex items-center gap-2 rounded-full bg-positive/15 px-3 py-1 text-[11.5px] font-semibold text-positive ring-1 ring-positive/25">
          <span class="relative grid place-items-center">
            <span class="absolute size-2.5 animate-ping rounded-full bg-positive/60"></span>
            <span class="size-1.5 rounded-full bg-positive"></span>
          </span>
          Live
        </span>
        } @else {
        <span class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11.5px] font-semibold" [style.color]="'var(--status-4xx)'" [style.background]="tint('var(--status-4xx)', 12)" [style.borderColor]="tint('var(--status-4xx)', 30)">
          <span class="size-1.5 rounded-full" [style.background]="'var(--status-4xx)'"></span> {{ 'monitor.paused' | transloco }}
        </span>
        }
        <div class="ml-auto flex items-center gap-2">
          @if (selectionMode()) {
          <span class="text-[12.5px] text-muted-foreground">{{ 'monitor.selectedCount' | transloco: { count: selectedCount() } }}</span>
          <label class="flex items-center gap-2 text-[12px] text-muted-foreground" [uiTooltip]="'monitor.activateNewTip' | transloco">
            <ui-checkbox [(checked)]="activateNewMocks" [ariaLabel]="'monitor.activateNew' | transloco" />
            {{ 'monitor.activateNew' | transloco }}
          </label>
          <button ui-button size="sm" [disabled]="selectedCount() === 0 || creatingMock()" (click)="createMocksFromSelected()"><ng-icon name="lucidePlus" size="0.9rem" /> {{ 'monitor.createMock' | transloco }}</button>
          <button ui-button variant="outline" size="sm" (click)="exitSelection()"><ng-icon name="lucideX" size="0.9rem" /> {{ 'monitor.cancel' | transloco }}</button>
          } @else {
          <button ui-button variant="outline" size="sm" [disabled]="filtered().length === 0" (click)="enterSelection()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ 'monitor.select' | transloco }}</button>
          <button ui-button variant="outline" size="sm" [disabled]="clearing()" (click)="clearLog()"><ng-icon name="lucideTrash2" size="0.9rem" /> {{ 'monitor.clear' | transloco }}</button>
          <button ui-button variant="outline" size="sm" [disabled]="filtered().length === 0" (click)="exportJson()"><ng-icon name="lucideDownload" size="0.9rem" /> {{ 'monitor.export' | transloco }}</button>
          }
        </div>
      </header>

      <!-- STATS STRIP -->
      <div class="relative z-20 flex shrink-0 flex-wrap items-center gap-2.5 border-b border-border bg-card/60 px-5 py-2">
        <div class="flex items-baseline gap-1.5 rounded-lg bg-muted/60 px-3 py-1 ring-1 ring-border">
          <span class="text-[15px] font-bold tabular-nums">{{ total() }}</span><span class="text-[11.5px] text-muted-foreground">{{ 'monitor.requests' | transloco }}</span>
        </div>
        <div class="flex items-baseline gap-1.5 rounded-lg bg-muted/60 px-3 py-1 ring-1 ring-border">
          <span class="text-[15px] font-bold tabular-nums" [style.color]="errorCount() > 0 ? 'var(--status-5xx)' : null">{{ errorCount() }}</span><span class="text-[11.5px] text-muted-foreground">{{ 'monitor.errors' | transloco }}</span>
        </div>
        <div class="flex items-baseline gap-1.5 rounded-lg bg-muted/60 px-3 py-1 ring-1 ring-border">
          <span class="text-[15px] font-bold tabular-nums">{{ avgLatency() }}</span><span class="text-[11.5px] text-muted-foreground">{{ 'monitor.avgMs' | transloco }}</span>
        </div>
        <span class="ml-1 inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
          @for (s of sourceBreakdown(); track s.source) {
          <span class="inline-flex items-center gap-1.5"><span class="size-1.5 rounded-full" [style.background]="s.color"></span>{{ s.label }} {{ s.count }}</span>
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
                 class="h-8 w-64 rounded-lg border border-input bg-black/30 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring/50 focus:ring-2 focus:ring-ring/20" />
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
        <ui-select class="w-40" [options]="methodOptions" [value]="methodFilter()" (valueChange)="methodFilter.set($any($event))" />
        @for (n of statusChips; track n) {
        <button (click)="toggleStatusClass(n)"
                class="inline-flex h-8 items-center rounded-lg border px-3 text-[12.5px] font-medium transition"
                [style.color]="statusClasses().has(n) ? statusColorClass(n) : 'var(--muted-foreground)'"
                [style.borderColor]="statusClasses().has(n) ? tint(statusColorClass(n), 40) : 'var(--input)'"
                [style.background]="statusClasses().has(n) ? tint(statusColorClass(n), 10) : 'transparent'">{{ n }}xx</button>
        }
        <label class="inline-flex items-center gap-2">
          <span class="text-[11.5px] text-muted-foreground">{{ 'monitor.servedBy' | transloco }}</span>
          <ui-select class="w-40" [options]="sourceOptions" [value]="sourceFilter()" (valueChange)="sourceFilter.set($any($event))" />
        </label>
        @if (filtered().length !== total()) {
        <span class="text-[11.5px] text-muted-foreground">{{ filtered().length }} / {{ total() }}</span>
        }
      </div>

      <!-- BODY: lista + dettaglio -->
      <div class="relative z-10 flex min-h-0 flex-1">
        <!-- LISTA -->
        <div class="flex min-h-0 shrink-0 flex-col border-r border-border" [style.width.px]="listWidth()">
          <div class="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-border px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <span>{{ 'monitor.colRequest' | transloco }}</span><span>{{ 'monitor.colLatTime' | transloco }}</span>
          </div>
          <div class="min-h-0 flex-1 overflow-auto mx-scroll">
            @for (row of filtered(); track row.id) {
            <button
              type="button"
              (click)="onRowClick(row.id)"
              class="grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b border-border-soft px-4 py-2.5 text-left transition hover:bg-white/[0.03]"
              [class.mx-selected]="!selectionMode() && row.id === selected()?.id"
              [style.boxShadow]="row.id !== selected()?.id && isUnmocked(row.source) ? 'inset 2px 0 0 0 ' + tint('var(--status-4xx)', 45) : null"
            >
              <span class="flex min-w-0 items-center gap-2.5">
                @if (selectionMode()) {
                <span class="grid size-4 shrink-0 place-items-center rounded border transition" [style.borderColor]="selectedIds().has(row.id) ? 'var(--brand)' : 'var(--input)'" [style.background]="selectedIds().has(row.id) ? 'var(--brand)' : 'transparent'">
                  @if (selectedIds().has(row.id)) { <ng-icon name="lucideCheck" size="0.7rem" class="text-white" /> }
                </span>
                }
                <span class="w-12 shrink-0 font-mono text-[12px] font-bold" [style.color]="methodColor(row.method)">{{ row.method }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-mono text-[13px] text-foreground">{{ row.originalUrl }}</span>
                  <span class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span class="size-1.5 rounded-full" [style.background]="sourceColor(row.source)"></span>{{ sourceLabel(row.source) }}
                    @if (row.sequenceStep; as seq) {
                    <span class="rounded bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] px-1 text-[10px] font-bold tracking-wide text-brand" [uiTooltip]="'monitor.sequenceStepTip' | transloco">SEQ {{ seq.index + 1 }}/{{ seq.count }}</span>
                    }
                  </span>
                </span>
                <span class="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11.5px] font-bold tabular-nums" [style.color]="statusColor(row.status)" [style.background]="tint(statusColor(row.status), 12)">{{ row.status }}</span>
              </span>
              <span class="text-right">
                <span class="block font-mono text-[12px] tabular-nums text-foreground/80">{{ row.latencyMs }} ms</span>
                <span class="block font-mono text-[10.5px] tabular-nums text-muted-foreground">{{ row.timestamp | date: 'HH:mm:ss' }}</span>
              </span>
            </button>
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
        </div>

        <!-- divisore trascinabile: ridimensiona la lista (largh. persistita) -->
        <div
          class="relative z-20 -ml-px w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-brand/30"
          (pointerdown)="startResize($event)"
          (dblclick)="resetListWidth()"
          role="separator"
          aria-orientation="vertical"
          [title]="'monitor.resizeHint' | transloco"
        ></div>

        <!-- DETTAGLIO -->
        <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div class="mx-glow"></div>
          @if (selected(); as sel) {
          <div class="relative z-10 flex min-h-0 flex-1 flex-col">
            <!-- header dettaglio (fisso) -->
            <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-4">
              <span class="font-mono text-[15px] font-bold" [style.color]="methodColor(sel.method)">{{ sel.method }}</span>
              <span class="font-mono text-[17px] font-semibold text-foreground">{{ sel.originalUrl }}</span>
              <span class="rounded-md px-2 py-0.5 font-mono text-[13px] font-bold tabular-nums" [style.color]="statusColor(sel.status)" [style.background]="tint(statusColor(sel.status), 14)">{{ sel.status }} {{ statusText(sel.status) }}</span>
              <span class="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <span class="size-1.5 rounded-full" [style.background]="sourceColor(sel.source)"></span>{{ sourceLabel(sel.source) }} · {{ sel.latencyMs }} ms · {{ sel.timestamp | date: 'HH:mm:ss.SSS' }}
              </span>
              @if (sel.sequenceStep; as seq) {
              <!-- Endpoint con sequenza: quale step ha risposto, con la variante — la progressione si legge da qui. -->
              <span class="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground" [uiTooltip]="'monitor.sequenceStepTip' | transloco">
                <span class="rounded bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] px-1 text-[10.5px] font-bold tracking-wide text-brand">SEQ {{ seq.index + 1 }}/{{ seq.count }}</span>
                <span class="font-mono text-[11.5px]">{{ seq.responseTitle ? seq.responseTitle + ' — ' : '' }}{{ seq.responseFile }}</span>
              </span>
              }
              @if (sel.sharedStateError; as sharedError) {
              <span class="inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--status-4xx)_12%,transparent)] px-2 py-1 font-mono text-[11px] text-[var(--status-4xx)]">
                {{ sharedError.code }}@if (sharedError.name) { · {{ sharedError.name }} }
              </span>
              }
              <span class="ml-auto flex flex-wrap items-center gap-2">
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
              </span>
            </div>

            <!-- sezioni in accordion (stile dettaglio catalogo): scrolla la regione, non la pagina -->
            <div class="min-h-0 flex-1 overflow-y-auto mx-scroll">
              <!-- Request · headers (chiuso di default) -->
              <div class="border-b border-border">
                <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
                  <div uiCollapsibleHeader class="flex items-center gap-2">
                    <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Request · headers</h3>
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

              <!-- Request · body (chiuso di default) -->
              <div class="border-b border-border">
                <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
                  <div uiCollapsibleHeader class="flex items-center gap-2">
                    <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Request · body</h3>
                    <span class="font-mono text-[11px] text-muted-foreground">{{ sel.requestBodyBytes }} B@if (sel.requestBodyTruncated) { · {{ 'monitor.truncated' | transloco }}}</span>
                  </div>
                  @if (sel.requestBody) {
                  <div class="px-6 py-3"><ui-code [code]="sel.requestBody" [language]="bodyLang(sel.requestBody)" /></div>
                  } @else {
                  <p class="px-6 py-3 text-[12.5px] text-muted-foreground">{{ 'monitor.noRequestPayload' | transloco }}</p>
                  }
                </ui-collapsible>
              </div>

              <!-- Response · headers -->
              <div class="border-b border-border">
                <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
                  <div uiCollapsibleHeader class="flex items-center gap-2">
                    <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Response · headers</h3>
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

              <!-- Response · body -->
              <div>
                <ui-collapsible triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
                  <div uiCollapsibleHeader class="flex items-center gap-2">
                    <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Response · body</h3>
                    <span class="font-mono text-[11px] text-muted-foreground">{{ sel.responseBodyBytes ?? 0 }} B@if (sel.responseBodyTruncated) { · {{ 'monitor.truncated' | transloco }}}</span>
                  </div>
                  @if (sel.responseBody) {
                  <div class="px-6 py-3"><ui-code [code]="sel.responseBody" [language]="bodyLang(sel.responseBody)" /></div>
                  } @else {
                  <p class="px-6 py-3 text-[12.5px] text-muted-foreground">{{ 'monitor.noResponseBody' | transloco }}</p>
                  }
                </ui-collapsible>
              </div>
            </div>
          </div>
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
          <h2 class="text-[15px] font-bold tracking-tight">{{ 'monitor.mockExistsTitle' | transloco }}</h2>
          <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="cancelAddResponseToExisting()"><ng-icon name="lucideX" size="0.95rem" /></button>
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
  `,
})
export class MonitorNextPage {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly stream = inject(MonitorStreamStore);
  private readonly transloco = inject(TranslocoService);
  private readonly dialog = inject(UiDialog);

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
  /** Larghezza della lista (px), ridimensionabile col divisore e persistita in localStorage (min = catalogo). */
  protected readonly listWidth = signal(clampListWidth(readStoredListWidth()));

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
  protected readonly selectionMode = signal(false);
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

  /** Lista filtrata per ricerca + metodo + classe di status + provenienza della risposta. */
  protected readonly filtered = computed(() => {
    const query = this.search().trim().toLowerCase();
    const method = this.methodFilter();
    const source = this.sourceFilter();
    const classes = this.statusClasses();
    return this.entries().filter((entry) => {
      if (query !== '' && !`${entry.originalUrl} ${entry.method}`.toLowerCase().includes(query)) return false;
      if (method !== 'all' && entry.method !== method) return false;
      if (source === 'real-backend') {
        if (!this.isUnmocked(entry.source)) return false;
      } else if (source !== 'all' && entry.source !== source) {
        return false;
      }
      if (classes.size > 0 && !classes.has(Math.floor(entry.status / 100))) return false;
      return true;
    });
  });

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
  protected readonly errorCount = computed(() => this.entries().filter((entry) => entry.status >= 400).length);
  protected readonly avgLatency = computed(() => {
    const list = this.entries();
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, entry) => sum + entry.latencyMs, 0) / list.length);
  });
  protected readonly sourceBreakdown = computed(() => {
    const counts = new Map<string, number>();
    for (const entry of this.entries()) counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1);
    return [...counts.entries()].map(([source, count]) => ({ source, count, ...this.sourceMeta(source) }));
  });
  protected selectEntry(id: string): void {
    this.selectedId.set(id);
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

  protected toggleStatusClass(n: number): void {
    const next = new Set(this.statusClasses());
    next.has(n) ? next.delete(n) : next.add(n);
    this.statusClasses.set(next);
  }

  /** Svuota lo storico via store; la selezione locale viene ricalcolata dal computed `selected`. */
  protected clearLog(): void {
    this.stream.clear();
    this.selectedId.set(undefined);
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
          this.mockExistsDialogRef = this.dialog.open(this.mockExistsDialogTpl());
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
  protected enterSelection(): void {
    this.selection.set({ runtimeId: null, ids: new Set() });
    this.selectionMode.set(true);
  }

  protected exitSelection(): void {
    this.selectionMode.set(false);
    this.selection.set({ runtimeId: null, ids: new Set() });
  }

  /** Le voci spuntate appartengono al runtime delle voci mostrate; quelle di un altro si perdono. */
  protected toggleSelection(id: string): void {
    const next = new Set(this.selectedIds());
    next.has(id) ? next.delete(id) : next.add(id);
    this.selection.set({ runtimeId: this.stream.runtimeId(), ids: next });
  }

  /** In modalità selezione il click sulla riga la spunta; altrimenti apre il dettaglio. */
  protected onRowClick(id: string): void {
    this.selectionMode() ? this.toggleSelection(id) : this.selectEntry(id);
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
        this.exitSelection();
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
    return `var(--method-${method.toLowerCase()})`;
  }

  /** Colore della classe di status (2xx–5xx); fallback neutro fuori range. */
  protected statusColorClass(klass: number): string {
    return klass >= 2 && klass <= 5 ? `var(--status-${klass}xx)` : 'var(--muted-foreground)';
  }

  protected statusColor(status: number): string {
    return this.statusColorClass(Math.floor(status / 100));
  }

  protected statusText(status: number): string {
    const map: Record<number, string> = {
      200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved', 304: 'Not Modified',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
      422: 'Unprocessable', 429: 'Too Many', 500: 'Server Error', 502: 'Bad Gateway', 503: 'Unavailable',
    };
    return map[status] ?? '';
  }

  protected sourceLabel(source: string): string {
    return this.sourceMeta(source).label;
  }

  protected sourceColor(source: string): string {
    return this.sourceMeta(source).color;
  }

  /** "Non mockata": servita dal backend (proxy / middleware / miss), senza una response locale (mock/handler/sse). */
  protected isUnmocked(source: string): boolean {
    return source !== 'mock' && source !== 'handler' && source !== 'sse';
  }

  private sourceMeta(source: string): SourceMeta {
    switch (source) {
      case 'mock': return { label: 'Mock', color: 'var(--type-mock)' };
      case 'handler': return { label: 'Handler', color: 'var(--type-handler)' };
      case 'middleware': return { label: 'Middleware', color: 'var(--type-middleware)' };
      case 'sse': return { label: 'SSE', color: 'var(--brand)' };
      case 'backend': return { label: 'Proxy', color: 'var(--brand-soft)' };
      case 'mock-only':
      case 'mock-only-miss': return { label: 'Miss', color: 'var(--foreground-faint)' };
      default: return { label: source, color: 'var(--muted-foreground)' };
    }
  }

  /** Tinta trasparente di un colore (per fondi/bordi tenui), via color-mix. */
  protected tint(color: string, pct: number): string {
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
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

  /** Evidenziazione del body: JSON se è un oggetto/array valido, altrimenti testo semplice. */
  protected bodyLang(text: string | undefined): 'json' | 'text' {
    const t = (text ?? '').trim();
    if (!(t.startsWith('{') || t.startsWith('['))) return 'text';
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      return 'text';
    }
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


const LIST_WIDTH_KEY = 'mx-monitor-list-width';
const DEFAULT_LIST_WIDTH = 440;
const MIN_LIST_WIDTH = 380; // come MIN_CATALOG_WIDTH nella view del catalogo

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
