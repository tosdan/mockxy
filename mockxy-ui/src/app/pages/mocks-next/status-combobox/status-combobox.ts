import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown } from '@ng-icons/lucide';
import { cn } from '../../../ui/cn';
import { HttpStatusCodesService, type HttpStatusCodeOption } from '../../../http-status-codes.service';

/**
 * Vero se `value` è uno status HTTP valido (intero 100–599). Esposto per le guardie di submit dei
 * call-site. Copia UI della regola del motore (isValidHttpStatus in src/http-body-utils.js):
 * bundle diversi, nessun codice condiviso — se la regola cambia, aggiornarle entrambe.
 */
export function isValidStatus(value: number | null | undefined): boolean {
  return value != null && Number.isInteger(value) && value >= 100 && value <= 599;
}

type StatusTone = 'default' | '2xx' | '3xx' | '4xx' | '5xx';

// Pill colorata per fascia (border+bg+text), allineata a SELECT_TONE di ui-select per coerenza con la pill read-only.
const TONE_PILL: Record<Exclude<StatusTone, 'default'>, string> = {
  '2xx': 'border-[color:var(--status-2xx)]/25 bg-[color:var(--status-2xx)]/[0.08] text-[color:var(--status-2xx)]/90',
  '3xx': 'border-[color:var(--status-3xx)]/25 bg-[color:var(--status-3xx)]/[0.08] text-[color:var(--status-3xx)]/90',
  '4xx': 'border-[color:var(--status-4xx)]/25 bg-[color:var(--status-4xx)]/[0.08] text-[color:var(--status-4xx)]/90',
  '5xx': 'border-[color:var(--status-5xx)]/25 bg-[color:var(--status-5xx)]/[0.08] text-[color:var(--status-5xx)]/90',
};

// Pallino guida per fascia (sui token --status-*), come SELECT_DOT di ui-select.
const TONE_DOT: Record<Exclude<StatusTone, 'default'>, string> = {
  '2xx': 'bg-[color:var(--status-2xx)]/80',
  '3xx': 'bg-[color:var(--status-3xx)]/80',
  '4xx': 'bg-[color:var(--status-4xx)]/80',
  '5xx': 'bg-[color:var(--status-5xx)]/80',
};

let statusComboboxSeq = 0;

/**
 * Combobox editabile per lo status HTTP, con l'estetica della pill di stato (ui-select tone): bordo/sfondo/
 * testo colorati per fascia + pallino guida, e la **label completa** (`200 OK`) mostrata dentro al controllo,
 * non in un testo esterno. Resta **free-solo**: il valore committato è sempre un numero e qualsiasi codice
 * 100–599 digitato a mano è accettato anche se non è tra i suggerimenti. La tendina filtra per codice o
 * descrizione (riusa HttpStatusCodesService). I call-site si riducono a `<mocks-next-status-combobox [(value)]="status" />`.
 */
@Component({
  selector: 'mocks-next-status-combobox',
  imports: [CdkOverlayOrigin, CdkConnectedOverlay, NgIcon, TranslocoPipe],
  providers: [provideIcons({ lucideChevronDown })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-1">
      <div class="relative w-fit" cdkOverlayOrigin #origin="cdkOverlayOrigin">
        @if (tone() !== 'default') {
        <span
          class="pointer-events-none absolute left-2.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full"
          [class]="dotClass()"
        ></span>
        }
        @if (readOnly()) {
        <span [class]="inputClass()">{{ text() }}</span>
        } @else {
        <input
          #field
          type="text"
          autocomplete="off"
          role="combobox"
          aria-autocomplete="list"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="open() ? listboxId : null"
          [attr.aria-activedescendant]="open() && activeIndex() >= 0 ? optionId(activeIndex()) : null"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [disabled]="disabled()"
          [attr.size]="text().length + 1"
          [value]="text()"
          placeholder="200"
          [class]="inputClass()"
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
        }
      </div>
      @if (invalid()) {
      <span class="text-[11.5px] text-destructive-soft">{{ 'statusCombobox.invalid' | transloco }}</span>
      }
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
        class="mx-scroll max-h-60 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-black/20 animate-in fade-in-0 zoom-in-95"
      >
        @for (opt of suggestions(); track opt.code; let i = $index) {
        <button
          type="button"
          role="option"
          [id]="optionId(i)"
          [attr.aria-selected]="opt.code === value()"
          [attr.data-active]="i === activeIndex() ? '' : null"
          (mousedown)="$event.preventDefault()"
          (click)="selectOption(opt)"
          (mouseenter)="activeIndex.set(i)"
          class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition data-[active]:bg-accent"
        >
          <span class="size-1.5 shrink-0 rounded-full" [class]="dotClassFor(opt.code)"></span>
          <span class="w-9 shrink-0 tabular-nums text-muted-foreground">{{ opt.code }}</span>
          <span class="flex-1 truncate" [class.font-medium]="opt.code === value()">{{ opt.description }}</span>
        </button>
        } @empty {
        <div class="px-2.5 py-1.5 text-sm text-muted-foreground">{{ 'statusCombobox.noCode' | transloco }}</div>
        }
      </div>
    </ng-template>
  `,
})
export class StatusCombobox {
  private readonly codes = inject(HttpStatusCodesService);

  /** Status committato. Sempre un numero (o null se il campo è vuoto/non numerico). */
  readonly value = model<number | null>(null);
  readonly disabled = input(false);
  /** Sola lettura: pill colorata con label completa, non interattiva (per la vista del mock). */
  readonly readOnly = input(false);

  /** Contenuto dell'input: la label `codice descrizione` quando committato, o il testo grezzo durante la digitazione. */
  protected readonly text = signal('');
  /** Filtro corrente della tendina (vuoto = mostra tutto, p.es. all'apertura per "sfogliare"). */
  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);

  /** Vero finché l'utente sta interagendo: blocca il sync esterno value→text per non calpestare la digitazione. */
  private editing = false;

  private readonly seq = ++statusComboboxSeq;
  protected readonly listboxId = `status-combobox-${this.seq}-listbox`;
  protected optionId(i: number): string {
    return `status-combobox-${this.seq}-opt-${i}`;
  }

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('field');
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly suggestions = computed(() => this.codes.search(this.query()));
  protected readonly invalid = computed(() => !isValidStatus(this.value()));

  /** Fascia di status del valore corrente (default per invalidi e 1xx, come la pill read-only). */
  protected readonly tone = computed<StatusTone>(() => {
    const v = this.value();
    if (v == null || !isValidStatus(v) || v < 200) return 'default';
    if (v >= 500) return '5xx';
    if (v >= 400) return '4xx';
    if (v >= 300) return '3xx';
    return '2xx';
  });

  /** Classe della pill: base mergeabile + override del tono (border/bg/text per fascia) + spazio per il pallino. */
  private readonly baseInput =
    'h-8 rounded-lg border border-input bg-black/40 text-sm font-medium text-foreground outline-none transition';
  protected readonly inputClass = computed(() => {
    const t = this.tone();
    const ro = this.readOnly();
    return cn(
      this.baseInput,
      ro
        ? 'inline-flex items-center whitespace-nowrap select-none pr-3'
        : 'field-sizing-content min-w-44 pr-7 hover:border-ring/40 focus:border-ring/50 focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50',
      t === 'default' ? 'pl-3' : 'pl-6',
      t !== 'default' && TONE_PILL[t],
    );
  });
  protected readonly dotClass = computed(() => {
    const t = this.tone();
    return t === 'default' ? '' : TONE_DOT[t];
  });
  /** Colore del pallino di una riga della tendina, per fascia. */
  protected dotClassFor(code: number): string {
    if (code >= 500) return TONE_DOT['5xx'];
    if (code >= 400) return TONE_DOT['4xx'];
    if (code >= 300) return TONE_DOT['3xx'];
    if (code >= 200) return TONE_DOT['2xx'];
    return 'bg-muted-foreground';
  }

  /** Sotto l'input; se non c'è spazio, sopra. */
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  ];

  constructor() {
    // Sync esterno: quando `value` cambia da fuori (init del parent, reset all'avvio della modifica)
    // riallinea il testo alla label, ma non mentre l'utente digita (altrimenti gli sovrascriveremmo l'input).
    effect(() => {
      const v = this.value();
      if (this.editing) return;
      untracked(() => this.text.set(this.label(v)));
    });
  }

  /** Etichetta visualizzata per un valore: `codice descrizione` se noto, altrimenti il solo codice (o vuoto). */
  private label(value: number | null): string {
    if (value == null) return '';
    return this.codes.findByCode(value)?.label ?? String(value);
  }

  protected onInput(raw: string): void {
    if (this.readOnly()) return;
    this.editing = true;
    this.text.set(raw);
    this.query.set(raw);
    const parsed = parseInt(raw, 10);
    this.value.set(Number.isNaN(parsed) ? null : parsed);
    if (!this.open()) this.open.set(true);
    this.activeIndex.set(this.suggestions().length > 0 ? 0 : -1);
  }

  /** Al focus seleziona tutto, così il primo tasto sostituisce la label invece di inserirsi nel mezzo. */
  protected onFocus(): void {
    if (this.readOnly()) return;
    this.inputRef().nativeElement.select();
  }

  protected onClick(): void {
    if (this.disabled() || this.readOnly()) return;
    this.open() ? this.close(false) : this.openPanel();
  }

  /** Apre la tendina in modalità "sfoglia" (filtro azzerato) e posiziona l'attivo sul valore corrente. */
  private openPanel(): void {
    if (this.disabled()) return;
    this.editing = true;
    this.query.set('');
    const current = this.suggestions().findIndex((o) => o.code === this.value());
    this.activeIndex.set(current);
    this.open.set(true);
    this.scrollActiveIntoView();
  }

  protected close(refocus: boolean): void {
    this.editing = false;
    if (this.open()) this.open.set(false);
    // Canonicalizza il testo sulla label del valore committato se valido; se è invalido lascio il testo digitato
    // così l'utente vede cosa ha inserito (con il messaggio di errore).
    const v = this.value();
    if (v != null) this.text.set(this.label(v));
    if (refocus) this.inputRef().nativeElement.focus();
  }

  protected selectOption(opt: HttpStatusCodeOption, refocus = true): void {
    this.value.set(opt.code);
    this.text.set(opt.label);
    this.query.set('');
    this.close(refocus);
  }

  protected onOutsideClick(event: MouseEvent): void {
    if (this.inputRef().nativeElement.contains(event.target as Node)) return;
    this.close(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled() || this.readOnly()) return;

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
        // Tab conferma il suggerimento evidenziato e lascia spostare il focus al campo successivo
        // (niente preventDefault, niente refocus). Senza un suggerimento attivo chiude e basta:
        // il valore free-solo è già committato live.
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
