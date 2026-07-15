import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideSlidersHorizontal, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '../ui/ui-button/ui-button';
import { UiSwitch } from '../ui/ui-switch/ui-switch';
import { DesktopService, type AppPreferences, type AppPreferencesPatch } from './desktop.service';
import { ToastService } from '../ui/ui-toast/ui-toast';

/**
 * Dialog "Preferenze dell'app" (app desktop): le preferenze GLOBALI dell'applicazione, distinte
 * dalle impostazioni del workspace attivo (WorkspaceSettingsDialog). Oggi contiene solo il toggle
 * del log degli errori su disco (cartella logs/ accanto all'eseguibile); le modifiche si applicano
 * subito, senza riavvio né ricaricamento della finestra.
 */
@Component({
  selector: 'app-preferences-dialog',
  imports: [NgIcon, UiButton, UiSwitch, TranslocoPipe],
  providers: [provideIcons({ lucideCheck, lucideSlidersHorizontal, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex w-[min(70vw,560px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <span class="grid h-7 w-7 place-items-center rounded-md bg-muted text-brand ring-1 ring-border"><ng-icon name="lucideSlidersHorizontal" size="0.95rem" /></span>
        <div class="min-w-0 leading-tight">
          <h2 class="text-[15px] font-bold tracking-tight">{{ 'appPreferences.title' | transloco }}</h2>
          <p class="text-[11px] text-muted-foreground">{{ 'appPreferences.subtitle' | transloco }}</p>
        </div>
        <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="close()"><ng-icon name="lucideX" size="0.95rem" /></button>
      </div>

      <div class="flex max-h-[68vh] flex-col gap-4 overflow-y-auto px-5 py-4">
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-3">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'appPreferences.errorLog' | transloco }}</label>
            <ui-switch [checked]="errorLogEnabled()" (checkedChange)="errorLogEnabled.set($event)" size="sm" [ariaLabel]="'appPreferences.errorLog' | transloco" />
          </div>
          <span class="text-[11.5px] text-muted-foreground">{{ 'appPreferences.errorLogHint' | transloco }}</span>
          @if (errorLogEnabled() && data.logsDir) {
          <span class="break-all font-mono text-[11px] text-muted-foreground" [title]="data.logsDir">{{ 'appPreferences.logsDir' | transloco }}: {{ data.logsDir }}</span>
          }
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button ui-button variant="outline" (click)="close()">{{ 'appPreferences.cancel' | transloco }}</button>
        <button ui-button (click)="save()" [disabled]="!canSave() || saving()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ saving() ? ('appPreferences.saving' | transloco) : ('appPreferences.save' | transloco) }}</button>
      </div>
    </div>
  `,
})
export class AppPreferencesDialog {
  private readonly dialogRef = inject<DialogRef<string>>(DialogRef);
  protected readonly data = inject<AppPreferences>(DIALOG_DATA);
  private readonly desktop = inject(DesktopService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly saving = signal(false);
  protected readonly errorLogEnabled = signal(this.data.errorLogEnabled);

  private readonly errorLogChanged = computed(() => this.errorLogEnabled() !== this.data.errorLogEnabled);
  protected readonly canSave = computed(() => this.errorLogChanged());

  protected async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    const patch: AppPreferencesPatch = {};
    if (this.errorLogChanged()) patch.errorLogEnabled = this.errorLogEnabled();

    this.saving.set(true);
    const result = await this.desktop.updateAppPreferences(patch);
    this.saving.set(false);
    if (result == null) {
      this.toast.show({ tone: 'error', title: this.transloco.translate('common.error'), description: this.transloco.translate('common.operationFailed') });
      return;
    }
    this.toast.show({ tone: 'success', title: this.transloco.translate('appPreferences.savedTitle') });
    this.dialogRef.close('saved');
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
