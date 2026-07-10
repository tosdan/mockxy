import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

/** Callout/avviso: bordo e fondo tinti dal token di stato, testo leggibile. */
export const alertVariants = cva('flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm', {
  variants: {
    tone: {
      info: 'border-[color:var(--brand)]/25 bg-[color:var(--brand)]/[0.08] [--ui-alert-icon:var(--brand-soft)]',
      success: 'border-[color:var(--positive)]/30 bg-[color:var(--positive)]/[0.10] [--ui-alert-icon:var(--positive)]',
      warning: 'border-[color:var(--status-4xx)]/30 bg-[color:var(--status-4xx)]/[0.10] [--ui-alert-icon:var(--status-4xx)]',
      error: 'border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/[0.08] [--ui-alert-icon:var(--destructive-soft)]',
    },
  },
  defaultVariants: { tone: 'info' },
});

export type AlertTone = NonNullable<VariantProps<typeof alertVariants>['tone']>;

@Component({
  selector: 'ui-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { role: 'status', '[class]': 'cls()' },
})
export class UiAlert {
  readonly tone = input<AlertTone>('info');
  readonly userClass = input<string>('', { alias: 'class' });
  protected readonly cls = computed(() => cn(alertVariants({ tone: this.tone() }), this.userClass()));
}
