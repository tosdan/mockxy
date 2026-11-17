import { ChangeDetectionStrategy, Component, type ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronUp, lucideClock, lucideSave, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ActivationItem } from '../mock-admin-api.types';
import { UiButton } from '../ui/ui-button/ui-button';
import { activationSides } from './activation-labels';
import { ActivationStore } from './activation.store';

/**
 * Attivazioni temporanee nella barra di stato: quanti endpoint sono serviti in modo diverso da
 * come sono salvati, e il pulsante che li riporta tutti allo stato salvato. Compare solo quando
 * ce ne sono: lo stato temporaneo non deve poter passare inosservato, nemmeno quando l'ha
 * impostato un test via API.
 *
 * Il conteggio apre l'elenco: per ogni endpoint cosa risponde ora e cosa dice il file, con le
 * due uscite — «Salva così» lo scrive nel file, la X lo riporta a come è salvato. È il solo
 * punto in cui lo stato temporaneo si vede tutto insieme, da qualunque pagina.
 */
@Component({
  selector: 'app-activation-indicator',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgIcon, TranslocoPipe, UiButton],
  providers: [provideIcons({ lucideChevronUp, lucideClock, lucideSave, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.count() > 0) {
    <span class="inline-flex items-center gap-1.5 font-semibold text-[color:var(--status-3xx)]" data-activation-indicator>
      <button
        type="button"
        cdkOverlayOrigin
        #origin="cdkOverlayOrigin"
        #trigger
        class="inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        [attr.aria-expanded]="open()"
        aria-haspopup="dialog"
        data-activation-open
        (click)="open.set(!open())"
      >
        <ng-icon name="lucideClock" size="0.8rem" />
        {{ (store.count() === 1 ? 'activation.countOne' : 'activation.count') | transloco: { count: store.count() } }}
        <ng-icon name="lucideChevronUp" size="0.7rem" />
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-60"
        [disabled]="store.busy()"
        (click)="store.clear()"
      >
        <ng-icon name="lucideX" size="0.7rem" />
        {{ 'activation.clear' | transloco }}
      </button>

      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="origin"
        [cdkConnectedOverlayOpen]="open()"
        [cdkConnectedOverlayPositions]="positions"
        [cdkConnectedOverlayViewportMargin]="8"
        (overlayOutsideClick)="open.set(false)"
        (detach)="open.set(false)"
        (attach)="focusPanel()"
      >
        <div
          #panel
          role="dialog"
          tabindex="-1"
          [attr.aria-label]="'activation.panelTitle' | transloco"
          class="max-h-[28rem] w-[36rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-black/20 mx-scroll animate-in fade-in-0 zoom-in-95 focus-visible:outline-none"
          (keydown.escape)="close()"
        >
          <div class="mb-1 flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{{ 'activation.panelTitle' | transloco }}</span>
            <span class="flex-1"></span>
            <button type="button" class="grid size-5 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground" (click)="close()" [attr.aria-label]="'common.close' | transloco">
              <ng-icon name="lucideX" size="0.7rem" />
            </button>
          </div>
          <p class="mb-2.5 text-[12px] font-normal text-muted-foreground">{{ 'activation.indicatorTip' | transloco }}</p>

          <ul class="flex flex-col font-normal">
            @for (item of store.items(); track item.method + ' ' + item.path) {
            @let sides = describe(item);
            <li class="flex items-center gap-2 border-b border-border/60 py-1.5 last:border-b-0" [attr.data-activation-item]="item.method + ' ' + item.path">
              <div class="min-w-0 flex-1">
                <button
                  type="button"
                  class="flex max-w-full items-baseline gap-1.5 rounded text-left transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  [attr.aria-label]="'activation.openEndpoint' | transloco: { method: item.method, path: item.path }"
                  [title]="'activation.openEndpoint' | transloco: { method: item.method, path: item.path }"
                  (click)="openEndpoint(item)"
                >
                  <span class="shrink-0 font-mono text-[10.5px] font-bold text-muted-foreground">{{ item.method }}</span>
                  <span class="truncate font-mono text-[12px] text-foreground/90">{{ item.path }}</span>
                </button>
                <div class="truncate text-[11px] text-muted-foreground" data-activation-saved>
                  {{ sides.saved == null ? ('activation.fileUnreadable' | transloco) : ('activation.inFile' | transloco: { value: sides.saved }) }}
                </div>
              </div>
              <span class="max-w-[13rem] shrink-0 truncate rounded bg-[color-mix(in_srgb,var(--status-3xx)_18%,transparent)] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--status-3xx)]" [title]="sides.now" data-activation-now>
                {{ 'activation.now' | transloco: { value: sides.now } }}
              </span>
              <button
                ui-button
                size="sm"
                variant="outline"
                class="shrink-0"
                [disabled]="store.busy() || item.id == null"
                [title]="'activation.saveTip' | transloco"
                (click)="store.save([item])"
              >
                <ng-icon name="lucideSave" size="0.8rem" /> {{ 'activation.save' | transloco }}
              </button>
              <button
                type="button"
                class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                [disabled]="store.busy() || item.id == null"
                [attr.aria-label]="'activation.removeOne' | transloco: { method: item.method, path: item.path }"
                [title]="'activation.removeOne' | transloco: { method: item.method, path: item.path }"
                (click)="remove(item)"
              >
                <ng-icon name="lucideX" size="0.75rem" />
              </button>
            </li>
            }
          </ul>

          <div class="mt-2.5 flex justify-end gap-2">
            <button ui-button size="sm" variant="outline" [disabled]="store.busy() || !canSaveAny()" (click)="store.save(store.items())">
              <ng-icon name="lucideSave" size="0.8rem" /> {{ 'activation.saveAll' | transloco }}
            </button>
            <button ui-button size="sm" variant="outline" [disabled]="store.busy()" (click)="store.clear()">
              <ng-icon name="lucideX" size="0.8rem" /> {{ 'activation.clear' | transloco }}
            </button>
          </div>
        </div>
      </ng-template>
    </span>
    <span class="h-3 w-px bg-border"></span>
    }
  `,
})
export class ActivationIndicator {
  protected readonly store = inject(ActivationStore);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  protected readonly open = signal(false);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  ];

  constructor() {
    // L'ultimo stato temporaneo se n'è andato (salvato, tolto, o azzerato da un test): il
    // pulsante che apriva il pannello non c'è più, e nemmeno il pannello.
    effect(() => {
      if (this.store.count() === 0) this.open.set(false);
    });
  }

  protected describe(item: ActivationItem): { now: string; saved: string | null } {
    return activationSides(item, (enabled) => this.transloco.translate(enabled ? 'activation.on' : 'activation.off'));
  }

  protected canSaveAny(): boolean {
    return this.store.items().some((item) => item.id != null);
  }

  protected remove(item: ActivationItem): void {
    if (item.id != null) this.store.remove(item.id);
  }

  /** Apre l'endpoint nel catalogo, come «vai al mock» dal Monitor. */
  protected openEndpoint(item: ActivationItem): void {
    this.open.set(false);
    void this.router.navigate(['/mocks'], { queryParams: { m: item.method, p: item.path } });
  }

  /** All'apertura il focus entra nel pannello: da tastiera lo si scorre e lo si chiude con Escape. */
  protected focusPanel(): void {
    this.panel()?.nativeElement.focus();
  }

  /** Chiusura dai controlli del pannello o con Escape: il focus torna al pulsante che l'ha aperto. */
  protected close(): void {
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }
}
