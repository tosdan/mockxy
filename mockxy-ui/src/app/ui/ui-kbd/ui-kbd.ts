import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cn } from '../cn';

/** Indicatore di tasto/scorciatoia (es. Cmd-K). */
@Component({
  selector: 'ui-kbd',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { '[class]': 'cls()' },
})
export class UiKbd {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly cls = computed(() =>
    cn(
      'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground',
      this.userClass(),
    ),
  );
}
