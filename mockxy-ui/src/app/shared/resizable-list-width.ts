import { signal } from '@angular/core';

/** Larghezza minima di una lista con dettaglio a fianco (come il catalogo). */
export const MIN_LIST_WIDTH = 380;
/** Spazio che resta comunque al dettaglio, a destra della lista. */
const MIN_DETAIL_WIDTH = 480;

/**
 * Larghezza di una lista ridimensionabile col divisore (Monitor, Storico, Dati): si trascina, il
 * doppio clic la riporta al default, e resta in localStorage per la visita successiva. Prima ogni
 * pagina ne aveva una copia.
 */
export class ResizableListWidth {
  readonly width = signal(0);

  constructor(
    private readonly storageKey: string,
    private readonly defaultWidth = 440,
  ) {
    this.width.set(this.clamp(this.readStored()));
  }

  /** Trascina il divisore: aggiorna la larghezza, e la salva al rilascio. */
  startResize(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.width();
    const onMove = (e: PointerEvent) => this.width.set(this.clamp(startWidth + (e.clientX - startX)));
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.removeProperty('user-select');
      this.store(this.width());
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.userSelect = 'none';
  }

  /** Doppio clic sul divisore: torna alla larghezza di default. */
  reset(): void {
    this.width.set(this.clamp(this.defaultWidth));
    this.store(this.width());
  }

  private readStored(): number {
    try {
      const n = parseInt(localStorage.getItem(this.storageKey) ?? '', 10);
      return Number.isFinite(n) ? n : this.defaultWidth;
    } catch {
      return this.defaultWidth;
    }
  }

  private store(width: number): void {
    try {
      localStorage.setItem(this.storageKey, String(width));
    } catch {
      /* localStorage non disponibile: la larghezza vale per questa visita */
    }
  }

  /** Fra il minimo e quanto lascia al dettaglio il suo spazio minimo. */
  private clamp(width: number): number {
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const max = Math.max(MIN_LIST_WIDTH, viewport - MIN_DETAIL_WIDTH);
    return Math.round(Math.max(MIN_LIST_WIDTH, Math.min(width, max)));
  }
}
