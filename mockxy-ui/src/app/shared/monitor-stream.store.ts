import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { MockAdminApiService } from '../mock-admin-api.service';
import { ToastService } from '../ui/ui-toast/ui-toast';
import type { RequestMonitorEntry, RequestMonitorStreamEvent } from '../mock-admin-api.types';
import { readErrorMessage } from './read-error-message';
import { RuntimeSyncStore } from './runtime-sync.store';

/**
 * Cattura live del traffico intercettato (stream SSE + storico in RAM), estratta dalla pagina Monitor
 * per essere pilotata dalla barra globale. Root-scoped e **sempre attiva in background**: lo stream parte
 * alla creazione e resta aperto in tutte le view finché non viene messo in pausa, così il traffico si
 * accumula anche fuori dal Monitor e lo si ritrova tornando sulla pagina. La selezione/i filtri restano
 * locali alla pagina Monitor: qui vivono solo lo stream e l'elenco grezzo.
 */
/** Primo tentativo di riapertura dello stream dopo un'interruzione; poi raddoppia fino al massimo. */
export const STREAM_RETRY_MS = 2000;
export const STREAM_RETRY_MAX_MS = 30000;

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
  private readonly _runtimeId = signal<string | null>(null);
  /**
   * Runtime a cui appartengono le voci mostrate, dichiarato dallo snapshot: gli ID ripartono a ogni
   * avvio, e chi crea mock da queste catture deve mandare questo, non il runtime di adesso.
   */
  readonly runtimeId = this._runtimeId.asReadonly();
  /** Lo stream si è chiuso per un errore, non per una pausa: si riapre appena il motore risponde. */
  private interrupted = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = STREAM_RETRY_MS;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearRetry());
    // Un nuovo runtime ha uno storico nuovo: si riapre lo stream, la cui istantanea sostituisce
    // l'elenco. Dopo un'interruzione lo si riapre quando il collegamento torna.
    inject(RuntimeSyncStore)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.kind === 'runtime') {
          this.forgetRuntime();
        }
        if (event.kind === 'runtime' && (this._streaming() || this.interrupted)) {
          this.clearRetry();
          this.close();
          this.resume();
        } else if (event.kind === 'resync' && this.interrupted) {
          this.clearRetry();
          this.resume();
        }
      });
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
        // Un solo avviso per interruzione: i tentativi di riapertura non ne aggiungono altri.
        if (!this.interrupted) {
          this.toast.show({ title: this.transloco.translate('stores.monitorUnreachable'), description: readErrorMessage(e) ?? this.transloco.translate('common.operationFailed'), tone: 'error' });
        }
        this.interrupted = true;
        // Può cadere il solo stream mentre GET /info risponde come prima: nessun evento della
        // sincronizzazione lo riaprirebbe, quindi riprova da sé, con attese crescenti.
        this.scheduleRetry();
      },
    });
    this._streaming.set(true);
  }

  /** Pausa voluta: chiude la connessione live lasciando intatto lo storico ricevuto. */
  private pause(): void {
    this.interrupted = false;
    this.clearRetry();
    this.close();
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, STREAM_RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.interrupted) this.resume();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private close(): void {
    this.streamSub?.unsubscribe();
    this.streamSub = undefined;
    this._streaming.set(false);
    this._loading.set(false);
  }

  /** Nuovo runtime: le voci mostrate non appartengono più a quello corrente finché non arriva il nuovo snapshot. */
  private forgetRuntime(): void {
    this._runtimeId.set(null);
  }

  private applyStreamEvent(event: RequestMonitorStreamEvent): void {
    this._loading.set(false);
    this.interrupted = false;
    this.retryDelay = STREAM_RETRY_MS;
    if (event.type === 'snapshot') {
      this._runtimeId.set(event.runtimeId ?? null);
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
