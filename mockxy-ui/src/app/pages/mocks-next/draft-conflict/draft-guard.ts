import { computed, signal, type Signal } from '@angular/core';
import type { Observable, Subscription } from 'rxjs';
import type { DraftTarget, RevisionConflict } from '../../../mock-admin-api.types';
import { isNotFoundError } from '../../../shared/read-error-message';
import type { DraftSave } from '../mocks-next.store';

/** Blocco della versione corrente mostrata accanto alla bozza. */
export interface RemoteBlock {
  label: string;
  code: string;
  language: 'json' | 'javascript' | 'text';
}

/** Versione corrente della risorsa di una bozza, letta dal server. */
export interface RemoteVersion<T> {
  revision: string;
  data: T;
  blocks: readonly RemoteBlock[];
}

/** Ciò che il pannello del conflitto legge e comanda di una bozza, qualunque sia il suo tipo. */
export interface DraftConflictView {
  readonly conflict: Signal<RevisionConflict | null>;
  readonly missing: Signal<boolean>;
  readonly remote: Signal<{ revision: string; blocks: readonly RemoteBlock[] } | null>;
  readonly loading: Signal<boolean>;
  readonly loadError: Signal<string | null>;
  readonly confirmingReload: Signal<boolean>;
  readonly reloadUnsupported: Signal<boolean>;
  readonly reloaded: Signal<boolean>;
  readonly remoteChanged: Signal<boolean>;
  readonly blocked: Signal<boolean>;
  compare(): void;
  reload(): void;
  confirmReload(): void;
  cancelReload(): void;
}

/** Salvataggio di una bozza: le opzioni per lo store e l'esito positivo legato alla stessa bozza. */
export interface GuardedSave {
  draft: DraftSave;
  onSuccess: () => void;
}

export interface DraftGuardOptions<T> {
  /** Legge la versione corrente del bersaglio. */
  load: (target: DraftTarget) => Observable<RemoteVersion<T>>;
  /** Sostituisce la bozza con la versione letta; false se il form non può rappresentarla. */
  apply: (data: T) => boolean;
  /** La bozza differisce da quanto seminato? Governa la conferma della ricarica. */
  isDirty: () => boolean;
  /** Messaggio di una lettura fallita. */
  errorMessage: (error: unknown) => string;
  /**
   * Stato della risorsa già noto alla sincronizzazione quando la bozza si apre: una bozza aperta
   * dopo che l'endpoint è sparito, o il runtime serve un altro workspace, nasce non salvabile.
   */
  unavailable?: () => 'missing' | 'blocked' | null;
}

/**
 * Protezione di una bozza (piano agent/API, §13 C4): conserva il bersaglio fissato all'apertura
 * (endpoint, variante, revisione letta) e gestisce conflitto e risorsa sparita. Un aggiornamento
 * remoto non cambia il bersaglio: soltanto una ricarica deliberata ne sostituisce la base, e
 * "Salva la mia versione" usa la revisione appena mostrata per quel solo salvataggio. Nessun merge
 * automatico. Classe pura (signals, niente DI), come ResponseDraft.
 */
export class DraftGuard<T> implements DraftConflictView {
  readonly target = signal<DraftTarget | null>(null);
  /** Ultimo `409 REVISION_CONFLICT` del salvataggio: il testo della bozza resta com'è. */
  readonly conflict = signal<RevisionConflict | null>(null);
  /** Il bersaglio non esiste più: il testo resta copiabile, il salvataggio è disabilitato. */
  readonly missing = signal(false);
  /** Versione corrente caricata da "Confronta". */
  readonly remote = signal<RemoteVersion<T> | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly confirmingReload = signal(false);
  /** La versione ricaricata non è rappresentabile in questo form (es. tipo di variante cambiato). */
  readonly reloadUnsupported = signal(false);
  /** Ricarica riuscita: la bozza ora è la versione corrente (esito mostrato fino al salvataggio). */
  readonly reloaded = signal(false);
  /** Una rilettura ha visto sul server una revisione diversa dalla base: salvare così darebbe 409. */
  readonly remoteChanged = signal(false);
  /** Il runtime serve un altro workspace: la bozza appartiene al precedente e non si salva. */
  readonly blocked = signal(false);

  readonly canSave = computed(() => this.target() !== null && !this.missing() && !this.blocked());

  // Una risposta relativa a una bozza chiusa o riaperta non tocca quella attuale.
  private generation = 0;
  private pending?: Subscription;
  private rechecking?: Subscription;

  constructor(private readonly options: DraftGuardOptions<T>) {}

  open(target: DraftTarget): void {
    this.reset();
    this.target.set(target);
    const unavailable = this.options.unavailable?.();
    if (unavailable === 'blocked') this.blocked.set(true);
    else if (unavailable === 'missing') this.missing.set(true);
  }

  close(): void {
    this.reset();
    this.target.set(null);
  }

  /**
   * Salvataggio sul bersaglio fissato. `revision` sostituisce la base per questo solo salvataggio
   * ("Salva la mia versione"); la base cambia davvero solo con una ricarica. Esito, conflitto e
   * risorsa sparita valgono solo per la bozza che ha salvato: se intanto è stata chiusa o riaperta,
   * una risposta tardiva non la tocca. Null se non c'è un bersaglio salvabile.
   */
  saveWith(onSaved: () => void, revision?: string): GuardedSave | null {
    const target = this.target();
    if (!target || !this.canSave()) {
      return null;
    }
    const generation = this.generation;
    this.reloaded.set(false);
    const draft: DraftSave = {
      target: revision ? { ...target, baseRevision: revision } : target,
      onConflict: (conflict) => {
        if (generation !== this.generation) return;
        // Un nuovo conflitto invalida la versione mostrata: va riconfrontata.
        this.conflict.set(conflict);
        this.remote.set(null);
        this.confirmingReload.set(false);
        this.reloadUnsupported.set(false);
      },
      onMissing: () => {
        if (generation !== this.generation) return;
        this.missing.set(true);
      },
    };
    return {
      draft,
      onSuccess: () => {
        if (generation !== this.generation) return;
        onSaved();
      },
    };
  }

  /**
   * Esito di una rilettura di sincronizzazione del bersaglio: testo, bersaglio e base non cambiano.
   * Segnala se il server ha una revisione diversa dalla base e, se la versione corrente è già
   * mostrata accanto alla bozza, la aggiorna insieme alla sua revisione.
   */
  observe(version: RemoteVersion<T>): void {
    const target = this.target();
    if (!target?.baseRevision) {
      return;
    }
    this.remoteChanged.set(version.revision !== target.baseRevision);
    const shown = this.remote();
    if (shown && shown.revision !== version.revision) {
      this.remote.set(version);
    }
  }

  /** La sincronizzazione non trova più il bersaglio: il testo resta, il salvataggio no. */
  markMissing(): void {
    if (this.target()) this.missing.set(true);
  }

  /** Il runtime serve un altro workspace: il salvataggio resta disabilitato. */
  block(): void {
    if (this.target()) this.blocked.set(true);
  }

  /**
   * Rilegge il bersaglio per la sincronizzazione, quando nessun'altra lettura lo copre (variante
   * della bozza diversa dalla selezionata). Una rilettura in volo, anche di confronto o ricarica,
   * basta: non se ne sovrappone un'altra.
   */
  recheck(): void {
    const target = this.target();
    if (!target || (this.rechecking && !this.rechecking.closed) || this.loading()) {
      return;
    }
    const generation = this.generation;
    this.rechecking = this.options.load(target).subscribe({
      next: (version) => {
        if (generation === this.generation) this.observe(version);
      },
      error: (error) => {
        if (generation === this.generation && isNotFoundError(error)) this.missing.set(true);
      },
    });
  }

  /** "Confronta": carica la versione corrente accanto alla bozza, senza sostituirla. */
  compare(): void {
    this.loadCurrent((version) => this.remote.set(version));
  }

  /** "Ricarica": con la bozza modificata chiede prima conferma. */
  reload(): void {
    if (this.options.isDirty()) {
      this.confirmingReload.set(true);
      return;
    }
    this.confirmReload();
  }

  cancelReload(): void {
    this.confirmingReload.set(false);
  }

  /** Sostituisce la bozza con la versione corrente, che diventa la nuova base. */
  confirmReload(): void {
    this.confirmingReload.set(false);
    this.loadCurrent((version) => {
      if (!this.options.apply(version.data)) {
        this.remote.set(version);
        this.reloadUnsupported.set(true);
        return;
      }
      this.target.update((target) => target && { ...target, baseRevision: version.revision });
      this.conflict.set(null);
      this.remote.set(null);
      this.remoteChanged.set(false);
      this.reloaded.set(true);
    });
  }

  private loadCurrent(onLoaded: (version: RemoteVersion<T>) => void): void {
    const target = this.target();
    if (!target) {
      return;
    }
    const generation = this.generation;
    this.pending?.unsubscribe();
    this.loading.set(true);
    this.loadError.set(null);
    this.reloadUnsupported.set(false);
    this.pending = this.options.load(target).subscribe({
      next: (version) => {
        if (generation !== this.generation) return;
        this.loading.set(false);
        onLoaded(version);
      },
      error: (error) => {
        if (generation !== this.generation) return;
        this.loading.set(false);
        if (isNotFoundError(error)) {
          this.missing.set(true);
          return;
        }
        this.loadError.set(this.options.errorMessage(error));
      },
    });
  }

  private reset(): void {
    this.generation += 1;
    this.pending?.unsubscribe();
    this.pending = undefined;
    this.rechecking?.unsubscribe();
    this.rechecking = undefined;
    this.conflict.set(null);
    this.remoteChanged.set(false);
    this.blocked.set(false);
    this.missing.set(false);
    this.remote.set(null);
    this.loading.set(false);
    this.loadError.set(null);
    this.confirmingReload.set(false);
    this.reloadUnsupported.set(false);
    this.reloaded.set(false);
  }
}
