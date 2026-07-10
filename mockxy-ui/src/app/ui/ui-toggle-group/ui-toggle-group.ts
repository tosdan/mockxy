import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { cn } from '../cn';

/**
 * Toggle group "segmented": un gruppo di opzioni mutuamente esclusive in un
 * unico controllo (es. JSON / File). Stile sui token.
 *
 * <ui-toggle-group [(value)]="mode">
 *   <button ui-toggle-item value="json">JSON</button>
 *   <button ui-toggle-item value="file">File</button>
 * </ui-toggle-group>
 */
@Component({
  selector: 'ui-toggle-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    role: 'group',
    class: 'inline-flex items-center rounded-lg border border-input bg-black/30 p-0.5 text-[11px] font-semibold',
  },
})
export class UiToggleGroup<T = string> {
  readonly value = model<T | null>(null);
}

/** Singola opzione del toggle group. */
@Component({
  selector: 'button[ui-toggle-item]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: {
    type: 'button',
    '[attr.aria-pressed]': 'selected()',
    '(click)': 'group.value.set(value())',
    '[class]': 'cls()',
  },
})
export class UiToggleItem<T = string> {
  protected readonly group = inject<UiToggleGroup<T>>(UiToggleGroup);
  readonly value = input.required<T>();

  protected readonly selected = computed(() => this.group.value() === this.value());
  protected readonly cls = computed(() =>
    cn(
      'cursor-pointer rounded-md px-2.5 py-1 transition',
      this.selected() ? 'bg-accent text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
    ),
  );
}
