import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { BrnSwitch, BrnSwitchThumb } from '@spartan-ng/brain/switch';
import { cn } from '../cn';

export type UiSwitchSize = 'default' | 'sm';

/**
 * Switch "helm" scritto a mano sopra il primitivo headless di spartan-ng (BrnSwitch).
 * spartan fornisce comportamento + accessibilita' (role=switch, aria-checked, tastiera,
 * focus, ControlValueAccessor); lo stile arriva interamente dai NOSTRI design token.
 */
@Component({
  selector: 'ui-switch',
  imports: [BrnSwitch, BrnSwitchThumb],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-switch
      [checked]="checked()"
      (checkedChange)="checked.set($event)"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel()"
      [class]="trackClass()"
    >
      <brn-switch-thumb [class]="thumbClass()" />
    </brn-switch>
  `,
})
export class UiSwitch {
  /** Stato on/off, two-way: [(checked)]. */
  readonly checked = model(false);
  readonly disabled = input(false);
  readonly ariaLabel = input<string | null>(null);
  /** Dimensione: 'default' (h-5 w-9) o 'sm' (h-4 w-7) per liste/righe dense. */
  readonly size = input<UiSwitchSize>('default');

  protected readonly trackClass = computed(() =>
    cn(
      'inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      this.size() === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
      this.checked() ? 'bg-positive' : 'bg-[var(--switch-off)]',
      this.disabled() && 'cursor-not-allowed opacity-50',
    ),
  );

  protected readonly thumbClass = computed(() => {
    const sm = this.size() === 'sm';
    return cn(
      'pointer-events-none block rounded-full bg-white shadow transition-transform',
      sm ? 'h-3 w-3' : 'h-4 w-4',
      this.checked() ? (sm ? 'translate-x-3' : 'translate-x-4') : 'translate-x-0',
    );
  });
}

