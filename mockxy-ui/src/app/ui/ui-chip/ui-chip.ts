import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cn } from '../cn';

/**
 * Chip informativo statico (non interattivo): contenitore tenue con bordo, per
 * coppie label/valore compatte (es. "delay 0 ms"). Stile dai token.
 * Il contenuto si proietta: <ui-chip><span>delay</span><span>0 ms</span></ui-chip>.
 */
@Component({
  selector: 'ui-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { '[class]': 'cls()' },
})
export class UiChip {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly cls = computed(() =>
    cn(
      'inline-flex items-center gap-1.5 rounded-lg border border-border bg-black/25 px-2.5 py-1.5 text-[12px] text-muted-foreground',
      this.userClass(),
    ),
  );
}
