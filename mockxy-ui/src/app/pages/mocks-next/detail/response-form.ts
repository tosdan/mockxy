import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { lucideBan, lucideCheck, lucideChevronDown, lucideGlobe, lucideKey, lucideLayers, lucidePlus, lucideRefreshCw, lucideRepeat, lucideShield, lucideUpload, lucideX, lucideZap } from '@ng-icons/lucide';
import { UiBadge } from '../../../ui/ui-badge/ui-badge';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiCodeEditor } from '../../../ui/ui-code-editor/ui-code-editor';
import { EditorShortcutsHelp } from '../../../ui/ui-code-editor/editor-shortcuts-help';
import { UiInput } from '../../../ui/ui-input/ui-input';
import { UiMenu, UiMenuItem } from '../../../ui/ui-menu/ui-menu';
import { UiSwitch } from '../../../ui/ui-switch/ui-switch';
import { UiToggleGroup, UiToggleItem } from '../../../ui/ui-toggle-group/ui-toggle-group';
import { UiTooltip } from '../../../ui/ui-tooltip/ui-tooltip';
import { MocksStore } from '../mocks-next.store';
import {
  CONTENT_TYPES,
  HEADER_BUNDLES,
  RESPONSE_PRESETS,
  contentTypeLabel,
  type HeaderBundle,
  type ResponsePreset,
} from '../response-presets';
import { StatusCombobox } from '../status-combobox/status-combobox';
import { HeaderNameCombobox } from '../header-combobox/header-name-combobox';
import type { ResponseDraft } from './response-draft';

/**
 * Form di modifica/creazione della response: titolo, status+delay+preset, editor header
 * (con bundle e content-type), body/sorgente o dropzone file. Lavora su una ResponseDraft
 * passata dal dettaglio (che tiene i pulsanti Salva/Annulla nella toolbar); l'unico evento
 * verso il padre è il file scelto in modifica (upload immediato).
 */
@Component({
  selector: 'mocks-next-response-form',
  imports: [CdkMenuTrigger, HeaderNameCombobox, NgIcon, StatusCombobox, TranslocoPipe, UiBadge, UiButton, UiCodeEditor, EditorShortcutsHelp, UiInput, UiMenu, UiMenuItem, UiSwitch, UiToggleGroup, UiToggleItem, UiTooltip],
  providers: [provideIcons({ lucideBan, lucideCheck, lucideChevronDown, lucideGlobe, lucideKey, lucideLayers, lucidePlus, lucideRefreshCw, lucideRepeat, lucideShield, lucideUpload, lucideX, lucideZap })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-5 px-6 py-5">
      <!-- titolo -->
      <div class="flex flex-col gap-1.5">
        <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'detail.titleLabel' | transloco }}</label>
        <input ui-input type="text" class="w-full max-w-xl text-[13px]" [placeholder]="'detail.titlePlaceholder' | transloco" [value]="draft().title()" (input)="draft().title.set($any($event.target).value)" />
      </div>

      @if (!draft().isScript()) {
      <!-- status + delay + preset response -->
      <div class="flex flex-wrap items-end gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Status</label>
          <mocks-next-status-combobox [value]="draft().status()" (valueChange)="draft().status.set($any($event))" />
        </div>
        <button ui-button variant="outline" [cdkMenuTriggerFor]="presetResponseMenu" [disabled]="busy()" [uiTooltip]="'detail.presetResponseTip' | transloco">
          <ng-icon name="lucideZap" size="0.85rem" /> {{ 'detail.presetResponse' | transloco }} <ng-icon name="lucideChevronDown" size="0.8rem" />
        </button>
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'detail.delayLabel' | transloco }}</label>
          <input ui-input type="number" min="0" class="w-32 text-[13px] tabular-nums" [value]="draft().delay()" (input)="draft().delay.set(toInt($any($event.target).value))" />
        </div>
        @if (draft().payloadType() !== 'file') {
        <!-- Templating opt-in: placeholder params/query/headers/body nel body e negli header (mai sui file). -->
        <div class="flex flex-col gap-1.5" [uiTooltip]="'detail.templatedTip' | transloco">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'detail.templatedLabel' | transloco }}</label>
          <span class="inline-flex h-9 items-center gap-2">
            <ui-switch [checked]="draft().templated()" (checkedChange)="draft().templated.set($event)" size="sm" [ariaLabel]="'detail.templatedLabel' | transloco" />
            <code class="font-mono text-[11px] text-muted-foreground">{{ templateExample }}</code>
          </span>
        </div>
        }
      </div>

      @if (draft().pendingPreset(); as p) {
      <div class="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px]">
        <ng-icon name="lucideZap" size="0.85rem" class="shrink-0 text-destructive-soft" />
        <span class="text-foreground">{{ 'detail.presetConfirm' | transloco: { label: presetLabel(p.label) } }}</span>
        <div class="ml-auto flex items-center gap-2">
          <button ui-button variant="destructive" size="sm" (click)="draft().applyPendingPreset()">{{ 'detail.replace' | transloco }}</button>
          <button ui-button variant="outline" size="sm" (click)="draft().pendingPreset.set(null)">{{ 'detail.cancel' | transloco }}</button>
        </div>
      </div>
      }

      <!-- headers editor -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Headers</label>
          <ui-badge tone="neutral">{{ draft().headers().length }}</ui-badge>
        </div>
        <div class="flex flex-col gap-1.5">
          @for (h of draft().headers(); track $index) {
          <div class="flex items-center gap-2">
            <mocks-next-header-combobox class="w-1/3" [value]="h.key" (valueChange)="draft().setHeaderKey($index, $event)" />
            <input ui-input type="text" class="flex-1 font-mono text-[12px]" [placeholder]="'detail.valuePlaceholder' | transloco" [value]="h.value" (input)="draft().setHeaderValue($index, $any($event.target).value)" />
            <button ui-button variant="ghost" size="icon" (click)="draft().removeHeaderRow($index)" [uiTooltip]="'detail.removeHeaderTip' | transloco"><ng-icon name="lucideX" size="0.85rem" /></button>
          </div>
          } @empty {
          <p class="text-[12.5px] text-muted-foreground">{{ 'detail.noHeader' | transloco }}</p>
          }
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button ui-button variant="outline" size="sm" (click)="draft().addHeaderRow()"><ng-icon name="lucidePlus" size="0.85rem" /> {{ 'detail.addHeader' | transloco }}</button>
          <button ui-button variant="outline" size="sm" [cdkMenuTriggerFor]="headerBundleMenu" [uiTooltip]="'detail.insertBundleTip' | transloco"><ng-icon name="lucideLayers" size="0.85rem" /> {{ 'detail.insertBundle' | transloco }} <ng-icon name="lucideChevronDown" size="0.8rem" /></button>
        </div>
      </div>
      }

      <!-- body / sorgente editor -->
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ (draft().isScript() ? 'detail.sourceLabel' : 'detail.bodyLabel') | transloco }}</label>
            @if (draft().isScript() || draft().payloadType() !== 'file') {
            <editor-shortcuts-help />
            }
          </div>
          <div class="flex items-center gap-2">
            @if (!draft().isScript()) {
            <ui-toggle-group [value]="draft().payloadType()" (valueChange)="draft().setBodyFormat($any($event))">
              <button ui-toggle-item value="json">JSON</button>
              <button ui-toggle-item value="text">{{ 'detail.formatText' | transloco }}</button>
              <button ui-toggle-item value="file">{{ 'detail.formatFile' | transloco }}</button>
            </ui-toggle-group>
            }
            @if (!draft().isScript() && draft().payloadType() !== 'file') {
            <button ui-button variant="outline" size="sm" class="font-mono" [cdkMenuTriggerFor]="contentTypeMenu" [uiTooltip]="'detail.contentTypeTip' | transloco">{{ draft().contentType() }} <ng-icon name="lucideChevronDown" size="0.8rem" /></button>
            }
            @if (draft().bodyInvalid()) {
            <span class="inline-flex items-center gap-1 text-[11.5px] text-destructive-soft"><ng-icon name="lucideX" size="0.8rem" /> {{ 'detail.invalidJson' | transloco }}</span>
            }
            @if (draft().isScript()) {
            <button ui-button variant="ghost" size="sm" (click)="draft().regenerateSource()" [uiTooltip]="'detail.regenerateTemplateTip' | transloco"><ng-icon name="lucideRefreshCw" size="0.8rem" /> {{ 'detail.regenerateTemplate' | transloco }}</button>
            }
          </div>
        </div>
        @if (!draft().isScript() && draft().payloadType() === 'file') {
        <label
          class="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-input bg-black/20 px-4 py-6 text-center text-[13px] transition hover:border-ring/40"
          [style.borderColor]="draggingFile() ? 'var(--brand)' : null"
          [style.backgroundColor]="draggingFile() ? 'color-mix(in srgb, var(--brand) 12%, transparent)' : null"
          [class.pointer-events-none]="busy()"
          [class.opacity-60]="busy()"
          (dragenter)="onFileDragOver($event)"
          (dragover)="onFileDragOver($event)"
          (dragleave)="onFileDragLeave($event)"
          (drop)="onFileDrop($event)"
        >
          <div class="pointer-events-none flex flex-col items-center gap-1.5">
            <ng-icon name="lucideUpload" size="1.35rem" [style.color]="draggingFile() ? 'var(--brand)' : null" />
            <span class="font-medium text-foreground">{{ dropzoneLabel() | transloco }}</span>
            @if (fileLabel(); as label) {
            <span class="font-mono text-[11.5px] text-muted-foreground">{{ (creating() ? 'detail.fileChosen' : 'detail.fileCurrent') | transloco }}: {{ label }}</span>
            }
            <span class="text-[11px] text-muted-foreground">{{ 'detail.fileHint' | transloco }}</span>
          </div>
          <input type="file" class="hidden" (change)="onFileSelected($event)" [disabled]="busy()" />
        </label>
        } @else {
        <ui-code-editor
          [value]="draft().body()"
          (valueChange)="draft().body.set($event)"
          [invalid]="draft().bodyInvalid()"
          [minRows]="10"
          [language]="draft().isScript() ? 'javascript' : (draft().payloadType() === 'text' ? 'text' : 'json')"
          [ariaLabel]="(draft().isScript() ? 'detail.sourceLabel' : 'detail.bodyLabel') | transloco"
        />
        }
      </div>
    </div>

    <!-- menu preset: bundle header / preset response / content-type -->
    <ng-template #headerBundleMenu>
      <div ui-menu class="min-w-[16rem]">
        @for (b of headerBundles; track b.id) {
        <button ui-menu-item (click)="draft().applyHeaderBundle(b)">
          <ng-icon [name]="b.icon" size="0.9rem" class="text-brand" />
          <span class="flex flex-1 flex-col">
            <span>{{ b.label | transloco }}</span>
            <span class="text-[11px] text-muted-foreground">{{ b.description }}</span>
          </span>
        </button>
        }
      </div>
    </ng-template>

    <ng-template #presetResponseMenu>
      <div ui-menu class="min-w-[16rem]">
        @for (p of responsePresets; track p.id) {
        <button ui-menu-item (click)="draft().choosePreset(p)">
          <span class="size-1.5 shrink-0 rounded-full" [class]="presetDotClass(p.status)"></span>
          <span class="flex-1">{{ p.label | transloco }}</span>
        </button>
        }
      </div>
    </ng-template>

    <ng-template #contentTypeMenu>
      <div ui-menu class="min-w-[14rem]">
        @for (ct of contentTypes; track ct) {
        <button ui-menu-item (click)="draft().chooseContentType(ct)">
          <span class="flex-1 font-mono text-[12.5px]">{{ contentTypeLabel(ct) }}</span>
          @if (draft().contentType() === contentTypeLabel(ct)) {
          <ng-icon name="lucideCheck" size="0.85rem" class="text-brand" />
          }
        </button>
        }
      </div>
    </ng-template>
  `,
})
export class MocksNextResponseForm {
  /** Bozza condivisa col dettaglio (che tiene Salva/Annulla in toolbar). */
  readonly draft = input.required<ResponseDraft>();
  /** Esempio mostrato accanto al toggle Template (le doppie graffe non si scrivono nel template Angular). */
  protected readonly templateExample = '{{params.id}} · {{query.x}}';
  /** True in creazione: il file scelto resta in bozza invece di essere caricato subito. */
  readonly creating = input(false);
  /** File scelto in MODIFICA: il padre lo carica subito sulla response corrente. */
  readonly filePicked = output<File>();

  protected readonly store = inject(MocksStore);
  private readonly transloco = inject(TranslocoService);

  protected readonly headerBundles: readonly HeaderBundle[] = HEADER_BUNDLES;
  protected readonly responsePresets: readonly ResponsePreset[] = RESPONSE_PRESETS;
  protected readonly contentTypes = CONTENT_TYPES;
  /** Esposto al template per le etichette dei content-type. */
  protected readonly contentTypeLabel = contentTypeLabel;

  protected readonly busy = computed(() => this.store.savingId() === this.store.selected()?.id);
  /** Highlight della dropzone file mentre un file è trascinato sopra. */
  protected readonly draggingFile = signal(false);

  /** Nome del file della response file-backed corrente (per la UI di upload in modifica). */
  private readonly currentFileLabel = computed(() => {
    const d = this.store.selected();
    if (d?.payloadType !== 'file') return '';
    return d.fileInfo?.name || d.bodyFile || d.file || '';
  });

  /** Nome file da mostrare nella dropzone: in creazione il file in bozza, in modifica quello già caricato. */
  protected readonly fileLabel = computed(() =>
    this.creating() ? (this.draft().file()?.name ?? '') : this.currentFileLabel(),
  );

  /** Traduce la chiave i18n dell'etichetta di un preset/bundle (per l'uso come parametro). */
  protected presetLabel(key: string): string {
    return this.transloco.translate(key);
  }

  /** Chiave i18n del testo principale della dropzone file (stato: caricamento / drag / sostituzione / vuoto). */
  protected dropzoneLabel(): string {
    if (this.busy()) return 'detail.fileUploading';
    if (this.draggingFile()) return 'detail.fileDrop';
    return this.fileLabel() ? 'detail.fileReplace' : 'detail.fileEmpty';
  }

  /** Classe del pallino di un preset, per fascia di status (coerente coi token --status-*). */
  protected presetDotClass(status: number): string {
    if (status >= 500) return 'bg-[color:var(--status-5xx)]/80';
    if (status >= 400) return 'bg-[color:var(--status-4xx)]/80';
    if (status >= 300) return 'bg-[color:var(--status-3xx)]/80';
    if (status >= 200) return 'bg-[color:var(--status-2xx)]/80';
    return 'bg-muted-foreground';
  }

  protected toInt(value: string): number {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? 0 : Math.max(0, n);
  }

  /** File scelto col picker in modalità File: in creazione lo tiene in bozza, in modifica lo carica il padre. */
  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.acceptFile(file);
  }

  /** Drag&drop sulla dropzone file: evidenzia mentre il file è sopra, accetta al rilascio. */
  protected onFileDragOver(event: DragEvent): void {
    if (this.busy()) return;
    event.preventDefault();
    this.draggingFile.set(true);
  }

  protected onFileDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.draggingFile.set(false);
  }

  protected onFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.draggingFile.set(false);
    if (this.busy()) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.acceptFile(file);
  }

  private acceptFile(file: File): void {
    if (this.creating()) {
      this.draft().file.set(file);
    } else {
      this.filePicked.emit(file);
    }
  }
}
