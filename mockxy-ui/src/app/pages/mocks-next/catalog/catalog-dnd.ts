import { UNSORTED_COLLECTION_ID, type CollectionSummary } from '../../../mock-admin-api.types';
import type { CatalogEndpointVM, CatalogTreeNode } from '../mocks-next.store';

/** Chiave del genitore "radice" nell'ordine unificato (deve combaciare col backend). */
export const ROOT_ORDER_KEY = 'root';

/**
 * Riga della lista piatta del catalogo: un endpoint o l'intestazione di una collection, con la sua
 * profondità (per l'indentazione) e la chiave del genitore (per dedurre il drop).
 */
export type CatalogRow =
  | { kind: 'collection'; node: CatalogTreeNode; depth: number; parentKey: string }
  | { kind: 'endpoint'; endpoint: CatalogEndpointVM; depth: number; parentKey: string };

/** Rettangolo minimo di una riga della lista (dal DOM o sintetico nei test). */
export interface RowRect {
  top: number;
  bottom: number;
  height: number;
}

export type DropDecision =
  | { kind: 'into'; collectionId: string }
  | { kind: 'line'; top: number; left: number; width: number; targetParentKey: string; insertAt: number }
  | { kind: 'none' };

export interface DropDecisionInput {
  /** Righe della lista piatta, nell'ordine esatto dei cdkDrag (children[i] ↔ rows[i]). */
  rows: readonly CatalogRow[];
  /** Ref (id endpoint o id collection) dell'elemento trascinato. */
  draggedId: string;
  /** Coordinata Y (viewport) del puntatore. */
  pointerY: number;
  /** Rettangoli delle righe, allineati a `rows`. */
  rowRects: readonly RowRect[];
  /** Bordo sinistro e larghezza della lista (per la linea di inserimento). */
  listLeft: number;
  listWidth: number;
  /** Ordine unificato dei figli per genitore (dallo store). */
  childOrder: Readonly<Record<string, readonly string[]>>;
}

/**
 * Lista piatta delle righe trascinabili: endpoint Unsorted (in cima) seguiti dai sottoalberi delle
 * collection radice, ognuno con profondità e chiave del genitore (l'intestazione Unsorted è fuori
 * lista perché non trascinabile). Le cartelle collassate nascondono l'intero sottoalbero.
 */
export function buildCatalogRows(
  unsorted: CatalogTreeNode | null,
  roots: readonly CatalogTreeNode[],
  collapsed: ReadonlySet<string>,
): readonly CatalogRow[] {
  const rows: CatalogRow[] = [];
  if (unsorted && !collapsed.has(UNSORTED_COLLECTION_ID)) {
    for (const child of unsorted.children) {
      if (child.kind === 'endpoint') {
        rows.push({ kind: 'endpoint', endpoint: child.endpoint, depth: 1, parentKey: UNSORTED_COLLECTION_ID });
      }
    }
  }
  for (const root of roots) {
    flattenNode(root, 0, ROOT_ORDER_KEY, collapsed, rows);
  }
  return rows;
}

function flattenNode(
  node: CatalogTreeNode,
  depth: number,
  parentKey: string,
  collapsed: ReadonlySet<string>,
  rows: CatalogRow[],
): void {
  rows.push({ kind: 'collection', node, depth, parentKey });
  if (collapsed.has(node.collection.id)) {
    return;
  }
  for (const child of node.children) {
    if (child.kind === 'endpoint') {
      rows.push({ kind: 'endpoint', endpoint: child.endpoint, depth: depth + 1, parentKey: node.collection.id });
    } else {
      flattenNode(child.node, depth + 1, node.collection.id, collapsed, rows);
    }
  }
}

/** Riferimento (id) di una riga: id collection o id endpoint. */
export function rowRef(row: CatalogRow): string {
  return row.kind === 'collection' ? row.node.collection.id : row.endpoint.id;
}

/** Ref (id) di tutti i discendenti (collection + endpoint) di una riga collection trascinata. */
export function descendantRefs(row: CatalogRow): string[] {
  if (row.kind !== 'collection') return [];
  const out: string[] = [];
  const walk = (node: CatalogTreeNode): void => {
    for (const child of node.children) {
      if (child.kind === 'endpoint') {
        out.push(child.endpoint.id);
      } else {
        out.push(child.node.collection.id);
        walk(child.node);
      }
    }
  };
  walk(row.node);
  return out;
}

/** Id di tutte le collection discendenti di `id` (per vietare il reparent dentro sé stessa). */
export function collectionDescendantIds(id: string, all: readonly CollectionSummary[]): string[] {
  const out: string[] = [];
  const walk = (pid: string): void => {
    for (const child of all.filter((c) => (c.parentId || undefined) === pid)) {
      out.push(child.id);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** Riga (e suo rect) sotto la Y del puntatore, saltando le righe ad altezza zero. */
function rowUnderPointer(pointerY: number, rowRects: readonly RowRect[]): { index: number; rect: RowRect } | null {
  for (let i = 0; i < rowRects.length; i += 1) {
    const rect = rowRects[i];
    if (rect.height === 0) continue;
    if (pointerY >= rect.top && pointerY < rect.bottom) return { index: i, rect };
  }
  return null;
}

/** Indice di inserimento nelle righe e posizione della linea, dalla Y del puntatore. */
function computeInsertLine(
  pointerY: number,
  rowRects: readonly RowRect[],
  listLeft: number,
  listWidth: number,
): { idx: number; top: number; left: number; width: number } | null {
  if (rowRects.length === 0) return null;
  let idx = rowRects.length;
  for (let i = 0; i < rowRects.length; i += 1) {
    const rect = rowRects[i];
    if (rect.height === 0) continue;
    if (pointerY < rect.top + rect.height / 2) {
      idx = i;
      break;
    }
  }
  const top = idx < rowRects.length ? rowRects[idx].top : rowRects[rowRects.length - 1].bottom;
  return { idx, top, left: listLeft, width: listWidth };
}

/**
 * Decide cosa succederebbe rilasciando alla Y data: `into` (puntatore sulla banda centrale
 * dell'intestazione di una collection → l'item finisce DENTRO), `line` (tra due elementi → posizione
 * indicata dalla linea) o `none` (sopra l'item stesso o il suo sottoalbero → nessuna destinazione).
 * Funzione pura: usata sia per il feedback visivo (drag move) sia per l'azione (drop), così non c'è
 * stato condiviso — e la geometria è testabile senza gesto reale.
 */
export function computeDropDecision(input: DropDecisionInput): DropDecision {
  const { rows, draggedId, pointerY, rowRects, listLeft, listWidth, childOrder } = input;
  const draggedIndex = rows.findIndex((row) => rowRef(row) === draggedId);
  if (draggedIndex < 0) return { kind: 'none' };
  const dragged = rows[draggedIndex];
  const banned = new Set<string>([draggedId, ...descendantRefs(dragged)]);

  // "Into": puntatore nella banda centrale dell'intestazione di una collection valida (no sé/discendenti, no Unsorted).
  const hit = rowUnderPointer(pointerY, rowRects);
  if (hit) {
    const overRow = rows[hit.index];
    const relative = (pointerY - hit.rect.top) / hit.rect.height;
    const isHeaderMiddle = overRow?.kind === 'collection'
      && overRow.node.collection.id !== UNSORTED_COLLECTION_ID
      && relative >= 0.25
      && relative <= 0.75;
    if (isHeaderMiddle && !banned.has(rowRef(overRow))) {
      return { kind: 'into', collectionId: overRow.node.collection.id };
    }
  }

  // Span del nodo trascinato (sé + discendenti visibili contigui) per sopprimere il drop "su sé stesso".
  let subtreeEnd = draggedIndex;
  for (let i = draggedIndex + 1; i < rows.length && rows[i].depth > dragged.depth; i += 1) subtreeEnd = i;

  const result = computeInsertLine(pointerY, rowRects, listLeft, listWidth);
  if (!result || (result.idx >= draggedIndex && result.idx <= subtreeEnd + 1)) return { kind: 'none' };

  let above: CatalogRow | null = null;
  for (let i = result.idx - 1; i >= 0; i -= 1) {
    if (!banned.has(rowRef(rows[i]))) { above = rows[i]; break; }
  }
  let below: CatalogRow | null = null;
  for (let i = result.idx; i < rows.length; i += 1) {
    if (!banned.has(rowRef(rows[i]))) { below = rows[i]; break; }
  }

  let targetParentKey: string;
  let firstChild = false;
  if (!above) {
    targetParentKey = ROOT_ORDER_KEY; // inizio lista
  } else if (below && below.depth > above.depth && above.kind === 'collection') {
    targetParentKey = above.node.collection.id; // primo figlio di una cartella aperta
    firstChild = true;
  } else {
    targetParentKey = above.parentKey; // fratello della riga sopra
  }
  // Gli endpoint vivono in "unsorted"/collection (mai a root); le collection mai in "unsorted".
  if (dragged.kind === 'endpoint' && targetParentKey === ROOT_ORDER_KEY) targetParentKey = UNSORTED_COLLECTION_ID;
  if (dragged.kind === 'collection' && targetParentKey === UNSORTED_COLLECTION_ID) targetParentKey = ROOT_ORDER_KEY;

  const targetChildRefs = (childOrder[targetParentKey] ?? []).filter((ref) => ref !== draggedId);
  const insertAt = firstChild || !above ? 0 : Math.max(0, targetChildRefs.indexOf(rowRef(above)) + 1);
  return { kind: 'line', top: result.top, left: listLeft, width: listWidth, targetParentKey, insertAt };
}
