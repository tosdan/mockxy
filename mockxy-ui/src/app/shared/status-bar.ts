import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideTriangleAlert, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { WorkspaceSummaryStore } from './workspace-summary.store';

/**
 * Striscia di stato in fondo alla shell: quanti endpoint, collection e attivi ha il workspace, e
 * quali definizioni il motore ha scartato.
 *
 * Prima viveva nel footer del catalogo, quindi spariva appena si cambiava view — e gli errori di
 * caricamento erano un tooltip, cioè leggibili solo puntandoli col mouse e mai copiabili. Qui
 * restano visibili da ogni view e si aprono in un pannello.
 */
@Component({
  selector: 'app-status-bar',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgIcon, TranslocoPipe],
  providers: [provideIcons({ lucideTriangleAlert, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-6.5 shrink-0 items-center gap-2.5 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      @if (summary.summary(); as s) {
      <span class="font-mono tabular-nums">
        {{ 'statusBar.counts' | transloco: { endpoints: s.endpoints, collections: s.collections, active: s.active } }}
      </span>

      @if (s.loadErrors.length > 0) {
      <span class="h-3 w-px bg-border"></span>
      <button
        type="button"
        cdkOverlayOrigin
        #origin="cdkOverlayOrigin"
        class="flex items-center gap-1.5 rounded px-1 py-0.5 font-semibold text-[color:var(--status-4xx)] transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        [attr.aria-expanded]="open()"
        aria-haspopup="dialog"
        (click)="open.set(!open())"
      >
        <ng-icon name="lucideTriangleAlert" size="0.8rem" />
        {{ (s.loadErrors.length === 1 ? 'statusBar.loadErrorsOne' : 'statusBar.loadErrors') | transloco: { count: s.loadErrors.length } }}
      </button>

      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="origin"
        [cdkConnectedOverlayOpen]="open()"
        [cdkConnectedOverlayPositions]="positions"
        [cdkConnectedOverlayViewportMargin]="8"
        (overlayOutsideClick)="open.set(false)"
        (detach)="open.set(false)"
      >
        <div
          role="dialog"
          [attr.aria-label]="'statusBar.loadErrorsTitle' | transloco"
          class="max-h-96 w-[34rem] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-black/20 mx-scroll animate-in fade-in-0 zoom-in-95"
          (keydown.escape)="open.set(false)"
        >
          <div class="mb-1 flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {{ 'statusBar.loadErrorsTitle' | transloco }}
            </span>
            <span class="flex-1"></span>
            <button type="button" class="grid size-5 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground" (click)="open.set(false)" [attr.aria-label]="'common.close' | transloco">
              <ng-icon name="lucideX" size="0.7rem" />
            </button>
          </div>
          <p class="mb-2.5 text-[12px] text-muted-foreground">{{ 'statusBar.loadErrorsHint' | transloco }}</p>
          <ul class="flex flex-col gap-2">
            @for (e of s.loadErrors; track e.configFilePath) {
            <li class="rounded-lg border border-border bg-black/20 p-2.5">
              <div class="truncate font-mono text-[11.5px] text-foreground/85" [title]="e.configFilePath">{{ e.configFilePath }}</div>
              <div class="mt-1 break-words text-[12px] text-[color:var(--status-4xx)]">{{ e.message }}</div>
            </li>
            }
          </ul>
        </div>
      </ng-template>
      }
      }
    </div>
  `,
})
export class StatusBar {
  protected readonly summary = inject(WorkspaceSummaryStore);
  protected readonly open = signal(false);

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  ];
}
