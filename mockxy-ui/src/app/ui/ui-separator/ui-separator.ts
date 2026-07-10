import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cn } from '../cn';

/** Separatore standardizzato sul token --border. orientation horizontal | vertical. */
@Component({
  selector: 'ui-separator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: {
    role: 'separator',
    '[attr.aria-orientation]': 'orientation()',
    '[class]': 'cls()',
  },
})
export class UiSeparator {
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');

  protected readonly cls = computed(() =>
    cn('shrink-0 bg-border', this.orientation() === 'vertical' ? 'h-full w-px self-stretch' : 'h-px w-full'),
  );
}
