import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCopy } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Righe per blocco content-visibility e altezza di una riga (text-[12.5px] × leading-[1.7]). */
const CHUNK_ROWS = 100;
const ROW_PX = 21.25;

/** Evidenzia una riga JSON producendo HTML (gia' escapato) con colori dai token. */
function jsonLineHtml(line: string): string {
  const re = /"(?:\\.|[^"\\])*"|true|false|null|-?\d+\.?\d*(?:[eE][+-]?\d+)?|[{}\[\],:]|\s+|[^\s]+/g;
  let out = '';
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const token = match[0];
    const escaped = escapeHtml(token);
    if (/^\s+$/.test(token)) {
      out += escaped;
      continue;
    }
    let color = '';
    if (token.charCodeAt(0) === 34 /* doppio apice */) {
      const rest = line.slice(re.lastIndex).replace(/^\s+/, '');
      color = rest.startsWith(':') ? 'var(--json-key)' : 'var(--json-string)';
    } else if (token === 'true' || token === 'false' || token === 'null') {
      color = 'var(--json-number)';
    } else if (/^-?\d/.test(token)) {
      color = 'var(--json-number)';
    } else if (/^[{}\[\],:]$/.test(token)) {
      color = 'var(--json-punct)';
    }
    out += color ? `<span style="color:${color}">${escaped}</span>` : escaped;
  }
  return out;
}

/**
 * Code block con numeri di riga ed evidenziazione JSON, sui token (--json-*, --code).
 * L'HTML e' generato internamente ed escapato, quindi il bypass del sanitizer e' sicuro.
 * Pulsante "copia" via @angular/cdk/clipboard (appare su hover/focus), con feedback locale.
 */
@Component({
  selector: 'ui-code',
  imports: [CdkCopyToClipboard, NgIcon, TranslocoPipe],
  providers: [provideIcons({ lucideCheck, lucideCopy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="group relative rounded-lg bg-[var(--code)] ring-1 ring-border">
      @if (copyable()) {
      <button
        type="button"
        [cdkCopyToClipboard]="code()"
        (cdkCopyToClipboardCopied)="onCopied($event)"
        [attr.aria-label]="(copied() ? 'common.copied' : 'common.copyCode') | transloco"
        class="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-md bg-[var(--code)]/80 text-muted-foreground opacity-0 ring-1 ring-border transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover:opacity-100"
      >
        <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideCopy'" size="0.85rem" [class.text-positive]="copied()" />
      </button>
      }
      <div class="overflow-x-auto px-4 py-3">
        <!-- Le righe sono raggruppate in blocchi con content-visibility:auto: il browser salta layout
             e paint dei blocchi fuori viewport (body massivi restano fluidi). Il salto è dichiarato
             sul blocco e non sulla singola riga: con decine di migliaia di righe la sola contabilità
             dei confini di containment renderebbe lo scroll lento (~16fps misurati su 14k righe).
             La colonna dei numeri è dimensionata in ch sulle cifre dell'ultima riga, per non
             dipendere dalla larghezza delle righe non renderizzate. -->
        <div class="text-[12.5px] leading-[1.7]" style="font-family: var(--font-mono)" [style.--code-gutter]="gutterWidth()">
          @for (chunk of chunks(); track chunk.start) {
          <div class="[content-visibility:auto]" [style.contain-intrinsic-block-size]="chunk.intrinsicSize">
            @for (line of chunk.lines; track $index) {
            <div class="grid grid-cols-[var(--code-gutter)_1fr] gap-x-4">
              <span class="select-none text-right text-[var(--json-gutter)]">{{ chunk.start + $index + 1 }}</span>
              <span class="whitespace-pre" [innerHTML]="line"></span>
            </div>
            }
          </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class UiCode {
  private readonly sanitizer = inject(DomSanitizer);

  readonly code = input('');
  readonly language = input<'json' | 'text'>('json');
  /** Mostra il pulsante "copia" (default: true). */
  readonly copyable = input(true);

  protected readonly copied = signal(false);

  /** Larghezza della colonna dei numeri di riga: le cifre dell'ultimo numero, in ch (font mono). */
  protected readonly gutterWidth = computed(() => `${String(this.lines().length).length}ch`);

  /** Righe raggruppate in blocchi da 100, con l'altezza intrinseca dichiarata (righe × 21.25px). */
  protected readonly chunks = computed(() => {
    const lines = this.lines();
    const out: { start: number; lines: SafeHtml[]; intrinsicSize: string }[] = [];
    for (let start = 0; start < lines.length; start += CHUNK_ROWS) {
      const slice = lines.slice(start, start + CHUNK_ROWS);
      out.push({ start, lines: slice, intrinsicSize: `auto ${slice.length * ROW_PX}px` });
    }
    return out;
  });

  protected readonly lines = computed<SafeHtml[]>(() => {
    const isJson = this.language() === 'json';
    return this.code()
      .split('\n')
      .map((line) => this.sanitizer.bypassSecurityTrustHtml(isJson ? jsonLineHtml(line) : escapeHtml(line)));
  });

  protected onCopied(success: boolean): void {
    if (!success) return;
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
