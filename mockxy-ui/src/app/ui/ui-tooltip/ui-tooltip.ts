import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  Directive,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
} from '@angular/core';
import { ComponentPortal } from '@angular/cdk/portal';
import { Overlay, OverlayRef, type ConnectedPosition } from '@angular/cdk/overlay';

export type UiTooltipPosition = 'top' | 'bottom' | 'left' | 'right';

let uiTooltipSeq = 0;

/** Contenuto del tooltip in overlay: stilizzato sui token, role=tooltip, animato. */
@Component({
  selector: 'ui-tooltip-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="tooltip"
      [id]="tooltipId"
      class="pointer-events-none w-max max-w-xs rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-border animate-in fade-in-0 zoom-in-95"
    >
      {{ text() }}
    </div>
  `,
})
export class UiTooltipContent {
  readonly text = signal('');
  tooltipId = '';
}

/**
 * Tooltip su @angular/cdk/overlay (coerente con Dialog/Menu/Select; niente brain alpha).
 * Posizionamento viewport-aware (flip automatico), apri/chiudi con delay, focus +
 * hover, Esc per chiudere, `aria-describedby` per l'accessibilita'.
 *
 * Uso: <button uiTooltip="Testo" position="top">Azione</button>
 */
@Directive({
  selector: '[uiTooltip]',
  host: {
    '(mouseenter)': 'scheduleShow()',
    '(mouseleave)': 'scheduleHide()',
    '(focusin)': 'scheduleShow()',
    '(focusout)': 'scheduleHide()',
    '(keydown.escape)': 'hideNow()',
  },
})
export class UiTooltip implements OnDestroy {
  readonly text = input.required<string>({ alias: 'uiTooltip' });
  readonly position = input<UiTooltipPosition>('top');
  readonly showDelay = input(150);
  readonly hideDelay = input(100);

  private readonly overlay = inject(Overlay);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly id = `ui-tooltip-${++uiTooltipSeq}`;

  private overlayRef?: OverlayRef;
  private contentRef?: ComponentRef<UiTooltipContent>;
  private showTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;

  protected scheduleShow(): void {
    clearTimeout(this.hideTimer);
    this.showTimer = setTimeout(() => this.show(), this.showDelay());
  }

  protected scheduleHide(): void {
    clearTimeout(this.showTimer);
    this.hideTimer = setTimeout(() => this.hide(), this.hideDelay());
  }

  protected hideNow(): void {
    clearTimeout(this.showTimer);
    this.hide();
  }

  private show(): void {
    if (!this.text() || this.overlayRef?.hasAttached()) return;
    this.overlayRef ??= this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(this.host)
        .withPositions(this.positions())
        .withPush(true),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
    });
    this.contentRef = this.overlayRef.attach(new ComponentPortal(UiTooltipContent));
    this.contentRef.instance.tooltipId = this.id;
    this.contentRef.instance.text.set(this.text());
    this.contentRef.changeDetectorRef.detectChanges();
    this.host.nativeElement.setAttribute('aria-describedby', this.id);
  }

  private hide(): void {
    this.overlayRef?.detach();
    this.contentRef = undefined;
    this.host.nativeElement.removeAttribute('aria-describedby');
  }

  /** Posizione preferita + opposta come fallback (flip se non c'e' spazio). */
  private positions(): ConnectedPosition[] {
    const gap = 8;
    const top: ConnectedPosition = { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -gap };
    const bottom: ConnectedPosition = { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: gap };
    const left: ConnectedPosition = { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -gap };
    const right: ConnectedPosition = { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: gap };
    switch (this.position()) {
      case 'bottom':
        return [bottom, top];
      case 'left':
        return [left, right];
      case 'right':
        return [right, left];
      default:
        return [top, bottom];
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    this.overlayRef?.dispose();
  }
}
