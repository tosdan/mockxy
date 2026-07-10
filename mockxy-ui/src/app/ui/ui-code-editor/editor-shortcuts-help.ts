import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  type OnDestroy,
  TemplateRef,
  ViewContainerRef,
  inject,
  viewChild,
} from '@angular/core';
import { Overlay, type OverlayRef, type ConnectedPosition } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleHelp } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';

interface Shortcut {
  /** Chiave i18n della descrizione (namespace `shortcuts`); risolta con la pipe transloco nel template. */
  readonly label: string;
  /** Combinazioni alternative; ognuna è una sequenza di tasti (resi come <kbd> uniti da "+"). */
  readonly combos: readonly (readonly string[])[];
}

const POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
];

/**
 * Icona "?" accanto alla label dell'editor: al passaggio del mouse (o col focus da tastiera) mostra
 * un popover con le scorciatoie disponibili nell'editor di codice. Usa l'overlay CDK, così non viene
 * tagliato dai contenitori con scroll della pagina.
 */
@Component({
  selector: 'editor-shortcuts-help',
  imports: [NgIcon, TranslocoPipe],
  providers: [provideIcons({ lucideCircleHelp })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex',
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusin)': 'show()',
    '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
  template: `
    <button
      type="button"
      class="grid size-4 place-items-center rounded text-muted-foreground/70 transition hover:text-foreground"
      [attr.aria-label]="'shortcuts.ariaLabel' | transloco"
    >
      <ng-icon name="lucideCircleHelp" size="0.9rem" />
    </button>

    <ng-template #content>
      <div
        class="w-max max-w-[32rem] rounded-lg border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
      >
        <p class="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/70">{{ 'shortcuts.title' | transloco }}</p>
        <ul class="flex flex-col gap-1.5 text-[12.5px]">
          @for (s of shortcuts; track s.label) {
          <li class="flex items-center justify-between gap-5">
            <span class="whitespace-nowrap text-muted-foreground">{{ s.label | transloco }}</span>
            <span class="flex flex-wrap items-center justify-end gap-1">
              @for (combo of s.combos; track $index; let lastCombo = $last) {
              @for (key of combo; track $index; let lastKey = $last) {
              <kbd class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-border">{{ key }}</kbd>
              @if (!lastKey) { <span class="text-muted-foreground/50">+</span> }
              }
              @if (!lastCombo) { <span class="px-0.5 text-muted-foreground/50">/</span> }
              }
            </span>
          </li>
          }
        </ul>
        <p class="mt-2 text-[11px] text-muted-foreground/70">{{ 'shortcuts.macHint' | transloco }}</p>
      </div>
    </ng-template>
  `,
})
export class EditorShortcutsHelp implements OnDestroy {
  private readonly overlay = inject(Overlay);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly vcr = inject(ViewContainerRef);
  private readonly content = viewChild.required<TemplateRef<unknown>>('content');
  private overlayRef?: OverlayRef;

  protected readonly shortcuts: readonly Shortcut[] = [
    { label: 'shortcuts.searchReplace', combos: [['Ctrl', 'F']] },
    { label: 'shortcuts.autocomplete', combos: [['Ctrl', 'Spazio']] },
    { label: 'shortcuts.format', combos: [['Shift', 'Alt', 'F']] },
    { label: 'shortcuts.indent', combos: [['Tab'], ['Shift', 'Tab']] },
    { label: 'shortcuts.commentLine', combos: [['Ctrl', '/']] },
    { label: 'shortcuts.undoRedo', combos: [['Ctrl', 'Z'], ['Ctrl', 'Y']] },
    { label: 'shortcuts.foldExpand', combos: [['Ctrl', 'Shift', '['], ['Ctrl', 'Shift', ']']] },
  ];

  protected show(): void {
    if (this.overlayRef?.hasAttached()) return;
    this.overlayRef ??= this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(this.host)
        .withPositions(POSITIONS)
        .withPush(true),
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
    });
    this.overlayRef.attach(new TemplatePortal(this.content(), this.vcr));
  }

  protected hide(): void {
    this.overlayRef?.detach();
  }

  ngOnDestroy(): void {
    this.overlayRef?.dispose();
  }
}
