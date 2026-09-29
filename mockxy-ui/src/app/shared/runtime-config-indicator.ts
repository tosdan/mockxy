import { ChangeDetectionStrategy, Component, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, type ConnectedPosition } from '@angular/cdk/overlay';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideRotateCcw, lucideSlidersHorizontal, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import type { RuntimeConfigKey, RuntimeConfigValues } from '../mock-admin-api.types';
import { UiButton } from '../ui/ui-button/ui-button';
import { RuntimeConfigStore } from './runtime-config.store';

/**
 * Etichette delle chiavi runtime: le stesse delle impostazioni del workspace, così valori di avvio
 * salvati e valori in uso si confrontano per nome.
 */
export const RUNTIME_CONFIG_LABELS: Readonly<Record<RuntimeConfigKey, string>> = {
  backendUrl: 'workspaceSettings.backendUrl',
  proxyFallbackEnabled: 'workspaceSettings.proxyFallback',
  corsEnabled: 'workspaceSettings.cors',
  adaptProxyCookies: 'workspaceSettings.adaptCookies',
  rewriteProxyRedirects: 'workspaceSettings.rewriteRedirects',
  caseInsensitiveFilters: 'workspaceSettings.caseInsensitiveFilters',
  globalDelayMs: 'workspaceSettings.globalDelay',
  delayAllRequests: 'workspaceSettings.delayAll',
  requestTimeoutMs: 'workspaceSettings.requestTimeout',
};

/** Ordine di lettura: quello delle impostazioni del workspace. */
const DISPLAY_ORDER = Object.keys(RUNTIME_CONFIG_LABELS) as RuntimeConfigKey[];

/** Un valore da mostrare: una chiave da tradurre (booleani, backend assente) o il testo così com'è. */
export interface RuntimeConfigValueLabel {
  readonly key: string | null;
  readonly text: string;
}

export function describeRuntimeConfigValue(value: RuntimeConfigValues[RuntimeConfigKey] | undefined): RuntimeConfigValueLabel {
  if (value === true) return { key: 'runtimeConfig.on', text: '' };
  if (value === false) return { key: 'runtimeConfig.off', text: '' };
  if (value == null) return { key: 'runtimeConfig.noBackend', text: '' };
  return { key: null, text: String(value) };
}

/**
 * Configurazione del runtime nella barra di stato (piano agent/API §13 C8), in browser e desktop:
 * per ogni chiave il valore in uso, se è un override e quale era il valore di avvio, con il ritorno
 * al valore di avvio. Gli override sono temporanei: niente viene salvato, un riavvio li elimina.
 */
@Component({
  selector: 'app-runtime-config-indicator',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NgIcon, TranslocoPipe, UiButton],
  providers: [provideIcons({ lucideRotateCcw, lucideSlidersHorizontal, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      #trigger
      class="flex items-center gap-1.5 rounded px-1 py-0.5 transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      [class.font-semibold]="store.overrideCount() > 0"
      [class.text-[color:var(--status-3xx)]]="store.overrideCount() > 0"
      [attr.aria-expanded]="open()"
      aria-haspopup="dialog"
      (click)="open.set(!open())"
    >
      <ng-icon name="lucideSlidersHorizontal" size="0.8rem" />
      @if (store.overrideCount() > 0) {
      {{ (store.overrideCount() === 1 ? 'runtimeConfig.overridesOne' : 'runtimeConfig.overrides') | transloco: { count: store.overrideCount() } }}
      } @else {
      {{ 'runtimeConfig.label' | transloco }}
      }
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayViewportMargin]="8"
      (overlayOutsideClick)="open.set(false)"
      (detach)="open.set(false)"
      (attach)="focusPanel()"
    >
      <div
        #panel
        role="dialog"
        tabindex="-1"
        [attr.aria-label]="'runtimeConfig.title' | transloco"
        class="max-h-[28rem] w-[32rem] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-black/20 mx-scroll animate-in fade-in-0 zoom-in-95 focus-visible:outline-none"
        (keydown.escape)="close()"
      >
        <div class="mb-1 flex items-center gap-2">
          <span class="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{{ 'runtimeConfig.title' | transloco }}</span>
          <span class="flex-1"></span>
          <button type="button" class="grid size-5 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground" (click)="close()" [attr.aria-label]="'common.close' | transloco">
            <ng-icon name="lucideX" size="0.7rem" />
          </button>
        </div>
        <p class="mb-2.5 text-[12px] text-muted-foreground">{{ 'runtimeConfig.hint' | transloco }}</p>

        @if (store.state(); as state) {
        <ul class="flex flex-col">
          @for (key of keys; track key) {
          @let overridden = isOverridden(key);
          <li class="flex items-center gap-2 border-b border-border/60 py-1.5 last:border-b-0" [attr.data-key]="key">
            <div class="min-w-0 flex-1">
              <div class="text-[12px] text-foreground/85">{{ labels[key] | transloco }}</div>
              @if (overridden) {
              @let startup = describe(state.startup[key]);
              <div class="text-[11px] text-muted-foreground">
                {{ 'runtimeConfig.startupValue' | transloco: { value: startup.key ? (startup.key | transloco) : startup.text } }}
              </div>
              }
            </div>
            @let effective = describe(state.effective[key]);
            <span class="max-w-[14rem] truncate font-mono text-[12px] text-foreground" [title]="effective.text">
              {{ effective.key ? (effective.key | transloco) : effective.text }}
            </span>
            @if (overridden) {
            <span class="shrink-0 rounded bg-[color:var(--status-3xx)]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--status-3xx)]">{{ 'runtimeConfig.overrideBadge' | transloco }}</span>
            <button
              type="button"
              class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
              [disabled]="store.resetting()"
              [attr.aria-label]="'runtimeConfig.resetOne' | transloco: { label: (labels[key] | transloco) }"
              [title]="'runtimeConfig.resetOne' | transloco: { label: (labels[key] | transloco) }"
              (click)="store.reset([key])"
            >
              <ng-icon name="lucideRotateCcw" size="0.75rem" />
            </button>
            }
          </li>
          }
        </ul>
        @if (store.overrideCount() > 0) {
        <div class="mt-2.5 flex justify-end">
          <button ui-button size="sm" variant="outline" [disabled]="store.resetting()" (click)="store.reset(store.overrideKeys())">
            <ng-icon name="lucideRotateCcw" size="0.8rem" /> {{ 'runtimeConfig.resetAll' | transloco }}
          </button>
        </div>
        }
        } @else {
        <p class="text-[12px] text-muted-foreground">{{ 'runtimeConfig.unavailable' | transloco }}</p>
        }
      </div>
    </ng-template>
  `,
})
export class RuntimeConfigIndicator {
  protected readonly store = inject(RuntimeConfigStore);
  protected readonly open = signal(false);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  protected readonly keys = DISPLAY_ORDER;
  protected readonly labels = RUNTIME_CONFIG_LABELS;
  protected readonly describe = describeRuntimeConfigValue;

  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  ];

  /** All'apertura il focus entra nel pannello: da tastiera lo si scorre e lo si chiude con Escape. */
  protected focusPanel(): void {
    this.panel()?.nativeElement.focus();
  }

  /** Chiusura dai controlli del pannello o con Escape: il focus torna al pulsante che l'ha aperto. */
  protected close(): void {
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  protected isOverridden(key: RuntimeConfigKey): boolean {
    return this.store.overrideKeys().includes(key);
  }
}
