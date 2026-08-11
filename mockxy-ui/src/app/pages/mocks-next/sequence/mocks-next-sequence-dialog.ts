import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { UiToggleGroup, UiToggleItem } from '../../../ui/ui-toggle-group/ui-toggle-group';
import { UiTooltip } from '../../../ui/ui-tooltip/ui-tooltip';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { MocksStore } from '../mocks-next.store';
import type {
  MockDetail,
  ResponseSequenceCreateRequest,
  SequenceState,
  SequenceStep,
  SequenceVariantConfig,
} from '../../../mock-admin-api.types';

export interface SequenceDialogData {
  readonly detail: MockDetail;
  readonly mode: 'create' | 'edit';
}

type SequenceMode = 'times' | 'forMs';

interface DraftStep {
  readonly response: string;
  readonly mode: SequenceMode;
  readonly value: string;
}

const DEFAULT_RESET_AFTER_MS = 30000;
const DEFAULT_STEP_VALUE: Record<SequenceMode, string> = { times: '3', forMs: '15000' };
const STATE_POLL_MS = 1500;

/** Editor di una response sequence, usato sia per crearla sia per modificare quella selezionata. */
@Component({
  selector: 'mocks-next-sequence-dialog',
  imports: [NgIcon, TranslocoPipe, UiButton, UiInput, UiSelect, UiToggleGroup, UiToggleItem, UiTooltip],
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
    <div class="flex max-h-[88vh] w-[min(94vw,760px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <span class="grid h-7 w-7 place-items-center rounded-md bg-muted text-sequence ring-1 ring-border"><ng-icon name="lucideListOrdered" size="0.95rem" /></span>
        <div class="min-w-0 leading-tight">
          <h2 class="text-[15px] font-bold tracking-tight">{{ (isEdit ? 'sequenceDialog.editTitle' : 'sequenceDialog.createTitle') | transloco }}</h2>
          <p class="truncate font-mono text-[11px] text-muted-foreground">{{ data.detail.method }} {{ data.detail.path }}</p>
        </div>
        <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="close()" [attr.aria-label]="'sequenceDialog.cancel' | transloco"><ng-icon name="lucideX" size="0.95rem" /></button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 mx-scroll">
        @if (!hasEnoughVariants) {
        <p class="rounded-lg border border-input bg-black/20 px-3.5 py-3 text-[12.5px] text-muted-foreground">{{ 'sequenceDialog.needVariants' | transloco }}</p>
        }

        <div class="flex flex-col gap-1.5">
          <label for="sequence-title" class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.responseTitle' | transloco }}</label>
          <input id="sequence-title" ui-input type="text" [value]="title()" (input)="title.set($any($event.target).value)" [placeholder]="'sequenceDialog.responseTitlePlaceholder' | transloco" />
        </div>

        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div class="flex items-center gap-2">
            <span class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.onEnd' | transloco }}</span>
            <ui-toggle-group [value]="onEnd()" [ariaLabel]="'sequenceDialog.onEnd' | transloco" (valueChange)="setOnEnd($any($event))">
              <button ui-toggle-item value="stay">{{ 'sequenceDialog.onEndStay' | transloco }}</button>
              <button ui-toggle-item value="loop">{{ 'sequenceDialog.onEndLoop' | transloco }}</button>
            </ui-toggle-group>
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="sequence-reset" class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.autoReset' | transloco }}</label>
          <div class="flex items-center gap-2">
            <input
              id="sequence-reset"
              ui-input
              type="number"
              min="1"
              class="w-32 font-mono text-[13px]"
              [placeholder]="'sequenceDialog.autoResetNever' | transloco"
              [value]="resetAfterMs()"
              (input)="resetAfterMs.set($any($event.target).value)"
            />
            <span class="text-[12px] text-muted-foreground">ms</span>
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'sequenceDialog.autoResetHint' | transloco }}</span>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'sequenceDialog.steps' | transloco }}</span>
          @for (step of steps(); track $index) {
          <div class="flex flex-wrap items-center gap-2 rounded-md px-1 py-1" [class.mx-selected]="$index === currentStepIndex()">
            <span class="w-5 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{{ $index + 1 }}</span>
            <ui-select
              class="min-w-52 flex-1"
              [options]="variantOptions"
              [value]="step.response"
              [ariaLabel]="'sequenceDialog.stepResponse' | transloco: { step: $index + 1 }"
              (valueChange)="setStepResponse($index, $any($event))"
            />
            @if (isTerminalStep($index)) {
            <span class="w-64 shrink-0 text-center text-[12px] italic text-muted-foreground">{{ 'sequenceDialog.finalStep' | transloco }}</span>
            } @else {
            <ui-toggle-group [value]="step.mode" [ariaLabel]="'sequenceDialog.stepCriterion' | transloco: { step: $index + 1 }" (valueChange)="setStepMode($index, $any($event))">
              <button ui-toggle-item value="times">{{ 'sequenceDialog.modeTimes' | transloco }}</button>
              <button ui-toggle-item value="forMs">{{ 'sequenceDialog.modeForMs' | transloco }}</button>
            </ui-toggle-group>
            <input
              ui-input
              type="number"
              min="1"
              class="w-24 shrink-0 font-mono text-[13px]"
              [attr.aria-label]="(step.mode === 'times' ? 'sequenceDialog.unitTimes' : 'sequenceDialog.unitForMs') | transloco"
              [value]="step.value"
              (input)="setStepValue($index, $any($event.target).value)"
            />
            <span class="w-10 shrink-0 text-[11px] text-muted-foreground">{{ (step.mode === 'times' ? 'sequenceDialog.unitTimes' : 'sequenceDialog.unitForMs') | transloco }}</span>
            }
            <button ui-button variant="ghost" size="icon" [disabled]="$index === 0" (click)="moveStep($index, -1)" [attr.aria-label]="'sequenceDialog.moveUp' | transloco" [uiTooltip]="'sequenceDialog.moveUp' | transloco"><ng-icon name="lucideArrowUp" size="0.85rem" /></button>
            <button ui-button variant="ghost" size="icon" [disabled]="$index === steps().length - 1" (click)="moveStep($index, 1)" [attr.aria-label]="'sequenceDialog.moveDown' | transloco" [uiTooltip]="'sequenceDialog.moveDown' | transloco"><ng-icon name="lucideArrowDown" size="0.85rem" /></button>
            <button ui-button variant="ghost" size="icon" [disabled]="steps().length <= 2" (click)="removeStep($index)" [attr.aria-label]="'sequenceDialog.removeStep' | transloco" [uiTooltip]="'sequenceDialog.removeStep' | transloco"><ng-icon name="lucideTrash2" size="0.85rem" /></button>
          </div>
          }
          <div>
            <button ui-button variant="outline" size="sm" [disabled]="!hasEnoughVariants" (click)="addStep()">
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

        @if (isEdit) {
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject<DialogRef<string>>(DialogRef);
  protected readonly data = inject<SequenceDialogData>(DIALOG_DATA);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly isEdit = this.data.mode === 'edit';
  protected readonly originalSequence: SequenceVariantConfig | null = this.isEdit
    ? this.data.detail.sequence ?? null
    : null;
  private readonly originalTitle = this.isEdit
    ? this.data.detail.responses?.find((response) => response.fileName === this.data.detail.selectedResponseFile)?.title ?? ''
    : '';

  protected readonly variantOptions: readonly UiSelectOption<string>[] = (this.data.detail.responses ?? [])
    .filter((response) => !response.missing && (response.type === 'mock' || response.type === 'handler'))
    .map((response) => ({
      value: response.fileName,
      label: response.title ? `${response.title} — ${response.fileName}` : response.fileName,
    }));

  protected readonly hasEnoughVariants = this.variantOptions.length >= 2;
  protected readonly title = signal(this.originalTitle);
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

  constructor() {
    if (this.isEdit) {
      this.refreshState();
      const pollTimer = setInterval(() => this.refreshState(), STATE_POLL_MS);
      this.destroyRef.onDestroy(() => clearInterval(pollTimer));
    }
  }

  protected isTerminalStep(index: number): boolean {
    return this.onEnd() === 'stay' && index === this.steps().length - 1;
  }

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
        mode: step.forMs != null ? 'forMs' : 'times',
        value: step.times != null ? String(step.times) : step.forMs != null ? String(step.forMs) : '',
      }));
    }
    return this.variantOptions.slice(0, 2).map((option, index) => ({
      response: option.value,
      mode: 'times',
      value: index === 0 ? DEFAULT_STEP_VALUE.times : '',
    }));
  }

  protected setOnEnd(onEnd: 'stay' | 'loop' | null): void {
    if (onEnd == null) return;
    this.onEnd.set(onEnd);
    if (onEnd === 'loop') {
      this.steps.update((steps) =>
        steps.map((step) => step.value === '' ? { ...step, value: DEFAULT_STEP_VALUE[step.mode] } : step),
      );
    }
  }

  protected setStepResponse(index: number, response: string | null): void {
    if (response == null) return;
    this.steps.update((steps) => steps.map((step, i) => i === index ? { ...step, response } : step));
  }

  protected setStepMode(index: number, mode: SequenceMode | null): void {
    if (mode == null) return;
    this.steps.update((steps) => steps.map((step, i) =>
      i === index ? { ...step, mode, value: DEFAULT_STEP_VALUE[mode] } : step,
    ));
  }

  protected setStepValue(index: number, value: string): void {
    this.steps.update((steps) => steps.map((step, i) => i === index ? { ...step, value } : step));
  }

  protected addStep(): void {
    const fallback = this.variantOptions[0]?.value ?? '';
    this.steps.update((steps) => {
      const next = steps.map((step, index) =>
        index === steps.length - 1 && step.value === ''
          ? { ...step, value: DEFAULT_STEP_VALUE[step.mode] }
          : step,
      );
      return [...next, { response: fallback, mode: 'times' as const, value: this.onEnd() === 'loop' ? DEFAULT_STEP_VALUE.times : '' }];
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

  protected readonly validationError = computed<string | null>(() => {
    if (!this.hasEnoughVariants) return 'sequenceDialog.errMinVariants';
    const steps = this.steps();
    if (steps.length < 2) return 'sequenceDialog.errMinSteps';
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (step.response === '') return 'sequenceDialog.errStepResponse';
      if (this.isTerminalStep(index)) continue;
      const value = Number(step.value);
      if (step.value.trim() === '' || !Number.isInteger(value) || value < 1) {
        return 'sequenceDialog.errStepValue';
      }
    }
    const reset = this.resetAfterMs().trim();
    if (reset !== '' && (!Number.isInteger(Number(reset)) || Number(reset) < 1)) {
      return 'sequenceDialog.errAutoReset';
    }
    return null;
  });

  private buildSequence(): ResponseSequenceCreateRequest {
    const reset = this.resetAfterMs().trim();
    return {
      type: 'sequence',
      title: this.title().trim(),
      steps: this.steps().map((step, index) => {
        const built: SequenceStep = { response: step.response };
        if (!this.isTerminalStep(index)) {
          built[step.mode] = Number(step.value);
        }
        return built;
      }),
      onEnd: this.onEnd(),
      resetAfterMs: reset === '' ? null : Number(reset),
    };
  }

  private readonly changed = computed(() => {
    const built = this.buildSequence();
    if (this.originalSequence == null) return true;
    return JSON.stringify(built) !== JSON.stringify({
      type: 'sequence',
      title: this.originalTitle,
      ...this.originalSequence,
    });
  });

  protected readonly canSave = computed(() =>
    this.store.savingId() == null && this.validationError() == null && this.changed(),
  );

  protected save(): void {
    if (!this.canSave()) return;
    const sequence = this.buildSequence();
    const onSuccess = () => {
      this.toast.show({ tone: 'success', title: this.transloco.translate('sequenceDialog.savedTitle') });
      this.dialogRef.close('saved');
    };
    if (this.isEdit) {
      this.store.updateSequence(sequence, onSuccess);
    } else {
      this.store.createSequence(sequence, onSuccess);
    }
  }

  private refreshState(): void {
    this.api.getSequenceState(this.data.detail.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: ({ sequenceState }) => this.sequenceState.set(sequenceState) });
  }

  protected resetSequence(): void {
    if (this.resetting()) return;
    this.resetting.set(true);
    this.api.resetSequence(this.data.detail.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
