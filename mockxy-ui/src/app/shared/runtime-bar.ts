import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideActivity, lucideDatabase, lucideSave } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton } from '../ui/ui-button/ui-button';
import { UiSwitch } from '../ui/ui-switch/ui-switch';
import { UiTooltip } from '../ui/ui-tooltip/ui-tooltip';
import { ServerStatusStore } from './server-status.store';
import { MonitorStreamStore } from './monitor-stream.store';
import { MonitorDumpStore } from './monitor-dump.store';
import { DesktopService } from './desktop.service';
import { WorkspaceControls } from './workspace-controls';
import { LanguageSwitcher } from './language-switcher';

/**
 * Barra di stato runtime, montata UNA volta nella shell e quindi visibile in tutte le view. A destra
 * concentra i controlli globali: server on/off, proxy all, cattura live del monitor (pausa/avvia) e
 * dump su disco dello storico (+ flush). A sinistra, nell'app desktop, i controlli workspace
 * "secondari" (recenti + apri); la scelta del workspace attivo è nelle tab della barra in cima.
 */
@Component({
  selector: 'app-runtime-bar',
  imports: [NgIcon, UiButton, UiSwitch, UiTooltip, WorkspaceControls, LanguageSwitcher, TranslocoPipe],
  providers: [provideIcons({ lucideActivity, lucideDatabase, lucideSave })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="h-[2.375rem] relative z-40 flex shrink-0 items-center gap-x-3 border-b border-border bg-card px-5 py-1.5 text-[11.5px] text-muted-foreground">
      @if (desktop.isDesktop) {
      <app-workspace-controls />
      <span class="h-3.5 w-px bg-border"></span>
      }

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5" [class.ml-auto]="desktop.isDesktop">
        <!-- Server on/off -->
        <span class="inline-flex items-center gap-2">
          <ui-switch [checked]="server.serverEnabled()" (checkedChange)="server.setServerEnabled($event)" size="sm" ariaLabel="Server" />
          <span class="font-medium text-foreground">{{ (server.serverEnabled() ? 'runtimeBar.serverOn' : 'runtimeBar.serverOff') | transloco }}</span>
          <span class="font-mono text-muted-foreground">{{ serverAddress }}</span>
        </span>

        <span class="h-3.5 w-px bg-border"></span>

        <!-- Proxy all (richiede il server acceso) -->
        <span class="inline-flex items-center gap-2" [class.opacity-50]="!server.serverEnabled()">
          <ui-switch [checked]="server.proxyAll()" (checkedChange)="server.setProxyAll($event)" [disabled]="!server.serverEnabled()" size="sm" ariaLabel="Proxy All" />
          <span class="font-medium text-foreground">Proxy All</span>
          <span class="font-mono text-muted-foreground">{{ server.serverEnabled() && server.proxyAll() ? 'straight to backend' : 'mocking active' }}</span>
          <!-- 'straight to backend' / 'mocking active': termini tecnici, non tradotti (rule 3) -->
        </span>

        <span class="h-3.5 w-px bg-border"></span>

        <!-- Cattura live del monitor (pausa/avvia) -->
        <span class="w-[27ch] inline-flex items-center gap-2" [uiTooltip]="'runtimeBar.monitorTip' | transloco">
          <ui-switch [checked]="stream.streaming()" (checkedChange)="stream.setStreaming($event)" size="sm" [ariaLabel]="'runtimeBar.monitorAria' | transloco" />
          <span class="inline-flex items-center gap-1.5 font-medium text-foreground">
            <ng-icon name="lucideActivity" size="0.85rem" [style.color]="stream.streaming() ? 'var(--positive)' : null" /> Monitor
          </span>
          <span class="font-mono text-muted-foreground">@if (stream.streaming()) { live } @else { {{ 'runtimeBar.monitorPaused' | transloco }} }</span>
        </span>

        <!-- Dump su disco dello storico (+ flush) -->
        @if (dump.available()) {
        <span class="h-3.5 w-px bg-border"></span>
        <span class="inline-flex items-center gap-2"
              [uiTooltip]="dump.enabled() ? ('runtimeBar.dumpTipOn' | transloco: { count: dump.pendingCount() }) : ('runtimeBar.dumpTipOff' | transloco)">
          <ui-switch [checked]="dump.enabled()" (checkedChange)="dump.setEnabled($event)" [disabled]="dump.busy()" size="sm" [ariaLabel]="'runtimeBar.dumpAria' | transloco" />
          <span class="inline-flex items-center gap-1.5 font-medium text-foreground">
            <ng-icon name="lucideDatabase" size="0.85rem" [style.color]="dump.enabled() ? 'var(--positive)' : null" /> Dump {{ dump.enabled() ? 'ON' : 'OFF' }}
          </span>
          @if (dump.enabled()) {
          <button ui-button variant="ghost" size="xs" [disabled]="dump.busy()" (click)="dump.flush()" [uiTooltip]="'runtimeBar.flushTip' | transloco">
            <ng-icon name="lucideSave" size="0.85rem" /> Flush
          </button>
          }
        </span>
        }

        @if (server.loading()) {
        <span class="ml-auto text-muted-foreground">{{ 'runtimeBar.loading' | transloco }}</span>
        }
      </div>

      <!-- Selettore di lingua: ultimo a destra, sempre visibile (browser e desktop). -->
      <app-language-switcher [class.ml-auto]="!desktop.isDesktop" />
    </div>
  `,
})
export class RuntimeBar {
  protected readonly server = inject(ServerStatusStore);
  protected readonly stream = inject(MonitorStreamStore);
  protected readonly dump = inject(MonitorDumpStore);
  protected readonly desktop = inject(DesktopService);
  protected readonly serverAddress = resolveServerAddress({
    isDesktop: this.desktop.isDesktop,
    baseUri: typeof document !== 'undefined' ? document.baseURI : '',
    host: typeof window !== 'undefined' ? window.location.host : '',
  });
}

/**
 * Risolve l'indirizzo di Mockxy mostrato accanto al toggle del server.
 *
 * Quando la pagina è servita DAL motore, l'indirizzo vero è quello della pagina stessa: vale
 * nell'app desktop (la finestra è caricata sul motore del workspace attivo, e allo switch si
 * ricarica) e nel browser sulla UI compilata sotto /_admin/ui/ — dove `host` intero copre anche
 * l'accesso da LAN con hostname non-localhost. Il default cablato resta solo per lo sviluppo con
 * ng serve, dove la pagina gira su una porta propria e parla col motore attraverso il proxy dev.
 */
export function resolveServerAddress(context: { isDesktop: boolean; baseUri: string; host: string }): string {
  const servedByEngine = context.baseUri.includes('/_admin/ui');
  if ((context.isDesktop || servedByEngine) && context.host) {
    return context.host;
  }
  return 'localhost:3000';
}
