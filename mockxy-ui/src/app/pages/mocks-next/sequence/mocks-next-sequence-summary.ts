import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideChevronRight, lucideClock, lucideRotateCcw } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiBadge } from '../../../ui/ui-badge/ui-badge';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiChip } from '../../../ui/ui-chip/ui-chip';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import type { MockDetail, SequenceState, SequenceVariantConfig } from '../../../mock-admin-api.types';

const STATE_POLL_MS = 2000;

/**
 * Da quanto tempo, in forma breve. Le unità sono le stesse in italiano e in inglese, così la
 * frase intera resta una sola chiave ("ultima richiesta {{ago}} fa").
 *
 * Il confronto è fra un `Date.now()` del motore e uno del browser: sono la stessa macchina nel
 * caso normale, ma con la UI aperta da un'altra macchina in LAN lo scarto di orologio potrebbe
 * rendere l'intervallo negativo — da cui il taglio a zero.
 */
export function formatAgo(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h`;
}

/** Come sta messo uno step rispetto al cursore, con i numeri che servono a disegnarlo. */
export interface SequenceStepView {
  readonly response: string;
  readonly times: number | null;
  readonly forMs: number | null;
  /** `done` = già servito in questo giro, `current` = risponderà alla prossima richiesta. */
  readonly phase: 'done' | 'current' | 'pending';
  /** Riempimento della barra in percentuale; null quando non c'è niente da misurare. */
  readonly progress: number | null;
  readonly served: number | null;
  readonly elapsedMs: number | null;
  /** Step forMs diventato corrente ma non ancora toccato da una richiesta: il timer non è partito. */
  readonly waitingFirstRequest: boolean;
}

/**
 * Riepilogo di una variante sequence: la definizione (step, fine corsa, auto-reset) e il cursore
 * runtime nello stesso posto.
 *
 * Sul nome delle cose: il motore fa avanzare il cursore appena finito di servire uno step
 * `times`, quindi `stepIndex` è lo step che risponderà ALLA PROSSIMA richiesta, non quello in cui
 * ci si trova (vedi il commento in src/mocks/sequence-state.js). Tutte le etichette qui dicono
 * "la prossima richiesta", perché è quello che il dato significa davvero.
 *
 * Il cursore si legge in polling: `sequence/state` non ha uno stream e il motore si muove solo
 * quando arriva traffico, che questa pagina non vede.
 */
@Component({
  selector: 'mocks-next-sequence-summary',
  imports: [NgIcon, TranslocoPipe, UiBadge, UiButton, UiChip],
  providers: [provideIcons({ lucideCheck, lucideChevronRight, lucideClock, lucideRotateCcw })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'min-h-0 flex-1 overflow-y-auto px-6 py-5 mx-scroll' },
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
      @if (cursor(); as c) {
      <!-- Banda del cursore: cosa risponde adesso, non dove siamo. -->
      <div
        class="flex items-center gap-3 rounded-lg border px-3 py-2.5"
        [class]="c.kind === 'running' ? 'border-[color:color-mix(in_srgb,var(--sequence)_28%,transparent)] bg-[color-mix(in_srgb,var(--sequence)_8%,transparent)]' : 'border-border bg-black/20'"
      >
        <span
          class="grid h-6 w-6 shrink-0 place-items-center rounded-full"
          [class]="c.kind === 'running' ? 'bg-[color-mix(in_srgb,var(--sequence)_18%,transparent)] text-sequence' : 'bg-white/5 text-muted-foreground'"
        >
          <ng-icon [name]="c.kind === 'running' ? 'lucideChevronRight' : 'lucideClock'" size="0.85rem" />
        </span>

        <div class="min-w-0 flex-1 leading-snug">
          <p class="text-[12.5px] text-foreground">
            @switch (c.kind) {
            @case ('never') { {{ 'sequenceSummary.never' | transloco }} }
            @case ('staleReset') { {{ 'sequenceSummary.staleReset' | transloco }} }
            @default {
            {{ (c.terminal ? 'sequenceSummary.nextTerminal' : 'sequenceSummary.next') | transloco: { step: c.stepIndex + 1 } }}
            <span class="font-mono text-muted-foreground">· {{ c.response }}</span>
            }
            }
          </p>
          <p class="truncate text-[11px] text-muted-foreground">
            @switch (c.kind) {
            @case ('never') { {{ 'sequenceSummary.neverHint' | transloco }} }
            @case ('staleReset') { {{ 'sequenceSummary.staleResetHint' | transloco }} }
            @default {
            {{ 'sequenceSummary.servedInStep' | transloco: { served: c.served } }} ·
            {{ 'sequenceSummary.lastRequest' | transloco: { ago: c.lastRequestAgo } }}
            }
            }
          </p>
        </div>

        <button ui-button variant="outline" size="sm" [disabled]="resetting() || c.kind === 'never'" (click)="reset()">
          <ng-icon name="lucideRotateCcw" size="0.85rem" /> {{ 'sequenceDialog.reset' | transloco }}
        </button>
      </div>
      }

      <div class="flex flex-wrap items-center gap-2">
        <ui-badge tone="neutral">{{ sequence().onEnd === 'loop' ? ('sequenceDialog.onEndLoop' | transloco) : ('sequenceDialog.onEndStay' | transloco) }}</ui-badge>
        <ui-chip>
          <span class="text-[10px] font-semibold uppercase tracking-wide">{{ 'sequenceDialog.autoReset' | transloco }}</span>
          <span class="font-mono font-semibold text-foreground">{{ sequence().resetAfterMs == null ? ('sequenceDialog.autoResetNever' | transloco) : sequence().resetAfterMs + ' ms' }}</span>
        </ui-chip>
      </div>

      <ol class="flex flex-col gap-2" [attr.aria-label]="'sequenceDialog.steps' | transloco">
        @for (step of stepViews(); track $index) {
        <li
          class="flex items-center gap-3 rounded-lg border px-3 py-2.5"
          [class]="step.phase === 'current' ? 'border-[color:color-mix(in_srgb,var(--sequence)_45%,transparent)] bg-[color-mix(in_srgb,var(--sequence)_10%,transparent)]' : step.phase === 'done' ? 'border-border bg-black/20 opacity-55' : 'border-border bg-black/20'"
        >
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--sequence)_16%,transparent)] font-mono text-[11px] font-bold text-sequence">
            @if (step.phase === 'done') {
            <ng-icon name="lucideCheck" size="0.75rem" [attr.aria-label]="'sequenceSummary.stepDone' | transloco" />
            } @else { {{ $index + 1 }} }
          </span>

          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class="truncate font-mono text-[12px] text-foreground">{{ step.response }}</span>
            @if (step.progress != null) {
            <span class="block h-[3px] overflow-hidden rounded-full bg-white/10">
              <span class="block h-full rounded-full bg-[var(--sequence)]" [style.width.%]="step.progress"></span>
            </span>
            }
          </div>

          <span class="shrink-0 text-[12px] text-muted-foreground">
            @if (step.times != null) { {{ step.times }} {{ 'sequenceDialog.unitTimes' | transloco }} }
            @else if (step.forMs != null) { {{ step.forMs }} ms }
            @else { {{ 'sequenceDialog.finalStep' | transloco }} }
          </span>

          <span class="w-28 shrink-0 truncate text-right font-mono text-[11px]" [class]="step.phase === 'current' ? 'text-sequence' : 'text-foreground/40'">
            @if (step.phase === 'current') {
              @if (step.waitingFirstRequest) { {{ 'sequenceSummary.waitingFirstRequest' | transloco }} }
              @else if (step.elapsedMs !== null) { {{ 'sequenceSummary.elapsed' | transloco: { elapsed: step.elapsedMs } }} }
              @else if (step.times !== null) { {{ 'sequenceSummary.served' | transloco: { served: step.served, total: step.times } }} }
              @else { {{ 'sequenceSummary.servedCount' | transloco: { served: step.served } }} }
            } @else { — }
          </span>
        </li>
        }
      </ol>
    </div>
  `,
})
export class MocksNextSequenceSummary {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly destroyRef = inject(DestroyRef);

  readonly detail = input.required<MockDetail>();

  protected readonly sequence = computed<SequenceVariantConfig>(() => this.detail().sequence!);
  protected readonly resetting = signal(false);

  private readonly state = signal<SequenceState | null>(null);
  /** Riletto a ogni giro di polling: è il riferimento per "quanto fa" e per le barre a tempo. */
  private readonly now = signal(Date.now());

  constructor() {
    // Cambio endpoint (stesso componente riusato): il cursore del precedente non vale più.
    // Il dettaglio ne porta già uno fresco dal GET, così la banda non parte vuota.
    effect(() => {
      const detail = this.detail();
      this.state.set(detail.sequenceState ?? null);
      this.refresh();
    });

    const pollTimer = setInterval(() => {
      this.now.set(Date.now());
      this.refresh();
    }, STATE_POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(pollTimer));
  }

  /**
   * Lo step corrente del cursore, con l'unica correzione che il motore non può fare da fermo:
   * l'auto-reset per inattività scatta ALLA RICHIESTA successiva, quindi passata la finestra lo
   * stato letto è ancora quello vecchio ma la prossima richiesta ripartirà dal primo step.
   */
  protected readonly cursor = computed(() => {
    const state = this.state();
    if (state == null) return null;

    const sequence = this.sequence();
    const stepIndex = Math.min(state.stepIndex, sequence.steps.length - 1);
    const resetAfterMs = sequence.resetAfterMs;
    const elapsedSinceRequest = state.lastRequestAt == null ? null : this.now() - state.lastRequestAt;

    const kind = state.lastRequestAt == null
      ? 'never'
      : resetAfterMs != null && elapsedSinceRequest != null && elapsedSinceRequest >= resetAfterMs
        ? 'staleReset'
        : 'running';

    return {
      kind,
      stepIndex,
      response: sequence.steps[stepIndex]?.response ?? '',
      served: state.servedInStep,
      lastRequestAgo: elapsedSinceRequest == null ? '' : formatAgo(elapsedSinceRequest),
      // Con onEnd "stay" l'ultimo step non ha criterio: una volta lì ci si resta fino a un reset.
      terminal: sequence.onEnd === 'stay' && stepIndex === sequence.steps.length - 1,
    } as const;
  });

  protected readonly stepViews = computed<readonly SequenceStepView[]>(() => {
    const sequence = this.sequence();
    const state = this.state();
    const cursor = this.cursor();
    // Cursore illeggibile o già scaduto per inattività: gli step sono solo la definizione.
    const activeIndex = state != null && cursor?.kind === 'running' ? cursor.stepIndex : -1;

    return sequence.steps.map((step, index) => {
      const times = step.times ?? null;
      const forMs = step.forMs ?? null;
      const phase = activeIndex < 0 ? 'pending' : index === activeIndex ? 'current' : index < activeIndex ? 'done' : 'pending';
      if (phase !== 'current' || state == null) {
        return { response: step.response, times, forMs, phase, progress: null, served: null, elapsedMs: null, waitingFirstRequest: false };
      }

      const waitingFirstRequest = forMs != null && state.stepStartedAt == null;
      const elapsedMs = forMs != null && state.stepStartedAt != null ? Math.max(0, this.now() - state.stepStartedAt) : null;
      const progress = elapsedMs != null && forMs != null
        ? Math.min(100, (elapsedMs / forMs) * 100)
        : times != null
          ? Math.min(100, (state.servedInStep / times) * 100)
          : null;

      return { response: step.response, times, forMs, phase, progress, served: state.servedInStep, elapsedMs, waitingFirstRequest };
    });
  });

  private refresh(): void {
    this.api.getSequenceState(this.detail().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ sequenceState }) => {
          this.now.set(Date.now());
          this.state.set(sequenceState);
        },
        // La variante selezionata può cambiare sotto i piedi (altra scheda, mutazione altrove):
        // l'errore non deve finire nel gestore globale, la banda sparisce e il giro dopo riprova.
        error: () => this.state.set(null),
      });
  }

  protected reset(): void {
    if (this.resetting()) return;
    this.resetting.set(true);
    this.api.resetSequence(this.detail().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ sequenceState }) => {
          this.resetting.set(false);
          this.now.set(Date.now());
          this.state.set(sequenceState);
          this.toast.show({ tone: 'success', title: this.transloco.translate('sequenceDialog.resetDone') });
        },
        error: () => {
          this.resetting.set(false);
          this.toast.show({ tone: 'error', title: this.transloco.translate('common.error') });
        },
      });
  }
}
