import { Directive, computed, input } from '@angular/core';
import { cn } from '../cn';

/** Etichetta di form standardizzata sui token. Si applica a <label>: <label ui-label>. */
@Directive({
  selector: 'label[ui-label]',
  host: { '[class]': 'cls()' },
})
export class UiLabel {
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly cls = computed(() =>
    cn('select-none text-sm font-medium text-foreground', this.userClass()),
  );
}
