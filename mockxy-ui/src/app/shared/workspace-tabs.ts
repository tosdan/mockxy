import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideClock, lucideFolder, lucidePlus, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiMenu, UiMenuItem } from '../ui/ui-menu/ui-menu';
import { UiTooltip } from '../ui/ui-tooltip/ui-tooltip';
import { DesktopService, type OpenWorkspace, type WorkspaceRef } from './desktop.service';

/**
 * Striscia dei workspace (solo app desktop): una tab per ogni workspace aperto, più i controlli
 * per aprirne un altro e riprendere i recenti. Cliccando una tab si passa a quel workspace; la "×"
 * lo chiude. Sostituisce il menu nativo della finestra.
 *
 * «Apri…» e «Recenti» stanno in coda alla striscia e non in un angolo lontano della barra: sono
 * il modo di far comparire una tab qui, quindi appartengono a questo gruppo.
 *
 * Cambiare workspace ricarica la finestra, quindi lo stato si rilegge all'avvio del componente;
 * dopo la chiusura di un workspace non attivo (che non ricarica) si rilegge l'elenco a mano.
 */
@Component({
  selector: 'app-workspace-tabs',
  imports: [CdkMenuTrigger, NgIcon, TranslocoPipe, UiMenu, UiMenuItem, UiTooltip],
  providers: [provideIcons({ lucideChevronDown, lucideClock, lucideFolder, lucidePlus, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1" style="-webkit-app-region: no-drag">
      @for (w of openWorkspaces(); track w.root) {
      <div
        class="group/tab flex max-w-[12rem] shrink-0 items-center gap-1 rounded-md py-1 pl-2.5 pr-1 text-[12.5px] font-medium transition"
        [class]="w.active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
      >
        <button class="flex min-w-0 items-center gap-1.5" (click)="switchTo(w)" [title]="w.name + ' · ' + w.root">
          <ng-icon name="lucideFolder" size="0.85rem" class="shrink-0" [class.text-brand]="w.active" />
          <span class="min-w-0 truncate">{{ w.name }}</span>
          <span class="shrink-0 font-mono text-[10.5px] opacity-70">:{{ w.port }}</span>
        </button>
        <button
          class="grid h-4 w-4 shrink-0 place-items-center rounded opacity-0 transition hover:bg-accent group-hover/tab:opacity-100"
          (click)="close(w.root)"
          [uiTooltip]="'workspaceTabs.closeWs' | transloco"
          [attr.aria-label]="'workspaceTabs.closeWs' | transloco"
        >
          <ng-icon name="lucideX" size="0.75rem" />
        </button>
      </div>
      } @empty {
      <span class="px-2 py-1 text-[12.5px] text-muted-foreground">{{ 'workspaceTabs.noneOpen' | transloco }}</span>
      }

      <span class="mx-0.5 h-4 w-px shrink-0 bg-border"></span>

      <button
        class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        (click)="open()"
        [uiTooltip]="'workspaceTabs.open' | transloco"
        [attr.aria-label]="'workspaceTabs.open' | transloco"
      >
        <ng-icon name="lucidePlus" size="0.9rem" />
      </button>
      <button
        class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        [cdkMenuTriggerFor]="recentMenu"
        [uiTooltip]="'workspaceTabs.recent' | transloco"
        [attr.aria-label]="'workspaceTabs.recentAria' | transloco"
      >
        <ng-icon name="lucideChevronDown" size="0.9rem" />
      </button>
    </div>

    <ng-template #recentMenu>
      <div ui-menu class="min-w-[18rem]">
        <div class="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{{ 'workspaceTabs.recentlyOpened' | transloco }}</div>
        @for (w of recentWorkspaces(); track w.root) {
        <div class="group/recent relative">
          <button ui-menu-item class="w-full pr-9" (click)="switchToRoot(w.root)">
            <ng-icon name="lucideClock" size="0.85rem" class="text-muted-foreground" />
            <span class="flex-1 truncate" [title]="w.root">{{ w.name }}</span>
          </button>
          <button
            type="button"
            class="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/recent:opacity-100"
            (click)="$event.stopPropagation(); removeRecent(w.root)"
            [uiTooltip]="'workspaceTabs.removeRecentTip' | transloco"
            [attr.aria-label]="'workspaceTabs.removeRecentTip' | transloco"
          >
            <ng-icon name="lucideX" size="0.75rem" />
          </button>
        </div>
        } @empty {
        <div class="px-2 py-1.5 text-muted-foreground">{{ 'workspaceTabs.none' | transloco }}</div>
        }
      </div>
    </ng-template>
  `,
})
export class WorkspaceTabs implements OnInit {
  protected readonly desktop = inject(DesktopService);
  protected readonly openWorkspaces = signal<readonly OpenWorkspace[]>([]);
  protected readonly recentWorkspaces = signal<readonly WorkspaceRef[]>([]);

  ngOnInit(): void {
    if (this.desktop.isDesktop) {
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    this.openWorkspaces.set(await this.desktop.listWorkspaces());
    this.recentWorkspaces.set(await this.desktop.listRecent());
  }

  /** Passa al workspace della tab; se è già quello attivo non fa nulla (niente ricaricamento inutile). */
  protected switchTo(w: OpenWorkspace): void {
    if (!w.active) {
      void this.desktop.switchWorkspace(w.root);
    }
  }

  protected async switchToRoot(root: string): Promise<void> {
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

  protected async close(root: string): Promise<void> {
    await this.desktop.closeWorkspace(root);
    await this.refresh();
  }
}
