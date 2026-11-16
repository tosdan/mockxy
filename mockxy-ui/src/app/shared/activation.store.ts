import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { finalize } from 'rxjs';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { ActivationItem, ActivationPatchItem, ActivationState } from '../mock-admin-api.types';
import { ToastService } from '../ui/ui-toast/ui-toast';
import { readErrorMessage } from './read-error-message';
import { ReadRetry } from './read-retry';
import { RuntimeSyncStore, affects } from './runtime-sync.store';

/**
 * Attivazioni temporanee (GET /activation): per un endpoint, acceso/spento e variante servita per
 * la sessione in corso. Vivono nella memoria del motore: i file del workspace non cambiano, e un
 * riavvio le elimina. Ciò che è salvato resta la decisione del team; questo è lo stato di lavoro
 * di chi sta provando un caso, o lo scenario preparato da un test.
 *
 * Si rilegge quando cambia la revisione `activation` di GET /info (per esempio perché un test le
 * ha cambiate via API), al focus e a ogni nuovo runtime, che riparte senza.
 */
export interface ActivationEndpointRef {
  method: string;
  path: string;
}

export function activationKey(endpoint: ActivationEndpointRef): string {
  return `${endpoint.method.toUpperCase()} ${endpoint.path}`;
}

@Injectable({ providedIn: 'root' })
export class ActivationStore {
  private readonly api = inject(MockAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly _items = signal<readonly ActivationItem[]>([]);
  readonly items = this._items.asReadonly();
  readonly count = computed(() => this._items().length);
  /**
   * Per metodo e percorso, la chiave che usa il motore. Non per id di catalogo: l'id è il
   * percorso del file, e cambia se la cartella dell'endpoint viene spostata, senza che
   * l'attivazione cambi né che la revisione `activation` si muova.
   */
  private readonly byEndpoint = computed(() => new Map(this._items().map((item) => [activationKey(item), item])));
  private readonly _busy = signal(false);
  readonly busy = this._busy.asReadonly();

  private loading = false;
  private reloadQueued = false;
  /** Cresce a ogni modifica riuscita: una lettura partita prima non sovrascrive lo stato nuovo. */
  private generation = 0;
  private readonly retry = new ReadRetry(() => this.load());

  constructor() {
    inject(RuntimeSyncStore)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (affects(event, 'activation')) this.load();
      });
    this.load();
  }

  /** Lo stato temporaneo di un endpoint; senza, l'endpoint è servito come salvato. */
  of(endpoint: ActivationEndpointRef): ActivationItem | undefined {
    return this.byEndpoint().get(activationKey(endpoint));
  }

  /** Rilegge le attivazioni; una richiesta alla volta, e una sola in coda se ne serve un'altra. */
  load(): void {
    this.retry.cancel();
    if (this.loading) {
      this.reloadQueued = true;
      return;
    }
    this.loading = true;
    const generation = this.generation;
    this.api
      .getActivation()
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
          if (generation === this.generation) this._items.set(state.items);
        },
        error: () => this.retry.failed(),
      });
  }

  /** Ritocca l'attivazione temporanea di un endpoint; `null` toglie quel campo. */
  set(item: ActivationPatchItem): void {
    this.mutate(this.api.patchActivation([item]));
  }

  /** Toglie ogni stato temporaneo da un endpoint: torna a come è salvato. */
  remove(id: string): void {
    this.mutate(this.api.patchActivation([{ id, enabled: null, responseFile: null }]));
  }

  /** Azzera tutte le attivazioni temporanee. */
  clear(): void {
    this.mutate(this.api.clearActivation());
  }

  private mutate(request: ReturnType<MockAdminApiService['getActivation']>): void {
    if (this._busy()) return;
    this._busy.set(true);
    request.pipe(finalize(() => this._busy.set(false))).subscribe({
      next: (state: ActivationState) => {
        this.generation += 1;
        this._items.set(state.items);
      },
      error: (error: unknown) =>
        this.toast.show({
          title: this.transloco.translate('activation.failed'),
          description: readErrorMessage(error) ?? this.transloco.translate('common.operationFailed'),
          tone: 'error',
        }),
    });
  }
}
