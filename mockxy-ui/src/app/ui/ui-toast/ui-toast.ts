import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleCheck, lucideCircleX, lucideInfo, lucideTriangleAlert, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

/** Azione opzionale del toast: un solo bottone, eseguito e poi chiuso il toast. */
export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface ToastItem {
  readonly id: number;
  readonly title: string;
  readonly description?: string;
  readonly tone: ToastTone;
  readonly action?: ToastAction;
}

let toastSeq = 0;

/** Service di notifiche toast (signal-based, niente dipendenze esterne). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly announcer = inject(LiveAnnouncer);
  readonly toasts = signal<readonly ToastItem[]>([]);

  show(toast: { title: string; description?: string; tone?: ToastTone; duration?: number; action?: ToastAction }): number {
    const id = ++toastSeq;
    const item: ToastItem = { id, title: toast.title, description: toast.description, tone: toast.tone ?? 'info', action: toast.action };
    this.toasts.update((list) => [...list, item]);

    // Annuncio agli screen reader via live region CDK (gli errori interrompono, il resto e' "polite").
    this.announcer.announce(
      item.description ? `${item.title}. ${item.description}` : item.title,
      item.tone === 'error' ? 'assertive' : 'polite',
    );

    // Un toast con azione resta un po' di piu': l'utente deve fare in tempo a cliccarla.
    const duration = toast.duration ?? (toast.action ? 7000 : 4000);
    if (duration > 0) {
      setTimeout(() => this.dismiss(id), duration);
    }
    return id;
  }

  /** Esegue l'azione del toast e lo chiude. */
  runAction(item: ToastItem): void {
    item.action?.run();
    this.dismiss(item.id);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}

/** Contenitore dei toast: montalo UNA volta (es. nella shell). Stile dai token. */
@Component({
  selector: 'ui-toaster',
  imports: [NgIcon, TranslocoPipe],
  providers: [provideIcons({ lucideCircleCheck, lucideCircleX, lucideInfo, lucideTriangleAlert, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-80 flex-col gap-2">
      @for (t of toast.toasts(); track t.id) {
      <div
        class="pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-popover px-3.5 py-3 shadow-lg animate-in fade-in slide-in-from-bottom-2"
        [class]="toneClass(t.tone)"
      >
        <ng-icon [name]="toneIcon(t.tone)" size="1.05rem" class="mt-px shrink-0" [style.color]="'var(--ui-alert-icon)'" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-foreground">{{ t.title }}</div>
          @if (t.description) {
          <div class="text-[13px] leading-snug text-muted-foreground">{{ t.description }}</div>
          }
          @if (t.action; as action) {
          <button
            type="button"
            (click)="toast.runAction(t)"
            class="mt-1.5 rounded text-[13px] font-semibold text-foreground underline underline-offset-2 transition hover:opacity-80"
          >
            {{ action.label }}
          </button>
          }
        </div>
        <button
          type="button"
          (click)="toast.dismiss(t.id)"
          [attr.aria-label]="'common.close' | transloco"
          class="-mr-1 shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground"
        >
          <ng-icon name="lucideX" size="0.9rem" />
        </button>
      </div>
      }
    </div>
  `,
})
export class UiToaster {
  protected readonly toast = inject(ToastService);

  /**
   * Per ogni tone, bordo e icona condividono lo STESSO colore base: il bordo a
   * bassa opacita' (hairline tenue), l'icona a piena opacita'. Cosi' l'icona ha
   * sempre lo stesso colore del bordo del toast.
   */
  protected toneClass(tone: ToastTone): string {
    switch (tone) {
      case 'success':
        return 'border-[color:var(--positive)]/30 [--ui-alert-icon:var(--positive)]';
      case 'warning':
        return 'border-[color:var(--status-4xx)]/35 [--ui-alert-icon:var(--status-4xx)]';
      case 'error':
        return 'border-[color:var(--destructive)]/35 [--ui-alert-icon:var(--destructive)]';
      default:
        return 'border-[color:var(--brand-soft)]/30 [--ui-alert-icon:var(--brand-soft)]';
    }
  }

  protected toneIcon(tone: ToastTone): string {
    switch (tone) {
      case 'success':
        return 'lucideCircleCheck';
      case 'warning':
        return 'lucideTriangleAlert';
      case 'error':
        return 'lucideCircleX';
      default:
        return 'lucideInfo';
    }
  }
}
