import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFolder, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiTooltip } from '../ui/ui-tooltip/ui-tooltip';
import { DesktopService, type OpenWorkspace } from './desktop.service';

/**
 * Barra dei workspace aperti (solo app desktop): riga in cima alla shell con una **tab per ogni
 * workspace aperto**, così si vede a colpo d'occhio quanti ce ne sono e quale è attivo. Cliccando una
 * tab si passa a quel workspace; la "×" lo chiude. Sostituisce il menu nativo della finestra (per i
 * recenti e l'apertura c'è la barra dei controlli accanto ai toggle runtime). Fuori da Electron non
 * rende nulla.
 *
 * Cambiare workspace ricarica la finestra, quindi lo stato si rilegge all'avvio del componente; dopo
 * la chiusura di un workspace non attivo (che non ricarica) si rilegge l'elenco a mano.
 */
@Component({
  selector: 'app-workspace-bar',
  imports: [NgIcon, TranslocoPipe, UiTooltip],
  providers: [provideIcons({ lucideFolder, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (desktop.isDesktop) {
    <!-- La titlebar di sistema è nascosta (main.js): questa barra fa da area di trascinamento della
         finestra e il padding riserva lo spazio dei pulsanti finestra disegnati dal sistema
         (env(titlebar-area-*): a destra su Windows/Linux, a sinistra su macOS; fuori da Electron
         le env() non esistono e resta il normale padding di 0.75rem). -->
    <div
      class="h-[2.375rem] relative z-50 flex shrink-0 items-center border-b border-border bg-card"
      style="
        -webkit-app-region: drag;
        padding-left: calc(0.75rem + env(titlebar-area-x, 0px));
        padding-right: calc(0.75rem + 100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw));
      "
    >
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
            [uiTooltip]="'workspaceBar.closeWs' | transloco"
            [attr.aria-label]="'workspaceBar.closeWs' | transloco"
          >
            <ng-icon name="lucideX" size="0.75rem" />
          </button>
        </div>
        } @empty {
        <span class="px-2 py-1 text-[12.5px] text-muted-foreground">{{ 'workspaceBar.noneOpen' | transloco }}</span>
        }
      </div>
    </div>
    }
  `,
})
export class WorkspaceBar implements OnInit {
  protected readonly desktop = inject(DesktopService);
  protected readonly openWorkspaces = signal<readonly OpenWorkspace[]>([]);

  ngOnInit(): void {
    if (this.desktop.isDesktop) {
      void this.refresh();
    }
  }

  private async refresh(): Promise<void> {
    this.openWorkspaces.set(await this.desktop.listWorkspaces());
  }

  /** Passa al workspace della tab; se è già quello attivo non fa nulla (niente ricaricamento inutile). */
  protected switchTo(w: OpenWorkspace): void {
    if (!w.active) {
      void this.desktop.switchWorkspace(w.root);
    }
  }

  protected async close(root: string): Promise<void> {
    await this.desktop.closeWorkspace(root);
    await this.refresh();
  }
}
