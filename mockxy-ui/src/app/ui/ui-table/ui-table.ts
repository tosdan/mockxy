import { Directive } from '@angular/core';

/**
 * Tabella standardizzata: si applica a <table>. Fornisce la "base look" (larghezza
 * piena, righe con bordo tenue, zebra e hover sui token) tramite la classe `.ui-table`
 * (regole globali in styles.css). Il padding/allineamento delle celle resta al
 * consumatore (utility Tailwind), cosi' restano configurabili.
 *
 * <table ui-table><tbody><tr><td class="py-1.5 pl-6 pr-4">…</td></tr></tbody></table>
 */
@Directive({
  selector: 'table[ui-table]',
  host: { class: 'ui-table w-full border-collapse' },
})
export class UiTable {}
