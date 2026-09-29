import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { MockAdminApiService } from '../mock-admin-api.service';
import { ToastService } from '../ui/ui-toast/ui-toast';
import type { ServerState } from '../mock-admin-api.types';
import { readErrorMessage } from './read-error-message';
import { RuntimeSyncStore, affects } from './runtime-sync.store';

/**
 * Stato runtime del server (server on/off + "proxy all"), riflesso dall'API `/_admin/api/server`.
 * Root-scoped: alimenta la barra globale visibile in tutte le view. Estratto da MocksStore, dove
 * prima viveva insieme al catalogo.
 */
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
   * stato di collegamento sta nella status bar). Scartata se nel frattempo l'utente ha cambiato
   * qualcosa, o se una sua modifica è ancora in volo.
   */
  refresh(): void {
    if (this.pendingPatches > 0) {
      return;
    }
    const epoch = this.changeEpoch;
    this.api.getServerState().subscribe({
      next: (state) => {
        if (epoch !== this.changeEpoch || this.pendingPatches > 0) return;
        this._serverEnabled.set(state.serverEnabled);
        this._proxyAll.set(state.proxyAll);
      },
      error: () => undefined,
    });
  }

  /** Carica lo stato runtime del server (server on/off + proxy all) dall'API. */
  load(): void {
    this._loading.set(true);
    this.api
      .getServerState()
      .pipe(finalize(() => this._loading.set(false)))
      .subscribe({
        next: (state) => {
          this._serverEnabled.set(state.serverEnabled);
          this._proxyAll.set(state.proxyAll);
        },
        error: (e) => this.toast.show({ title: this.transloco.translate('common.error'), description: readErrorMessage(e) ?? this.transloco.translate('common.operationFailed'), tone: 'error' }),
      });
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
    this.api.updateServerState(patch).pipe(finalize(() => (this.pendingPatches -= 1))).subscribe({
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
}
