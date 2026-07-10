import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { BrnCheckbox } from '@spartan-ng/brain/checkbox';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck } from '@ng-icons/lucide';
import { cn } from '../cn';

/**
 * Checkbox "helm" sopra BrnCheckbox (spartan brain): comportamento + a11y dal
 * primitivo, stile dai token. Il box e' il button interno (data-state), il segno
 * di spunta e' proiettato e compare via group-data-[state=checked].
 *
 * NB: cursore/opacita' del disabled sono pilotati dal NOSTRO signal disabled(),
 * non da data-[disabled]: il brain lascia data-disabled="false" quando abilitato,
 * quindi una variante data-[disabled] scatterebbe anche da abilitato.
 */
@Component({
  selector: 'ui-checkbox',
  imports: [BrnCheckbox, NgIcon],
  providers: [provideIcons({ lucideCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-checkbox
      [checked]="checked()"
      (checkedChange)="checked.set($event)"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel()"
      [class]="boxClass()"
    >
      <ng-icon
        name="lucideCheck"
        size="0.78rem"
        class="text-primary-foreground opacity-0 transition-opacity group-data-[state=checked]:opacity-100"
      />
    </brn-checkbox>
  `,
})
export class UiCheckbox {
  /** Stato checked, two-way: [(checked)]. */
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly ariaLabel = input<string | null>(null);

  protected readonly boxClass = computed(() =>
    cn(
      'group inline-flex size-[18px] items-center justify-center rounded-[5px] border border-input bg-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
      this.disabled() ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
    ),
  );
}
