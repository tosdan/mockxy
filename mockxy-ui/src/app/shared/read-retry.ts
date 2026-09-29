import { DestroyRef, inject } from '@angular/core';

/** Attese fra i tentativi di una lettura fallita: raddoppiano fino al massimo, ripartono al successo. */
export const READ_RETRY_MIN_MS = 1000;
export const READ_RETRY_MAX_MS = 30000;

/**
 * Nuovi tentativi di una lettura fallita, per gli store che si rileggono sulla sincronizzazione col
 * runtime. Senza, una lettura fallita dopo un cambio di revisione non si ripeterebbe più: il polling
 * ha già visto quella revisione e non chiede di rileggere. Il tentativo richiama la lettura dello
 * store, che conserva le sue protezioni contro risposte superate e modifiche dell'utente.
 *
 * Va creato in un contesto di injection (un inizializzatore di campo dello store): allo smontaggio
 * annulla il tentativo in attesa e non ne pianifica altri.
 */
export class ReadRetry {
  private timer?: ReturnType<typeof setTimeout>;
  private delay = READ_RETRY_MIN_MS;
  private destroyed = false;

  constructor(private readonly read: () => void) {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.cancel();
    });
  }

  /**
   * Lettura fallita: la ripete dopo l'attesa corrente, che raddoppia per la volta successiva. Dopo
   * lo smontaggio non pianifica più niente, anche se una richiesta ancora in volo fallisce.
   */
  failed(): void {
    if (this.destroyed) return;
    this.cancel();
    const delay = this.delay;
    this.delay = Math.min(delay * 2, READ_RETRY_MAX_MS);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.read();
    }, delay);
  }

  /** Lettura riuscita: niente più tentativi, e la prossima attesa riparte dalla minima. */
  succeeded(): void {
    this.cancel();
    this.delay = READ_RETRY_MIN_MS;
  }

  /** Una lettura nuova sostituisce il tentativo in attesa. */
  cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
