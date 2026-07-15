import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowDown,
  lucideArrowUp,
  lucideCheck,
  lucideListOrdered,
  lucidePlus,
  lucideRotateCcw,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiInput } from '../../../ui/ui-input/ui-input';
import { UiSelect, type UiSelectOption } from '../../../ui/ui-select/ui-select';
import { UiSwitch } from '../../../ui/ui-switch/ui-switch';
import { UiToggleGroup, UiToggleItem } from '../../../ui/ui-toggle-group/ui-toggle-group';
import { UiTooltip } from '../../../ui/ui-tooltip/ui-tooltip';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { MocksStore } from '../mocks-next.store';
import type { MockDetail, SequenceConfig, SequenceState, SequenceStep } from '../../../mock-admin-api.types';

export interface SequenceDialogData {
  readonly detail: MockDetail;
}

/** Bozza di uno step: variante + valore del criterio come stringa (input numerico). */
interface DraftStep {
  response: string;
  value: string;
}

type SequenceMode = 'times' | 'forMs';

/** Default proposto per l'auto-reset alla prima attivazione (vedi DESIGN-SEQUENZE.md). */
const DEFAULT_RESET_AFTER_MS = 30000;
/** Default proposto per il criterio del primo step di una sequenza nuova. */
const DEFAULT_STEP_VALUE: Record<SequenceMode, string> = { times: '3', forMs: '15000' };

/**
 * Dialog "Sequenza": definisce la sequenza di varianti dell'endpoint (vedi
 * docs/progetto/DESIGN-SEQUENZE.md). In testata i controlli di comportamento (attiva,
 * modalità times/forMs unica per tutta la sequenza, esito finale, auto-reset); al centro gli
 * step ordinabili (variante + valore del criterio); in fondo — separata perché è un'azione
 * runtime immediata, non parte del Salva — la sezione stato col cursore e il reset.
 */
@Component({
  selector: 'mocks-next-sequence-dialog',
  imports: [NgIcon, TranslocoPipe, UiButton, UiInput, UiSelect, UiSwitch, UiToggleGroup, UiToggleItem, UiTooltip],
  providers: [
    provideIcons({
      lucideArrowDown,
      lucideArrowUp,
      lucideCheck,
      lucideListOrdered,
      lucidePlus,
      lucideRotateCcw,
      lucideTrash2,
      lucideX,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex max-h-[85vh] w-[min(92vw,640px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <span class="grid h-7 w-7 place-items-center rounded-md bg-muted text-brand ring-1 ring-border"><ng-icon name="lucideListOrdered" size="0.95rem" /></span>
        <div class="min-w-0 leading-tight">
          <h2 class="text-[15px] font-bold tracking-tight">{{ 'sequenceDialog.title' | transloco }}</h2>
          <p class="truncate font-mono text-[11px] text-muted-foreground">{{ data.detail.method }} {{ data.detail.path }}</p>
        </div>
        <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="close()"><ng-icon name="lucideX" size="0.95rem" /></button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto mx-scroll px-5 py-4">
        @if (!hasEnoughVariants) {
        <p class="rounded-lg border border-input bg-black/20 px-3.5 py-3 text-[12.5px] text-muted-foreground">{{ 'sequenceDialog.needVariants' | transloco }}</p>
        }

        <!-- Comportamento della sequenza -->
        <div class="flex items-center justify-between gap-3">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.enabled' | transloco }}</label>
          <ui-switch [checked]="enabled()" [disabled]="!hasEnoughVariants" (checkedChange)="enabled.set($event)" size="sm" [ariaLabel]="'sequenceDialog.enabled' | transloco" />
        </div>

        <div class="flex flex-wrap items-center gap-x-6 gap-y-3" [class.opacity-50]="!editingEnabled()">
          <div class="flex items-center gap-2">
            <span class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.mode' | transloco }}</span>
            <ui-toggle-group [value]="mode()" (valueChange)="setMode($any($event))">
              <button ui-toggle-item value="times" [disabled]="!editingEnabled()">{{ 'sequenceDialog.modeTimes' | transloco }}</button>
              <button ui-toggle-item value="forMs" [disabled]="!editingEnabled()">{{ 'sequenceDialog.modeForMs' | transloco }}</button>
            </ui-toggle-group>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.onEnd' | transloco }}</span>
            <ui-toggle-group [value]="onEnd()" (valueChange)="onEnd.set($any($event))">
              <button ui-toggle-item value="stay" [disabled]="!editingEnabled()">{{ 'sequenceDialog.onEndStay' | transloco }}</button>
              <button ui-toggle-item value="loop" [disabled]="!editingEnabled()">{{ 'sequenceDialog.onEndLoop' | transloco }}</button>
            </ui-toggle-group>
          </div>
        </div>

        <div class="flex flex-col gap-1.5" [class.opacity-50]="!editingEnabled()">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.autoReset' | transloco }}</label>
          <div class="flex items-center gap-2">
            <input
              ui-input
              type="number"
              min="1"
              class="w-32 font-mono text-[13px]"
              [placeholder]="'sequenceDialog.autoResetNever' | transloco"
              [value]="resetAfterMs()"
              [disabled]="!editingEnabled()"
              (input)="resetAfterMs.set($any($event.target).value)"
            />
            <span class="text-[12px] text-muted-foreground">ms</span>
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'sequenceDialog.autoResetHint' | transloco }}</span>
        </div>

        <!-- Step -->
        <div class="flex flex-col gap-2" [class.opacity-50]="!editingEnabled()">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.steps' | transloco }}</label>
          @for (step of steps(); track $index) {
          <div class="flex items-center gap-2" [class.mx-selected]="$index === currentStepIndex()">
            <span class="w-5 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{{ $index + 1 }}</span>
            <ui-select
              class="min-w-0 flex-1"
              [options]="variantOptions"
              [value]="step.response"
              [disabled]="!editingEnabled()"
              (valueChange)="setStepResponse($index, $any($event))"
            />
            @if (isTerminalStep($index)) {
            <span class="w-28 shrink-0 text-center text-[12px] italic text-muted-foreground">{{ 'sequenceDialog.finalStep' | transloco }}</span>
            } @else {
            <input
              ui-input
              type="number"
              min="1"
              class="w-28 shrink-0 font-mono text-[13px]"
              [value]="step.value"
              [disabled]="!editingEnabled()"
              (input)="setStepValue($index, $any($event.target).value)"
            />
            }
            <span class="w-12 shrink-0 text-[11px] text-muted-foreground">{{ (mode() === 'times' ? 'sequenceDialog.unitTimes' : 'sequenceDialog.unitForMs') | transloco }}</span>
            <button ui-button variant="ghost" size="icon" [disabled]="!editingEnabled() || $index === 0" (click)="moveStep($index, -1)" [uiTooltip]="'sequenceDialog.moveUp' | transloco"><ng-icon name="lucideArrowUp" size="0.85rem" /></button>
            <button ui-button variant="ghost" size="icon" [disabled]="!editingEnabled() || $index === steps().length - 1" (click)="moveStep($index, 1)" [uiTooltip]="'sequenceDialog.moveDown' | transloco"><ng-icon name="lucideArrowDown" size="0.85rem" /></button>
            <button ui-button variant="ghost" size="icon" [disabled]="!editingEnabled() || steps().length <= 2" (click)="removeStep($index)" [uiTooltip]="'sequenceDialog.removeStep' | transloco"><ng-icon name="lucideTrash2" size="0.85rem" /></button>
          </div>
          }
          <div>
            <button ui-button variant="outline" size="sm" [disabled]="!editingEnabled()" (click)="addStep()">
              <ng-icon name="lucidePlus" size="0.85rem" /> {{ 'sequenceDialog.addStep' | transloco }}
            </button>
          </div>
        </div>

        @if (validationError()) {
        <p class="text-[12.5px] text-destructive-soft">{{ validationError()! | transloco }}</p>
        }
        @if (store.error()) {
        <p class="text-[12.5px] text-destructive-soft">{{ store.error() }}</p>
        }

        <!-- Stato runtime: azione immediata, separata dai controlli di definizione (Salva) -->
        @if (originalSequence != null) {
        <div class="flex items-center justify-between gap-3 rounded-lg border border-input bg-black/20 px-3.5 py-2.5">
          <span class="text-[12.5px] text-muted-foreground">
            {{ 'sequenceDialog.stateLine' | transloco: { step: stateStepLabel(), served: sequenceState()?.servedInStep ?? 0 } }}
          </span>
          <button ui-button variant="outline" size="sm" [disabled]="resetting()" (click)="resetSequence()">
            <ng-icon name="lucideRotateCcw" size="0.85rem" /> {{ 'sequenceDialog.reset' | transloco }}
          </button>
        </div>
        }
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button ui-button variant="outline" (click)="close()">{{ 'sequenceDialog.cancel' | transloco }}</button>
        <button ui-button [disabled]="!canSave()" (click)="save()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ 'sequenceDialog.save' | transloco }}</button>
      </div>
    </div>
  `,
})
export class MocksNextSequenceDialog {
  protected readonly store = inject(MocksStore);
  private readonly api = inject(MockAdminApiService);
  private readonly dialogRef = inject<DialogRef<string>>(DialogRef);
  protected readonly data = inject<SequenceDialogData>(DIALOG_DATA);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** Sequenza esistente (normalizzata dal server), o null se l'endpoint non ne ha una. */
  protected readonly originalSequence: SequenceConfig | null = this.data.detail.endpoint?.sequence ?? null;

  /** Varianti eleggibili come step: mock e handler (i middleware vivono nel percorso proxy). */
  protected readonly variantOptions: readonly UiSelectOption<string>[] = (this.data.detail.responses ?? [])
    .filter((response) => !response.missing && response.type !== 'middleware')
    .map((response) => ({
      value: response.fileName,
      label: response.title ? `${response.title} — ${response.fileName}` : response.fileName,
    }));

  /** Una sequenza richiede almeno due varianti eleggibili; sotto, tutto disabilitato con hint. */
  protected readonly hasEnoughVariants = this.variantOptions.length >= 2;

  protected readonly enabled = signal(this.originalSequence?.enabled ?? this.hasEnoughVariants);
  protected readonly mode = signal<SequenceMode>(
    this.originalSequence?.steps.some((step) => step.forMs != null) ? 'forMs' : 'times',
  );
  protected readonly onEnd = signal<'stay' | 'loop'>(this.originalSequence?.onEnd ?? 'stay');
  protected readonly resetAfterMs = signal(
    this.originalSequence != null
      ? this.originalSequence.resetAfterMs != null
        ? String(this.originalSequence.resetAfterMs)
        : ''
      : String(DEFAULT_RESET_AFTER_MS),
  );
  protected readonly steps = signal<readonly DraftStep[]>(this.buildInitialSteps());
  protected readonly sequenceState = signal<SequenceState | null>(this.data.detail.sequenceState ?? null);
  protected readonly resetting = signal(false);

  /** I controlli di definizione si modificano solo con la sequenza attiva (e varianti sufficienti). */
  protected readonly editingEnabled = computed(() => this.hasEnoughVariants && this.enabled());

  /** L'ultimo step è terminale (nessun criterio) quando la sequenza si ferma lì. */
  protected isTerminalStep(index: number): boolean {
    return this.onEnd() === 'stay' && index === this.steps().length - 1;
  }

  /** Indice dello step corrente del cursore, evidenziato nell'elenco (solo a definizione invariata). */
  protected readonly currentStepIndex = computed(() => {
    const state = this.sequenceState();
    return state != null && !this.changed() ? state.stepIndex : -1;
  });

  protected stateStepLabel(): string {
    const state = this.sequenceState();
    return state == null ? '-' : `${state.stepIndex + 1}/${this.steps().length}`;
  }

  private buildInitialSteps(): DraftStep[] {
    if (this.originalSequence != null) {
      return this.originalSequence.steps.map((step) => ({
        response: step.response,
        value: step.times != null ? String(step.times) : step.forMs != null ? String(step.forMs) : '',
      }));
    }
    // Sequenza nuova: primi due varianti eleggibili, criterio proposto sul primo step.
    return this.variantOptions.slice(0, 2).map((option, index) => ({
      response: option.value,
      value: index === 0 ? DEFAULT_STEP_VALUE[this.mode()] : '',
    }));
  }

  protected setMode(mode: SequenceMode | null): void {
    if (mode == null || mode === this.mode()) return;
    this.mode.set(mode);
    // Cambio di unità: i valori inseriti non sono convertibili (3 volte ≠ 3 ms), si ripropone il default.
    this.steps.update((steps) =>
      steps.map((step) => ({ ...step, value: step.value === '' ? '' : DEFAULT_STEP_VALUE[mode] })),
    );
  }

  protected setStepResponse(index: number, response: string | null): void {
    if (response == null) return;
    this.steps.update((steps) => steps.map((step, i) => (i === index ? { ...step, response } : step)));
  }

  protected setStepValue(index: number, value: string): void {
    this.steps.update((steps) => steps.map((step, i) => (i === index ? { ...step, value } : step)));
  }

  protected addStep(): void {
    const fallback = this.variantOptions[0]?.value ?? '';
    this.steps.update((steps) => {
      // Il nuovo step entra in coda: il precedente ultimo (che poteva essere terminale senza
      // valore) riceve il default del criterio, il nuovo diventa il terminale.
      const next = steps.map((step, i) =>
        i === steps.length - 1 && step.value === '' ? { ...step, value: DEFAULT_STEP_VALUE[this.mode()] } : step,
      );
      return [...next, { response: fallback, value: '' }];
    });
  }

  protected removeStep(index: number): void {
    this.steps.update((steps) => steps.filter((_, i) => i !== index));
  }

  protected moveStep(index: number, delta: -1 | 1): void {
    this.steps.update((steps) => {
      const target = index + delta;
      if (target < 0 || target >= steps.length) return steps;
      const next = [...steps];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  /** Prima violazione di validazione (chiave i18n), o null se la bozza è salvabile. */
  protected readonly validationError = computed<string | null>(() => {
    if (!this.editingEnabled()) return null;
    const steps = this.steps();
    if (steps.length < 2) return 'sequenceDialog.errMinSteps';
    for (let i = 0; i < steps.length; i += 1) {
      if (steps[i].response === '') return 'sequenceDialog.errStepResponse';
      const isTerminal = this.isTerminalStep(i);
      if (isTerminal) continue;
      const value = Number(steps[i].value);
      if (steps[i].value.trim() === '' || !Number.isInteger(value) || value < 1) {
        return 'sequenceDialog.errStepValue';
      }
    }
    const reset = this.resetAfterMs().trim();
    if (reset !== '' && (!Number.isInteger(Number(reset)) || Number(reset) < 1)) {
      return 'sequenceDialog.errAutoReset';
    }
    return null;
  });

  /** La definizione costruita dalla bozza; null quando non c'è nulla da salvare. */
  private buildSequence(): SequenceConfig | null {
    if (!this.enabled() && this.originalSequence == null) return null;
    const reset = this.resetAfterMs().trim();
    return {
      enabled: this.enabled(),
      steps: this.steps().map((step, index) => {
        const built: SequenceStep = { response: step.response };
        if (!this.isTerminalStep(index)) {
          built[this.mode() === 'times' ? 'times' : 'forMs'] = Number(step.value);
        }
        return built;
      }),
      onEnd: this.onEnd(),
      resetAfterMs: reset === '' ? null : Number(reset),
    };
  }

  private readonly changed = computed(() => {
    // Le signal lette qui (enabled/steps/onEnd/resetAfterMs/mode) rendono il computed reattivo.
    const built =
      this.enabled() || this.originalSequence != null
        ? {
            enabled: this.enabled(),
            steps: this.steps().map((step, index) => ({
              response: step.response,
              value: this.isTerminalStep(index) ? null : step.value.trim(),
            })),
            onEnd: this.onEnd(),
            mode: this.mode(),
            resetAfterMs: this.resetAfterMs().trim(),
          }
        : null;
    const original =
      this.originalSequence != null
        ? {
            enabled: this.originalSequence.enabled,
            steps: this.originalSequence.steps.map((step, index) => ({
              response: step.response,
              value:
                this.originalSequence!.onEnd === 'stay' && index === this.originalSequence!.steps.length - 1
                  ? null
                  : String(step.times ?? step.forMs ?? ''),
            })),
            onEnd: this.originalSequence.onEnd,
            mode: this.originalSequence.steps.some((step) => step.forMs != null) ? 'forMs' : 'times',
            resetAfterMs: this.originalSequence.resetAfterMs != null ? String(this.originalSequence.resetAfterMs) : '',
          }
        : null;
    return JSON.stringify(built) !== JSON.stringify(original);
  });

  protected readonly canSave = computed(
    () =>
      this.hasEnoughVariants &&
      this.store.savingId() == null &&
      this.validationError() == null &&
      this.changed() &&
      (this.enabled() || this.originalSequence != null),
  );

  protected save(): void {
    if (!this.canSave()) return;
    const sequence = this.buildSequence();
    if (sequence == null) return;
    this.store.updateSequence(sequence, () => {
      this.toast.show({ tone: 'success', title: this.transloco.translate('sequenceDialog.savedTitle') });
      this.dialogRef.close('saved');
    });
  }

  /** Azione runtime immediata: il cursore riparte dal primo step (nessun Salva necessario). */
  protected resetSequence(): void {
    if (this.resetting()) return;
    this.resetting.set(true);
    this.api.resetSequence(this.data.detail.id).subscribe({
      next: ({ sequenceState }) => {
        this.resetting.set(false);
        this.sequenceState.set(sequenceState);
        this.toast.show({ tone: 'success', title: this.transloco.translate('sequenceDialog.resetDone') });
      },
      error: () => {
        this.resetting.set(false);
        this.toast.show({ tone: 'error', title: this.transloco.translate('common.error') });
      },
    });
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
