import { ChangeDetectionStrategy, Component, computed, inject, input, model, signal } from '@angular/core';

let radioGroupSeq = 0;

/** Gruppo radio: tiene il valore selezionato (two-way [(value)]) e un name condiviso. */
@Component({
  selector: 'ui-radio-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { role: 'radiogroup', class: 'flex flex-col gap-2.5' },
})
export class UiRadioGroup<T = unknown> {
  readonly value = model<T | null>(null);
  readonly name = signal(`ui-radio-${++radioGroupSeq}`);
}

/**
 * Radio item su input nativo (a11y + tastiera native). Il pallino e il bordo
 * seguono il valore del gruppo.
 *
 * NB: l'input e' stilizzato direttamente con `appearance-none` (l'input *e'* il
 * controllo visibile) invece di nasconderlo con `sr-only` e disegnare uno span a
 * parte. Un input `sr-only` e' un elemento 1x1 fuori posizione: al focus (click
 * reale) il browser scrolla *ogni* antenato scrollabile per portarlo in vista,
 * inclusi i container `overflow:hidden` (che restano scroll-positionabili) — e
 * questo spingeva fuori schermo l'intero contenuto della pagina ("schermo nero").
 * Con l'input nella sua posizione naturale e visibile, il focus non scrolla nulla.
 */
@Component({
  selector: 'ui-radio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label
      class="flex items-center gap-2 text-sm"
      [class.cursor-pointer]="!disabled()"
      [class.cursor-not-allowed]="disabled()"
      [class.opacity-50]="disabled()"
    >
      <input
        type="radio"
        class="size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-transparent outline-none transition checked:border-primary checked:bg-[radial-gradient(circle_at_center,var(--primary)_4px,transparent_4.5px)] focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed"
        [name]="group.name()"
        [checked]="checked()"
        [disabled]="disabled()"
        (change)="group.value.set(value())"
      />
      <ng-content />
    </label>
  `,
})
export class UiRadio<T = unknown> {
  protected readonly group = inject<UiRadioGroup<T>>(UiRadioGroup);
  readonly value = input.required<T>();
  readonly disabled = input(false);

  protected readonly checked = computed(() => this.group.value() === this.value());
}
