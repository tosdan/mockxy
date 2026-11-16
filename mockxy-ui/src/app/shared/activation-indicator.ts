import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClock, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiTooltip } from '../ui/ui-tooltip/ui-tooltip';
import { ActivationStore } from './activation.store';

/**
 * Attivazioni temporanee nella barra di stato: quanti endpoint sono serviti in modo diverso da
 * come sono salvati, e il pulsante che li riporta tutti allo stato salvato. Compare solo quando
 * ce ne sono: lo stato temporaneo non deve poter passare inosservato, nemmeno quando l'ha
 * impostato un test via API.
 */
@Component({
  selector: 'app-activation-indicator',
  imports: [NgIcon, TranslocoPipe, UiTooltip],
  providers: [provideIcons({ lucideClock, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.count() > 0) {
    <span class="inline-flex items-center gap-1.5 font-semibold text-[color:var(--status-3xx)]" data-activation-indicator>
      <ng-icon name="lucideClock" size="0.8rem" />
      <span [uiTooltip]="'activation.indicatorTip' | transloco">
        {{ (store.count() === 1 ? 'activation.countOne' : 'activation.count') | transloco: { count: store.count() } }}
      </span>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded px-1 py-0.5 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-60"
        [disabled]="store.busy()"
        (click)="store.clear()"
      >
        <ng-icon name="lucideX" size="0.7rem" />
        {{ 'activation.clear' | transloco }}
      </button>
    </span>
    <span class="h-3 w-px bg-border"></span>
    }
  `,
})
export class ActivationIndicator {
  protected readonly store = inject(ActivationStore);
}
