import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DesktopService } from './desktop.service';
import { RuntimeStatus } from './runtime-status';
import { WorkspaceTabs } from './workspace-tabs';

/**
 * Unica barra in cima alla shell: workspace a sinistra, stato runtime a destra.
 *
 * Prima erano due righe da 38 px — le tab dei workspace e i toggle runtime — per un totale di
 * chrome che nessuna delle due riempiva. Ci stanno su una riga sola perché il runtime è passato a
 * indicatori compatti (app-runtime-status) invece che a quattro interruttori con etichetta.
 *
 * Nell'app desktop questa barra fa anche da area di trascinamento della finestra (la titlebar di
 * sistema è nascosta da main.js) e il padding riserva lo spazio dei pulsanti finestra disegnati dal
 * sistema: `env(titlebar-area-*)` sta a destra su Windows/Linux e a sinistra su macOS. Fuori da
 * Electron quelle env() non esistono e resta il normale padding.
 */
@Component({
  selector: 'app-top-bar',
  imports: [RuntimeStatus, WorkspaceTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="relative z-50 flex h-[2.375rem] shrink-0 items-center gap-3 border-b border-border bg-card"
      style="
        -webkit-app-region: drag;
        padding-left: calc(0.75rem + env(titlebar-area-x, 0px));
        padding-right: calc(0.75rem + 100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw));
      "
    >
      @if (desktop.isDesktop) {
      <app-workspace-tabs />
      }
      <app-runtime-status class="ml-auto" style="-webkit-app-region: no-drag" />
    </div>
  `,
})
export class TopBar {
  protected readonly desktop = inject(DesktopService);
}
