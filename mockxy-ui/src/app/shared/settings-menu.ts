import { ChangeDetectionStrategy, Component, ViewContainerRef, inject } from '@angular/core';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCog, lucideSlidersHorizontal } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiMenu, UiMenuItem } from '../ui/ui-menu/ui-menu';
import { UiDialog } from '../ui/ui-dialog/ui-dialog';
import { DesktopService } from './desktop.service';
import { WorkspaceSettingsDialog } from './workspace-settings-dialog';
import { AppPreferencesDialog } from './app-preferences-dialog';

/**
 * Ingranaggio delle impostazioni (solo app desktop): impostazioni del workspace attivo (es. porta)
 * e preferenze globali dell'app (es. log errori). Vive in fondo al rail delle view, insieme alla
 * lingua: sono i controlli che non appartengono a nessuna view in particolare.
 */
@Component({
  selector: 'app-settings-menu',
  imports: [CdkMenuTrigger, NgIcon, TranslocoPipe, UiMenu, UiMenuItem],
  providers: [provideIcons({ lucideCog, lucideSlidersHorizontal })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="flex w-13 flex-col items-center gap-1 rounded-lg py-2 text-[9px] font-bold tracking-wide text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      [cdkMenuTriggerFor]="settingsMenu"
      [attr.aria-label]="'settingsMenu.tip' | transloco"
    >
      <ng-icon name="lucideCog" size="1.1rem" />
      {{ 'settingsMenu.label' | transloco }}
    </button>

    <ng-template #settingsMenu>
      <div ui-menu class="min-w-[14rem]">
        <button ui-menu-item (click)="openSettings()">
          <ng-icon name="lucideCog" size="0.85rem" class="text-muted-foreground" />
          <span>{{ 'workspaceControls.settings' | transloco }}</span>
        </button>
        <button ui-menu-item (click)="openPreferences()">
          <ng-icon name="lucideSlidersHorizontal" size="0.85rem" class="text-muted-foreground" />
          <span>{{ 'workspaceControls.appPreferences' | transloco }}</span>
        </button>
      </div>
    </ng-template>
  `,
})
export class SettingsMenu {
  private readonly desktop = inject(DesktopService);
  private readonly dialog = inject(UiDialog);
  private readonly vcr = inject(ViewContainerRef);

  /** Apre le impostazioni del workspace attivo (porta, ...). */
  protected async openSettings(): Promise<void> {
    const ws = await this.desktop.getWorkspace();
    if (!ws) {
      return;
    }
    this.dialog.open(WorkspaceSettingsDialog, { data: ws, viewContainerRef: this.vcr, autoFocus: 'dialog' });
  }

  /** Apre le preferenze globali dell'app (log errori, ...). */
  protected async openPreferences(): Promise<void> {
    const prefs = await this.desktop.getAppPreferences();
    if (!prefs) {
      return;
    }
    this.dialog.open(AppPreferencesDialog, { data: prefs, viewContainerRef: this.vcr, autoFocus: 'dialog' });
  }
}
