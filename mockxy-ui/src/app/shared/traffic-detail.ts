import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiBadge } from '../ui/ui-badge/ui-badge';
import { UiCode } from '../ui/ui-code/ui-code';
import { UiCollapsible } from '../ui/ui-collapsible/ui-collapsible';
import { UiTable } from '../ui/ui-table/ui-table';
import { UiTooltip } from '../ui/ui-tooltip/ui-tooltip';
import type { RequestMonitorEntry } from '../mock-admin-api.types';
import { RESPONSE_SOURCE_ICONS, SEQUENCE_ICON, responseSourceMeta } from './response-source';
import { bodyLanguage, headerCount, headerRows, methodColor, statusColor, statusText, tint } from './traffic-format';

/**
 * Dettaglio di una richiesta catturata, comune a Monitor e Storico: testata (metodo, URL, status,
 * provenienza, latenza, momento, passo di sequenza, errore di shared state) e le quattro sezioni di
 * request e response. Le azioni della pagina (crea mock, vai al mock, cURL…) arrivano come
 * contenuto proiettato con l'attributo `actions`.
 *
 * Il body della response e' aperto e riempie lo spazio che resta, scorrendo per conto suo: si
 * scorre il body, non tutto il pannello. Resta comunque richiudibile.
 */
@Component({
  selector: 'app-traffic-detail',
  imports: [DatePipe, NgIcon, NgTemplateOutlet, TranslocoPipe, UiBadge, UiCode, UiCollapsible, UiTable, UiTooltip],
  providers: [provideIcons({ ...RESPONSE_SOURCE_ICONS })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
  template: `
    @let e = entry();
    <div class="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-4">
      <span class="font-mono text-[15px] font-bold" [style.color]="methodColor(e.method)">{{ e.method }}</span>
      <span class="font-mono text-[17px] font-semibold text-foreground">{{ e.originalUrl }}</span>
      <span class="rounded-md px-2 py-0.5 font-mono text-[13px] font-bold tabular-nums" [style.color]="statusColor(e.status)" [style.background]="tint(statusColor(e.status), 14)">{{ e.status }} {{ statusText(e.status) }}</span>
      <span class="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground" [attr.title]="keyTitle()">
        <ng-icon [name]="source(e.source).icon" size="0.8rem" [style.color]="source(e.source).color" />{{ source(e.source).label }} · {{ e.latencyMs }} ms · {{ e.timestamp | date: timestampFormat() }}
      </span>
      @if (e.sequenceStep; as seq) {
      <!-- Endpoint con sequenza: quale step ha risposto, con la variante. -->
      <span class="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground" [uiTooltip]="'trafficDetail.sequenceStepTip' | transloco">
        <span class="inline-flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] px-1 text-[10.5px] font-bold tracking-wide text-brand-soft"><ng-icon [name]="sequenceIcon" size="0.7rem" />SEQ {{ seq.index + 1 }}/{{ seq.count }}</span>
        <span class="font-mono text-[11.5px]">{{ seq.responseTitle ? seq.responseTitle + ' — ' : '' }}{{ seq.responseFile }}</span>
      </span>
      }
      @if (e.sharedStateError; as sharedError) {
      <span class="inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--status-4xx)_12%,transparent)] px-2 py-1 font-mono text-[11px] text-[var(--status-4xx)]">
        {{ sharedError.code }}@if (sharedError.name) { · {{ sharedError.name }} }
      </span>
      }
      <span class="ml-auto flex flex-wrap items-center gap-2"><ng-content select="[actions]" /></span>
    </div>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto mx-scroll">
      <div class="shrink-0 border-b border-border">
        <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
          <div uiCollapsibleHeader class="flex items-center gap-2">
            <h2 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'trafficDetail.requestHeaders' | transloco }}</h2>
            <ui-badge tone="neutral">{{ headerCount(e.requestHeaders) }}</ui-badge>
          </div>
          <ng-container *ngTemplateOutlet="headersTable; context: { $implicit: e.requestHeaders }" />
        </ui-collapsible>
      </div>

      <div class="shrink-0 border-b border-border">
        <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
          <div uiCollapsibleHeader class="flex items-center gap-2">
            <h2 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'trafficDetail.requestBody' | transloco }}</h2>
            <span class="font-mono text-[11px] text-muted-foreground">{{ e.requestBodyBytes }} B@if (e.requestBodyTruncated) { · {{ 'trafficDetail.truncated' | transloco }}}</span>
          </div>
          @if (e.requestBody) {
          <div class="px-6 py-3"><ui-code [code]="e.requestBody" [language]="bodyLanguage(e.requestBody)" /></div>
          } @else {
          <p class="px-6 py-3 text-[12.5px] text-muted-foreground">{{ 'trafficDetail.noRequestPayload' | transloco }}</p>
          }
        </ui-collapsible>
      </div>

      <div class="shrink-0 border-b border-border">
        <ui-collapsible [open]="false" triggerClass="bg-white/5 px-6 py-2.5 hover:bg-white/10">
          <div uiCollapsibleHeader class="flex items-center gap-2">
            <h2 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'trafficDetail.responseHeaders' | transloco }}</h2>
            <ui-badge tone="neutral">{{ headerCount(e.responseHeaders) }}</ui-badge>
          </div>
          <ng-container *ngTemplateOutlet="headersTable; context: { $implicit: e.responseHeaders }" />
        </ui-collapsible>
      </div>

      <div class="flex flex-col" [class.flex-1]="responseBodyOpen()" [style.min-height]="responseBodyOpen() ? '32rem' : null">
        <ui-collapsible class="flex flex-col" [class.min-h-0]="responseBodyOpen()" [class.flex-1]="responseBodyOpen()"
                        [open]="responseBodyOpen()" (openChange)="responseBodyOpen.set($event)" triggerClass="shrink-0 bg-white/5 px-6 py-2.5 hover:bg-white/10">
          <div uiCollapsibleHeader class="flex items-center gap-2">
            <h2 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'trafficDetail.responseBody' | transloco }}</h2>
            <span class="font-mono text-[11px] text-muted-foreground">{{ e.responseBodyBytes ?? 0 }} B@if (e.responseBodyTruncated) { · {{ 'trafficDetail.truncated' | transloco }}}</span>
          </div>
          @if (e.responseBody) {
          <div class="min-h-0 flex-1 overflow-y-auto mx-scroll px-6 py-3"><ui-code [code]="e.responseBody" [language]="bodyLanguage(e.responseBody)" /></div>
          } @else {
          <p class="px-6 py-3 text-[12.5px] text-muted-foreground">{{ 'trafficDetail.noResponseBody' | transloco }}</p>
          }
        </ui-collapsible>
      </div>
    </div>

    <ng-template #headersTable let-headers>
      <div class="overflow-x-auto bg-[var(--code)] mx-scroll">
        <table ui-table class="font-mono text-[12px]">
          <tbody>
            @for (h of headerRows(headers); track h[0]) {
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
    </ng-template>
  `,
})
export class TrafficDetail {
  readonly entry = input.required<RequestMonitorEntry>();
  /** Formato del momento: il Monitor mostra l'ora, lo Storico (che copre piu' giorni) anche la data. */
  readonly timestampFormat = input('HH:mm:ss.SSS');
  /** Tooltip della provenienza: nello Storico la chiave del dump (file#riga), utile a chi indaga. */
  readonly keyTitle = input<string | null>(null);

  /** Apertura del body della response: aperto riempie lo spazio che resta e scorre per conto suo. */
  protected readonly responseBodyOpen = signal(true);

  protected readonly sequenceIcon = SEQUENCE_ICON;
  protected readonly methodColor = methodColor;
  protected readonly statusColor = statusColor;
  protected readonly statusText = statusText;
  protected readonly tint = tint;
  protected readonly headerCount = headerCount;
  protected readonly headerRows = headerRows;
  protected readonly bodyLanguage = bodyLanguage;
  protected readonly source = responseSourceMeta;
}
