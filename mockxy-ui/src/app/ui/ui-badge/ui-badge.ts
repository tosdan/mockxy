import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

/**
 * Badge: chip neutro + testo a tinta dal token semantico (come in aurora-2).
 * `tone` copre metodi HTTP, classi di status e tinte generiche → un'unica
 * resa coerente per tutti i badge dell'app.
 */
export const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-white/[0.04] font-bold tracking-wide ring-1 ring-white/10',
  {
    variants: {
      tone: {
        get: 'text-method-get/85',
        post: 'text-method-post/85',
        put: 'text-method-put/85',
        delete: 'text-method-delete/85',
        patch: 'text-method-patch/85',
        '2xx': 'text-status-2xx/90',
        '3xx': 'text-status-3xx/90',
        '4xx': 'text-status-4xx/90',
        '5xx': 'text-status-5xx/90',
        neutral: 'text-muted-foreground',
        brand: 'text-brand',
        positive: 'text-positive',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[10px]',
        md: 'px-2.5 py-1 text-sm',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>['size']>;

@Component({
  selector: 'ui-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { '[class]': 'computedClass()' },
})
export class UiBadge {
  readonly tone = input<BadgeTone>('neutral');
  readonly size = input<BadgeSize>('sm');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly computedClass = computed(() =>
    cn(badgeVariants({ tone: this.tone(), size: this.size() }), this.userClass()),
  );
}
