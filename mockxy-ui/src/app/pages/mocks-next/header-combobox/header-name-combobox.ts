import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';

/** Nomi di header HTTP più comuni (casing canonico), suggeriti nella combobox delle response. */
const COMMON_HEADERS: readonly string[] = [
  'Content-Type',
  'Cache-Control',
  'Content-Disposition',
  'Content-Encoding',
  'Content-Language',
  'Content-Length',
  'ETag',
  'Expires',
  'Last-Modified',
  'Location',
  'Set-Cookie',
  'Vary',
  'Retry-After',
  'WWW-Authenticate',
  'Allow',
  'Accept-Ranges',
  'Content-Range',
  'Age',
  'Link',
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'Referrer-Policy',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'X-XSS-Protection',
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Access-Control-Allow-Credentials',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
  'X-Request-Id',
  'X-Powered-By',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
];

/** Filtra gli header per `query` (case-insensitive): prima i prefissi, poi le sottostringhe; vuoto = tutti. */
function searchHeaders(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...COMMON_HEADERS];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const header of COMMON_HEADERS) {
    const lower = header.toLowerCase();
    if (lower.startsWith(q)) starts.push(header);
    else if (lower.includes(q)) contains.push(header);
  }
  return [...starts, ...contains];
}

let headerComboboxSeq = 0;

/**
 * Combobox editabile per il NOME di un header, con la stessa interazione della status-combobox: si digita per
 * filtrare i suggerimenti (header più comuni) oppure si apre la tendina per sceglierne uno noto. Resta free-solo:
 * qualsiasi nome digitato a mano è accettato (gli header sono case-insensitive). Call-site: `[(value)]="key"`.
 */
@Component({
  selector: 'mocks-next-header-combobox',
  imports: [CdkOverlayOrigin, CdkConnectedOverlay, NgIcon, TranslocoPipe],
  providers: [provideIcons({ lucideChevronDown })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="relative" cdkOverlayOrigin #origin="cdkOverlayOrigin">
      <input
        #field
        type="text"
        autocomplete="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? listboxId : null"
        [attr.aria-activedescendant]="open() && activeIndex() >= 0 ? optionId(activeIndex()) : null"
        [disabled]="disabled()"
        [value]="value()"
        [placeholder]="effectivePlaceholder()"
        class="w-full rounded-lg border border-input bg-black/30 py-1.5 pl-3 pr-7 font-mono text-[12px] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-ring/50 focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
        (focus)="onFocus()"
        (input)="onInput($any($event.target).value)"
        (click)="onClick()"
        (keydown)="onKeydown($event)"
      />
      <button
        type="button"
        tabindex="-1"
        aria-hidden="true"
        [disabled]="disabled()"
        (mousedown)="$event.preventDefault()"
        (click)="onClick()"
        class="absolute inset-y-0 right-0 grid w-7 place-items-center text-muted-foreground disabled:opacity-50"
      >
        <ng-icon name="lucideChevronDown" size="0.9rem" class="transition-transform" [class.rotate-180]="open()" />
      </button>
    </div>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayViewportMargin]="8"
      (overlayOutsideClick)="onOutsideClick($event)"
      (detach)="close(false)"
    >
      <div
        #panel
        role="listbox"
        [id]="listboxId"
        class="mx-scroll max-h-60 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-black/20 animate-in fade-in-0 zoom-in-95"
      >
        @for (opt of suggestions(); track opt; let i = $index) {
        <button
          type="button"
          role="option"
          [id]="optionId(i)"
          [attr.aria-selected]="opt === value()"
          [attr.data-active]="i === activeIndex() ? '' : null"
          (mousedown)="$event.preventDefault()"
          (click)="selectOption(opt)"
          (mouseenter)="activeIndex.set(i)"
          class="flex w-full cursor-pointer items-center rounded-md px-2.5 py-1.5 text-left font-mono text-[12.5px] outline-none transition data-[active]:bg-accent"
        >
          <span class="flex-1 truncate" [class.font-medium]="opt === value()">{{ opt }}</span>
        </button>
        } @empty {
        <div class="px-2.5 py-1.5 text-sm text-muted-foreground">{{ 'headerCombobox.noKnownHeaders' | transloco }}</div>
        }
      </div>
    </ng-template>
  `,
})
export class HeaderNameCombobox {
  private readonly transloco = inject(TranslocoService);

  /** Nome dell'header committato (free-solo). */
  readonly value = model<string>('');
  readonly disabled = input(false);
  /** Placeholder dell'input; se omesso usa il default tradotto (`headerCombobox.placeholder`). */
  readonly placeholder = input<string | null>(null);

  /** Placeholder effettivo: quello passato dal call-site oppure il default tradotto. */
  protected readonly effectivePlaceholder = computed(
    () => this.placeholder() ?? this.transloco.translate('headerCombobox.placeholder'),
  );

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);

  private readonly seq = ++headerComboboxSeq;
  protected readonly listboxId = `header-combobox-${this.seq}-listbox`;
  protected optionId(i: number): string {
    return `header-combobox-${this.seq}-opt-${i}`;
  }

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly suggestions = computed(() => searchHeaders(this.query()));

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  ];

  protected onInput(raw: string): void {
    this.value.set(raw);
    this.query.set(raw);
    if (!this.open()) this.open.set(true);
    this.activeIndex.set(this.suggestions().length > 0 ? 0 : -1);
  }

  /** Al focus seleziona tutto, così il primo tasto sostituisce il valore invece di inserirsi nel mezzo. */
  protected onFocus(): void {
    this.inputRef().nativeElement.select();
  }

  protected onClick(): void {
    if (this.disabled()) return;
    this.open() ? this.close(false) : this.openPanel();
  }

  /** Apre la tendina in modalità "sfoglia" (filtro azzerato) e posiziona l'attivo sul valore corrente. */
  private openPanel(): void {
    if (this.disabled()) return;
    this.query.set('');
    this.activeIndex.set(this.suggestions().findIndex((h) => h === this.value()));
    this.open.set(true);
    this.scrollActiveIntoView();
  }

  protected close(refocus: boolean): void {
    if (this.open()) this.open.set(false);
    if (refocus) this.inputRef().nativeElement.focus();
  }

  protected selectOption(opt: string, refocus = true): void {
    this.value.set(opt);
    this.query.set('');
    this.close(refocus);
  }

  protected onOutsideClick(event: MouseEvent): void {
    if (this.inputRef().nativeElement.contains(event.target as Node)) return;
    this.close(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;

    if (!this.open()) {
      if (event.key === 'ArrowDown') {
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
        this.activeIndex.set(this.suggestions().length > 0 ? 0 : -1);
        this.scrollActiveIntoView();
        break;
      case 'End':
        event.preventDefault();
        this.activeIndex.set(this.suggestions().length - 1);
        this.scrollActiveIntoView();
        break;
      case 'Enter': {
        event.preventDefault();
        const opt = this.suggestions()[this.activeIndex()];
        opt ? this.selectOption(opt) : this.close(true);
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.close(true);
        break;
      case 'Tab': {
        // Tab conferma il suggerimento evidenziato e lascia spostare il focus (niente preventDefault).
        const opt = this.suggestions()[this.activeIndex()];
        opt ? this.selectOption(opt, false) : this.close(false);
        break;
      }
    }
  }

  /** Prossimo indice in direzione `dir`, ciclico; da -1 parte dal bordo coerente con la direzione. */
  private step(dir: 1 | -1): number {
    const total = this.suggestions().length;
    if (total === 0) return -1;
    const current = this.activeIndex();
    if (current < 0) return dir === 1 ? 0 : total - 1;
    return (current + dir + total) % total;
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      this.panelRef()?.nativeElement.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
    });
  }
}
