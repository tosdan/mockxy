import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogRef } from '@angular/cdk/dialog';
import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideChevronDown,
  lucideCircleCheck,
  lucideCircleX,
  lucideCopy,
  lucideInfo,
  lucidePalette,
  lucidePencil,
  lucidePlus,
  lucideSearch,
  lucideSwatchBook,
  lucideTag,
  lucideToggleRight,
  lucideTrash2,
  lucideTriangleAlert,
  lucideType,
} from '@ng-icons/lucide';
import { UiTooltip } from '../../ui/ui-tooltip/ui-tooltip';
import { UiAlert } from '../../ui/ui-alert/ui-alert';
import { UiBadge } from '../../ui/ui-badge/ui-badge';
import { UiButton } from '../../ui/ui-button/ui-button';
import { UiCard } from '../../ui/ui-card/ui-card';
import { UiCheckbox } from '../../ui/ui-checkbox/ui-checkbox';
import { UiChip } from '../../ui/ui-chip/ui-chip';
import { UiCode } from '../../ui/ui-code/ui-code';
import { UiCodeEditor } from '../../ui/ui-code-editor/ui-code-editor';
import { UiCollapsible } from '../../ui/ui-collapsible/ui-collapsible';
import { UiInput } from '../../ui/ui-input/ui-input';
import { UiTable } from '../../ui/ui-table/ui-table';
import { UiToggleGroup, UiToggleItem } from '../../ui/ui-toggle-group/ui-toggle-group';
import { UiKbd } from '../../ui/ui-kbd/ui-kbd';
import { UiLabel } from '../../ui/ui-label/ui-label';
import { UiSelect, type UiSelectOption } from '../../ui/ui-select/ui-select';
import { UiSeparator } from '../../ui/ui-separator/ui-separator';
import { UiSkeleton } from '../../ui/ui-skeleton/ui-skeleton';
import { UiSwitch } from '../../ui/ui-switch/ui-switch';
import { UiTabs, UiTabsContent, UiTabsList, UiTabsTrigger } from '../../ui/ui-tabs/ui-tabs';
import { UiDialog } from '../../ui/ui-dialog/ui-dialog';
import { UiMenu, UiMenuItem } from '../../ui/ui-menu/ui-menu';
import { UiRadio, UiRadioGroup } from '../../ui/ui-radio/ui-radio';
import { ToastService } from '../../ui/ui-toast/ui-toast';
import { UiTree, type UiTreeNode } from '../../ui/ui-tree/ui-tree';

interface Swatch {
  /** Nome del custom property, es. "--card". */
  readonly name: string;
  /** Utility Tailwind associata, o "—" se si usa solo via var(). */
  readonly util: string;
}

interface ColorGroup {
  readonly id: string;
  readonly title: string;
  readonly desc: string;
  readonly swatches: readonly Swatch[];
}

interface NavItem {
  readonly id: string;
  readonly label: string;
}

/**
 * Design System — punto di riferimento navigabile e documentato dei token e dei
 * componenti UI del restyle (tema "aurora-2"). I valori dei colori sono letti a
 * runtime dal CSS, cosi' la pagina non va mai fuori sync con i token reali.
 */
@Component({
  selector: 'app-design-system',
  imports: [
    RouterLink,
    NgIcon,
    UiTooltip,
    UiAlert,
    UiBadge,
    UiButton,
    UiCard,
    UiCheckbox,
    UiChip,
    UiCode,
    UiCodeEditor,
    UiCollapsible,
    UiInput,
    UiKbd,
    UiLabel,
    UiSelect,
    UiSeparator,
    UiSkeleton,
    UiSwitch,
    UiTable,
    UiToggleGroup,
    UiToggleItem,
    UiTabs,
    UiTabsList,
    UiTabsTrigger,
    UiTabsContent,
    CdkMenuTrigger,
    UiMenu,
    UiMenuItem,
    UiRadioGroup,
    UiRadio,
    UiTree,
  ],
  providers: [
    provideIcons({
      lucideArrowLeft,
      lucideChevronDown,
      lucideCircleCheck,
      lucideCircleX,
      lucideCopy,
      lucideInfo,
      lucidePalette,
      lucidePencil,
      lucidePlus,
      lucideSearch,
      lucideSwatchBook,
      lucideTag,
      lucideToggleRight,
      lucideTrash2,
      lucideTriangleAlert,
      lucideType,
    }),
  ],
  templateUrl: './design-system.page.html',
  styleUrl: './design-system.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesignSystemPage {
  readonly nav: readonly NavItem[] = [
    { id: 'intro', label: 'Introduzione' },
    { id: 'colori', label: 'Colori & token' },
    { id: 'tipografia', label: 'Tipografia' },
    { id: 'radius', label: 'Raggi & superfici' },
    { id: 'button', label: 'Button' },
    { id: 'switch', label: 'Switch' },
    { id: 'badge', label: 'Badge' },
    { id: 'input', label: 'Input' },
    { id: 'select', label: 'Select' },
    { id: 'tooltip', label: 'Tooltip' },
    { id: 'tabs', label: 'Tabs' },
    { id: 'checkbox', label: 'Checkbox' },
    { id: 'separator', label: 'Separator' },
    { id: 'code', label: 'Code block' },
    { id: 'code-editor', label: 'Code editor' },
    { id: 'card', label: 'Card' },
    { id: 'alert', label: 'Alert' },
    { id: 'label', label: 'Label' },
    { id: 'kbd', label: 'Kbd' },
    { id: 'skeleton', label: 'Skeleton' },
    { id: 'dialog', label: 'Dialog' },
    { id: 'dropdown', label: 'Dropdown menu' },
    { id: 'toast', label: 'Toast' },
    { id: 'radio', label: 'Radio' },
    { id: 'tree', label: 'Tree' },
    { id: 'toggle-group', label: 'Toggle group' },
    { id: 'chip', label: 'Chip' },
    { id: 'collapsible', label: 'Collapsible' },
    { id: 'table', label: 'Table' },
    { id: 'roadmap', label: 'Estensioni' },
  ];

  /** Esempio JSON per il Code block. */
  readonly jsonSample = [
    '{',
    '  "id": "RSSMRA80A01H501U",',
    '  "tipo": "PF",',
    '  "denominazione": "Mario Rossi",',
    '  "deleghe": [',
    '    { "id": "DLG-001", "tipo": "F24", "stato": "ATTIVA" }',
    '  ],',
    '  "attivo": true',
    '}',
  ].join('\n');

  /** Bozza editabile per il Code editor (demo interattiva). */
  readonly codeEditorDraft = signal('{\n  "id": "DLG-001",\n  "tipo": "F24",\n  "stato": "ATTIVA"\n}');
  /** JSON non valido nella bozza dell'editor (per il ring di errore demo). */
  readonly codeEditorInvalid = computed(() => {
    try {
      JSON.parse(this.codeEditorDraft());
      return false;
    } catch {
      return true;
    }
  });

  private readonly uiDialog = inject(UiDialog);
  protected readonly toast = inject(ToastService);
  private readonly dialogTpl = viewChild.required<TemplateRef<unknown>>('dialogTpl');
  private dialogRef?: DialogRef<unknown>;

  /** Valore del gruppo radio di esempio. */
  protected readonly radioValue = signal<string>('json');

  /** Esempio Select: opzioni + valore selezionato (una opzione disabilitata). */
  protected readonly responseOptions: readonly UiSelectOption<string>[] = [
    { value: 'default', label: 'Default (200)' },
    { value: 'not-found', label: 'Soggetto non trovato (404)' },
    { value: 'server-error', label: 'Errore server (500)' },
    { value: 'proxy', label: 'Proxy (non disponibile)', disabled: true },
  ];
  protected readonly selectValue = signal<string | null>('default');
  /** Select con tono di status (pill colorata): valore d'esempio. */
  protected readonly statusValue = signal<string | null>('200');
  readonly statusOptions: readonly UiSelectOption<string>[] = [
    { value: '200', label: '200 OK' },
    { value: '404', label: '404 Not Found' },
    { value: '500', label: '500 Internal Server Error' },
  ];

  /** Tono del select status, derivato dal codice (per la pill colorata). */
  protected readonly statusTone = computed<'2xx' | '4xx' | '5xx'>(() => {
    const code = parseInt(this.statusValue() ?? '', 10);
    return code >= 500 ? '5xx' : code >= 400 ? '4xx' : '2xx';
  });

  /** Toggle group d'esempio (segmented JSON/File). */
  protected readonly toggleValue = signal<'json' | 'file'>('json');

  /** Righe d'esempio per la Table. */
  readonly sampleHeaders: ReadonlyArray<readonly [string, string]> = [
    ['content-type', 'application/json'],
    ['cache-control', 'no-store'],
    ['x-mock-source', 'mock'],
  ];

  /** Dati di esempio per l'albero. */
  protected readonly treeData: UiTreeNode[] = [
    {
      id: 'auth',
      label: 'Autenticazione',
      meta: '3',
      children: [
        { id: 'a1', label: '/auth/login', meta: 'POST' },
        { id: 'a2', label: '/auth/me', meta: 'GET' },
      ],
    },
    {
      id: 'soggetti',
      label: 'Soggetti',
      meta: '4',
      children: [
        { id: 's1', label: '/soggetti', meta: 'GET' },
        { id: 's2', label: '/soggetti/:id', meta: 'GET' },
        {
          id: 'deleghe',
          label: 'Deleghe',
          meta: '2',
          children: [
            { id: 'd1', label: '/soggetti/:id/deleghe', meta: 'GET' },
            { id: 'd2', label: '/soggetti/:id/deleghe/:idDelega', meta: 'GET' },
          ],
        },
      ],
    },
  ];

  openDialog(): void {
    this.dialogRef = this.uiDialog.open(this.dialogTpl());
  }

  closeDialog(): void {
    this.dialogRef?.close();
  }

  readonly colorGroups: readonly ColorGroup[] = [
    {
      id: 'superfici',
      title: 'Superfici',
      desc: 'I livelli di sfondo, dal piu profondo al piu elevato. Le superfici si impilano per creare gerarchia senza ombre forti.',
      swatches: [
        { name: '--background', util: 'bg-background' },
        { name: '--card', util: 'bg-card' },
        { name: '--muted', util: 'bg-muted' },
        { name: '--accent', util: 'bg-accent' },
        { name: '--code', util: 'bg-[var(--code)]' },
      ],
    },
    {
      id: 'testo',
      title: 'Testo',
      desc: 'Gerarchia tipografica per colore: primario, secondario e disattivato. Mai bianco pieno, per restare riposante.',
      swatches: [
        { name: '--foreground', util: 'text-foreground' },
        { name: '--muted-foreground', util: 'text-muted-foreground' },
        { name: '--foreground-faint', util: 'text-[var(--foreground-faint)]' },
      ],
    },
    {
      id: 'bordi',
      title: 'Bordi & focus',
      desc: 'Hairline e ring di focus. I bordi sono overlay bianchi a bassa opacita; il ring usa lo slate del brand.',
      swatches: [
        { name: '--border', util: 'border-border' },
        { name: '--border-soft', util: '—' },
        { name: '--input', util: 'border-input' },
        { name: '--ring', util: 'ring-ring' },
      ],
    },
    {
      id: 'brand',
      title: 'Brand & primario',
      desc: 'Un unico accento: slate desaturato. I bottoni primari usano il gradiente brand → brand-strong (non il flat) per contrasto.',
      swatches: [
        { name: '--brand', util: 'text-brand / bg-brand' },
        { name: '--brand-soft', util: '—' },
        { name: '--brand-strong', util: '—' },
        { name: '--brand-deep', util: '—' },
        { name: '--primary', util: 'bg-primary' },
        { name: '--primary-foreground', util: 'text-primary-foreground' },
      ],
    },
    {
      id: 'stati',
      title: 'Stati',
      desc: 'Positivo (server online / switch ON) e distruttivo. destructive-soft e il testo chiaro su sfondo distruttivo tenue.',
      swatches: [
        { name: '--positive', util: 'bg-positive / text-positive' },
        { name: '--destructive', util: 'text-destructive' },
        { name: '--destructive-soft', util: 'text-destructive-soft' },
      ],
    },
    {
      id: 'metodi',
      title: 'Metodi HTTP',
      desc: 'Tinte semantiche per i verbi HTTP, applicate come testo su chip neutro (vedi Badge). Shade -300, usate all 85%.',
      swatches: [
        { name: '--method-get', util: 'text-method-get' },
        { name: '--method-post', util: 'text-method-post' },
        { name: '--method-put', util: 'text-method-put' },
        { name: '--method-delete', util: 'text-method-delete' },
        { name: '--method-patch', util: 'text-method-patch' },
      ],
    },
    {
      id: 'status',
      title: 'Classi di status',
      desc: 'Tinte per le classi di status HTTP (2xx/3xx/4xx/5xx), per colorare codici e badge di esito.',
      swatches: [
        { name: '--status-2xx', util: 'text-status-2xx' },
        { name: '--status-3xx', util: 'text-status-3xx' },
        { name: '--status-4xx', util: 'text-status-4xx' },
        { name: '--status-5xx', util: 'text-status-5xx' },
      ],
    },
    {
      id: 'tipi',
      title: 'Tipo di definizione',
      desc: 'Tinte per il tipo di definizione di un endpoint (mock / handler / middleware), usate come pallino + etichetta nel catalogo.',
      swatches: [
        { name: '--type-mock', util: 'text-type-mock / bg-type-mock' },
        { name: '--type-handler', util: 'text-type-handler / bg-type-handler' },
        { name: '--type-middleware', util: 'text-type-middleware / bg-type-middleware' },
      ],
    },
    {
      id: 'json',
      title: 'Sintassi JSON',
      desc: 'Palette per l evidenziazione del body JSON: chiavi, stringhe, numeri, punteggiatura e numeri di riga.',
      swatches: [
        { name: '--json-key', util: '.json-key' },
        { name: '--json-string', util: '.json-string' },
        { name: '--json-number', util: '.json-number' },
        { name: '--json-punct', util: '.json-punct' },
        { name: '--json-gutter', util: '.a2-gutter' },
      ],
    },
  ];

  /** Valori risolti dei token (letti dal CSS a runtime → sempre allineati). */
  readonly tokenValues = signal<Record<string, string>>({});

  constructor() {
    afterNextRender(() => {
      const computed = getComputedStyle(document.documentElement);
      const values: Record<string, string> = {};
      for (const group of this.colorGroups) {
        for (const swatch of group.swatches) {
          values[swatch.name] = computed.getPropertyValue(swatch.name).trim();
        }
      }
      this.tokenValues.set(values);
    });
  }

  /** Scorre alla sezione richiesta dentro il contenitore scrollabile. */
  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
