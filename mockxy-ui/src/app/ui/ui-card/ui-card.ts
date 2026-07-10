import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cn } from '../cn';

/** Superficie contenitore standard: bordo + bg-card + raggio. Aggiungi padding via class. */
@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { '[class]': 'cls()' },
})
export class UiCard {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly cls = computed(() => cn('block rounded-xl border border-border bg-card', this.userClass()));
}
