import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, ViewContainerRef } from '@angular/core';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { lucideCheck, lucideCog, lucideCopy, lucideFile, lucideFileCode, lucideLayers, lucideListOrdered, lucideMessageSquare, lucidePencil, lucidePlus, lucideRadio, lucideTrash2, lucideX } from '@ng-icons/lucide';
import { UiBadge, type BadgeTone } from '../../../ui/ui-badge/ui-badge';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiChip } from '../../../ui/ui-chip/ui-chip';
import { UiCode } from '../../../ui/ui-code/ui-code';
import { UiCollapsible } from '../../../ui/ui-collapsible/ui-collapsible';
import { UiInput } from '../../../ui/ui-input/ui-input';
import { UiMenu, UiMenuItem } from '../../../ui/ui-menu/ui-menu';
import { UiSelect, type UiSelectOption } from '../../../ui/ui-select/ui-select';
import { UiSkeleton } from '../../../ui/ui-skeleton/ui-skeleton';
import { UiSwitch } from '../../../ui/ui-switch/ui-switch';
import { UiTable } from '../../../ui/ui-table/ui-table';
import { UiTooltip } from '../../../ui/ui-tooltip/ui-tooltip';
import { UiDialog } from '../../../ui/ui-dialog/ui-dialog';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { MocksStore } from '../mocks-next.store';
import { StatusCombobox, isValidStatus } from '../status-combobox/status-combobox';
import { MocksNextCopyDialog, type CopyDialogData } from '../copy/mocks-next-copy-dialog';
import { MocksNextSequenceDialog, type SequenceDialogData } from '../sequence/mocks-next-sequence-dialog';
import { MocksNextSseConsole } from '../sse/mocks-next-sse-console';
import { MocksNextResponseForm } from './response-form';
import { ResponseDraft, type DraftPayloadType, type DraftScriptType } from './response-draft';
import type { MockType } from '../../../mock-admin-api.types';

const METHOD_TONES: ReadonlySet<string> = new Set(['get', 'post', 'put', 'delete', 'patch']);

/**
 * Pannello dettaglio della schermata Mocks (Fase C: CRUD inline).
 * Mostra header endpoint, regione Response, headers e body dal MockDetail reale e
 * permette di modificare in posto: descrizione endpoint, response (via ResponseDraft +
 * form dedicato), creazione/eliminazione response, eliminazione endpoint.
 * Componente "smart": inietta MocksStore.
 */
@Component({
  selector: 'mocks-next-detail',
  imports: [CdkMenuTrigger, NgIcon, StatusCombobox, TranslocoPipe, UiBadge, UiButton, UiChip, UiCode, UiCollapsible, UiInput, UiMenu, UiMenuItem, UiSelect, UiSkeleton, UiSwitch, UiTable, UiTooltip, MocksNextResponseForm, MocksNextSseConsole],
  providers: [provideIcons({ lucideCheck, lucideCog, lucideCopy, lucideFile, lucideFileCode, lucideLayers, lucideListOrdered, lucideMessageSquare, lucidePencil, lucidePlus, lucideRadio, lucideTrash2, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative flex min-w-0 flex-1 flex-col overflow-hidden bg-muted' },
  template: `
    <div class="mx-glow"></div>

    @if (detail(); as d) {
    <!-- HEADER ENDPOINT -->
    <div class="relative z-10 shrink-0 border-b border-border px-6 pb-4 pt-4">
      <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-3">
            <ui-badge [tone]="methodTone(d.method)" size="md">{{ d.method }}</ui-badge>
            <h1 class="min-w-0 truncate font-mono text-[22px] font-bold tracking-tight text-foreground">{{ d.path }}</h1>
          </div>

          <!-- descrizione: vista / modifica inline -->
          @if (editingDescription()) {
          <div class="mt-2 flex items-center gap-2">
            <input
              ui-input
              type="text"
              class="w-full max-w-xl text-[13.5px]"
              [placeholder]="'detail.descriptionPlaceholder' | transloco"
              [value]="draftDescription()"
              (input)="draftDescription.set($any($event.target).value)"
              (keydown.enter)="saveDescription()"
              (keydown.escape)="cancelEditDescription()"
            />
            <button ui-button size="icon" [disabled]="busy()" (click)="saveDescription()" [uiTooltip]="'detail.saveDescription' | transloco"><ng-icon name="lucideCheck" size="0.9rem" /></button>
            <button ui-button variant="outline" size="icon" (click)="cancelEditDescription()" [uiTooltip]="'detail.cancel' | transloco"><ng-icon name="lucideX" size="0.9rem" /></button>
          </div>
          } @else {
          <div class="mt-2 flex items-center gap-2">
            <p class="text-[13.5px]" [class]="d.endpoint?.description ? 'text-muted-foreground' : 'text-muted-foreground/50 italic'">{{ d.endpoint?.description || ('detail.noDescription' | transloco) }}</p>
            @if (d.editable) {
            <button type="button" class="shrink-0 text-muted-foreground/50 transition hover:text-foreground" (click)="startEditDescription()" [uiTooltip]="'detail.editDescription' | transloco"><ng-icon name="lucidePencil" size="0.7rem" /></button>
            }
          </div>
          }

          @if (filePath()) {
          <p class="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--foreground-faint)]" [uiTooltip]="'detail.filePathTip' | transloco">
            <ng-icon name="lucideFile" size="0.75rem" />
            {{ filePath() }}
          </p>
          }
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <span class="inline-flex items-center gap-2 rounded-lg border border-input bg-accent px-3 py-1.5 text-[13px] font-semibold text-foreground">
            <ui-switch [checked]="!d.disabled" [disabled]="busy()" size="sm" (checkedChange)="store.toggleEnabled(d.id, $event)" [ariaLabel]="'detail.endpointActive' | transloco" />
            {{ (d.disabled ? 'detail.inactive' : 'detail.active') | transloco }}
          </span>
          @if (d.editable) {
            @if (confirmingDeleteEndpoint()) {
            <span class="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[12.5px]">
              <span class="text-destructive-soft">{{ 'detail.deleteEndpointConfirm' | transloco }}</span>
              <button ui-button variant="destructive" size="sm" [disabled]="busy()" (click)="confirmDeleteEndpoint()">{{ 'detail.delete' | transloco }}</button>
              <button ui-button variant="outline" size="sm" (click)="cancelDeleteEndpoint()">{{ 'detail.cancel' | transloco }}</button>
            </span>
            } @else {
            <button ui-button variant="destructive" (click)="askDeleteEndpoint()"><ng-icon name="lucideTrash2" size="0.85rem" /> {{ 'detail.delete' | transloco }}</button>
            }
          }
          <button ui-button variant="outline" (click)="openCopy()" [uiTooltip]="'detail.copyEndpointTip' | transloco"><ng-icon name="lucideCopy" size="0.85rem" /> {{ 'detail.copy' | transloco }}</button>
          <!-- Il chip SEQ (stesso segnale del catalogo) rende evidente la sequenza attiva. -->
          <button ui-button variant="outline" (click)="openSequence()" [uiTooltip]="(d.sequenceActive ? 'detail.sequenceTipActive' : 'detail.sequenceTip') | transloco">
            <ng-icon name="lucideListOrdered" size="0.85rem" [class.text-sequence]="d.sequenceActive" /> {{ 'detail.sequence' | transloco }}
            @if (d.sequenceActive) {
            <span class="rounded bg-[color-mix(in_srgb,var(--sequence)_16%,transparent)] px-1 text-[0.7rem] font-bold tracking-wide text-sequence">SEQ</span>
            }
          </button>
        </div>
      </div>
    </div>

    <!-- REGIONE RESPONSE -->
    <div class="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="shrink-0 border-b border-border bg-white/[0.02] px-6 py-3">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div class="flex items-center gap-2">
            <span class="grid h-6 w-6 place-items-center rounded-md bg-muted text-brand ring-1 ring-border">
              <ng-icon name="lucideMessageSquare" size="0.85rem" />
            </span>
            <h2 class="text-[15px] font-bold tracking-tight text-foreground">Response</h2>
            <ui-badge tone="neutral">{{ d.responses?.length ?? 0 }}</ui-badge>
          </div>

          @if (responseFormOpen()) {
          @if (creatingResponse()) {
          <span class="text-[12.5px] font-semibold text-brand">{{ newResponseLabel() }}</span>
          } @else {
          <span class="text-[12.5px] font-semibold text-brand">{{ 'detail.editResponse' | transloco }}</span>
          }
          <div class="ml-auto flex items-center gap-2">
            <button ui-button [disabled]="!canSaveResponse()" (click)="saveEditResponse()"><ng-icon name="lucideCheck" size="0.9rem" /> {{ 'detail.save' | transloco }}</button>
            <button ui-button variant="outline" [disabled]="busy()" (click)="cancelEditResponse()"><ng-icon name="lucideX" size="0.9rem" /> {{ 'detail.cancel' | transloco }}</button>
          </div>
          } @else if (confirmingDeleteResponse()) {
          <span class="text-[12.5px] text-destructive-soft">{{ 'detail.deleteResponseConfirm' | transloco: { title: currentTitleLabel() } }}</span>
          <div class="ml-auto flex items-center gap-2">
            <button ui-button variant="destructive" [disabled]="busy()" (click)="confirmDeleteResponse()"><ng-icon name="lucideTrash2" size="0.85rem" /> {{ 'detail.delete' | transloco }}</button>
            <button ui-button variant="outline" [disabled]="busy()" (click)="cancelDeleteResponse()">{{ 'detail.cancel' | transloco }}</button>
          </div>
          } @else {
          <div class="flex items-center gap-2">
            <ui-select
              class="w-128"
              [options]="responseOptions()"
              [value]="d.selectedResponseFile ?? null"
              (valueChange)="store.selectResponse($any($event))"
              [disabled]="busy()"
              [placeholder]="'detail.responseTitlePlaceholder' | transloco"
            />
            @if (d.editable) {
            <button ui-button variant="outline" size="icon" [cdkMenuTriggerFor]="addResponseMenu" [disabled]="busy()" [uiTooltip]="'detail.addResponseTip' | transloco"><ng-icon name="lucidePlus" size="0.95rem" /></button>
            @if (responseEditable()) {
            <button ui-button variant="outline" size="icon" (click)="startEditResponse()" [uiTooltip]="'detail.editSelectedResponseTip' | transloco"><ng-icon name="lucidePencil" size="0.95rem" /></button>
            }
            <button ui-button variant="destructive" size="icon" (click)="askDeleteResponse()" [disabled]="(d.responses?.length ?? 0) <= 1" [uiTooltip]="((d.responses?.length ?? 0) <= 1 ? 'detail.atLeastOneResponseTip' : 'detail.deleteSelectedResponseTip') | transloco"><ng-icon name="lucideTrash2" size="0.95rem" /></button>
            }
          </div>

          <div class="ml-auto flex flex-wrap items-center gap-2">
            @if (selectedStatus() !== null) {
            <mocks-next-status-combobox [value]="selectedStatus()" [readOnly]="true" />
            }
            <ui-chip>
              <span class="text-[10px] font-semibold uppercase tracking-wide">delay</span>
              <span class="font-mono font-semibold tabular-nums text-foreground">{{ d.config?.delayMs ?? 0 }} ms</span>
            </ui-chip>
          </div>
          }
        </div>

        <!-- menu "aggiungi response": nuovo mock + (clona dalla mock) + nuovi script vanilla -->
        <ng-template #addResponseMenu>
          <div ui-menu class="min-w-[15rem]">
            <button ui-menu-item (click)="createResponseOfType('mock')">
              <ng-icon name="lucideLayers" size="0.9rem" class="text-type-mock" />
              <span class="flex-1">{{ 'detail.newResponseMock' | transloco }}</span>
            </button>
            <div class="mx-1 my-1 h-px bg-border"></div>
            <button ui-menu-item (click)="createResponseOfType('handler', 'vanilla')">
              <ng-icon name="lucideFileCode" size="0.9rem" class="text-type-handler" />
              <span class="flex-1">{{ 'detail.newResponseHandler' | transloco }}</span>
            </button>
            <button ui-menu-item (click)="createResponseOfType('middleware', 'vanilla')">
              <ng-icon name="lucideCog" size="0.9rem" class="text-type-middleware" />
              <span class="flex-1">{{ 'detail.newResponseMiddleware' | transloco }}</span>
            </button>
            <button ui-menu-item (click)="createSseResponse()">
              <ng-icon name="lucideRadio" size="0.9rem" class="text-brand" />
              <span class="flex-1">{{ 'detail.newResponseSse' | transloco }}</span>
            </button>
            @if (isMockSelected()) {
            <div class="mx-1 my-1 h-px bg-border"></div>
            <button ui-menu-item (click)="createResponseOfType('handler', 'clone')">
              <ng-icon name="lucideFileCode" size="0.9rem" class="text-type-handler" />
              <span class="flex-1">{{ 'detail.cloneToHandler' | transloco }}</span>
            </button>
            <button ui-menu-item (click)="createResponseOfType('middleware', 'clone')">
              <ng-icon name="lucideCog" size="0.9rem" class="text-type-middleware" />
              <span class="flex-1">{{ 'detail.cloneToMiddleware' | transloco }}</span>
            </button>
            }
          </div>
        </ng-template>
      </div>

      <!-- AREA HEADERS + BODY (vista) oppure FORM MODIFICA/CREAZIONE RESPONSE -->
      <!-- In vista è una colonna flex: header fissi (con cap), body con scroll interno.
           In modifica resta un'unica area scrollabile (il form è lungo per natura). -->
      <div class="min-h-0 flex-1" [class]="responseFormOpen() ? 'overflow-y-auto mx-scroll' : 'flex flex-col overflow-hidden'">
        @if (responseFormOpen()) {
        <mocks-next-response-form [draft]="draft" [creating]="creatingResponse()" (filePicked)="uploadResponseFile($event)" />
        } @else if (d.type === 'sse') {
        <!-- Variante SSE: al posto della preview del body c'è la console (regia manuale). -->
        <mocks-next-sse-console [detail]="d" />
        } @else {
        @if (headerEntries().length) {
        <div class="shrink-0 border-b border-border">
          <ui-collapsible triggerClass="bg-black/20 px-6 py-2.5 hover:bg-black/30">
            <div uiCollapsibleHeader class="flex items-center gap-2">
              <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">Headers</h3>
              <ui-badge tone="neutral">{{ headerEntries().length }}</ui-badge>
            </div>
            <div class="max-h-48 overflow-y-auto bg-[var(--code)] mx-scroll">
              <table ui-table class="font-mono text-[12px]">
                <tbody>
                  @for (h of headerEntries(); track h[0]) {
                  <tr>
                    <td class="w-[34%] whitespace-nowrap py-1.5 pl-6 pr-4 align-top font-medium text-slate-300/90">{{ h[0] }}</td>
                    <td class="truncate py-1.5 pr-4 align-top text-muted-foreground" [title]="h[1]">{{ h[1] }}</td>
                  </tr>
                  }
                </tbody>
              </table>
            </div>
          </ui-collapsible>
        </div>
        }

        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex shrink-0 items-center gap-3 bg-black/20 px-6 py-2.5">
            <h3 class="text-[12px] font-bold uppercase tracking-[0.14em] text-foreground/80">{{ (body().kind === 'source' ? 'detail.sourceLabel' : 'detail.bodyLabel') | transloco }}</h3>
            <span class="font-mono text-[11px] text-muted-foreground">{{ d.selectedResponseFile }}</span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4 mx-scroll">
            @if (body().kind === 'file') {
            <p class="font-mono text-[13px] text-muted-foreground">{{ 'detail.filePrefix' | transloco }} {{ body().text || '—' }}</p>
            } @else if (body().kind === 'none') {
            <p class="text-[13px] text-muted-foreground">{{ 'detail.noBody' | transloco }}</p>
            } @else {
            <ui-code [code]="body().text" [language]="body().kind === 'json' ? 'json' : 'text'" />
            }
          </div>
        </div>
        }
      </div>
    </div>
    } @else if (loading()) {
    <div class="relative z-10 flex flex-col gap-3 p-6">
      <ui-skeleton class="h-7 w-64" />
      <ui-skeleton class="h-4 w-80" />
      <ui-skeleton class="mt-4 h-40 w-full" />
    </div>
    } @else {
    <div class="relative z-10 grid flex-1 place-items-center p-6 text-sm text-muted-foreground">
      {{ 'detail.selectEndpoint' | transloco }}
    </div>
    }
  `,
})
export class MocksNextDetail {
  protected readonly store = inject(MocksStore);
  private readonly api = inject(MockAdminApiService);
  private readonly dialog = inject(UiDialog);
  private readonly vcr = inject(ViewContainerRef);
  private readonly transloco = inject(TranslocoService);
  /** Alias dei signal dello store (componente smart). */
  protected readonly detail = this.store.selected;
  protected readonly loading = this.store.detailLoading;

  // --- stato modifica (Fase C) ---
  protected readonly editingResponse = signal(false);
  /** Creazione response: il form è aperto su una bozza non ancora creata (Salva crea, Annulla scarta). */
  protected readonly creatingResponse = signal(false);
  protected readonly editingDescription = signal(false);
  protected readonly confirmingDeleteResponse = signal(false);
  protected readonly confirmingDeleteEndpoint = signal(false);

  /** Bozza della response nel form (stato + regole + payload), condivisa col form dedicato. */
  protected readonly draft = new ResponseDraft();
  // bozza descrizione
  protected readonly draftDescription = signal('');

  constructor() {
    // Quando cambia l'endpoint selezionato, azzera lo stato di modifica (niente bozze stantie).
    let lastId: string | null | undefined = null;
    effect(() => {
      const id = this.detail()?.id;
      if (id !== lastId) {
        lastId = id;
        this.resetEditState();
      }
    });
  }

  protected readonly busy = computed(() => this.store.savingId() === this.detail()?.id);
  /** Form response aperto: modifica di una esistente, o creazione di una nuova bozza. */
  protected readonly responseFormOpen = computed(() => this.editingResponse() || this.creatingResponse());
  /** Etichetta della testata del form in creazione (es. "Nuova response handler"). */
  protected readonly newResponseLabel = computed(() =>
    this.transloco.translate('detail.newResponseTitle', { type: this.draft.scriptType() ?? 'mock' }));

  /** La response selezionata e' modificabile in posto? (no payload binari, no sse: il copione si edita da file/API). */
  protected readonly responseEditable = computed(() => {
    const d = this.detail();
    if (!d || !d.editable) return false;
    if (d.type === 'sse') return false;
    if (d.type === 'handler' || d.type === 'middleware') return d.source != null;
    return d.payloadType === 'json' || d.payloadType === 'text' || d.payloadType === 'file' || d.payloadType == null;
  });

  protected readonly filePath = computed(() => {
    const d = this.detail();
    return d?.definitionFilePath || d?.configFilePath || '';
  });

  protected readonly headerEntries = computed<readonly [string, string][]>(() => {
    const headers = this.detail()?.config?.headers ?? {};
    return Object.entries(headers).map(([key, value]) => [key, formatHeaderValue(value)]);
  });

  protected readonly responseOptions = computed<readonly UiSelectOption<string>[]>(() =>
    (this.detail()?.responses ?? []).map((r) => {
      const type = r.type ?? 'mock';
      return {
        value: r.fileName,
        label: `${r.title || r.fileName} · ${type}`,
        accent: `var(--type-${type})`,
      };
    }),
  );

  protected readonly selectedStatus = computed<number | null>(() => {
    const d = this.detail();
    if (!d) return null;
    const selected = d.responses?.find((r) => r.fileName === d.selectedResponseFile);
    return selected?.status ?? d.status ?? null;
  });

  protected readonly canSaveResponse = computed(() => {
    if (this.busy() || this.draft.bodyInvalid()) return false;
    if (!this.draft.isScript() && !isValidStatus(this.draft.status())) return false;
    // In creazione modalità File serve un file scelto (l'upload avviene dopo la create).
    if (this.creatingResponse() && this.draft.payloadType() === 'file' && !this.draft.file()) return false;
    return true;
  });

  protected readonly body = computed<{ kind: 'json' | 'text' | 'source' | 'file' | 'none'; text: string; }>(() => {
    const d = this.detail();
    if (!d) return { kind: 'none', text: '' };
    if (d.type === 'handler' || d.type === 'middleware') {
      return { kind: 'source', text: d.source ?? '' };
    }
    if (d.payloadType === 'file') {
      return { kind: 'file', text: d.fileInfo?.name || d.bodyFile || d.file || '' };
    }
    if (d.payloadType === 'none') {
      return { kind: 'none', text: '' };
    }
    const raw = d.body ?? d.response ?? null;
    if (raw == null) return { kind: 'none', text: '' };
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
    return { kind: d.payloadType === 'text' ? 'text' : 'json', text };
  });

  /** True se la response selezionata è un mock con body inline (JSON/testo): seminabile in uno script. */
  protected readonly isMockSelected = computed(() => {
    const b = this.body();
    return this.detail()?.type === 'mock' && (b.kind === 'json' || b.kind === 'text');
  });

  protected methodTone(method: string): BadgeTone {
    const m = method.toLowerCase();
    return (METHOD_TONES.has(m) ? m : 'neutral') as BadgeTone;
  }

  protected currentTitleLabel(): string {
    const d = this.detail();
    return this.currentResponseTitle() || d?.selectedResponseFile || '';
  }

  // --- descrizione endpoint (C3) ---
  protected startEditDescription(): void {
    const d = this.detail();
    if (!d || !d.editable) return;
    this.resetEditState();
    this.draftDescription.set(d.endpoint?.description ?? '');
    this.editingDescription.set(true);
  }
  protected cancelEditDescription(): void {
    this.editingDescription.set(false);
  }
  protected saveDescription(): void {
    if (this.busy()) return;
    this.store.saveDescription(this.draftDescription().trim(), () => this.editingDescription.set(false));
  }

  // --- modifica response (C1) ---
  protected startEditResponse(): void {
    const d = this.detail();
    if (!d || !this.responseEditable()) return;
    this.resetEditState();
    const payloadType: DraftPayloadType = d.payloadType === 'text' ? 'text' : d.payloadType === 'file' ? 'file' : 'json';
    const scriptType: DraftScriptType = d.type === 'handler' || d.type === 'middleware' ? d.type : null;
    this.draft.seedForEdit({
      title: this.currentResponseTitle(),
      status: this.selectedStatus() ?? 200,
      delay: d.config?.delayMs ?? 0,
      headers: this.headerEntries().map(([key, value]) => ({ key, value })),
      payloadType,
      body: payloadType === 'file' ? '' : this.body().text,
      scriptType,
      templated: d.config?.templated === true,
    });
    this.editingResponse.set(true);
  }
  protected cancelEditResponse(): void {
    // In creazione "Annulla" scarta la bozza senza creare nulla lato backend.
    this.closeResponseForm();
  }
  protected saveEditResponse(): void {
    if (!this.canSaveResponse()) return;
    if (this.creatingResponse()) {
      this.createDraftResponse();
      return;
    }
    const payload = this.draft.buildUpdatePayload();
    if (!payload) return;
    this.store.saveResponse(payload, () => this.closeResponseForm());
  }

  /** Crea sul backend la response in bozza (solo a "Salva"); in modalità File carica il file dopo la create. */
  private createDraftResponse(): void {
    const payload = this.draft.buildCreatePayload();
    if (!payload) return;
    if (!this.draft.isScript() && this.draft.payloadType() === 'file') {
      const file = this.draft.file();
      if (!file) return;
      // crea la response (metadati) e, una volta selezionata, vi carica sopra il file scelto.
      this.store.addResponse(payload, () => this.store.uploadResponseFile(file, () => this.closeResponseForm()));
      return;
    }
    this.store.addResponse(payload, () => this.closeResponseForm());
  }

  /** Chiude il form response (modifica o creazione) e azzera la bozza volatile. */
  private closeResponseForm(): void {
    this.editingResponse.set(false);
    this.creatingResponse.set(false);
    this.draft.clearTransient();
  }

  /** Carica il file scelto/rilasciato in MODIFICA (rende la response file-backed) e chiude il form. */
  protected uploadResponseFile(file: File): void {
    this.store.uploadResponseFile(file, () => this.closeResponseForm());
  }

  // --- crea response (C2): apre il form su una BOZZA del tipo scelto (anche diverso dall'attuale).
  //     Niente create lato backend qui: avviene solo a "Salva" (createDraftResponse). "Annulla" scarta.
  //     seed='clone' semina lo script dalla response mock attuale; 'vanilla' usa il template. ---
  protected createResponseOfType(type: Exclude<MockType, 'sse'>, seed: 'clone' | 'vanilla' = 'vanilla'): void {
    const d = this.detail();
    if (this.busy() || !d?.editable) return;
    this.resetEditState();
    const seededSource = type !== 'mock' && seed === 'clone' ? this.seedSourceFromMock(type) : undefined;
    this.draft.seedForCreate(type, seededSource);
    this.creatingResponse.set(true);
  }

  /**
   * Crea una variante sse e la seleziona. Nessun form intermedio: nasce col copione vuoto (o
   * clonato, se la selezionata è già sse) e si edita da file/API; la console appare subito.
   */
  protected createSseResponse(): void {
    if (this.busy()) return;
    this.resetEditState();
    this.store.addResponse({ type: 'sse' });
  }

  // --- elimina response (C2) ---
  protected askDeleteResponse(): void {
    this.resetEditState();
    this.confirmingDeleteResponse.set(true);
  }
  protected cancelDeleteResponse(): void {
    this.confirmingDeleteResponse.set(false);
  }
  protected confirmDeleteResponse(): void {
    if (this.busy()) return;
    this.store.removeResponse(() => this.confirmingDeleteResponse.set(false));
  }

  /**
   * Apre il dialog "Sequenza" sull'endpoint corrente. Il dettaglio viene riletto fresco dal
   * server: è il GET dettaglio a portare sequenceState (il cursore runtime), che nello stato
   * in store può mancare o essere stantio dopo altre mutazioni.
   */
  protected openSequence(): void {
    const d = this.detail();
    if (!d) return;
    this.api.getMock(d.id).subscribe({
      next: (detail) => {
        this.dialog.open(MocksNextSequenceDialog, {
          data: { detail } satisfies SequenceDialogData,
          viewContainerRef: this.vcr,
          autoFocus: 'dialog',
        });
      },
    });
  }

  /** Apre il dialog "Copia" sull'endpoint corrente (metodo+path precompilati e modificabili). */
  protected openCopy(): void {
    const d = this.detail();
    if (!d) return;
    this.dialog.open(MocksNextCopyDialog, {
      data: { id: d.id, method: d.method, path: d.path, responseCount: d.responses?.length ?? 0 } satisfies CopyDialogData,
      viewContainerRef: this.vcr,
      autoFocus: 'dialog',
    });
  }

  // --- elimina endpoint (C4) ---
  protected askDeleteEndpoint(): void {
    this.resetEditState();
    this.confirmingDeleteEndpoint.set(true);
  }
  protected cancelDeleteEndpoint(): void {
    this.confirmingDeleteEndpoint.set(false);
  }
  protected confirmDeleteEndpoint(): void {
    if (this.busy()) return;
    this.store.removeEndpoint(() => this.confirmingDeleteEndpoint.set(false));
  }

  // --- helpers privati ---
  private resetEditState(): void {
    this.editingResponse.set(false);
    this.creatingResponse.set(false);
    this.editingDescription.set(false);
    this.confirmingDeleteResponse.set(false);
    this.confirmingDeleteEndpoint.set(false);
    this.draft.clearTransient();
  }

  private currentResponseTitle(): string {
    const d = this.detail();
    const r = d?.responses?.find((x) => x.fileName === d.selectedResponseFile);
    return r?.title ?? '';
  }

  /** Sorgente script che ritorna status/headers/body della response mock selezionata (seed non-lossy). */
  private seedSourceFromMock(type: 'handler' | 'middleware'): string | undefined {
    const d = this.detail();
    const b = this.body();
    if (!d || d.type !== 'mock' || (b.kind !== 'json' && b.kind !== 'text')) {
      return undefined;
    }
    const status = this.selectedStatus() ?? 200;
    const headers = JSON.stringify(d.config?.headers ?? {});
    const jsonBody = b.kind === 'json' ? (b.text.trim() || '{}') : JSON.stringify(b.text);
    const fn = type === 'handler' ? 'resolveResponse' : 'transformResponse';
    return `module.exports = {
  async ${fn}() {
    return {
      status: ${status},
      headers: ${headers},
      jsonBody: ${jsonBody}
    };
  }
};
`;
  }
}

function formatHeaderValue(value: string | number | boolean | string[]): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}
