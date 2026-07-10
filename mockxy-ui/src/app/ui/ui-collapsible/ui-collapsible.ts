import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { cn } from '../cn';

/**
 * Collapsible: una sezione con intestazione cliccabile (chevron che ruota) e
 * contenuto che si apre/chiude. Stato two-way [(open)] (default aperto).
 *
 * <ui-collapsible triggerClass="bg-black/20 px-6 py-2.5 hover:bg-black/30">
 *   <div uiCollapsibleHeader>…intestazione…</div>
 *   …contenuto…
 * </ui-collapsible>
 *
 * Per un accordion (un solo aperto per volta) si coordinano piu' istanze a monte.
 */
@Component({
  selector: 'ui-collapsible',
  imports: [NgIcon],
  providers: [provideIcons({ lucideChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" [attr.aria-expanded]="open()" (click)="open.set(!open())" [class]="cls()">
      <ng-icon
        name="lucideChevronRight"
        size="0.85rem"
        class="shrink-0 text-muted-foreground transition-transform"
        [class.rotate-90]="open()"
      />
      <ng-content select="[uiCollapsibleHeader]" />
    </button>
    @if (open()) {
    <ng-content />
    }
  `,
})
export class UiCollapsible {
  readonly open = model(true);
  /** Classi aggiuntive per la barra di intestazione (padding/sfondo/hover). */
  readonly triggerClass = input('');

  protected readonly cls = computed(() =>
    cn('flex w-full cursor-pointer items-center gap-2 text-left transition', this.triggerClass()),
  );
}
