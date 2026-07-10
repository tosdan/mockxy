import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCopy, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiCheckbox } from '../../../ui/ui-checkbox/ui-checkbox';
import { UiInput } from '../../../ui/ui-input/ui-input';
import { UiSelect, type UiSelectOption } from '../../../ui/ui-select/ui-select';
import { MocksStore } from '../mocks-next.store';
import { routePathError } from '../../../mock-path-convention';
import { MOCK_METHODS } from '../../../mock-admin-ui.constants';

export interface CopyDialogData {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly responseCount: number;
}

const METHOD_OPTIONS: readonly UiSelectOption<string>[] = MOCK_METHODS.map((m) => ({ value: m, label: m }));

/**
 * Dialog "Copia": duplica l'endpoint selezionato verso un nuovo metodo+path (entrambi
 * precompilati e modificabili). Il flag "copia tutte le response" è spento di default:
 * spento → copia solo la response selezionata; acceso → copia tutte. Il backend rifiuta
 * (409) un metodo+path già esistente; l'errore è mostrato inline (oltre che come toast).
 */
@Component({
  selector: 'mocks-next-copy-dialog',
  imports: [NgIcon, TranslocoPipe, UiButton, UiCheckbox, UiInput, UiSelect],
  providers: [provideIcons({ lucideCheck, lucideCopy, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex max-h-[85vh] w-[min(92vw,560px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <span class="grid h-7 w-7 place-items-center rounded-md bg-muted text-brand ring-1 ring-border"><ng-icon name="lucideCopy" size="0.95rem" /></span>
        <div class="leading-tight">
          <h2 class="text-[15px] font-bold tracking-tight">{{ 'copyDialog.title' | transloco }}</h2>
          <p class="font-mono text-[11px] text-muted-foreground">{{ 'copyDialog.from' | transloco: { method: data.method, path: data.path } }}</p>
        </div>
        <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="close()" [disabled]="store.creating()"><ng-icon name="lucideX" size="0.95rem" /></button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto mx-scroll px-5 py-4">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'copyDialog.method' | transloco }}</label>
            <ui-select class="w-36" [options]="methodOptions" [value]="method()" (valueChange)="method.set($any($event))" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'copyDialog.path' | transloco }}</label>
            <input ui-input type="text" class="w-full font-mono text-[13px]" [placeholder]="'copyDialog.pathPlaceholder' | transloco" [value]="path()" (input)="path.set($any($event.target).value)" />
            @if (pathError()) {
            <span class="text-[11.5px] text-destructive-soft">{{ (pathError() ?? '') | transloco }}</span>
            }
          </div>
        </div>

        <div class="flex items-start gap-2.5 rounded-lg border border-input bg-black/20 px-3.5 py-3">
          <ui-checkbox class="mt-0.5" [(checked)]="copyResponses" [ariaLabel]="copyAllAriaLabel" />
          <button type="button" class="min-w-0 text-left" (click)="copyResponses.set(!copyResponses())">
            <span class="block text-[13px] font-medium text-foreground">{{ 'copyDialog.copyAllResponses' | transloco: { count: data.responseCount } }}</span>
            <span class="block text-[11.5px] text-muted-foreground">{{ 'copyDialog.copyAllResponsesHint' | transloco }}</span>
          </button>
        </div>

        @if (store.error()) {
        <p class="text-[12.5px] text-destructive-soft">{{ store.error() }}</p>
        }
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button ui-button variant="outline" (click)="close()" [disabled]="store.creating()">{{ 'copyDialog.cancel' | transloco }}</button>
        <button ui-button (click)="copy()" [disabled]="!canCopy()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ 'copyDialog.copy' | transloco }}</button>
      </div>
    </div>
  `,
})
export class MocksNextCopyDialog {
  protected readonly store = inject(MocksStore);
  private readonly dialogRef = inject<DialogRef<string>>(DialogRef);
  protected readonly data = inject<CopyDialogData>(DIALOG_DATA);
  private readonly transloco = inject(TranslocoService);

  protected readonly methodOptions = METHOD_OPTIONS;

  protected readonly method = signal(this.data.method);
  protected readonly path = signal(this.data.path);
  /** Flag "copia tutte le response": spento di default (copia solo la selezionata). */
  protected readonly copyResponses = signal(false);

  /** aria-label tradotta della checkbox "copia tutte le response". */
  protected get copyAllAriaLabel(): string {
    return this.transloco.translate('copyDialog.copyAllResponsesAria');
  }

  /** Chiave i18n dell'errore path (o null se valido), dalla validazione condivisa; tradotta nel template. */
  protected readonly pathError = computed(() => routePathError(this.path()));
  protected readonly canCopy = computed(() => !this.store.creating() && this.path().trim() !== '' && this.pathError() === null);

  protected copy(): void {
    if (!this.canCopy()) return;
    this.store.copyEndpoint(
      this.data.id,
      { method: this.method(), path: this.path().trim(), copyResponses: this.copyResponses() },
      (ok) => {
        if (ok) this.dialogRef.close('copied');
      },
    );
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
