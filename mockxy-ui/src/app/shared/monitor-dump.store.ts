import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { MockAdminApiService } from '../mock-admin-api.service';
import { ToastService } from '../ui/ui-toast/ui-toast';
import type { MonitorDumpState } from '../mock-admin-api.types';
import { readErrorMessage } from './read-error-message';
import { ReadRetry } from './read-retry';
import { RuntimeSyncStore, affects } from './runtime-sync.store';

/**
 * Dump su disco dello storico monitor (NDJSON append-only), pilotato dalla barra globale. Root-scoped:
 * carica lo stato all'avvio e lo espone a tutte le view. `available` è false quando il backend non offre
 * il dump (in quel caso la barra non mostra il controllo). Estratto dalla pagina Monitor.
 */
type ReadStatus = 'current' | 'superseded' | 'changed';

@Injectable({ providedIn: 'root' })
export class MonitorDumpStore {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly _state = signal<MonitorDumpState | null>(null);
  readonly state = this._state.asReadonly();
  private readonly _busy = signal(false);
  readonly busy = this._busy.asReadonly();
  /** True quando il dump è offerto dal backend (stato caricato): la barra mostra il controllo solo allora. */
  readonly available = computed(() => this._state() !== null);
  readonly enabled = computed(() => this._state()?.enabled ?? false);
  readonly pendingCount = computed(() => this._state()?.pendingCount ?? 0);

  // Cresce a ogni azione dell'utente: una rilettura partita prima non la sovrascrive.
  private changeEpoch = 0;
  // Cresce a ogni lettura: si applica solo la più recente.
  private readSeq = 0;
  // Una lettura fallita e ancora valida si ripete con una rilettura silenziosa (vedi ReadRetry).
  private readonly retry = new ReadRetry(() => this.refresh());
  // Una rilettura saltata o superata da un'azione in corso: si rifà quando l'azione termina.
  private rereadAfterAction = false;

  constructor() {
    inject(RuntimeSyncStore)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (affects(event, 'dump')) this.refresh();
      });
    this.load();
  }

  /**
   * Rilettura silenziosa per la sincronizzazione: un errore transitorio non nasconde il controllo
   * (lo stato di collegamento sta nella status bar), e un'azione dell'utente in corso o arrivata
   * nel frattempo vince. Con un'azione in corso non parte, ma riparte quando l'azione termina,
   * riuscita o no.
   */
  refresh(): void {
    this.retry.cancel();
    if (this._busy()) {
      this.rereadAfterAction = true;
      return;
    }
    const read = this.readTicket();
    this.api.getMonitorDumpState().subscribe({
      next: (state) =>
        this.settleRead(read, () => {
          this.retry.succeeded();
          this._state.set(state);
        }),
      error: () => this.settleRead(read, () => this.retry.failed()),
    });
  }

  load(): void {
    this.retry.cancel();
    const read = this.readTicket();
    this.api.getMonitorDumpState().subscribe({
      next: (state) =>
        this.settleRead(read, () => {
          this.retry.succeeded();
          this._state.set(state);
        }),
      error: () =>
        this.settleRead(read, () => {
          this._state.set(null); // dump non disponibile: niente controllo nella barra, finché un tentativo non lo trova
          this.retry.failed();
        }),
    });
  }

  /** Stato di una lettura al suo esito: ancora valida, superata da una più recente o da un'azione dell'utente. */
  private readTicket(): () => ReadStatus {
    const seq = ++this.readSeq;
    const epoch = this.changeEpoch;
    return () => {
      if (seq !== this.readSeq) return 'superseded';
      return epoch !== this.changeEpoch || this._busy() ? 'changed' : 'current';
    };
  }

  /**
   * Applica l'esito di una lettura ancora valida. Una superata da una lettura più recente lascia
   * decidere quella; una superata da un'azione dell'utente non la sovrascrive, ma si rifà quando
   * l'azione è conclusa: il bisogno di rileggere non si perde.
   */
  private settleRead(read: () => ReadStatus, outcome: () => void): void {
    const status = read();
    if (status === 'current') {
      outcome();
    } else if (status === 'changed') {
      this.rereadAfterSettled();
    }
  }

  private rereadAfterSettled(): void {
    if (this._busy()) {
      this.rereadAfterAction = true;
    } else {
      this.refresh();
    }
  }

  /** Azione dell'utente conclusa, riuscita o no: riparte la rilettura che aveva dovuto aspettare. */
  private actionSettled(): void {
    this._busy.set(false);
    if (this.rereadAfterAction) {
      this.rereadAfterAction = false;
      this.refresh();
    }
  }

  /** Attiva/disattiva la scrittura su disco dello storico. */
  setEnabled(enabled: boolean): void {
    this.changeEpoch += 1;
    this._busy.set(true);
    this.api
      .setMonitorDumpState({ enabled })
      .pipe(finalize(() => this.actionSettled()))
      .subscribe({
        next: (state) => {
          this._state.set(state);
          this.toast.show({
            title: this.transloco.translate(state.enabled ? 'stores.dumpStarted' : 'stores.dumpStopped'),
            description: this.transloco.translate(state.enabled ? 'stores.dumpStartedDesc' : 'stores.dumpStoppedDesc'),
            tone: 'success',
          });
        },
        error: (e) => this.toast.show({ title: this.transloco.translate('common.error'), description: readErrorMessage(e) ?? this.transloco.translate('common.operationFailed'), tone: 'error' }),
      });
  }

  /** Scrive subito su disco le request in coda. */
  flush(): void {
    this.changeEpoch += 1;
    this._busy.set(true);
    this.api
      .flushMonitorDump()
      .pipe(finalize(() => this.actionSettled()))
      .subscribe({
        next: (result) => {
          if (typeof result.enabled === 'boolean') {
            this._state.update((state) => (state ? ({ ...state, ...result } as MonitorDumpState) : state));
          }
          this.toast.show({ title: 'Flush', description: this.transloco.translate('stores.flushDesc', { count: result.flushed }), tone: 'success' });
        },
        error: (e) => this.toast.show({ title: this.transloco.translate('common.error'), description: readErrorMessage(e) ?? this.transloco.translate('common.operationFailed'), tone: 'error' }),
      });
  }
}
