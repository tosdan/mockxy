import { afterNextRender, ChangeDetectionStrategy, Component, computed, input, signal, viewChild } from '@angular/core';
import {
  CdkNestedTreeNode,
  CdkTree,
  CdkTreeNode,
  CdkTreeNodeDef,
  CdkTreeNodeOutlet,
  CdkTreeNodeToggle,
} from '@angular/cdk/tree';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight, lucideFolder, lucideFolderOpen } from '@ng-icons/lucide';

export interface UiTreeNode {
  readonly id: string;
  readonly label: string;
  /** Testo accessorio a destra (es. conteggio o metodo). */
  readonly meta?: string;
  readonly children?: readonly UiTreeNode[];
}

/** Nodo arricchito coi metadati per i connettori (profondita' + ultimo fratello). */
interface InternalNode extends UiTreeNode {
  readonly depth: number;
  readonly last: boolean;
  /** Mutabile: la CDK richiede `T[]` (non readonly) dal childrenAccessor. */
  children?: InternalNode[];
}

/** Aggiunge depth + last ad ogni nodo, ricorsivamente (per disegnare i connettori). */
function augment(nodes: readonly UiTreeNode[], depth: number): InternalNode[] {
  const lastIdx = nodes.length - 1;
  return nodes.map((n, i) => ({
    ...n,
    depth,
    last: i === lastIdx,
    children: n.children?.length ? augment(n.children, depth + 1) : undefined,
  }));
}

/**
 * Albero su @angular/cdk/tree (modalita' nested): la CDK fornisce navigazione da
 * tastiera (TreeKeyManager: frecce, Home/End, type-ahead) + ARIA completo
 * (role=tree/treeitem, aria-level/expanded/setsize/posinset) + modello di
 * espansione; noi mettiamo lo stile sui token e i connettori di profondita' (├/└).
 *
 * I connettori sono ricostruiti pezzo per pezzo da depth + last (precalcolati sui
 * dati, non dal context CDK) cosi' la linea verticale si ferma all'ultimo figlio.
 * Default: tutto espanso (expandAll dopo il render); le radici sono cartelle.
 */
@Component({
  selector: 'ui-tree',
  imports: [CdkTree, CdkTreeNode, CdkNestedTreeNode, CdkTreeNodeDef, CdkTreeNodeOutlet, CdkTreeNodeToggle, NgIcon],
  providers: [provideIcons({ lucideChevronRight, lucideFolder, lucideFolderOpen })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cdk-tree
      class="block overflow-hidden"
      [dataSource]="rootNodes()"
      [childrenAccessor]="childrenAccessor"
      [trackBy]="trackBy"
    >
      <!-- CARTELLA (nodo espandibile). isExpandable=true → la CDK gestisce aria-expanded. -->
      <cdk-nested-tree-node *cdkTreeNodeDef="let node; when: hasChild" class="block outline-none" [isExpandable]="true">
        <button
          type="button"
          cdkTreeNodeToggle
          class="relative flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-[13px] font-medium text-foreground transition hover:bg-accent"
          [style.padding-left.px]="8 + node.depth * 16"
        >
          @if (node.depth > 0) {
          <span class="pointer-events-none absolute top-0 h-1/2 w-px bg-border" [style.left.px]="node.depth * 16 - 1"></span>
          <span class="pointer-events-none absolute top-1/2 h-px w-[9px] bg-border" [style.left.px]="node.depth * 16 - 1"></span>
          @if (!node.last) {
          <span class="pointer-events-none absolute top-1/2 bottom-0 w-px bg-border" [style.left.px]="node.depth * 16 - 1"></span>
          }
          }
          <ng-icon
            name="lucideChevronRight"
            size="0.85rem"
            class="shrink-0 text-muted-foreground transition-transform"
            [class.rotate-90]="isOpen(node)"
          />
          <ng-icon [name]="isOpen(node) ? 'lucideFolderOpen' : 'lucideFolder'" size="0.95rem" class="shrink-0 text-muted-foreground" />
          <span class="truncate">{{ node.label }}</span>
          @if (node.meta) {
          <span class="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{{ node.meta }}</span>
          }
        </button>
        <div class="relative" role="group" [class.hidden]="!isOpen(node)">
          @if (node.depth > 0 && !node.last) {
          <span class="pointer-events-none absolute inset-y-0 w-px bg-border" [style.left.px]="node.depth * 16 - 1"></span>
          }
          <ng-container cdkTreeNodeOutlet></ng-container>
        </div>
      </cdk-nested-tree-node>

      <!-- FOGLIA (endpoint) -->
      <cdk-tree-node *cdkTreeNodeDef="let node" class="block outline-none">
        <div
          class="relative flex items-center gap-2 rounded-md py-1.5 pr-2 text-[13px] text-muted-foreground"
          [style.padding-left.px]="8 + node.depth * 16 + 20"
        >
          @if (node.depth > 0) {
          <span class="pointer-events-none absolute top-0 h-1/2 w-px bg-border" [style.left.px]="node.depth * 16 - 1"></span>
          <span class="pointer-events-none absolute top-1/2 h-px w-[25px] bg-border" [style.left.px]="node.depth * 16 - 1"></span>
          @if (!node.last) {
          <span class="pointer-events-none absolute top-1/2 bottom-0 w-px bg-border" [style.left.px]="node.depth * 16 - 1"></span>
          }
          }
          <span class="truncate font-mono text-foreground">{{ node.label }}</span>
          @if (node.meta) {
          <span class="ml-auto shrink-0 text-[10px] text-muted-foreground">{{ node.meta }}</span>
          }
        </div>
      </cdk-tree-node>
    </cdk-tree>
  `,
})
export class UiTree {
  readonly nodes = input<readonly UiTreeNode[]>([]);

  /** Dati arricchiti coi metadati dei connettori. */
  protected readonly rootNodes = computed(() => augment(this.nodes(), 0));

  private readonly noChildren: InternalNode[] = [];
  protected readonly childrenAccessor = (node: InternalNode): InternalNode[] => node.children ?? this.noChildren;
  protected readonly hasChild = (_: number, node: InternalNode): boolean => !!node.children?.length;
  protected readonly trackBy = (_: number, node: InternalNode): string => node.id;

  private readonly tree = viewChild(CdkTree);
  /** True dopo l'expandAll iniziale: prima mostriamo tutto espanso (niente flash). */
  private readonly ready = signal(false);

  constructor() {
    afterNextRender(() => {
      this.tree()?.expandAll();
      this.ready.set(true);
    });
  }

  protected isOpen(node: InternalNode): boolean {
    if (!this.ready()) return true;
    return this.tree()?.isExpanded(node) ?? true;
  }
}
