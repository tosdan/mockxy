import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Testata di una pagina (Monitor, Storico, Dati), sul modello di quella del catalogo: il nome della
 * vista in maiuscoletto, lo stesso della barra a sinistra, poi quello che la pagina proietta
 * (conteggio, stato, schede) e a destra le azioni, proiettate con l'attributo `actions`.
 */
@Component({
  selector: 'ui-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-5' },
  template: `
    <h1 class="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{{ title() }}</h1>
    <ng-content />
    <div class="ml-auto flex items-center gap-2"><ng-content select="[actions]" /></div>
  `,
})
export class UiPageHeader {
  readonly title = input.required<string>();
}
