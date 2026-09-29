import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { finalize } from 'rxjs';
import { MockAdminApiService } from '../mock-admin-api.service';
import { RUNTIME_CONFIG_KEYS, type RuntimeConfigKey, type RuntimeConfigState } from '../mock-admin-api.types';
import { ToastService } from '../ui/ui-toast/ui-toast';
import { readErrorMessage } from './read-error-message';
import { ReadRetry } from './read-retry';
import { RuntimeSyncStore, affects } from './runtime-sync.store';

/**
 * Configurazione del runtime (GET /config, piano agent/API §13 C8): valori di avvio, valori in uso
 * e override effimeri impostati via API, per esempio da un agente. Browser e desktop la leggono
 * dalla stessa API; niente viene salvato né copiato nelle impostazioni del workspace. Si rilegge
 * quando cambia la revisione `config` di GET /info, al focus e a ogni nuovo runtime, che riparte
 * senza override. Una lettura fallita si ritenta da sola: la revisione che l'ha chiesta è già
 * stata vista, e il polling non la richiederebbe più.
 */
@Injectable({ providedIn: 'root' })
export class RuntimeConfigStore {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly _state = signal<RuntimeConfigState | null>(null);
  readonly state = this._state.asReadonly();
  /** Chiavi con un override attivo, nell'ordine del server. */
  readonly overrideKeys = computed<readonly RuntimeConfigKey[]>(() => {
    const overrides = this._state()?.overrides ?? {};
    return RUNTIME_CONFIG_KEYS.filter((key) => Object.hasOwn(overrides, key));
  });
  readonly overrideCount = computed(() => this.overrideKeys().length);
  private readonly _resetting = signal(false);
  readonly resetting = this._resetting.asReadonly();

  private loading = false;
  private reloadQueued = false;
  /** Cresce a ogni modifica riuscita: una lettura partita prima non sovrascrive lo stato nuovo. */
  private generation = 0;
  private readonly retry = new ReadRetry(() => this.load());

  constructor() {
    inject(RuntimeSyncStore)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (affects(event, 'config')) this.load();
      });
    this.load();
  }

  /** Rilegge la configurazione; una richiesta alla volta, e una sola in coda se ne serve un'altra. */
  load(): void {
    this.retry.cancel();
    if (this.loading) {
      this.reloadQueued = true;
      return;
    }
    this.loading = true;
    const generation = this.generation;
    this.api
      .getRuntimeConfig()
      .pipe(
        finalize(() => {
          this.loading = false;
          if (this.reloadQueued) {
            this.reloadQueued = false;
            this.load();
          }
        }),
      )
      .subscribe({
        next: (state) => {
          this.retry.succeeded();
          if (generation === this.generation) this._state.set(state);
        },
        // L'ultima lettura resta visibile e si ritenta con attese crescenti; un motore
        // irraggiungibile lo dice anche lo stato di collegamento.
        error: () => this.retry.failed(),
      });
  }

  /** Riporta le chiavi indicate al valore di avvio, togliendo i loro override. */
  reset(keys: readonly RuntimeConfigKey[]): void {
    if (keys.length === 0 || this._resetting()) return;
    this._resetting.set(true);
    this.api
      .patchRuntimeConfig({ unset: [...keys] })
      .pipe(finalize(() => this._resetting.set(false)))
      .subscribe({
        // La risposta non si applica: può arrivare dopo una lettura più recente (un agente che ha
        // cambiato di nuovo la configurazione) o dopo un riavvio del motore. Si rilegge: una lettura
        // partita adesso vede almeno questo ripristino, quelle partite prima si scartano.
        next: () => {
          this.generation += 1;
          this.load();
        },
        error: (error: unknown) =>
          this.toast.show({
            title: this.transloco.translate('runtimeConfig.resetFailed'),
            description: readErrorMessage(error) ?? this.transloco.translate('common.operationFailed'),
            tone: 'error',
          }),
      });
  }
}
