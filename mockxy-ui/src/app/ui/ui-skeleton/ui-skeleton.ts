import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cn } from '../cn';

/** Placeholder di caricamento (pulse) su bg-muted. Dimensioni via class. */
@Component({
  selector: 'ui-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: { '[class]': 'cls()' },
})
export class UiSkeleton {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly cls = computed(() => cn('block animate-pulse rounded-md bg-muted', this.userClass()));
}
