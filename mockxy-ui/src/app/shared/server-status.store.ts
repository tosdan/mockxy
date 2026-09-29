import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { MockAdminApiService } from '../mock-admin-api.service';
import { ToastService } from '../ui/ui-toast/ui-toast';
import type { ServerState } from '../mock-admin-api.types';
import { readErrorMessage } from './read-error-message';
import { ReadRetry } from './read-retry';
import { RuntimeSyncStore, affects } from './runtime-sync.store';

/**
 * Stato runtime del server (server on/off + "proxy all"), riflesso dall'API `/_admin/api/server`.
 * Root-scoped: alimenta la barra globale visibile in tutte le view. Estratto da MocksStore, dove
 * prima viveva insieme al catalogo.
 */
type ReadStatus = 'current' | 'superseded' | 'changed';

@Injectable({ providedIn: 'root' })
export class ServerStatusStore {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly _serverEnabled = signal(true);
  readonly serverEnabled = this._serverEnabled.asReadonly();
  private readonly _proxyAll = signal(false);
  readonly proxyAll = this._proxyAll.asReadonly();
  private readonly _loading = signal(true);
  readonly loading = this._loading.asReadonly();
  // Cresce a ogni modifica dell'utente: una rilettura partita prima non la sovrascrive.
  private changeEpoch = 0;
  private pendingPatches = 0;
  // Cresce a ogni lettura: si applica solo la più recente, così una risposta superata da un'altra
  // lettura (caricamento iniziale o rilettura) non ripristina un valore vecchio.
  private readSeq = 0;
  // Una lettura fallita e ancora valida si ripete con una rilettura silenziosa (vedi ReadRetry).
  private readonly retry = new ReadRetry(() => this.refresh());
  // Una rilettura saltata o superata da una modifica in volo: si rifà quando la modifica termina.
  private rereadAfterChange = false;

  constructor() {
    // Stato cambiato da un agente o da un'altra finestra, o motore ripartito: dopo una
    // riconnessione Proxy All torna quello vero senza ricaricare la pagina.
    inject(RuntimeSyncStore)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (affects(event, 'server')) this.refresh();
      });
    this.load();
  }

  /**
   * Rilettura silenziosa per la sincronizzazione: niente indicatore di caricamento né toast (lo
   * stato di collegamento sta nella status bar). Con una modifica dell'utente in volo non parte, ma
   * riparte quando la modifica termina, riuscita o no.
   */
  refresh(): void {
    this.retry.cancel();
    if (this.pendingPatches > 0) {
      this.rereadAfterChange = true;
      return;
    }
    const read = this.readTicket();
    this.api.getServerState().subscribe({
      next: (state) =>
        this.settleRead(read, () => {
          this.retry.succeeded();
          this.applyState(state);
        }),
      error: () => this.settleRead(read, () => this.retry.failed()),
    });
  }

  /** Carica lo stato runtime del server (server on/off + proxy all) dall'API. */
  load(): void {
    this.retry.cancel();
    this._loading.set(true);
    const read = this.readTicket();
    this.api
      .getServerState()
      .pipe(finalize(() => this._loading.set(false)))
      .subscribe({
        next: (state) =>
          this.settleRead(read, () => {
            this.retry.succeeded();
            this.applyState(state);
          }),
        error: (e) =>
          this.settleRead(read, () => {
            this.toast.show({ title: this.transloco.translate('common.error'), description: readErrorMessage(e) ?? this.transloco.translate('common.operationFailed'), tone: 'error' });
            this.retry.failed();
          }),
      });
  }

  /** Stato di una lettura al suo esito: ancora valida, superata da una più recente o da una modifica dell'utente. */
  private readTicket(): () => ReadStatus {
    const seq = ++this.readSeq;
    const epoch = this.changeEpoch;
    return () => {
      if (seq !== this.readSeq) return 'superseded';
      return epoch !== this.changeEpoch || this.pendingPatches > 0 ? 'changed' : 'current';
    };
  }

  /**
   * Applica l'esito di una lettura ancora valida. Una superata da una lettura più recente lascia
   * decidere quella; una superata da una modifica dell'utente non sovrascrive la modifica, ma si
   * rifà quando la modifica è conclusa: il bisogno di rileggere non si perde.
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
    if (this.pendingPatches > 0) {
      this.rereadAfterChange = true;
    } else {
      this.refresh();
    }
  }

  private applyState(state: ServerState): void {
    this._serverEnabled.set(state.serverEnabled);
    this._proxyAll.set(state.proxyAll);
  }

  /** Accende/spegne il server (off = passthrough puro: nessun mock, nessun monitor). */
  setServerEnabled(enabled: boolean): void {
    this.patch({ serverEnabled: enabled });
  }

  /** Attiva/disattiva "proxy all" (tutte le chiamate proxate, nessun mock, ma monitor attivo). */
  setProxyAll(proxyAll: boolean): void {
    this.patch({ proxyAll });
  }

  /** Aggiorna lo stato server con update ottimistico e rollback in caso di errore. */
  private patch(patch: Partial<ServerState>): void {
    const previous = { serverEnabled: this._serverEnabled(), proxyAll: this._proxyAll() };
    if (patch.serverEnabled !== undefined) this._serverEnabled.set(patch.serverEnabled);
    if (patch.proxyAll !== undefined) this._proxyAll.set(patch.proxyAll);
    this.changeEpoch += 1;
    this.pendingPatches += 1;
    this.api.updateServerState(patch).pipe(finalize(() => this.patchSettled())).subscribe({
      next: (state) => {
        this._serverEnabled.set(state.serverEnabled);
        this._proxyAll.set(state.proxyAll);
      },
      error: (e) => {
        this._serverEnabled.set(previous.serverEnabled);
        this._proxyAll.set(previous.proxyAll);
        this.toast.show({ title: this.transloco.translate('common.error'), description: readErrorMessage(e) ?? this.transloco.translate('common.operationFailed'), tone: 'error' });
      },
    });
  }

  /** Ultima modifica conclusa, riuscita o no: riparte la rilettura che aveva dovuto aspettare. */
  private patchSettled(): void {
    this.pendingPatches -= 1;
    if (this.pendingPatches === 0 && this.rereadAfterChange) {
      this.rereadAfterChange = false;
      this.refresh();
    }
  }
}
