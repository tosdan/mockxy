import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

/** Varianti del bottone (shadcn-style) costruite sui design token di aurora-2. */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // primario = gradiente brand (come la CTA di aurora-2), non il flat, per contrasto
        default: 'bg-gradient-to-br from-brand to-[var(--brand-strong)] text-white shadow-sm hover:brightness-110',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:bg-muted',
        outline: 'border border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        destructive:
          'border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/[0.08] text-destructive-soft/90 hover:border-[color:var(--destructive)]/50 hover:bg-[color:var(--destructive)]/[0.16]',
      },
      size: {
        // default abbassata per allinearsi all'altezza dei controlli py-1.5 (es. toggle "Attivo")
        default: 'h-8 px-3.5 text-[0.8125rem]',
        sm: 'h-7 px-3 text-xs',
        xs: 'h-6 px-2 text-[0.75rem]',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

/** Bottone come componente ad attributo: <button ui-button variant="..." size="...">. */
@Component({
  selector: 'button[ui-button], a[ui-button]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
  host: { '[class]': 'computedClass()' },
})
export class UiButton {
  readonly variant = input<ButtonVariant>('default');
  readonly size = input<ButtonSize>('default');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly computedClass = computed(() =>
    cn(buttonVariants({ variant: this.variant(), size: this.size() }), this.userClass()),
  );
}
