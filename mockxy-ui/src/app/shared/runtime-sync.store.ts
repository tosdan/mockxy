import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Subject, finalize, type Subscription } from 'rxjs';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RuntimeInfo, RuntimeRevisions } from '../mock-admin-api.types';

export type RevisionKey = keyof RuntimeRevisions;

/**
 * Cosa è cambiato nel runtime, per chi deve rileggere.
 * - `revisions`: stesse istanza e connessione, alcune revisioni sono cresciute;
 * - `resync`: ritorno visibile/focus o connessione ritrovata: si rilegge tutto ciò che si mostra,
 *   anche a revisioni invariate (un cambio a mtime e dimensione invariati sfugge alle revisioni);
 * - `runtime`: il motore è ripartito (`runtimeId` nuovo); `workspaceChanged` se ora serve un altro
 *   workspace, e allora i dati aperti appartengono al precedente.
 */
export type RuntimeSyncEvent =
  | { kind: 'revisions'; info: RuntimeInfo; changed: ReadonlySet<RevisionKey> }
  | { kind: 'resync'; info: RuntimeInfo }
  | { kind: 'runtime'; info: RuntimeInfo; workspaceChanged: boolean };

/** Intervallo del polling di GET /info mentre la finestra è visibile. */
export const RUNTIME_POLL_MS = 2000;

/**
 * Sincronizzazione della GUI col runtime (piano agent/API, §7 S4): interroga GET /info ogni
 * `RUNTIME_POLL_MS` mentre la finestra è visibile, una richiesta alla volta, e subito al focus o al
 * ritorno visibile. Confronta identità e revisioni con l'ultima lettura e pubblica cosa rileggere;
 * ogni store rilegge le proprie risorse. Una lettura fallita segna la connessione come persa (i dati
 * mostrati possono non essere aggiornati) e il polling continua.
 *
 * Root-scoped. Il polling parte con `start()`, chiamato all'avvio dell'app: gli store la usano
 * senza avviarla, e nei test non parte niente da solo.
 */
@Injectable({ providedIn: 'root' })
export class RuntimeSyncStore {
  private readonly api = inject(MockAdminApiService);
  private readonly document = inject(DOCUMENT);

  private readonly _info = signal<RuntimeInfo | null>(null);
  /** Ultima identità letta del runtime. */
  readonly info = this._info.asReadonly();
  private readonly _connected = signal(true);
  /** False dopo una lettura fallita: la GUI mostra dati che possono non essere aggiornati. */
  readonly connected = this._connected.asReadonly();

  private readonly eventsSubject = new Subject<RuntimeSyncEvent>();
  readonly events$ = this.eventsSubject.asObservable();

  private started = false;
  private requesting = false;
  private request?: Subscription;
  private resyncPending = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly onVisibility = () => {
    if (this.visible()) {
      this.check(true);
    } else {
      this.clearTimer();
    }
  };
  private readonly onFocus = () => this.check(true);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', this.onVisibility);
      this.document.defaultView?.removeEventListener('focus', this.onFocus);
      this.clearTimer();
      this.request?.unsubscribe();
      this.eventsSubject.complete();
    });
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.document.addEventListener('visibilitychange', this.onVisibility);
    this.document.defaultView?.addEventListener('focus', this.onFocus);
    this.check(false);
  }

  /**
   * Legge GET /info. Con `resync` chi ascolta rilegge tutto ciò che mostra; una richiesta in volo
   * non viene duplicata: la rilettura completa segue appena termina.
   */
  check(resync: boolean): void {
    if (resync) {
      this.resyncPending = true;
    }
    if (this.requesting) {
      return;
    }
    this.clearTimer();
    const withResync = this.resyncPending;
    this.resyncPending = false;
    this.requesting = true;
    const request = this.api
      .getRuntimeInfo()
      .pipe(
        finalize(() => {
          this.requesting = false;
          if (this.resyncPending) {
            this.check(false);
          } else {
            this.schedule();
          }
        }),
      )
      .subscribe({
        next: (info) => this.apply(info, withResync),
        // La rilettura completa chiesta dal focus non si perde: la prossima lettura riuscita è una
        // riconnessione, che la pubblica comunque.
        error: () => this._connected.set(false),
      });
    // Tenuta solo per annullarla allo smontaggio; una risposta sincrona l'ha già chiusa.
    if (!request.closed) this.request = request;
  }

  private apply(info: RuntimeInfo, resync: boolean): void {
    const previous = this._info();
    const reconnected = !this._connected();
    this._info.set(info);
    this._connected.set(true);
    if (previous == null) {
      if (resync || reconnected) this.eventsSubject.next({ kind: 'resync', info });
      return;
    }
    if (info.runtimeId !== previous.runtimeId) {
      this.eventsSubject.next({ kind: 'runtime', info, workspaceChanged: info.workspace.id !== previous.workspace.id });
      return;
    }
    if (resync || reconnected) {
      this.eventsSubject.next({ kind: 'resync', info });
      return;
    }
    const changed = new Set<RevisionKey>(
      (Object.keys(info.revisions) as RevisionKey[]).filter((key) => info.revisions[key] !== previous.revisions[key]),
    );
    if (changed.size > 0) {
      this.eventsSubject.next({ kind: 'revisions', info, changed });
    }
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.started || !this.visible()) {
      return;
    }
    this.timer = setTimeout(() => this.check(false), RUNTIME_POLL_MS);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private visible(): boolean {
    return this.document.visibilityState !== 'hidden';
  }
}

/** Una risorsa va riletta per questo evento? `key` è la revisione che la descrive. */
export function affects(event: RuntimeSyncEvent, key: RevisionKey): boolean {
  return event.kind !== 'revisions' || event.changed.has(key);
}
