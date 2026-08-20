import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideActivity, lucideCheck, lucideChevronDown, lucideCopy, lucideDatabase, lucideSave } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton } from '../ui/ui-button/ui-button';
import { UiSwitch } from '../ui/ui-switch/ui-switch';
import { UiTooltip } from '../ui/ui-tooltip/ui-tooltip';
import { ServerStatusStore } from './server-status.store';
import { MonitorStreamStore } from './monitor-stream.store';
import { MonitorDumpStore } from './monitor-dump.store';
import { DesktopService } from './desktop.service';
import { resolveDesktopBindAddress, resolveServerAddress } from './server-address';

/**
 * Stato runtime della shell: server, proxy, cattura del monitor e dump su disco.
 *
 * Sono quattro stati che si **guardano** di continuo e si **commutano** di rado, quindi in barra
 * stanno come indicatori di sola lettura e gli interruttori vivono nel popover che il gruppo apre.
 * Prima ogni stato occupava un interruttore sempre visibile: la barra ne usciva larga il doppio
 * per controlli che si toccano una volta al giorno.
 */
@Component({
  selector: 'app-runtime-status',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, CdkCopyToClipboard, NgIcon, TranslocoPipe, UiButton, UiSwitch, UiTooltip],
  providers: [provideIcons({ lucideActivity, lucideCheck, lucideChevronDown, lucideCopy, lucideDatabase, lucideSave })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 items-center' },
  template: `
    <!-- Il gruppo intero è il bersaglio: gli indicatori restano leggibili come testo, e il nome
         accessibile del pulsante si compone da loro (stato incluso), quindi niente aria-label. -->
    <button
      type="button"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      class="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      [attr.aria-expanded]="open()"
      aria-haspopup="dialog"
      [uiTooltip]="'runtimeStatus.openTip' | transloco"
      (click)="open.set(!open())"
    >
      <span [class]="pillClass">
        <span class="size-1.5 shrink-0 rounded-full" [class]="server.serverEnabled() ? 'bg-positive' : 'bg-muted-foreground/40'"></span>
        {{ 'runtimeStatus.server' | transloco }}
        <span class="font-mono text-foreground/85">
          {{ server.serverEnabled() ? serverAddress() : ('runtimeStatus.serverOff' | transloco) }}
        </span>
      </span>

      <span [class]="pillClass">
        Proxy
        <span class="font-mono text-foreground/85">{{ proxyLabel() | transloco }}</span>
      </span>

      <span [class]="pillClass">
        <span class="size-1.5 shrink-0 rounded-full" [class]="stream.streaming() ? 'bg-positive' : 'bg-muted-foreground/40'"></span>
        <ng-icon name="lucideActivity" size="0.7rem" />
        {{ 'runtimeStatus.monitor' | transloco }}
        <span class="font-mono text-foreground/85">{{ (stream.streaming() ? 'runtimeStatus.live' : 'runtimeStatus.paused') | transloco }}</span>
      </span>

      @if (dump.available()) {
      <span [class]="pillClass">
        <ng-icon name="lucideDatabase" size="0.7rem" />
        {{ 'runtimeStatus.dump' | transloco }}
        <span class="font-mono text-foreground/85">{{ (dump.enabled() ? 'runtimeStatus.dumpOn' : 'runtimeStatus.dumpOff') | transloco }}</span>
      </span>
      }

      @if (server.loading()) {
      <span class="px-1 text-[11px] text-muted-foreground">{{ 'runtimeStatus.loading' | transloco }}</span>
      }

      <ng-icon name="lucideChevronDown" size="0.8rem" class="shrink-0 text-muted-foreground transition-transform" [class.rotate-180]="open()" />
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayViewportMargin]="8"
      (overlayOutsideClick)="open.set(false)"
      (detach)="open.set(false)"
    >
      <div
        role="dialog"
        [attr.aria-label]="'runtimeStatus.title' | transloco"
        class="w-77 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-black/20 animate-in fade-in-0 zoom-in-95"
        (keydown.escape)="open.set(false)"
      >
        <div class="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {{ 'runtimeStatus.title' | transloco }}
        </div>

        <div class="flex flex-col gap-2.5 text-[12.5px]">
          <div class="flex items-center gap-2.5">
            <ui-switch [checked]="server.serverEnabled()" (checkedChange)="server.setServerEnabled($event)" size="sm" ariaLabel="Server" />
            <span class="flex-1 font-semibold text-foreground">{{ 'runtimeStatus.server' | transloco }}</span>
            <span class="font-mono text-[11px] text-muted-foreground">{{ (server.serverEnabled() ? 'runtimeStatus.serverOn' : 'runtimeStatus.serverOff') | transloco }}</span>
          </div>

          <div class="flex items-center gap-2.5" [class.opacity-50]="!server.serverEnabled()">
            <ui-switch [checked]="server.proxyAll()" (checkedChange)="server.setProxyAll($event)" [disabled]="!server.serverEnabled()" size="sm" ariaLabel="Proxy All" />
            <!-- "Proxy All" resta non tradotto: è il nome del kill-switch (come Monitor/Dump/Flush). -->
            <span class="flex-1 font-semibold text-foreground">Proxy All</span>
            <span class="font-mono text-[11px] text-muted-foreground">{{ proxyLabel() | transloco }}</span>
          </div>

          <div class="flex items-center gap-2.5" [uiTooltip]="'runtimeStatus.monitorTip' | transloco">
            <ui-switch [checked]="stream.streaming()" (checkedChange)="stream.setStreaming($event)" size="sm" [ariaLabel]="'runtimeStatus.monitorAria' | transloco" />
            <span class="flex-1 font-semibold text-foreground">{{ 'runtimeStatus.monitor' | transloco }}</span>
            <span class="font-mono text-[11px] text-muted-foreground">{{ (stream.streaming() ? 'runtimeStatus.live' : 'runtimeStatus.paused') | transloco }}</span>
          </div>

          @if (dump.available()) {
          <div class="flex items-center gap-2.5"
               [uiTooltip]="dump.enabled() ? ('runtimeStatus.dumpTipOn' | transloco: { count: dump.pendingCount() }) : ('runtimeStatus.dumpTipOff' | transloco)">
            <ui-switch [checked]="dump.enabled()" (checkedChange)="dump.setEnabled($event)" [disabled]="dump.busy()" size="sm" [ariaLabel]="'runtimeStatus.dumpAria' | transloco" />
            <span class="flex-1 font-semibold text-foreground">{{ 'runtimeStatus.dumpLabel' | transloco }}</span>
            @if (dump.enabled()) {
            <button ui-button variant="outline" size="xs" [disabled]="dump.busy()" (click)="dump.flush()" [uiTooltip]="'runtimeStatus.flushTip' | transloco">
              <ng-icon name="lucideSave" size="0.8rem" /> Flush
            </button>
            } @else {
            <span class="font-mono text-[11px] text-muted-foreground">{{ 'runtimeStatus.dumpOff' | transloco }}</span>
            }
          </div>
          }
        </div>

        <div class="my-3 h-px bg-border"></div>

        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/85">{{ serverAddress() }}</span>
          <button
            ui-button
            variant="outline"
            size="xs"
            [cdkCopyToClipboard]="serverAddress()"
            (cdkCopyToClipboardCopied)="onCopied($event)"
            [uiTooltip]="'runtimeStatus.copyAddress' | transloco"
          >
            <ng-icon [name]="copied() ? 'lucideCheck' : 'lucideCopy'" size="0.8rem" />
            {{ (copied() ? 'common.copied' : 'runtimeStatus.copy') | transloco }}
          </button>
        </div>
      </div>
    </ng-template>
  `,
})
export class RuntimeStatus {
  protected readonly server = inject(ServerStatusStore);
  protected readonly stream = inject(MonitorStreamStore);
  protected readonly dump = inject(MonitorDumpStore);
  private readonly desktop = inject(DesktopService);

  protected readonly open = signal(false);
  protected readonly copied = signal(false);

  protected readonly pillClass =
    'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-md bg-white/[0.04] px-2 text-[11px] text-muted-foreground ring-1 ring-border';

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
  ];

  /** Proxy All spento significa "i mock rispondono": l'etichetta dice l'effetto, non il flag. */
  protected readonly proxyLabel = computed(() =>
    this.server.serverEnabled() && this.server.proxyAll() ? 'runtimeStatus.proxyAllOn' : 'runtimeStatus.proxyAllOff',
  );

  protected readonly serverAddress = signal(
    resolveServerAddress({
      isDesktop: this.desktop.isDesktop,
      baseUri: typeof document !== 'undefined' ? document.baseURI : '',
      host: typeof window !== 'undefined' ? window.location.host : '',
    })
  );

  constructor() {
    // Nel desktop l'indirizzo della pagina è SEMPRE loopback (la finestra carica dal motore
    // locale), anche quando il bind del workspace è 0.0.0.0: l'etichetta deve mostrare
    // l'interfaccia di ascolto scelta nei settings, non l'URL della finestra.
    if (this.desktop.isDesktop) {
      void this.desktop.getWorkspace().then((info) => {
        const address = resolveDesktopBindAddress(info, typeof window !== 'undefined' ? window.location.host : '');
        if (address) {
          this.serverAddress.set(address);
        }
      });
    }
  }

  protected onCopied(ok: boolean): void {
    if (!ok) {
      return;
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
