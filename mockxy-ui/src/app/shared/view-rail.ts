import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideActivity, lucideDatabase, lucideFileJson, lucideListTree } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { DesktopService } from './desktop.service';
import { LanguageSwitcher } from './language-switcher';
import { MonitorStreamStore } from './monitor-stream.store';
import { SettingsMenu } from './settings-menu';

interface RailView {
  readonly labelKey: string;
  readonly icon: string;
  readonly path: string;
}

const VIEWS: readonly RailView[] = [
  { labelKey: 'viewRail.catalogo', icon: 'lucideListTree', path: '/mocks' },
  { labelKey: 'viewRail.monitor', icon: 'lucideActivity', path: '/monitor' },
  { labelKey: 'viewRail.storico', icon: 'lucideDatabase', path: '/storico' },
  { labelKey: 'viewRail.dati', icon: 'lucideFileJson', path: '/dati' },
];

/**
 * Rail di navigazione fra le view (Catalogo / Monitor / Storico / Dati): colonna fissa a sinistra
 * nella shell, montata una volta sola. Sostituisce il vecchio switcher a tendina replicato nella
 * topbar di ogni pagina: le view sono sempre visibili e raggiungibili con un click invece che due,
 * e le topbar smettono di dover sapere quale view stanno rendendo.
 *
 * Le voci sono link veri (routerLink), non bottoni: si annunciano come navigazione e restano
 * apribili col tasto centrale. In fondo stanno i controlli che non appartengono a nessuna view —
 * impostazioni (solo desktop) e lingua.
 */
@Component({
  selector: 'app-view-rail',
  imports: [RouterLink, RouterLinkActive, NgIcon, TranslocoPipe, LanguageSwitcher, SettingsMenu],
  providers: [provideIcons({ lucideActivity, lucideDatabase, lucideFileJson, lucideListTree })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex shrink-0 flex-col' },
  template: `
    <nav
      class="flex h-full w-15 flex-col items-center gap-1 border-r border-border bg-card py-2"
      [attr.aria-label]="'viewRail.nav' | transloco"
    >
      @for (view of views; track view.path) {
      <a
        [routerLink]="view.path"
        routerLinkActive="bg-accent text-foreground shadow-[inset_2px_0_0_0_var(--brand-soft)]"
        #link="routerLinkActive"
        [attr.aria-current]="link.isActive ? 'page' : null"
        class="relative flex w-13 flex-col items-center gap-1 rounded-lg py-2 text-[9px] font-bold tracking-wide text-muted-foreground no-underline transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ng-icon [name]="view.icon" size="1.1rem" />
        {{ view.labelKey | transloco }}
        <!-- Il pallino ripete nel rail il segnale della barra runtime: la cattura live è attiva
             anche mentre si guarda un'altra view, e da qui si vede senza cambiare pagina. -->
        @if (view.path === '/monitor' && stream.streaming()) {
        <span class="absolute right-2.5 top-1.5 size-1.5 rounded-full bg-positive"></span>
        }
      </a>
      }

      <span class="flex-1"></span>

      @if (desktop.isDesktop) {
      <app-settings-menu />
      }
      <app-language-switcher />
    </nav>
  `,
})
export class ViewRail {
  protected readonly desktop = inject(DesktopService);
  protected readonly stream = inject(MonitorStreamStore);
  protected readonly views = VIEWS;
}
