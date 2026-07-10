import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideChevronDown } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { cn } from '../cn';

export interface UiSelectOption<T = string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
  /** Colore (CSS) di un pallino guida a sinistra dell'opzione e sul trigger quando selezionata. */
  readonly accent?: string;
}

/** Tono del trigger: 'default' neutro o una classe di status (pill colorata + dot). */
export type UiSelectTone = 'default' | '2xx' | '3xx' | '4xx' | '5xx';

/** Classi border+bg+text del trigger per tono (override su base via twMerge). */
const SELECT_TONE: Record<Exclude<UiSelectTone, 'default'>, string> = {
  '2xx': 'border-[color:var(--status-2xx)]/25 bg-[color:var(--status-2xx)]/[0.08] text-[color:var(--status-2xx)]/90',
  '3xx': 'border-[color:var(--status-3xx)]/25 bg-[color:var(--status-3xx)]/[0.08] text-[color:var(--status-3xx)]/90',
  '4xx': 'border-[color:var(--status-4xx)]/25 bg-[color:var(--status-4xx)]/[0.08] text-[color:var(--status-4xx)]/90',
  '5xx': 'border-[color:var(--status-5xx)]/25 bg-[color:var(--status-5xx)]/[0.08] text-[color:var(--status-5xx)]/90',
};

/** Colore del pallino guida per tono. */
const SELECT_DOT: Record<Exclude<UiSelectTone, 'default'>, string> = {
  '2xx': 'bg-[color:var(--status-2xx)]/80',
  '3xx': 'bg-[color:var(--status-3xx)]/80',
  '4xx': 'bg-[color:var(--status-4xx)]/80',
  '5xx': 'bg-[color:var(--status-5xx)]/80',
};

let uiSelectSeq = 0;

/**
 * Select stilizzata su @angular/cdk overlay (pattern combobox+listbox, ARIA 1.2),
 * coerente con ui-dialog/ui-menu. A differenza della select nativa, la tendina
 * aperta e' completamente tematizzata coi token (sfondo popover, opzioni, spunta).
 *
 * API data-driven: <ui-select [options]="opts" [(value)]="v" placeholder="..." />.
 * La larghezza si imposta sull'host (es. class="w-64"); il trigger riempie l'host
 * e il pannello eredita la larghezza del trigger.
 */
@Component({
  selector: 'ui-select',
  imports: [CdkOverlayOrigin, CdkConnectedOverlay, NgIcon, TranslocoPipe],
  providers: [provideIcons({ lucideCheck, lucideChevronDown })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button
      #trigger
      type="button"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      role="combobox"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? listboxId : null"
      [attr.aria-activedescendant]="open() && activeIndex() >= 0 ? optionId(activeIndex()) : null"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown)="onKeydown($event)"
      [class]="triggerClass()"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        @if (tone() !== 'default') {
        <span class="size-1.5 shrink-0 rounded-full" [class]="dotClass()"></span>
        } @else if (selectedAccent(); as acc) {
        <span class="size-1.5 shrink-0 rounded-full" [style.background]="acc"></span>
        }
        <span class="truncate" [class.text-muted-foreground]="selectedLabel() === null">
          {{ selectedLabel() ?? displayPlaceholder() }}
        </span>
      </span>
      <ng-icon
        name="lucideChevronDown"
        size="1rem"
        class="pointer-events-none shrink-0 text-muted-foreground transition-transform"
        [class.rotate-180]="open()"
      />
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayWidth]="triggerWidth()"
      [cdkConnectedOverlayViewportMargin]="8"
      (overlayOutsideClick)="onOutsideClick($event)"
      (detach)="close(false)"
    >
      <div
        #panel
        role="listbox"
        [id]="listboxId"
        class="max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-black/20 animate-in fade-in-0 zoom-in-95"
      >
        @for (opt of options(); track opt.value; let i = $index) {
        <button
          type="button"
          role="option"
          [id]="optionId(i)"
          [attr.aria-selected]="isSelected(opt)"
          [attr.data-active]="i === activeIndex() ? '' : null"
          [disabled]="!!opt.disabled"
          (click)="selectOption(opt)"
          (mouseenter)="opt.disabled || activeIndex.set(i)"
          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition data-[active]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          @if (opt.accent) {
          <span class="size-1.5 shrink-0 rounded-full" [style.background]="opt.accent"></span>
          }
          <span class="flex-1 truncate" [class.font-medium]="isSelected(opt)">{{ opt.label }}</span>
          @if (isSelected(opt)) {
          <ng-icon name="lucideCheck" size="0.9rem" class="shrink-0 text-brand" />
          }
        </button>
        } @empty {
        <div class="px-2.5 py-1.5 text-sm text-muted-foreground">{{ 'common.noOptions' | transloco }}</div>
        }
      </div>
    </ng-template>
  `,
})
export class UiSelect<T = string> {
  private readonly transloco = inject(TranslocoService);
  readonly options = input<readonly UiSelectOption<T>[]>([]);
  readonly placeholder = input('');
  /** Placeholder mostrato: quello passato dal consumer, o il default tradotto se assente. */
  protected readonly displayPlaceholder = computed(() => this.placeholder() || this.transloco.translate('common.selectPlaceholder'));
  /** Tono del trigger: 'default' o una classe di status (pill colorata + dot). */
  readonly tone = input<UiSelectTone>('default');

  // h-8 = stessa altezza del ui-button default, per coerenza tra i controlli.
  private readonly baseTrigger =
    'flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-black/40 pl-3 pr-2.5 text-sm font-medium text-foreground outline-none transition hover:border-ring/40 focus-visible:border-ring/50 focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50';

  /** Classe del trigger: base + override del tono (border/bg/text colorati). */
  protected readonly triggerClass = computed(() => {
    const t = this.tone();
    return cn(this.baseTrigger, t !== 'default' && SELECT_TONE[t]);
  });

  /** Classe del pallino guida (solo se tone !== default). */
  protected readonly dotClass = computed(() => {
    const t = this.tone();
    return t === 'default' ? '' : SELECT_DOT[t];
  });
  readonly disabled = input(false);
  readonly value = model<T | null>(null);

  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);
  protected readonly triggerWidth = signal(0);

  private readonly id = ++uiSelectSeq;
  protected readonly listboxId = `ui-select-${this.id}-listbox`;
  protected optionId(i: number): string {
    return `ui-select-${this.id}-opt-${i}`;
  }

  private readonly triggerRef = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  /** Etichetta dell'opzione selezionata, o null se nessuna (mostra il placeholder). */
  protected readonly selectedLabel = computed(
    () => this.options().find((o) => o.value === this.value())?.label ?? null,
  );

  /** Colore del pallino dell'opzione selezionata (per il trigger), o null. */
  protected readonly selectedAccent = computed(
    () => this.options().find((o) => o.value === this.value())?.accent ?? null,
  );

  /** Sotto il trigger; se non c'e' spazio, sopra. */
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  ];

  protected isSelected(o: UiSelectOption<T>): boolean {
    return o.value === this.value();
  }

  protected toggle(): void {
    this.open() ? this.close(false) : this.openPanel();
  }

  protected openPanel(): void {
    if (this.disabled()) return;
    this.triggerWidth.set(this.triggerRef().nativeElement.offsetWidth);
    const current = this.options().findIndex((o) => o.value === this.value());
    this.activeIndex.set(current >= 0 ? current : this.step(1, true));
    this.open.set(true);
    this.scrollActiveIntoView();
  }

  protected close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.triggerRef().nativeElement.focus();
  }

  protected selectOption(o: UiSelectOption<T>): void {
    if (o.disabled) return;
    this.value.set(o.value);
    this.close(true);
  }

  protected onOutsideClick(event: MouseEvent): void {
    // Un click sul trigger e' gestito da toggle(): ignoralo qui per non
    // chiudere-e-riaprire (altrimenti il pannello non si chiuderebbe mai dal trigger).
    if (this.triggerRef().nativeElement.contains(event.target as Node)) return;
    this.close(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;

    if (!this.open()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        this.openPanel();
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex.set(this.step(1));
        this.scrollActiveIntoView();
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.set(this.step(-1));
        this.scrollActiveIntoView();
        break;
      case 'Home':
        event.preventDefault();
        this.activeIndex.set(this.step(1, true)); // dal bordo in avanti = prima abilitata
        this.scrollActiveIntoView();
        break;
      case 'End':
        event.preventDefault();
        this.activeIndex.set(this.step(-1, true)); // dal bordo all'indietro = ultima abilitata
        this.scrollActiveIntoView();
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const opt = this.options()[this.activeIndex()];
        if (opt) this.selectOption(opt);
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.close(true);
        break;
      case 'Tab':
        this.close(false);
        break;
    }
  }

  /**
   * Prossimo indice abilitato in direzione `dir`. Con `edge` parte dal bordo
   * (primo/ultimo) invece che dall'indice attivo. Salta le opzioni disabilitate.
   */
  private step(dir: 1 | -1, edge = false): number {
    const opts = this.options();
    if (!opts.length) return -1;
    let i = edge ? (dir === 1 ? -1 : opts.length) : this.activeIndex();
    for (let n = 0; n < opts.length; n++) {
      i = (i + dir + opts.length) % opts.length;
      if (!opts[i].disabled) return i;
    }
    return this.activeIndex();
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      this.panelRef()?.nativeElement.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
    });
  }
}
