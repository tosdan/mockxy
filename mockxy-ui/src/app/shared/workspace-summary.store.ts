import { Injectable, signal } from '@angular/core';
import type { MockLoadError } from '../mock-admin-api.types';

/** Quello che la status bar sa del workspace: conteggi e definizioni scartate dal caricamento. */
export interface WorkspaceSummary {
  readonly endpoints: number;
  readonly collections: number;
  readonly active: number;
  readonly loadErrors: readonly MockLoadError[];
}

/**
 * Riepilogo del workspace per la status bar della shell.
 *
 * Sono fatti del workspace, non della pagina: quanti endpoint ci sono e quali file il motore ha
 * scartato restano veri anche mentre si guarda il Monitor. Lo alimenta la schermata del catalogo
 * (l'unica che carica l'elenco), e il valore sopravvive alla navigazione perché lo store è
 * root-scoped mentre MocksStore vive quanto la sua pagina.
 *
 * Conseguenza da conoscere: in una sessione in cui il catalogo non è mai stato aperto il riepilogo
 * resta `null` e la status bar non mostra conteggi. Nessuna chiamata in più solo per riempirla.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceSummaryStore {
  private readonly _summary = signal<WorkspaceSummary | null>(null);
  readonly summary = this._summary.asReadonly();

  set(summary: WorkspaceSummary): void {
    this._summary.set(summary);
  }
}
