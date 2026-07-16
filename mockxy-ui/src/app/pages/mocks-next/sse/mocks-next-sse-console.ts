import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideRadio, lucideRotateCcw, lucideSend, lucideZap } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiBadge } from '../../../ui/ui-badge/ui-badge';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiInput } from '../../../ui/ui-input/ui-input';
import { UiTooltip } from '../../../ui/ui-tooltip/ui-tooltip';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import type { MockDetail, SseHistoryEntry, SseMessage, SsePreset, SseStateResponse } from '../../../mock-admin-api.types';

/** Cadenza di aggiornamento della console (connessioni + storico). */
const POLL_MS = 2000;

/**
 * Console della variante sse ("regia manuale", vedi DESIGN-SSE.md): al posto della preview del
 * body mostra le connessioni aperte, lo storico dei messaggi usciti (copione e manuali, stile
 * chat, ricliccabili per re-inviare), il compositore del prossimo evento e le macro (presets).
 * Il push è broadcast a tutte le connessioni; lo stato si aggiorna in polling leggero.
 */
@Component({
  selector: 'mocks-next-sse-console',
  imports: [DatePipe, NgIcon, TranslocoPipe, UiBadge, UiButton, UiInput, UiTooltip],
  providers: [provideIcons({ lucideRadio, lucideRotateCcw, lucideSend, lucideZap })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-1 flex-col overflow-hidden' },
  template: `
    <!-- stato: connessioni + copione -->
    <div class="flex shrink-0 flex-wrap items-center gap-3 bg-black/20 px-6 py-2.5">
      <span class="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">
        <ng-icon name="lucideRadio" size="0.9rem" [class.text-positive]="connections().length > 0" />
        {{ 'sseConsole.connections' | transloco }}
      </span>
      <ui-badge [tone]="connections().length > 0 ? 'positive' : 'neutral'">{{ connections().length }}</ui-badge>
      @for (c of connections(); track c.id) {
      <span class="rounded-md bg-black/20 px-2 py-0.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border" [uiTooltip]="'sseConsole.connectionTip' | transloco">
        #{{ c.id }} · {{ c.eventsSent }} ev @if (c.scriptLength > 0) {· {{ c.scriptIndex }}/{{ c.scriptLength }}}
      </span>
      }
      <span class="ml-auto text-[11.5px] text-muted-foreground">
        {{ 'sseConsole.scriptSummary' | transloco: { count: detail().sse?.script?.length ?? 0, onEnd: onEndLabel() } }}
      </span>
    </div>

    <!-- storico stile chat -->
    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4 mx-scroll">
      @if (history().length === 0) {
      <p class="text-[13px] text-muted-foreground">{{ 'sseConsole.empty' | transloco }}</p>
      }
      <div class="flex flex-col gap-2">
        @for (entry of history(); track $index) {
        <div class="group/msg flex items-start gap-2.5">
          <span class="mt-0.5 shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">{{ entry.at | date: 'HH:mm:ss' }}</span>
          <span
            class="shrink-0 rounded px-1 text-[10px] font-bold uppercase tracking-wide"
            [class]="entry.origin === 'manual' ? 'bg-[color-mix(in_srgb,var(--brand)_16%,transparent)] text-brand' : 'bg-black/25 text-muted-foreground'"
          >{{ (entry.origin === 'manual' ? 'sseConsole.originManual' : 'sseConsole.originScript') | transloco }}</span>
          <div class="min-w-0 flex-1 rounded-lg bg-black/20 px-3 py-1.5 ring-1 ring-border">
            @if (entry.event) {
            <span class="mr-2 font-mono text-[11px] font-bold text-foreground">{{ entry.event }}</span>
            }
            <span class="break-all font-mono text-[12px] text-muted-foreground">{{ dataLabel(entry.data) }}</span>
          </div>
          <button
            ui-button
            variant="ghost"
            size="icon"
            class="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover/msg:opacity-100"
            [disabled]="sending()"
            (click)="resend(entry)"
            [uiTooltip]="'sseConsole.resendTip' | transloco"
          >
            <ng-icon name="lucideRotateCcw" size="0.8rem" />
          </button>
        </div>
        }
      </div>
    </div>

    <!-- compositore + macro -->
    <div class="shrink-0 border-t border-border bg-black/20 px-6 py-3">
      @if (presets().length > 0) {
      <div class="mb-2 flex flex-wrap items-center gap-1.5">
        <ng-icon name="lucideZap" size="0.8rem" class="text-muted-foreground" />
        @for (preset of presets(); track $index) {
        <button
          ui-button
          variant="outline"
          size="sm"
          [disabled]="sending()"
          (click)="sendPreset(preset)"
          [uiTooltip]="dataLabel(preset.data)"
        >{{ preset.label || preset.event || 'preset' }}</button>
        }
      </div>
      }
      <div class="flex items-start gap-2">
        <input
          ui-input
          type="text"
          class="w-44 font-mono text-[12.5px]"
          [placeholder]="'sseConsole.eventPlaceholder' | transloco"
          [value]="eventName()"
          (input)="eventName.set($any($event.target).value)"
        />
        <textarea
          ui-input
          rows="2"
          class="min-h-9 flex-1 resize-y font-mono text-[12.5px]"
          [placeholder]="'sseConsole.dataPlaceholder' | transloco"
          [value]="dataText()"
          (input)="dataText.set($any($event.target).value)"
          (keydown.control.enter)="send()"
        ></textarea>
        <button ui-button [disabled]="!canSend()" (click)="send()" [uiTooltip]="'sseConsole.sendTip' | transloco">
          <ng-icon name="lucideSend" size="0.9rem" /> {{ 'sseConsole.send' | transloco }}
        </button>
      </div>
    </div>
  `,
})
export class MocksNextSseConsole implements OnInit, OnDestroy {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  readonly detail = input.required<MockDetail>();

  protected readonly state = signal<SseStateResponse | null>(null);
  protected readonly eventName = signal('');
  protected readonly dataText = signal('');
  protected readonly sending = signal(false);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly connections = computed(() => this.state()?.connections ?? []);
  protected readonly history = computed(() => this.state()?.history ?? []);
  protected readonly presets = computed<readonly SsePreset[]>(() => this.detail().sse?.presets ?? []);
  protected readonly canSend = computed(() => !this.sending() && this.dataText().trim() !== '');

  constructor() {
    // Cambio endpoint (stesso componente riusato): stato azzerato e ricaricato subito.
    effect(() => {
      this.detail().id;
      this.state.set(null);
      this.refresh();
    });
  }

  ngOnInit(): void {
    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
    }
  }

  private refresh(): void {
    this.api.getSseState(this.detail().id).subscribe({
      next: (state) => this.state.set(state),
      error: () => {
        /* endpoint cambiato/variante non più sse: il prossimo giro o il cambio detail sistemano */
      },
    });
  }

  protected onEndLabel(): string {
    const onEnd = this.detail().sse?.onEnd ?? 'keep-open';
    return this.transloco.translate(
      onEnd === 'close' ? 'sseConsole.onEndClose' : onEnd === 'loop' ? 'sseConsole.onEndLoop' : 'sseConsole.onEndKeepOpen',
    );
  }

  /** Testo compatto del data di un messaggio (JSON serializzato o stringa così com'è). */
  protected dataLabel(data: unknown): string {
    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  /** Invia il messaggio composto: il data è JSON se interpretabile, altrimenti testo puro. */
  protected send(): void {
    if (!this.canSend()) return;
    const raw = this.dataText().trim();
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* testo puro: legittimo per gli eventi SSE */
    }
    const message: SseMessage = { data };
    const event = this.eventName().trim();
    if (event !== '') {
      message.event = event;
    }
    this.push(message);
  }

  protected resend(entry: SseHistoryEntry): void {
    this.push({ data: entry.data, event: entry.event, id: entry.id });
  }

  protected sendPreset(preset: SsePreset): void {
    this.push({ data: preset.data, event: preset.event, id: preset.id });
  }

  private push(message: SseMessage): void {
    this.sending.set(true);
    this.api.pushSse(this.detail().id, message).subscribe({
      next: ({ delivered }) => {
        this.sending.set(false);
        this.refresh();
        if (delivered === 0) {
          // Regia senza pubblico: il messaggio è nello storico ma nessun client era connesso.
          this.toast.show({ tone: 'warning', title: this.transloco.translate('sseConsole.noConnections') });
        }
      },
      error: () => {
        this.sending.set(false);
        this.toast.show({ tone: 'error', title: this.transloco.translate('common.error') });
      },
    });
  }
}
