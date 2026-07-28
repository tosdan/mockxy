import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { DesktopService, type UpdateState } from './desktop.service';

/** Stato condiviso tra banner e dialog preferenze per il controllo aggiornamenti desktop. */
@Injectable({ providedIn: 'root' })
export class UpdateNotificationService {
  private readonly desktop = inject(DesktopService);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;
  private unsubscribe: (() => void) | null = null;

  readonly state = signal<UpdateState | null>(null);
  readonly available = signal<UpdateState | null>(null);

  async start(): Promise<void> {
    if (this.started || !this.desktop.isDesktop) return;
    this.started = true;
    this.unsubscribe = this.desktop.onUpdateAvailable((state) => this.apply(state, false));
    this.destroyRef.onDestroy(() => this.unsubscribe?.());

    const state = await this.desktop.getUpdateState();
    if (state) this.apply(state, false);
  }

  async checkManually(): Promise<UpdateState | null> {
    const state = await this.desktop.checkForUpdates();
    if (state) this.apply(state, true);
    return state;
  }

  async ignoreCurrent(): Promise<void> {
    const version = this.available()?.latestVersion;
    if (!version) return;
    const state = await this.desktop.ignoreUpdate(version);
    if (state) this.state.set(state);
    this.available.set(null);
  }

  async openCurrent(): Promise<boolean> {
    return this.desktop.openUpdate();
  }

  private apply(state: UpdateState, showIgnored: boolean): void {
    this.state.set(state);
    this.available.set(
      state.checksEnabled &&
        state.status === 'available' &&
        (!state.ignored || showIgnored)
        ? state
        : null,
    );
  }
}
