import { Injectable, inject, signal } from '@angular/core';
import { Subscription, finalize } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { MockAdminApiService } from '../mock-admin-api.service';
import { ToastService } from '../ui/ui-toast/ui-toast';
import type { RequestMonitorEntry, RequestMonitorStreamEvent } from '../mock-admin-api.types';
import { readErrorMessage } from './read-error-message';

/**
 * Cattura live del traffico intercettato (stream SSE + storico in RAM), estratta dalla pagina Monitor
 * per essere pilotata dalla barra globale. Root-scoped e **sempre attiva in background**: lo stream parte
 * alla creazione e resta aperto in tutte le view finché non viene messo in pausa, così il traffico si
 * accumula anche fuori dal Monitor e lo si ritrova tornando sulla pagina. La selezione/i filtri restano
 * locali alla pagina Monitor: qui vivono solo lo stream e l'elenco grezzo.
 */
@Injectable({ providedIn: 'root' })
export class MonitorStreamStore {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private streamSub?: Subscription;

  private readonly _entries = signal<readonly RequestMonitorEntry[]>([]);
  readonly entries = this._entries.asReadonly();
  private readonly _streaming = signal(false);
  readonly streaming = this._streaming.asReadonly();
  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();
  private readonly _clearing = signal(false);
  readonly clearing = this._clearing.asReadonly();

  constructor() {
    this.resume();
  }

  /** Avvia o sospende la cattura live in base al valore richiesto dalla barra. */
  setStreaming(on: boolean): void {
    on ? this.resume() : this.pause();
  }

  /** Svuota lo storico (lato server e in RAM); il backend propaga anche un evento `clear` ai client. */
  clear(): void {
    this._clearing.set(true);
    this.api
      .clearRequestMonitoring()
      .pipe(finalize(() => this._clearing.set(false)))
      .subscribe({
        next: () => this._entries.set([]),
        error: (e) => this.toast.show({ title: this.transloco.translate('common.error'), description: readErrorMessage(e) ?? this.transloco.translate('common.operationFailed'), tone: 'error' }),
      });
  }

  /** Apre lo stream SSE e sincronizza l'elenco con lo snapshot server-side. */
  private resume(): void {
    if (this._streaming()) return;
    this._loading.set(true);
    this.streamSub = this.api.streamRequestMonitoring().subscribe({
      next: (event) => this.applyStreamEvent(event),
      error: (e: unknown) => {
        this._loading.set(false);
        this._streaming.set(false);
        this.toast.show({ title: this.transloco.translate('stores.monitorUnreachable'), description: readErrorMessage(e) ?? this.transloco.translate('common.operationFailed'), tone: 'error' });
      },
    });
    this._streaming.set(true);
  }

  /** Chiude la connessione live lasciando intatto lo storico ricevuto. */
  private pause(): void {
    this.streamSub?.unsubscribe();
    this.streamSub = undefined;
    this._streaming.set(false);
    this._loading.set(false);
  }

  private applyStreamEvent(event: RequestMonitorStreamEvent): void {
    this._loading.set(false);
    if (event.type === 'snapshot') {
      this._entries.set(event.items);
      return;
    }
    if (event.type === 'clear') {
      this._entries.set([]);
      return;
    }
    this._entries.update((list) => [event.item, ...list.filter((entry) => entry.id !== event.item.id)]);
  }
}
