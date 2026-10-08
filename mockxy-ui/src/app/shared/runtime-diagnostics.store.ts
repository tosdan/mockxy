import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RuntimeStatusReport } from '../mock-admin-api.types';
import { ReadRetry } from './read-retry';
import { RuntimeSyncStore, affects } from './runtime-sync.store';

/**
 * Esito dell'ultimo caricamento del workspace (GET /runtime/status) per la status bar: errori dei
 * file nel registro installato, con quello che il runtime serve al loro posto, e il fallimento
 * globale. Si rilegge quando cambia la revisione `diagnostics` di GET /info, al focus e a ogni nuovo
 * runtime: la diagnostica cambia anche quando il runtime continua a servire la vecchia rotta. Una
 * lettura fallita si ritenta da sola (vedi ReadRetry).
 */
@Injectable({ providedIn: 'root' })
export class RuntimeDiagnosticsStore {
  private readonly api = inject(MockAdminApiService);

  private readonly _report = signal<RuntimeStatusReport | null>(null);
  readonly report = this._report.asReadonly();
  readonly errors = computed(() => this._report()?.errors ?? []);
  /** Problemi che non impediscono il caricamento: non rendono "degradato" il runtime. */
  readonly warnings = computed(() => this._report()?.warnings ?? []);
  readonly fatalError = computed(() => this._report()?.fatalError ?? null);
  /** Qualcosa da segnalare: errori di file o un caricamento fallito nel suo insieme. */
  readonly hasProblems = computed(() => this.errors().length > 0 || this.fatalError() != null);

  private loading = false;
  private reloadQueued = false;
  private readonly retry = new ReadRetry(() => this.load());

  constructor() {
    inject(RuntimeSyncStore)
      .events$.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (affects(event, 'diagnostics')) this.load();
      });
    this.load();
  }

  /** Rilegge l'esito; una richiesta alla volta, e una sola in coda se ne serve un'altra. */
  load(): void {
    this.retry.cancel();
    if (this.loading) {
      this.reloadQueued = true;
      return;
    }
    this.loading = true;
    this.api
      .getRuntimeStatus()
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
        next: (report) => {
          this.retry.succeeded();
          this._report.set(report);
        },
        // L'ultimo esito resta visibile e si ritenta con attese crescenti; un motore
        // irraggiungibile lo dice anche lo stato di collegamento.
        error: () => this.retry.failed(),
      });
  }
}
