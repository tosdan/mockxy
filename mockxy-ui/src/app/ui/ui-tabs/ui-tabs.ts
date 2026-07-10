import { Directive, computed, inject, input } from '@angular/core';
import { BrnTabs, BrnTabsContent, BrnTabsList, BrnTabsTrigger } from '@spartan-ng/brain/tabs';
import { cn } from '../cn';

/**
 * Tabs "helm" sopra i primitivi headless di spartan-ng (comportamento + a11y da
 * tastiera). Composizione via hostDirectives: l'API pubblica resta pulita
 * (ui-tabs / ui-tabs-list / ui-tabs-trigger / ui-tabs-content), lo stile dai token.
 */
@Directive({
  selector: '[ui-tabs]',
  hostDirectives: [{ directive: BrnTabs, inputs: ['brnTabs: ui-tabs', 'orientation'], outputs: ['brnTabsChange'] }],
  host: { class: 'flex flex-col gap-3' },
})
export class UiTabs {}

@Directive({
  selector: '[ui-tabs-list]',
  hostDirectives: [BrnTabsList],
  host: { class: 'inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1' },
})
export class UiTabsList {}

@Directive({
  selector: 'button[ui-tabs-trigger]',
  hostDirectives: [{ directive: BrnTabsTrigger, inputs: ['brnTabsTrigger: ui-tabs-trigger', 'disabled'] }],
  host: { '[class]': 'cls()' },
})
export class UiTabsTrigger {
  private readonly brn = inject(BrnTabsTrigger);
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly cls = computed(() =>
    cn(
      'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
      this.brn.selected() ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      this.userClass(),
    ),
  );
}

@Directive({
  selector: '[ui-tabs-content]',
  hostDirectives: [{ directive: BrnTabsContent, inputs: ['brnTabsContent: ui-tabs-content'] }],
  host: { class: 'outline-none' },
})
export class UiTabsContent {}
