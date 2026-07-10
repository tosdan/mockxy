import { Directive, computed, input } from '@angular/core';
import { cn } from '../cn';

/** Campo di testo standardizzato sui token. Si applica a <input>/<textarea>: <input ui-input />. */
@Directive({
  selector: 'input[ui-input], textarea[ui-input]',
  host: { '[class]': 'cls()' },
})
export class UiInput {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly cls = computed(() =>
    cn(
      'w-full rounded-lg border border-input bg-black/30 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:border-ring/50 focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50',
      this.userClass(),
    ),
  );
}
