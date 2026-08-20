import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import {
  CdkDrag,
  CdkDragPreview,
  CdkDropList,
  type CdkDragDrop,
  type CdkDragMove,
} from '@angular/cdk/drag-drop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowDown,
  lucideArrowUp,
  lucideCheck,
  lucideChevronDown,
  lucideChevronRight,
  lucideEllipsisVertical,
  lucideExpand,
  lucideFilter,
  lucideFilterX,
  lucideFileCode,
  lucideFolder,
  lucideFolderPlus,
  lucideGripVertical,
  lucideInfo,
  lucideLayers,
  lucideMessageSquare,
  lucidePlus,
  lucidePower,
  lucidePowerOff,
  lucideRefreshCw,
  lucideSearch,
  lucideShrink,
  lucideTrash2,
  lucideUngroup,
  lucideUpload,
  lucideX,
} from '@ng-icons/lucide';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiBadge, type BadgeTone } from '../../../ui/ui-badge/ui-badge';
import { UiButton } from '../../../ui/ui-button/ui-button';
import { UiInput } from '../../../ui/ui-input/ui-input';
import { UiKbd } from '../../../ui/ui-kbd/ui-kbd';
import { UiMenu, UiMenuItem } from '../../../ui/ui-menu/ui-menu';
import { UiSwitch } from '../../../ui/ui-switch/ui-switch';
import { UiTooltip } from '../../../ui/ui-tooltip/ui-tooltip';
import {
  MocksStore,
  type CatalogCollectionVM,
  type StatusFilter,
  type TypeFilter,
} from '../mocks-next.store';
import { UNSORTED_COLLECTION_ID, type EndpointCreateType, type MockType } from '../../../mock-admin-api.types';
import { ViewStateService } from '../../../shared/view-state.service';
import {
  ROOT_ORDER_KEY,
  buildCatalogRows,
  collectionDescendantIds,
  computeDropDecision,
  rowRef,
  type CatalogRow,
  type RowRect,
} from './catalog-dnd';

const METHOD_TONES: ReadonlySet<string> = new Set(['get', 'post', 'put', 'delete', 'patch']);

/** Oltre questa profondità le linee guida smettono di aggiungersi: l'indentazione basta da sola. */
const MAX_GUIDE_DEPTH = 12;

/** Chiave (ViewStateService) delle collection collassate, ritrovate tornando sulla view. */
const COLLAPSED_COLLECTIONS_STATE_KEY = 'mocks-collapsed';

/**
 * Pannello catalogo: albero appiattito in un'UNICA lista piatta (endpoint e collection intercalati,
 * niente drop-list annidate) con drag-drop unificato — riordino e reparent/assegnazione dedotti dal
 * punto di rilascio. Più ricerca, filtri, espandi/collassa e gestione collection. Unsorted è speciale:
 * non trascinabile, sempre in cima, contenitore dei non categorizzati.
 */
@Component({
  selector: 'mocks-next-catalog',
  imports: [
    NgTemplateOutlet,
    NgIcon,
    CdkMenuTrigger,
    CdkDropList,
    CdkDrag,
    CdkDragPreview,
    UiBadge,
    UiButton,
    UiInput,
    UiKbd,
    UiMenu,
    UiMenuItem,
    UiSwitch,
    UiTooltip,
    TranslocoPipe,
  ],
  providers: [
    provideIcons({
      lucideArrowDown,
      lucideArrowUp,
      lucideCheck,
      lucideChevronDown,
      lucideChevronRight,
      lucideEllipsisVertical,
      lucideExpand,
      lucideFilter,
      lucideFilterX,
      lucideFileCode,
      lucideFolder,
      lucideFolderPlus,
      lucideGripVertical,
      lucideInfo,
      lucideLayers,
      lucideMessageSquare,
      lucidePlus,
      lucidePower,
      lucidePowerOff,
      lucideRefreshCw,
      lucideSearch,
      lucideShrink,
      lucideTrash2,
      lucideUngroup,
      lucideUpload,
      lucideX,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex min-w-0 flex-col border-r border-border bg-card',
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
  styles: [
    // Il segnaposto (clone all'origine, lista statica) è attenuato per indicare la sorgente del drag.
    '.cdk-drag-placeholder { opacity: 0.4; }',
    // Niente animazione di "ritorno" del preview al rilascio: con l'update ottimistico l'item compare
    // subito a destinazione, quindi il ghost non deve volare verso l'origine.
    '::ng-deep .cdk-drag-preview { transition: none !important; }',
    '::ng-deep .cdk-drag-animating { transition: none !important; }',
    // Evidenziazione "drop dentro questa collection" (anello brand + sfondo accent), senza shift di layout.
    '.mx-drop-into { background-color: var(--accent); box-shadow: inset 0 0 0 2px var(--brand); }',
  ],
  template: `
    <!-- header catalogo -->
    <div class="shrink-0 border-b border-border px-3 py-2.5">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <h2 class="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{{ 'catalog.title' | transloco }}</h2>
          <ui-badge tone="neutral">{{ store.totalEndpoints() }}</ui-badge>
        </div>
        <div class="flex items-center gap-1.5">
          <!-- Un solo punto di creazione: qui nasce tutto quello che comparira' nell'albero
               sotto, invece che sparso fra la topbar di pagina e le icone della testata. -->
          <button ui-button size="sm" [cdkMenuTriggerFor]="newMenu">
            <ng-icon name="lucidePlus" size="0.9rem" />
            {{ 'catalog.new' | transloco }}
            <ng-icon name="lucideChevronDown" size="0.75rem" class="opacity-70" />
          </button>
          <!-- Ricarica, espandi e collassa: rare, quindi in secondo piano. -->
          <button ui-button variant="outline" size="icon" class="size-7" [uiTooltip]="'catalog.viewActionsTip' | transloco" [attr.aria-label]="'catalog.viewActionsTip' | transloco" [cdkMenuTriggerFor]="viewMenu">
            <ng-icon name="lucideEllipsisVertical" size="0.95rem" />
          </button>
        </div>
      </div>
      <label class="relative mt-2.5 block">
        <ng-icon name="lucideSearch" size="0.85rem" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <!-- pr-8 anche a campo vuoto: il testo non deve spostarsi quando il pulsante compare. -->
        <input #searchInput ui-input type="text" [placeholder]="'catalog.searchPlaceholder' | transloco" class="w-full pl-8 pr-8 text-[12.5px]" [value]="store.searchTerm()" (input)="store.searchTerm.set($any($event.target).value)" />
        @if (store.searchTerm() !== '') {
        <button
          type="button"
          class="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
          [attr.aria-label]="'common.clearFilter' | transloco"
          (click)="clearSearch(searchInput)"
        >
          <ng-icon name="lucideX" size="0.7rem" />
        </button>
        } @else {
        <!-- La scorciatoia si annuncia dove si usa; sparisce appena il campo ha del testo,
             perche' li' quel posto serve alla "x" che lo svuota. -->
        <ui-kbd class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2">/</ui-kbd>
        }
      </label>
      <!-- Filtri in chiaro: prima erano chiusi in un menu e li segnalava solo un pallino, quindi
           lo stato del catalogo non era leggibile senza aprirlo. -->
      <div class="mt-2 flex items-center gap-2">
        <div role="radiogroup" [attr.aria-label]="'catalog.filterStatusLabel' | transloco" class="flex items-center gap-0.5 rounded-lg border border-input bg-black/30 p-0.5">
          @for (s of statusOptions; track s.value) {
          <button
            type="button"
            role="radio"
            [attr.aria-checked]="store.statusFilter() === s.value"
            class="rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            [class]="store.statusFilter() === s.value ? 'bg-accent text-foreground shadow-[0_0_0_1px_var(--border)]' : 'text-muted-foreground hover:text-foreground'"
            (click)="store.statusFilter.set(s.value)"
          >
            {{ s.labelKey | transloco }}
          </button>
          }
        </div>

        <button ui-button variant="outline" size="sm" class="h-7 px-2.5" [cdkMenuTriggerFor]="typeMenu">
          <ng-icon name="lucideFilter" size="0.8rem" />
          {{ 'catalog.filterTypeLabel' | transloco }}: {{ currentTypeLabel() | transloco }}
          <ng-icon name="lucideChevronDown" size="0.7rem" class="opacity-70" />
        </button>

        @if (store.hasMenuFilter()) {
        <button
          type="button"
          class="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          [uiTooltip]="'catalog.resetFilters' | transloco"
          [attr.aria-label]="'catalog.resetFilters' | transloco"
          (click)="resetFilters()"
        >
          <ng-icon name="lucideFilterX" size="0.85rem" />
        </button>
        }
      </div>

      <!-- Sotto filtro il riordino e' sospeso (cdkDragDisabled): prima spariva in silenzio. -->
      @if (store.hasActiveFilter()) {
      <p class="mt-2 flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
        <ng-icon name="lucideInfo" size="0.75rem" class="shrink-0" />
        {{ 'catalog.reorderSuspended' | transloco }}
      </p>
      }

      @if (creatingCollection() && creatingParentId() === undefined) {
      <div class="mt-2 flex items-center gap-1.5">
        <ng-icon name="lucideFolderPlus" size="0.85rem" class="shrink-0 text-brand" />
        <input
          #createInput
          ui-input
          type="text"
          class="w-full text-[12.5px]"
          [placeholder]="'catalog.collectionNamePlaceholder' | transloco"
          [value]="newCollectionLabel()"
          (input)="newCollectionLabel.set($any($event.target).value)"
          (keydown.enter)="saveCreateCollection()"
          (keydown.escape)="cancelCreateCollection()"
        />
        <button ui-button size="icon" (click)="saveCreateCollection()" [uiTooltip]="'catalog.createTip' | transloco"><ng-icon name="lucideCheck" size="0.85rem" /></button>
        <button ui-button variant="outline" size="icon" (click)="cancelCreateCollection()" [uiTooltip]="'catalog.cancelTip' | transloco"><ng-icon name="lucideX" size="0.85rem" /></button>
      </div>
      }
    </div>

    <!-- albero appiattito: Unsorted fisso in cima + UNA sola lista piatta (endpoint e collection intercalati) -->
    <div class="min-h-0 flex-1 overflow-y-auto mx-scroll px-2 py-2">
      @if (store.catalogIsEmpty()) {
        @if (store.hasActiveFilter()) {
        <p class="px-3 py-6 text-center text-[12.5px] text-muted-foreground">{{ 'catalog.noFilterMatch' | transloco }}</p>
        } @else {
        <div class="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <ng-icon name="lucideFolder" size="1.6rem" class="text-brand/70" />
          <p class="text-sm font-semibold text-foreground">{{ 'catalog.emptyWorkspaceTitle' | transloco }}</p>
          <p class="text-[12.5px] text-muted-foreground">{{ 'catalog.emptyWorkspaceHint' | transloco }}</p>
        </div>
        }
      } @else {
      <!-- Unsorted: intestazione fissa, non trascinabile (i suoi endpoint sono le prime righe della lista) -->
      @if (store.unsortedNode(); as u) {
      <ng-container *ngTemplateOutlet="folderHeaderTpl; context: { $implicit: u.collection, depth: 0 }" />
      }
      <!-- lista unica: ordine e genitore dei figli dedotti dal rilascio (vedi onDrop) -->
      <div #listEl cdkDropList cdkDropListSortingDisabled (cdkDropListDropped)="onDrop($event)" class="flex flex-col">
        @for (row of flatRows(); track rowKey(row)) {
        @if (row.kind === 'collection') {
        <div
          cdkDrag
          [cdkDragData]="{ kind: 'col', id: row.node.collection.id }"
          [cdkDragDisabled]="store.hasActiveFilter()"
          (cdkDragStarted)="onDragStarted()"
          (cdkDragMoved)="onDragMoved($event)"
          (cdkDragEnded)="onDragEnded()"
        >
          <ng-container *ngTemplateOutlet="folderHeaderTpl; context: { $implicit: row.node.collection, depth: row.depth }" />
          <!-- anteprima compatta del drag: solo "cartella · nome · conteggio", non l'intero sottoalbero -->
          <div *cdkDragPreview class="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[13px] font-semibold text-foreground shadow-lg">
            <ng-icon name="lucideFolder" size="0.95rem" class="text-brand" />
            <span class="max-w-[220px] truncate">{{ row.node.collection.name }}</span>
            <ui-badge tone="neutral">{{ row.node.collection.count }}</ui-badge>
          </div>
        </div>
        @if (creatingCollection() && creatingParentId() === row.node.collection.id) {
        <div class="flex items-center gap-1.5 py-1 pr-1" [style.padding-left.px]="8 + (row.depth + 1) * 14">
          <ng-icon name="lucideFolderPlus" size="0.85rem" class="shrink-0 text-brand" />
          <input
            #createInput
            ui-input
            type="text"
            class="w-full text-[12.5px]"
            [placeholder]="'catalog.subCollectionNamePlaceholder' | transloco"
            [value]="newCollectionLabel()"
            (input)="newCollectionLabel.set($any($event.target).value)"
            (keydown.enter)="saveCreateCollection()"
            (keydown.escape)="cancelCreateCollection()"
          />
          <button ui-button size="icon" (click)="saveCreateCollection()" [uiTooltip]="'catalog.createTip' | transloco"><ng-icon name="lucideCheck" size="0.85rem" /></button>
          <button ui-button variant="outline" size="icon" (click)="cancelCreateCollection()" [uiTooltip]="'catalog.cancelTip' | transloco"><ng-icon name="lucideX" size="0.85rem" /></button>
        </div>
        }
        } @else {
        <div
          cdkDrag
          [cdkDragData]="{ kind: 'ep', id: row.endpoint.id }"
          [cdkDragDisabled]="store.hasActiveFilter()"
          (cdkDragStarted)="onDragStarted()"
          (cdkDragMoved)="onDragMoved($event)"
          (cdkDragEnded)="onDragEnded()"
        >
          <ng-container *ngTemplateOutlet="endpointRowTpl; context: { $implicit: row.endpoint, depth: row.depth }" />
        </div>
        }
        }
      </div>
      }
    </div>

    <!-- linea di inserimento: proiettata nella posizione "to-be"; la lista resta statica (sorting CDK disabilitato) -->
    @if (dropLine(); as line) {
    <div class="pointer-events-none fixed z-50 h-0.5 rounded-full bg-brand" [style.top.px]="line.top" [style.left.px]="line.left" [style.width.px]="line.width"></div>
    }

    <!-- INTESTAZIONE COLLECTION (riga cartella) -->
    <ng-template #folderHeaderTpl let-col let-depth="depth">
      <div
        class="group/folder relative flex w-full cursor-pointer items-center gap-1.5 rounded-lg py-1.5 pr-1 text-left transition hover:bg-accent"
        [class.mx-drop-into]="dropIntoId() === col.id"
        [style.padding-left.px]="8 + depth * 14"
        (click)="toggleCollapse(col.id)"
      >
        @for (guide of guides(depth); track guide) {
        <span class="mx-tree-line" [style.left.px]="guide"></span>
        }
        @if (!isUnsorted(col)) {
        <span class="shrink-0 cursor-grab text-muted-foreground/40 opacity-0 transition group-hover/folder:opacity-100">
          <ng-icon name="lucideGripVertical" size="0.85rem" />
        </span>
        } @else {
        <span class="w-[0.85rem] shrink-0"></span>
        }
        <ng-icon name="lucideChevronRight" size="0.85rem" class="shrink-0 text-muted-foreground transition-transform" [class.rotate-90]="!collapsed().has(col.id)" />
        <ng-icon name="lucideFolder" size="0.95rem" class="shrink-0 text-brand" />
        <span class="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight" [class]="depth >= 1 ? 'text-foreground/90' : 'text-foreground'">{{ col.name }}</span>
        @if (confirmingDissolveCollectionId() === col.id) {
        <span class="flex shrink-0 items-center gap-1" (click)="$event.stopPropagation()">
          <button ui-button variant="outline" size="sm" (click)="confirmDissolveCollection(col.id)" [uiTooltip]="'catalog.dissolveCollectionTip' | transloco" [showDelay]="250">{{ 'catalog.confirmDissolve' | transloco: { count: store.collectionEndpointCount(col.id) } }}</button>
          <button ui-button variant="outline" size="sm" (click)="cancelCollectionAction()">{{ 'catalog.cancel' | transloco }}</button>
        </span>
        } @else if (confirmingEraseCollectionId() === col.id) {
        <span class="flex shrink-0 items-center gap-1" (click)="$event.stopPropagation()">
          <button ui-button variant="destructive" size="sm" [disabled]="store.erasingCollectionId() != null" (click)="confirmEraseCollection(col.id)" [uiTooltip]="isUnsorted(col) ? ('catalog.eraseUnsortedTip' | transloco) : ('catalog.eraseCollectionTip' | transloco)" [showDelay]="250">{{ 'catalog.confirmErase' | transloco: { count: store.collectionEndpointCount(col.id) } }}</button>
          <button ui-button variant="outline" size="sm" [disabled]="store.erasingCollectionId() != null" (click)="cancelCollectionAction()">{{ 'catalog.cancel' | transloco }}</button>
        </span>
        } @else {
        <button ui-button variant="ghost" size="icon" class="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover/folder:opacity-100" (click)="$event.stopPropagation()" [cdkMenuTriggerFor]="isUnsorted(col) ? unsortedMenu : folderMenu" [cdkMenuTriggerData]="{ col: col }" [uiTooltip]="'catalog.collectionActionsTip' | transloco">
          <ng-icon name="lucideEllipsisVertical" size="0.9rem" />
        </button>
        }
        <ui-badge tone="neutral" class="shrink-0">{{ col.count }}</ui-badge>
      </div>
    </ng-template>

    <!-- RIGA ENDPOINT -->
    <ng-template #endpointRowTpl let-ep let-depth="depth">
      <div
        (click)="store.selectMock(ep.id)"
        class="group relative flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 transition"
        [style.padding-left.px]="8 + depth * 14"
        [class]="ep.id === store.selectedId() ? 'mx-selected' : 'hover:bg-accent'"
        [class.mx-muted]="!ep.enabled"
      >
        @for (guide of guides(depth); track guide) {
        <span class="mx-tree-line" [style.left.px]="guide"></span>
        }
        <ui-badge [tone]="methodTone(ep.method)" class="w-[42px] shrink-0">{{ ep.method }}</ui-badge>
        <div class="min-w-0 flex-1">
          <span class="block truncate font-mono text-[12px] leading-tight" [class]="ep.id === store.selectedId() ? 'text-foreground' : 'text-foreground/80'" [title]="ep.path">{{ ep.path }}</span>
          <div class="mt-0.5 flex items-center gap-2 text-[10px]">
            <span class="flex items-center gap-1" [class]="typeTextClass(ep.type)">
              <span class="h-1.5 w-1.5 rounded-full" [class]="typeDotClass(ep.type)"></span>
              {{ ep.type }}
            </span>
            @if (ep.status !== null) {
            <span class="font-mono font-semibold tabular-nums" [class]="statusTextClass(ep.status)">{{ ep.status }}</span>
            }
            <span class="flex items-center gap-0.5 text-muted-foreground">
              <ng-icon name="lucideMessageSquare" size="0.7rem" />
              {{ ep.responses }}
            </span>
            @if (ep.sequenceActive) {
            <span class="rounded bg-[color-mix(in_srgb,var(--sequence)_16%,transparent)] px-1 font-bold tracking-wide text-sequence" [uiTooltip]="'catalog.sequenceBadgeTip' | transloco">SEQ</span>
            }
          </div>
        </div>
        <button
          ui-button
          variant="ghost"
          size="icon"
          class="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover:opacity-100"
          (click)="$event.stopPropagation()"
          [cdkMenuTriggerFor]="moveMenu"
          [cdkMenuTriggerData]="{ ep: ep }"
          [uiTooltip]="'catalog.moveToCollectionTip' | transloco"
        >
          <ng-icon name="lucideEllipsisVertical" size="0.9rem" />
        </button>
        <span (click)="$event.stopPropagation()">
          <ui-switch
            [checked]="ep.enabled"
            [disabled]="store.savingId() === ep.id"
            size="sm"
            (checkedChange)="store.toggleEnabled(ep.id, $event)"
            [ariaLabel]="'catalog.enableEndpointAria' | transloco"
          />
        </span>
      </div>
    </ng-template>

    <!-- menu "Nuovo": tutto cio' che puo' comparire nell'albero, in un posto solo -->
    <ng-template #newMenu>
      <div ui-menu class="min-w-[15rem]">
        <button ui-menu-item (click)="create.emit('mock')">
          <ng-icon name="lucideLayers" size="0.9rem" class="text-type-mock" />
          <span class="flex-1">Mock</span>
        </button>
        <button ui-menu-item (click)="create.emit('handler')">
          <ng-icon name="lucideFileCode" size="0.9rem" class="text-type-handler" />
          <span class="flex-1">Handler</span>
        </button>
        <button ui-menu-item (click)="create.emit('middleware')">
          <ng-icon name="lucideCog" size="0.9rem" class="text-type-middleware" />
          <span class="flex-1">Middleware</span>
        </button>
        <div class="my-1 h-px bg-border"></div>
        <button ui-menu-item (click)="startCreateCollection()">
          <ng-icon name="lucideFolderPlus" size="0.9rem" class="text-brand" />
          <span class="flex-1">{{ 'catalog.newCollectionTip' | transloco }}</span>
        </button>
        <div class="my-1 h-px bg-border"></div>
        <button ui-menu-item (click)="importOpenapi.emit()">
          <ng-icon name="lucideUpload" size="0.9rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'catalog.importOpenapi' | transloco }}</span>
        </button>
      </div>
    </ng-template>

    <!-- menu delle azioni di vista: rare, quindi qui invece che in barra -->
    <ng-template #viewMenu>
      <div ui-menu class="min-w-[14rem]">
        <button ui-menu-item (click)="store.reload()">
          <ng-icon name="lucideRefreshCw" size="0.9rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'catalog.reloadTip' | transloco }}</span>
        </button>
        <div class="my-1 h-px bg-border"></div>
        <button ui-menu-item (click)="expandAll()">
          <ng-icon name="lucideExpand" size="0.9rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'catalog.expandAllTip' | transloco }}</span>
        </button>
        <button ui-menu-item (click)="collapseAll()">
          <ng-icon name="lucideShrink" size="0.9rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'catalog.collapseAllTip' | transloco }}</span>
        </button>
      </div>
    </ng-template>

    <!-- menu del tipo: lo stato e il reset stanno in riga, qui resta la sola scelta del tipo -->
    <ng-template #typeMenu>
      <div ui-menu>
        @for (t of typeOptions; track t.value) {
        <button ui-menu-item (click)="store.typeFilter.set(t.value)">
          <span class="flex-1">{{ t.labelKey | transloco }}</span>
          @if (store.typeFilter() === t.value) {
          <ng-icon name="lucideCheck" size="0.85rem" class="text-brand" />
          }
        </button>
        }
      </div>
    </ng-template>

    <!-- menu azioni collection -->
    <ng-template #folderMenu let-col="col">
      <div ui-menu>
        <button ui-menu-item (click)="startCreateSubCollection(col.id)">
          <ng-icon name="lucideFolderPlus" size="0.85rem" class="text-brand" />
          <span class="flex-1">{{ 'catalog.newSubCollection' | transloco }}</span>
        </button>
        <div class="my-1 h-px bg-border"></div>
        <button ui-menu-item (click)="store.setCollectionEnabled(col.id, true)">
          <ng-icon name="lucidePower" size="0.85rem" class="text-positive" />
          <span class="flex-1">{{ 'catalog.enableAll' | transloco }}</span>
        </button>
        <button ui-menu-item (click)="store.setCollectionEnabled(col.id, false)">
          <ng-icon name="lucidePowerOff" size="0.85rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'catalog.disableAll' | transloco }}</span>
        </button>
        <div class="my-1 h-px bg-border"></div>
        <button ui-menu-item (click)="moveCollectionUp(col)">
          <ng-icon name="lucideArrowUp" size="0.85rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'catalog.moveUp' | transloco }}</span>
        </button>
        <button ui-menu-item (click)="moveCollectionDown(col)">
          <ng-icon name="lucideArrowDown" size="0.85rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'catalog.moveDown' | transloco }}</span>
        </button>
        <div class="my-1 h-px bg-border"></div>
        <div class="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{{ 'catalog.moveUnder' | transloco }}</div>
        @for (t of reparentTargets(col); track t.id ?? '__root__') {
        <button ui-menu-item (click)="store.reparentCollection(col.id, t.id)">
          <span class="flex-1 truncate">{{ t.label }}</span>
          @if ((col.parentId ?? undefined) === t.id) {
          <ng-icon name="lucideCheck" size="0.85rem" class="text-brand" />
          }
        </button>
        }
        <div class="my-1 h-px bg-border"></div>
        <button ui-menu-item (click)="askDissolveCollection(col.id)" [uiTooltip]="'catalog.dissolveCollectionTip' | transloco" position="left" [showDelay]="250">
          <ng-icon name="lucideUngroup" size="0.85rem" class="text-muted-foreground" />
          <span class="flex-1">{{ 'catalog.dissolveCollection' | transloco }}</span>
          <ng-icon name="lucideInfo" size="0.8rem" class="text-muted-foreground" />
        </button>
        <button ui-menu-item (click)="askEraseCollection(col.id)" [uiTooltip]="'catalog.eraseCollectionTip' | transloco" position="left" [showDelay]="250">
          <ng-icon name="lucideTrash2" size="0.85rem" class="text-destructive-soft" />
          <span class="flex-1 text-destructive-soft">{{ 'catalog.eraseCollection' | transloco }}</span>
          <ng-icon name="lucideInfo" size="0.8rem" class="text-destructive-soft/80" />
        </button>
      </div>
    </ng-template>

    <!-- menu azioni della collection virtuale Unsorted -->
    <ng-template #unsortedMenu let-col="col">
      <div ui-menu>
        <button ui-menu-item (click)="askEraseCollection(col.id)" [uiTooltip]="'catalog.eraseUnsortedTip' | transloco" position="left" [showDelay]="250">
          <ng-icon name="lucideTrash2" size="0.85rem" class="text-destructive-soft" />
          <span class="flex-1 text-destructive-soft">{{ 'catalog.eraseUnsorted' | transloco }}</span>
          <ng-icon name="lucideInfo" size="0.8rem" class="text-destructive-soft/80" />
        </button>
      </div>
    </ng-template>

    <!-- menu "sposta in collection" per endpoint -->
    <ng-template #moveMenu let-ep="ep">
      <div ui-menu>
        <div class="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{{ 'catalog.moveToLabel' | transloco }}</div>
        <button ui-menu-item (click)="store.assignCollection(ep.id, undefined)">
          <span class="flex-1">Unsorted</span>
          @if (!ep.collectionId) {
          <ng-icon name="lucideCheck" size="0.85rem" class="text-brand" />
          }
        </button>
        @for (c of store.collections(); track c.id) {
        <button ui-menu-item (click)="store.assignCollection(ep.id, c.id)">
          <span class="flex-1 truncate">{{ c.label }}</span>
          @if (ep.collectionId === c.id) {
          <ng-icon name="lucideCheck" size="0.85rem" class="text-brand" />
          }
        </button>
        }
      </div>
    </ng-template>
  `,
})
export class MocksNextCatalog {
  /**
   * Creazione di un endpoint e import OpenAPI restano alla pagina, che possiede i dialog e il
   * ViewContainerRef da cui vedono lo store page-scoped: il catalogo si limita a chiederli.
   */
  readonly create = output<EndpointCreateType>();
  readonly importOpenapi = output<void>();

  protected readonly store = inject(MocksStore);
  private readonly transloco = inject(TranslocoService);
  private readonly viewState = inject(ViewStateService);

  /**
   * "/" porta al filtro del catalogo, come in git, less e nella maggior parte dei tool a lista.
   * Non intercetta nulla mentre si sta scrivendo altrove (campi, editor di codice, aree
   * modificabili) ne' quando accompagna un modificatore, che sarebbe una scorciatoia diversa.
   */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) {
      return;
    }
    const input = this.searchInput()?.nativeElement;
    if (!input) {
      return;
    }
    event.preventDefault();
    input.focus();
    input.select();
  }

  /**
   * Svuota il filtro e rimette il fuoco nel campo: chi lo azzera di solito sta per riscriverci,
   * e perdere il fuoco costringerebbe a un click in piu'.
   */
  protected clearSearch(input: HTMLInputElement): void {
    this.store.searchTerm.set('');
    input.focus();
  }

  protected readonly creatingCollection = signal(false);
  /** Genitore sotto cui creare la collection (undefined = livello root). */
  protected readonly creatingParentId = signal<string | undefined>(undefined);
  protected readonly newCollectionLabel = signal('');
  protected readonly confirmingDissolveCollectionId = signal<string | null>(null);
  protected readonly confirmingEraseCollectionId = signal<string | null>(null);
  /** Linea di inserimento (coordinate viewport) durante il drag, o null quando non si trascina. */
  protected readonly dropLine = signal<{ top: number; left: number; width: number } | null>(null);
  /** Id della sotto-collection evidenziata come "drop dentro" (puntatore sulla sua intestazione), o null. */
  protected readonly dropIntoId = signal<string | null>(null);
  /** Contenitore della drop-list, per leggere le posizioni delle righe durante il drag. */
  private readonly listEl = viewChild<ElementRef<HTMLElement>>('listEl');
  /** Campo del filtro: bersaglio della scorciatoia "/". */
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  /** Input di creazione collection (root o sotto-collection): gli si dà il fuoco appena compare. */
  private readonly createInput = viewChild<ElementRef<HTMLInputElement>>('createInput');

  constructor() {
    effect(() => this.createInput()?.nativeElement.focus());
  }

  protected readonly typeOptions: ReadonlyArray<{ value: TypeFilter; labelKey: string }> = [
    { value: 'all', labelKey: 'catalog.filterAll' },
    { value: 'mock', labelKey: 'catalog.filterMock' },
    { value: 'handler', labelKey: 'catalog.filterHandler' },
    { value: 'middleware', labelKey: 'catalog.filterMiddleware' },
    { value: 'sse', labelKey: 'catalog.filterSse' },
    { value: 'ws', labelKey: 'catalog.filterWs' },
    { value: 'sequence', labelKey: 'catalog.filterSequence' },
  ];
  protected readonly statusOptions: ReadonlyArray<{ value: StatusFilter; labelKey: string }> = [
    { value: 'all', labelKey: 'catalog.filterAll' },
    { value: 'on', labelKey: 'catalog.filterActive' },
    { value: 'off', labelKey: 'catalog.filterInactive' },
  ];

  // --- espandi/collassa cartelle ---
  // Persistite (ViewStateService): tornando sulla view le cartelle sono come lasciate. Id di
  // collection nel frattempo eliminate restano nel set senza effetti (nessuna riga li usa).
  protected readonly collapsed = signal<ReadonlySet<string>>(
    new Set(this.viewState.read<string[]>(COLLAPSED_COLLECTIONS_STATE_KEY) ?? []),
  );

  private setCollapsed(next: ReadonlySet<string>): void {
    this.collapsed.set(next);
    this.viewState.write(COLLAPSED_COLLECTIONS_STATE_KEY, [...next]);
  }

  /**
   * Lista piatta delle righe trascinabili, nell'ordine esatto dei cdkDrag della drop-list
   * (geometria e appiattimento vivono in catalog-dnd, puri e testati a parte).
   */
  protected readonly flatRows = computed<readonly CatalogRow[]>(() =>
    buildCatalogRows(this.store.unsortedNode(), this.store.catalogTree(), this.collapsed()),
  );

  protected rowKey(row: CatalogRow): string {
    return row.kind === 'collection' ? `c:${row.node.collection.id}` : `e:${row.endpoint.id}`;
  }

  protected isUnsorted(col: CatalogCollectionVM): boolean {
    return col.id === UNSORTED_COLLECTION_ID;
  }

  protected toggleCollapse(id: string): void {
    const next = new Set(this.collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.setCollapsed(next);
  }
  protected expandAll(): void {
    this.setCollapsed(new Set());
  }
  protected collapseAll(): void {
    this.setCollapsed(new Set(this.store.collapsibleIds()));
  }

  // --- creazione collection ---
  protected startCreateCollection(): void {
    this.creatingParentId.set(undefined);
    this.newCollectionLabel.set('');
    this.creatingCollection.set(true);
  }
  /** Apre l'input di creazione come sotto-collection di `parentId`, espandendo il genitore. */
  protected startCreateSubCollection(parentId: string): void {
    const next = new Set(this.collapsed());
    next.delete(parentId);
    this.setCollapsed(next);
    this.creatingParentId.set(parentId);
    this.newCollectionLabel.set('');
    this.creatingCollection.set(true);
  }
  protected cancelCreateCollection(): void {
    this.creatingCollection.set(false);
  }
  protected saveCreateCollection(): void {
    this.store.createCollection(this.newCollectionLabel(), this.creatingParentId(), () => {
      this.creatingCollection.set(false);
      this.newCollectionLabel.set('');
    });
  }

  // --- eliminazione collection ---
  protected askDissolveCollection(id: string): void {
    this.confirmingEraseCollectionId.set(null);
    this.confirmingDissolveCollectionId.set(id);
  }
  protected askEraseCollection(id: string): void {
    this.confirmingDissolveCollectionId.set(null);
    this.confirmingEraseCollectionId.set(id);
  }
  protected cancelCollectionAction(): void {
    this.confirmingDissolveCollectionId.set(null);
    this.confirmingEraseCollectionId.set(null);
  }
  protected confirmDissolveCollection(id: string): void {
    this.store.deleteCollection(id, () => this.cancelCollectionAction());
  }
  protected confirmEraseCollection(id: string): void {
    this.store.eraseCollection(id, () => this.cancelCollectionAction());
  }

  // --- riordino/reparent collection via MENU (accessibile, un passo per volta) ---
  protected moveCollectionUp(c: CatalogCollectionVM): void {
    this.moveCollection(c, -1);
  }
  protected moveCollectionDown(c: CatalogCollectionVM): void {
    this.moveCollection(c, 1);
  }
  private moveCollection(c: CatalogCollectionVM, dir: -1 | 1): void {
    const parent = c.parentId ?? undefined;
    const sibIds = this.siblingIds(parent);
    const sIdx = sibIds.indexOf(c.id);
    if (sIdx + dir < 0 || sIdx + dir >= sibIds.length) return;
    [sibIds[sIdx], sibIds[sIdx + dir]] = [sibIds[sIdx + dir], sibIds[sIdx]];
    this.store.reorderCollections(parent, sibIds);
  }

  protected reparentTargets(c: CatalogCollectionVM): ReadonlyArray<{ id: string | undefined; label: string }> {
    const all = this.store.collections();
    const banned = new Set<string>([c.id, ...collectionDescendantIds(c.id, all)]);
    const targets: { id: string | undefined; label: string }[] = [{ id: undefined, label: this.transloco.translate('catalog.rootLevel') }];
    for (const col of all) {
      if (!banned.has(col.id)) targets.push({ id: col.id, label: col.label });
    }
    return targets;
  }

  // --- DRAG-DROP unificato (lista statica; "drop dentro" una collection vs linea di inserimento) ---
  // La geometria della decisione è in catalog-dnd (pura); qui restano solo la lettura del DOM
  // (rettangoli delle righe) e l'applicazione dello spostamento sullo store.

  /** Rettangoli dei cdkDrag della lista, allineati a flatRows (children[i] ↔ flatRows[i], sorting CDK disabilitato). */
  private dropGeometry(): { rowRects: RowRect[]; listLeft: number; listWidth: number } | null {
    const listEl = this.listEl()?.nativeElement;
    if (!listEl) return null;
    const children = (Array.from(listEl.children) as HTMLElement[]).filter((el) => el.classList.contains('cdk-drag'));
    const listRect = listEl.getBoundingClientRect();
    return {
      rowRects: children.map((el) => el.getBoundingClientRect()),
      listLeft: listRect.left,
      listWidth: listRect.width,
    };
  }

  /** Decisione di drop alla Y data (delegata alla geometria pura di catalog-dnd). */
  private dropDecisionAt(pointerY: number, draggedId: string): ReturnType<typeof computeDropDecision> {
    const geometry = this.dropGeometry();
    if (!geometry) return { kind: 'none' };
    return computeDropDecision({
      rows: this.flatRows(),
      draggedId,
      pointerY,
      childOrder: this.store.childOrder(),
      ...geometry,
    });
  }

  /** Esegue lo spostamento del nodo trascinato verso (targetParentKey, insertAt): riordino, assegnazione o reparent. */
  private applyMove(dragged: CatalogRow, targetParentKey: string, insertAt: number): void {
    const draggedRef = rowRef(dragged);
    const targetChildRefs = (this.store.childOrder()[targetParentKey] ?? []).filter((ref) => ref !== draggedRef);
    if (targetParentKey === dragged.parentKey) {
      const newRefs = [...targetChildRefs];
      newRefs.splice(insertAt, 0, draggedRef);
      this.store.reorderChildren(targetParentKey, newRefs);
      return;
    }
    if (dragged.kind === 'endpoint') {
      const targetCollectionId = targetParentKey === UNSORTED_COLLECTION_ID ? undefined : targetParentKey;
      this.store.assignCollection(draggedRef, targetCollectionId, insertAt);
    } else {
      const targetParentId = targetParentKey === ROOT_ORDER_KEY ? undefined : targetParentKey;
      this.store.reparentCollection(draggedRef, targetParentId, insertAt);
    }
  }

  protected onDragStarted(): void {
    this.creatingCollection.set(false);
    this.dropLine.set(null);
    this.dropIntoId.set(null);
  }

  protected onDragMoved(event: CdkDragMove): void {
    if (this.store.hasActiveFilter()) return;
    const draggedId = (event.source.data as { kind: 'ep' | 'col'; id: string }).id;
    const decision = this.dropDecisionAt(event.pointerPosition.y, draggedId);
    if (decision.kind === 'into') {
      this.dropIntoId.set(decision.collectionId);
      this.dropLine.set(null);
    } else if (decision.kind === 'line') {
      this.dropIntoId.set(null);
      this.dropLine.set({ top: decision.top, left: decision.left, width: decision.width });
    } else {
      this.dropIntoId.set(null);
      this.dropLine.set(null);
    }
  }

  protected onDragEnded(): void {
    this.dropLine.set(null);
    this.dropIntoId.set(null);
  }

  /**
   * Drop: ricalcola la decisione dal punto di rilascio (`event.dropPoint`) — niente stato condiviso,
   * quindi nessuna race con cdkDragEnded. `into` → dentro la collection (primo figlio); `line` →
   * posizione indicata; `none` → no-op. Disabilitato sotto filtro.
   */
  protected onDrop(event: CdkDragDrop<unknown>): void {
    this.dropLine.set(null);
    this.dropIntoId.set(null);
    if (this.store.hasActiveFilter()) return;

    const draggedData = event.item.data as { kind: 'ep' | 'col'; id: string };
    const dragged = this.flatRows().find((row) => rowRef(row) === draggedData.id) ?? null;
    if (!dragged) return;

    const decision = this.dropDecisionAt(event.dropPoint.y, draggedData.id);
    if (decision.kind === 'into') {
      this.applyMove(dragged, decision.collectionId, 0);
    } else if (decision.kind === 'line') {
      this.applyMove(dragged, decision.targetParentKey, decision.insertAt);
    }
  }

  // --- helpers ---
  /** Id dei fratelli (collection reali) sotto un dato parent, in ordine di rendering. */
  private siblingIds(parentId: string | undefined): string[] {
    const refs = this.store.childOrder()[parentId ?? ROOT_ORDER_KEY] ?? [];
    const collectionIds = new Set(this.store.collections().map((c) => c.id));
    return refs.filter((ref) => collectionIds.has(ref));
  }
  /** Etichetta del tipo filtrato, per mostrarla sul pulsante invece di un pallino. */
  protected readonly currentTypeLabel = computed(
    () => this.typeOptions.find((option) => option.value === this.store.typeFilter())?.labelKey ?? 'catalog.filterAll',
  );

  /**
   * Ascisse dei tratti verticali per una riga a quella profondità: uno per ogni livello di
   * antenato, allineati al centro dello scalino di indentazione (8 + i*14 + 7). Tabella
   * precalcolata: la si legge a ogni riga a ogni ciclo di rendering.
   */
  private static readonly GUIDE_OFFSETS: readonly (readonly number[])[] = Array.from(
    { length: MAX_GUIDE_DEPTH + 1 },
    (_unused, depth) => Array.from({ length: depth }, (_u, level) => 8 + level * 14 + 7),
  );

  protected guides(depth: number): readonly number[] {
    return MocksNextCatalog.GUIDE_OFFSETS[Math.min(depth, MAX_GUIDE_DEPTH)];
  }

  protected resetFilters(): void {
    this.store.typeFilter.set('all');
    this.store.statusFilter.set('all');
  }

  protected methodTone(method: string): BadgeTone {
    const m = method.toLowerCase();
    return (METHOD_TONES.has(m) ? m : 'neutral') as BadgeTone;
  }

  protected statusTextClass(status: number | null): string {
    if (status == null) return 'text-muted-foreground';
    if (status >= 500) return 'text-status-5xx/80';
    if (status >= 400) return 'text-status-4xx/80';
    if (status >= 300) return 'text-status-3xx/80';
    if (status >= 200) return 'text-status-2xx/80';
    return 'text-muted-foreground';
  }

  protected typeDotClass(type: MockType): string {
    return type === 'handler' ? 'bg-type-handler/55' : type === 'middleware' ? 'bg-type-middleware/55' : type === 'sequence' ? 'bg-sequence/55' : type === 'sse' || type === 'ws' ? 'bg-brand/55' : 'bg-type-mock/55';
  }

  protected typeTextClass(type: MockType): string {
    return type === 'handler' ? 'text-type-handler/75' : type === 'middleware' ? 'text-type-middleware/75' : type === 'sequence' ? 'text-sequence/75' : type === 'sse' || type === 'ws' ? 'text-brand/75' : 'text-type-mock/75';
  }
}
