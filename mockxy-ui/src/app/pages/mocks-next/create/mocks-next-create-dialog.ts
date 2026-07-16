import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideCog, lucideFileCode, lucideLayers, lucideRefreshCw, lucideUpload, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiCodeEditor } from '../../../ui/ui-code-editor/ui-code-editor';
import { UiInput } from '../../../ui/ui-input/ui-input';
import { UiSelect, type UiSelectOption } from '../../../ui/ui-select/ui-select';
import { UiToggleGroup, UiToggleItem } from '../../../ui/ui-toggle-group/ui-toggle-group';
import { UiTooltip } from '../../../ui/ui-tooltip/ui-tooltip';
import { MocksStore } from '../mocks-next.store';
import { scriptTemplate } from '../script-templates';
import { StatusCombobox, isValidStatus } from '../status-combobox/status-combobox';
import { routePathError } from '../../../mock-path-convention';
import type { MockType } from '../../../mock-admin-api.types';
import { MOCK_METHODS } from '../../../mock-admin-ui.constants';

export interface CreateDialogData {
  /** Il dialog "Nuovo" crea endpoint mock/handler/middleware; le varianti sse nascono dal dettaglio. */
  readonly type: Exclude<MockType, 'sse'>;
}

const METHOD_OPTIONS: readonly UiSelectOption<string>[] = MOCK_METHODS.map((m) => ({ value: m, label: m }));

/**
 * Dialog "Nuovo": crea mock/handler/middleware. Inietta lo store page-scoped
 * (il dialog va aperto con `viewContainerRef`); chiude solo a creazione riuscita.
 */
@Component({
  selector: 'mocks-next-create-dialog',
  imports: [NgIcon, StatusCombobox, TranslocoPipe, UiButton, UiCodeEditor, UiInput, UiSelect, UiToggleGroup, UiToggleItem, UiTooltip],
  providers: [provideIcons({ lucideCheck, lucideCog, lucideFileCode, lucideLayers, lucideRefreshCw, lucideUpload, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex max-h-[85vh] w-[min(92vw,640px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl">
      <div class="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <span class="grid h-7 w-7 place-items-center rounded-md bg-muted text-brand ring-1 ring-border"><ng-icon [name]="icon()" size="0.95rem" /></span>
        <h2 class="text-[15px] font-bold tracking-tight">{{ 'createDialog.title' | transloco: { type: typeLabel() } }}</h2>
        <button ui-button variant="ghost" size="icon" class="ml-auto" (click)="close()" [disabled]="store.creating()"><ng-icon name="lucideX" size="0.95rem" /></button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto mx-scroll px-5 py-4">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex flex-col gap-1.5">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'createDialog.method' | transloco }}</label>
            <ui-select class="w-36" [options]="methodOptions" [value]="method()" (valueChange)="method.set($any($event))" />
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'createDialog.path' | transloco }}</label>
            <input ui-input type="text" class="w-full font-mono text-[13px]" placeholder="/es/risorsa/:id" [value]="path()" (input)="path.set($any($event.target).value)" />
            @if (pathError()) {
            <span class="text-[11.5px] text-destructive-soft">{{ (pathError() ?? '') | transloco }}</span>
            }
          </div>
        </div>

        @if (data.type === 'mock') {
        <div class="flex flex-col gap-1.5">
          <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Status</label>
          <mocks-next-status-combobox [(value)]="status" />
        </div>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Body</label>
            <div class="flex items-center gap-2">
              <ui-toggle-group [value]="bodyFormat()" (valueChange)="bodyFormat.set($any($event))">
                <button ui-toggle-item value="json">JSON</button>
                <button ui-toggle-item value="text">{{ 'createDialog.bodyFormatText' | transloco }}</button>
                <button ui-toggle-item value="file">File</button>
              </ui-toggle-group>
              @if (bodyInvalid()) {
              <span class="inline-flex items-center gap-1 text-[11.5px] text-destructive-soft"><ng-icon name="lucideX" size="0.8rem" /> {{ 'createDialog.invalidJson' | transloco }}</span>
              }
            </div>
          </div>
          @if (bodyFormat() === 'file') {
          <label
            class="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-input bg-black/20 px-4 py-6 text-center text-[13px] transition hover:border-ring/40"
            [style.borderColor]="draggingFile() ? 'var(--brand)' : null"
            [style.backgroundColor]="draggingFile() ? 'color-mix(in srgb, var(--brand) 12%, transparent)' : null"
            (dragenter)="onFileDragOver($event)"
            (dragover)="onFileDragOver($event)"
            (dragleave)="onFileDragLeave($event)"
            (drop)="onFileDrop($event)"
          >
            <div class="pointer-events-none flex flex-col items-center gap-1.5">
              <ng-icon name="lucideUpload" size="1.35rem" [style.color]="draggingFile() ? 'var(--brand)' : null" />
              <span class="font-medium text-foreground">
                @if (draggingFile()) {
                {{ 'createDialog.dropFile' | transloco }}
                } @else if (fileDraft()) {
                {{ 'createDialog.dropReplace' | transloco }}
                } @else {
                {{ 'createDialog.dropHint' | transloco }}
                }
              </span>
              @if (fileDraft(); as f) {
              <span class="font-mono text-[11.5px] text-muted-foreground">{{ f.name }}</span>
              }
              <span class="text-[11px] text-muted-foreground">{{ 'createDialog.fileContentTypeHint' | transloco }}</span>
            </div>
            <input type="file" class="hidden" (change)="onFileSelected($event)" />
          </label>
          } @else {
          <ui-code-editor [value]="bodyDraft()" (valueChange)="bodyDraft.set($event)" [invalid]="bodyInvalid()" [minRows]="8" [language]="bodyFormat() === 'text' ? 'text' : 'json'" [ariaLabel]="(bodyFormat() === 'text' ? 'createDialog.ariaBodyText' : 'createDialog.ariaBodyJson') | transloco" />
          }
        </div>
        } @else {
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <label class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ 'createDialog.source' | transloco }}</label>
            <button ui-button variant="ghost" size="sm" (click)="regenerateSource()" [uiTooltip]="'createDialog.regenerateTemplateTip' | transloco"><ng-icon name="lucideRefreshCw" size="0.8rem" /> {{ 'createDialog.regenerateTemplate' | transloco }}</button>
          </div>
          <ui-code-editor [value]="sourceDraft()" (valueChange)="sourceDraft.set($event)" [minRows]="12" language="javascript" [ariaLabel]="'createDialog.ariaSourceJs' | transloco" />
        </div>
        }

        @if (store.error()) {
        <p class="text-[12.5px] text-destructive-soft">{{ store.error() }}</p>
        }
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button ui-button variant="outline" (click)="close()" [disabled]="store.creating()">{{ 'createDialog.cancel' | transloco }}</button>
        <button ui-button (click)="create()" [disabled]="!canCreate()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ 'createDialog.create' | transloco }}</button>
      </div>
    </div>
  `,
})
export class MocksNextCreateDialog {
  protected readonly store = inject(MocksStore);
  private readonly dialogRef = inject<DialogRef<string>>(DialogRef);
  protected readonly data = inject<CreateDialogData>(DIALOG_DATA);

  protected readonly methodOptions = METHOD_OPTIONS;

  protected readonly method = signal('GET');
  protected readonly path = signal('');
  protected readonly status = signal<number | null>(200);
  protected readonly bodyDraft = signal('{\n  \n}');
  protected readonly sourceDraft = signal(this.data.type === 'mock' ? '' : scriptTemplate(this.data.type));
  /** Formato del body in creazione: JSON, testo, o file (upload dopo la creazione). */
  protected readonly bodyFormat = signal<'json' | 'text' | 'file'>('json');
  protected readonly fileDraft = signal<File | null>(null);
  protected readonly draggingFile = signal(false);

  protected readonly typeLabel = computed(() => (this.data.type === 'mock' ? 'mock' : this.data.type === 'handler' ? 'handler' : 'middleware'));
  protected readonly icon = computed(() => (this.data.type === 'mock' ? 'lucideLayers' : this.data.type === 'handler' ? 'lucideFileCode' : 'lucideCog'));

  protected readonly statusInvalid = computed(() => this.data.type === 'mock' && !isValidStatus(this.status()));
  protected readonly pathError = computed(() => routePathError(this.path()));

  protected readonly bodyInvalid = computed(() => {
    if (this.data.type !== 'mock' || this.bodyFormat() !== 'json') return false;
    try {
      JSON.parse(this.bodyDraft());
      return false;
    } catch {
      return true;
    }
  });

  protected readonly canCreate = computed(() => {
    if (this.store.creating() || this.path().trim() === '' || this.pathError() !== null) return false;
    if (this.data.type !== 'mock') return true;
    if (this.statusInvalid() || this.bodyInvalid()) return false;
    if (this.bodyFormat() === 'file' && this.fileDraft() == null) return false;
    return true;
  });

  protected create(): void {
    if (!this.canCreate()) return;
    const method = this.method();
    const path = this.path().trim();
    const done = (ok: boolean) => {
      if (ok) this.dialogRef.close('created');
    };
    if (this.data.type === 'mock') {
      // Content-type ESPLICITO (visibile/modificabile nel dettaglio): JSON→application/json, Testo→text/plain.
      // Per File è l'upload a impostarlo dal MIME del file.
      const headers: Record<string, string> =
        this.bodyFormat() === 'json'
          ? { 'content-type': 'application/json; charset=utf-8' }
          : this.bodyFormat() === 'text'
            ? { 'content-type': 'text/plain; charset=utf-8' }
            : {};
      const config = { method, path, status: this.status() ?? 0, disabled: false, headers, bodyFile: '001.response.json', delayMs: 0 };
      if (this.bodyFormat() === 'file') {
        // crea l'endpoint (body vuoto) e poi carica il file sulla sua prima response.
        const file = this.fileDraft();
        this.store.createMockDef(config, {}, (ok) => {
          if (!ok) return;
          if (file) this.store.uploadResponseFile(file, () => this.dialogRef.close('created'));
          else this.dialogRef.close('created');
        });
      } else {
        const body = this.bodyFormat() === 'text' ? this.bodyDraft() : safeParse(this.bodyDraft());
        this.store.createMockDef(config, body, done);
      }
    } else {
      this.store.createScriptDef(this.data.type, { method, path, disabled: false }, this.sourceDraft(), done);
    }
  }

  /** Ripristina la sorgente al template di partenza (solo handler/middleware). */
  protected regenerateSource(): void {
    if (this.data.type === 'mock') return;
    this.sourceDraft.set(scriptTemplate(this.data.type));
  }

  // --- modalità File (dropzone) ---
  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (file) this.fileDraft.set(file);
  }

  protected onFileDragOver(event: DragEvent): void {
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
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) this.fileDraft.set(file);
  }

  protected close(): void {
    this.dialogRef.close();
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
