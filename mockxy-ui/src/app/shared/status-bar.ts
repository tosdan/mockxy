import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild, type ElementRef, type WritableSignal } from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideServerCrash, lucideTriangleAlert, lucideUnplug, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiKbd } from '../ui/ui-kbd/ui-kbd';
import { UiTooltip } from '../ui/ui-tooltip/ui-tooltip';
import { WorkspaceSummaryStore } from './workspace-summary.store';
import { RuntimeSyncStore } from './runtime-sync.store';
import { RuntimeDiagnosticsStore } from './runtime-diagnostics.store';
import { RuntimeConfigIndicator } from './runtime-config-indicator';

/**
 * Striscia di stato in fondo alla shell: quanti endpoint, collection e attivi ha il workspace, e
 * quali definizioni il motore ha scartato.
 *
 * Prima viveva nel footer del catalogo, quindi spariva appena si cambiava view — e gli errori di
 * caricamento erano un tooltip, cioè leggibili solo puntandoli col mouse e mai copiabili. Qui
 * restano visibili da ogni view e si aprono in un pannello.
 *
 * Mostra anche lo stato del collegamento col motore (dati forse non aggiornati) e gli errori del
 * runtime: quello che il caricamento ha scartato e cosa serve al suo posto, anche quando la vecchia
 * rotta resta attiva (piano agent/API, §7 S4). Gli avvisi del runtime stanno in un indicatore a
 * parte: non sono errori, il caricamento è riuscito e tutto è servito.
 */
@Component({
  selector: 'app-status-bar',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgIcon, RuntimeConfigIndicator, TranslocoPipe, UiKbd, UiTooltip],
  providers: [provideIcons({ lucideServerCrash, lucideTriangleAlert, lucideUnplug, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-6.5 shrink-0 items-center gap-2.5 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      <!-- Regione sempre montata: annuncia la perdita del collegamento col motore. -->
      <span class="sr-only" role="status">@if (!sync.connected()) { {{ 'statusBar.staleTip' | transloco }} }</span>
      @if (!sync.connected()) {
      <span class="flex items-center gap-1.5 font-semibold text-[color:var(--status-4xx)]" [uiTooltip]="'statusBar.staleTip' | transloco">
        <ng-icon name="lucideUnplug" size="0.8rem" />
        {{ 'statusBar.stale' | transloco }}
      </span>
      <span class="h-3 w-px bg-border"></span>
      }

      @if (summary.summary(); as s) {
      <span class="font-mono tabular-nums">
        {{ 'statusBar.counts' | transloco: { endpoints: s.endpoints, collections: s.collections, active: s.active } }}
      </span>

      @if (s.loadErrors.length > 0) {
      <span class="h-3 w-px bg-border"></span>
      <button
        type="button"
        cdkOverlayOrigin
        #origin="cdkOverlayOrigin"
        class="flex items-center gap-1.5 rounded px-1 py-0.5 font-semibold text-[color:var(--status-4xx)] transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        [attr.aria-expanded]="open()"
        aria-haspopup="dialog"
        (click)="open.set(!open())"
      >
        <ng-icon name="lucideTriangleAlert" size="0.8rem" />
        {{ (s.loadErrors.length === 1 ? 'statusBar.loadErrorsOne' : 'statusBar.loadErrors') | transloco: { count: s.loadErrors.length } }}
      </button>

      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="origin"
        [cdkConnectedOverlayOpen]="open()"
        [cdkConnectedOverlayPositions]="positions"
        [cdkConnectedOverlayViewportMargin]="8"
        (overlayOutsideClick)="open.set(false)"
        (detach)="open.set(false)"
        (attach)="focusPanel(loadErrorsPanel())"
      >
        <div
          #loadErrorsPanel
          role="dialog"
          tabindex="-1"
          [attr.aria-label]="'statusBar.loadErrorsTitle' | transloco"
          class="max-h-96 w-[34rem] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-black/20 mx-scroll animate-in fade-in-0 zoom-in-95 focus-visible:outline-none"
          (keydown.escape)="close(open, origin)"
        >
          <div class="mb-1 flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {{ 'statusBar.loadErrorsTitle' | transloco }}
            </span>
            <span class="flex-1"></span>
            <button type="button" class="grid size-5 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground" (click)="close(open, origin)" [attr.aria-label]="'common.close' | transloco">
              <ng-icon name="lucideX" size="0.7rem" />
            </button>
          </div>
          <p class="mb-2.5 text-[12px] text-muted-foreground">{{ 'statusBar.loadErrorsHint' | transloco }}</p>
          <ul class="flex flex-col gap-2">
            @for (e of s.loadErrors; track e.configFilePath) {
            <li class="rounded-lg border border-border bg-black/20 p-2.5">
              <div class="truncate font-mono text-[11.5px] text-foreground/85" [title]="e.configFilePath">{{ e.configFilePath }}</div>
              <div class="mt-1 break-words text-[12px] text-[color:var(--status-4xx)]">{{ e.message }}</div>
            </li>
            }
          </ul>
        </div>
      </ng-template>
      }
      }

      @if (diagnostics.hasProblems()) {
      <span class="h-3 w-px bg-border"></span>
      <button
        type="button"
        cdkOverlayOrigin
        #runtimeOrigin="cdkOverlayOrigin"
        class="flex items-center gap-1.5 rounded px-1 py-0.5 font-semibold text-[color:var(--status-4xx)] transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        [attr.aria-expanded]="runtimeOpen()"
        aria-haspopup="dialog"
        (click)="runtimeOpen.set(!runtimeOpen())"
      >
        <ng-icon name="lucideServerCrash" size="0.8rem" />
        {{ runtimeLabel() | transloco: { count: diagnostics.errors().length } }}
      </button>

      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="runtimeOrigin"
        [cdkConnectedOverlayOpen]="runtimeOpen()"
        [cdkConnectedOverlayPositions]="positions"
        [cdkConnectedOverlayViewportMargin]="8"
        (overlayOutsideClick)="runtimeOpen.set(false)"
        (detach)="runtimeOpen.set(false)"
        (attach)="focusPanel(runtimePanel())"
      >
        <div
          #runtimePanel
          role="dialog"
          tabindex="-1"
          [attr.aria-label]="'statusBar.runtimeTitle' | transloco"
          class="max-h-96 w-[34rem] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-black/20 mx-scroll animate-in fade-in-0 zoom-in-95 focus-visible:outline-none"
          (keydown.escape)="close(runtimeOpen, runtimeOrigin)"
        >
          <div class="mb-1 flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {{ 'statusBar.runtimeTitle' | transloco }}
            </span>
            <span class="flex-1"></span>
            <button type="button" class="grid size-5 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground" (click)="close(runtimeOpen, runtimeOrigin)" [attr.aria-label]="'common.close' | transloco">
              <ng-icon name="lucideX" size="0.7rem" />
            </button>
          </div>
          <p class="mb-2.5 text-[12px] text-muted-foreground">{{ 'statusBar.runtimeHint' | transloco }}</p>
          <ul class="flex flex-col gap-2">
            @if (diagnostics.fatalError(); as fatal) {
            <li class="rounded-lg border border-[color:var(--destructive)]/40 bg-black/20 p-2.5">
              <div class="text-[11.5px] font-semibold text-foreground/85">{{ 'statusBar.runtimeFatal' | transloco }}</div>
              <div class="mt-1 break-words text-[12px] text-destructive-soft">{{ fatal.message }}</div>
            </li>
            }
            @for (e of diagnostics.errors(); track e.filePath) {
            <li class="rounded-lg border border-border bg-black/20 p-2.5">
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/85" [title]="e.filePath">{{ e.filePath }}</span>
                <span class="shrink-0 text-[10.5px] text-muted-foreground">{{ (e.serving === 'retained' ? 'statusBar.servingRetained' : 'statusBar.servingMissing') | transloco }}</span>
              </div>
              <div class="mt-1 break-words text-[12px] text-[color:var(--status-4xx)]">{{ e.message }}</div>
            </li>
            }
          </ul>
        </div>
      </ng-template>
      }

      @if (diagnostics.warnings().length > 0) {
      <span class="h-3 w-px bg-border"></span>
      <button
        type="button"
        cdkOverlayOrigin
        #warningsOrigin="cdkOverlayOrigin"
        class="flex items-center gap-1.5 rounded px-1 py-0.5 font-semibold text-[color:var(--status-3xx)] transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        [attr.aria-expanded]="warningsOpen()"
        aria-haspopup="dialog"
        (click)="warningsOpen.set(!warningsOpen())"
      >
        <ng-icon name="lucideTriangleAlert" size="0.8rem" />
        {{ (diagnostics.warnings().length === 1 ? 'statusBar.runtimeWarningsOne' : 'statusBar.runtimeWarnings') | transloco: { count: diagnostics.warnings().length } }}
      </button>

      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="warningsOrigin"
        [cdkConnectedOverlayOpen]="warningsOpen()"
        [cdkConnectedOverlayPositions]="positions"
        [cdkConnectedOverlayViewportMargin]="8"
        (overlayOutsideClick)="warningsOpen.set(false)"
        (detach)="warningsOpen.set(false)"
        (attach)="focusPanel(warningsPanel())"
      >
        <div
          #warningsPanel
          role="dialog"
          tabindex="-1"
          [attr.aria-label]="'statusBar.runtimeWarningsTitle' | transloco"
          class="max-h-96 w-[34rem] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-black/20 mx-scroll animate-in fade-in-0 zoom-in-95 focus-visible:outline-none"
          (keydown.escape)="close(warningsOpen, warningsOrigin)"
        >
          <div class="mb-1 flex items-center gap-2">
            <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {{ 'statusBar.runtimeWarningsTitle' | transloco }}
            </span>
            <span class="flex-1"></span>
            <button type="button" class="grid size-5 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground" (click)="close(warningsOpen, warningsOrigin)" [attr.aria-label]="'common.close' | transloco">
              <ng-icon name="lucideX" size="0.7rem" />
            </button>
          </div>
          <p class="mb-2.5 text-[12px] text-muted-foreground">{{ 'statusBar.runtimeWarningsHint' | transloco }}</p>
          <ul class="flex flex-col gap-2">
            <!-- Più avvisi possono riguardare lo stesso file con lo stesso codice (un package con
                 tre problemi): l'identità è l'occorrenza, non la coppia file + codice. -->
            @for (w of diagnostics.warnings(); track $index) {
            <li class="rounded-lg border border-border bg-black/20 p-2.5">
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/85" [title]="w.filePath">{{ w.filePath }}</span>
                <span class="shrink-0 font-mono text-[10.5px] text-muted-foreground">{{ w.code }}</span>
              </div>
              <div class="mt-1 break-words text-[12px] text-foreground/85">{{ w.message }}</div>
            </li>
            }
          </ul>
        </div>
      </ng-template>
      }

      <!-- Configurazione runtime e suggerimento stanno a destra, fuori dal blocco del riepilogo: ci
           sono anche quando il catalogo non e' ancora stato aperto. -->
      <span class="ml-auto"></span>
      <app-runtime-config-indicator />
      <span class="h-3 w-px bg-border"></span>
      <span class="inline-flex items-center gap-1.5">
        {{ 'statusBar.commands' | transloco }}
        <ui-kbd>{{ modifierKey }}</ui-kbd>
        <ui-kbd>K</ui-kbd>
      </span>
    </div>
  `,
})
export class StatusBar {
  protected readonly summary = inject(WorkspaceSummaryStore);
  protected readonly sync = inject(RuntimeSyncStore);
  protected readonly diagnostics = inject(RuntimeDiagnosticsStore);
  protected readonly open = signal(false);
  protected readonly runtimeOpen = signal(false);
  protected readonly warningsOpen = signal(false);
  protected readonly loadErrorsPanel = viewChild<ElementRef<HTMLElement>>('loadErrorsPanel');
  protected readonly runtimePanel = viewChild<ElementRef<HTMLElement>>('runtimePanel');
  protected readonly warningsPanel = viewChild<ElementRef<HTMLElement>>('warningsPanel');
  /** Un caricamento fallito nel suo insieme prevale sul conteggio degli errori dei file. */
  protected readonly runtimeLabel = computed(() => {
    if (this.diagnostics.fatalError()) return 'statusBar.runtimeFailed';
    return this.diagnostics.errors().length === 1 ? 'statusBar.runtimeErrorsOne' : 'statusBar.runtimeErrors';
  });

  /** All'apertura il focus entra nel pannello: da tastiera lo si scorre e lo si chiude con Escape. */
  protected focusPanel(panel: ElementRef<HTMLElement> | undefined): void {
    panel?.nativeElement.focus();
  }

  /** Chiusura dai controlli del pannello o con Escape: il focus torna al pulsante che l'ha aperto. */
  protected close(open: WritableSignal<boolean>, origin: CdkOverlayOrigin): void {
    open.set(false);
    origin.elementRef.nativeElement.focus();
  }

  /** Su macOS la scorciatoia si annuncia con Cmd, altrove con Ctrl. */
  protected readonly modifierKey =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  ];
}
