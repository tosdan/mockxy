import { ChangeDetectionStrategy, Component, OnInit, ViewContainerRef, inject, signal } from '@angular/core';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideClock, lucideCog, lucidePlus, lucideX } from '@ng-icons/lucide';
import { UiButton } from '../ui/ui-button/ui-button';
import { UiMenu, UiMenuItem } from '../ui/ui-menu/ui-menu';
import { UiTooltip } from '../ui/ui-tooltip/ui-tooltip';
import { UiDialog } from '../ui/ui-dialog/ui-dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { DesktopService, type WorkspaceRef } from './desktop.service';
import { WorkspaceSettingsDialog } from './workspace-settings-dialog';

/**
 * Controlli workspace "secondari" (solo app desktop): elenco dei workspace aperti di recente,
 * pulsante "Apri…" e pulsante ingranaggio per le impostazioni del workspace attivo (es. porta).
 * Montato a sinistra nella barra dei toggle runtime. La scelta del workspace attivo tra quelli
 * aperti è invece nelle tab in cima (app-workspace-bar).
 */
@Component({
  selector: 'app-workspace-controls',
  imports: [CdkMenuTrigger, NgIcon, TranslocoPipe, UiButton, UiMenu, UiMenuItem, UiTooltip],
  providers: [provideIcons({ lucideChevronDown, lucideClock, lucideCog, lucidePlus, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center gap-2">
      <button ui-button variant="ghost" size="icon" (click)="openSettings()" [uiTooltip]="'workspaceControls.settings' | transloco" [attr.aria-label]="'workspaceControls.settings' | transloco">
        <ng-icon name="lucideCog" size="0.95rem" />
      </button>
      <button ui-button variant="ghost" size="sm" (click)="open()">
        <ng-icon name="lucidePlus" size="0.95rem" /> {{ 'workspaceControls.open' | transloco }}
      </button>
      <button ui-button variant="ghost" size="sm" [cdkMenuTriggerFor]="recentMenu" [attr.aria-label]="'workspaceControls.recentAria' | transloco">
        <ng-icon name="lucideClock" size="0.9rem" /> {{ 'workspaceControls.recent' | transloco }}
        <ng-icon name="lucideChevronDown" size="0.8rem" class="text-muted-foreground" />
      </button>
    </span>

    <ng-template #recentMenu>
      <div ui-menu class="min-w-[18rem]">
        <div class="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{{ 'workspaceControls.recentlyOpened' | transloco }}</div>
        @for (w of recentWorkspaces(); track w.root) {
        <div class="group/recent relative">
          <button ui-menu-item class="w-full pr-9" (click)="switchTo(w.root)">
            <ng-icon name="lucideClock" size="0.85rem" class="text-muted-foreground" />
            <span class="flex-1 truncate" [title]="w.root">{{ w.name }}</span>
          </button>
          <button
            type="button"
            class="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/recent:opacity-100"
            (click)="$event.stopPropagation(); removeRecent(w.root)"
            [uiTooltip]="'workspaceControls.removeRecentTip' | transloco"
            [attr.aria-label]="'workspaceControls.removeRecentTip' | transloco"
          >
            <ng-icon name="lucideX" size="0.75rem" />
          </button>
        </div>
        } @empty {
        <div class="px-2 py-1.5 text-muted-foreground">{{ 'workspaceControls.none' | transloco }}</div>
        }
      </div>
    </ng-template>
  `,
})
export class WorkspaceControls implements OnInit {
  protected readonly desktop = inject(DesktopService);
  private readonly dialog = inject(UiDialog);
  private readonly vcr = inject(ViewContainerRef);
  protected readonly recentWorkspaces = signal<readonly WorkspaceRef[]>([]);

  ngOnInit(): void {
    if (this.desktop.isDesktop) {
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    this.recentWorkspaces.set(await this.desktop.listRecent());
  }

  protected async switchTo(root: string): Promise<void> {
    const result = await this.desktop.switchWorkspace(root);
    // Workspace inesistente: il backend l'ha già tolto dai recenti, qui rinfresco l'elenco mostrato.
    if (result && !result.ok) {
      await this.refresh();
    }
  }

  /** Toglie un workspace dai recenti (previa conferma nativa); se confermato, rinfresca l'elenco. */
  protected async removeRecent(root: string): Promise<void> {
    if (await this.desktop.removeRecent(root)) {
      await this.refresh();
    }
  }

  protected open(): void {
    this.desktop.openWorkspace();
  }

  /** Apre le impostazioni del workspace attivo (porta, ...). */
  protected async openSettings(): Promise<void> {
    const ws = await this.desktop.getWorkspace();
    if (!ws) {
      return;
    }
    this.dialog.open(WorkspaceSettingsDialog, { data: ws, viewContainerRef: this.vcr, autoFocus: 'dialog' });
  }
}
