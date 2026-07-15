import {
  ROOT_ORDER_KEY,
  buildCatalogRows,
  collectionDescendantIds,
  computeDropDecision,
  descendantRefs,
  rowRef,
  type CatalogRow,
  type RowRect,
} from './catalog-dnd';
import { UNSORTED_COLLECTION_ID, type CollectionSummary } from '../../../mock-admin-api.types';
import type { CatalogChild, CatalogEndpointVM, CatalogTreeNode } from '../mocks-next.store';

function ep(id: string): CatalogEndpointVM {
  return { id, method: 'GET', path: `/${id}`, status: 200, type: 'mock', enabled: true, responses: 1, sequenceActive: false };
}

function colNode(id: string, children: readonly CatalogChild[] = []): CatalogTreeNode {
  return { collection: { id, name: id, count: 0, depth: 0, endpoints: [] }, children };
}

function epChild(id: string): CatalogChild {
  return { kind: 'endpoint', endpoint: ep(id) };
}

function colChild(node: CatalogTreeNode): CatalogChild {
  return { kind: 'collection', node };
}

/** Rettangoli sintetici: righe alte 30px impilate a partire da y=0. */
function stackedRects(count: number, rowHeight = 30): RowRect[] {
  return Array.from({ length: count }, (_, i) => ({
    top: i * rowHeight,
    bottom: (i + 1) * rowHeight,
    height: rowHeight,
  }));
}

/** Albero di prova: Unsorted con [u1, u2]; root: colA(a1, colB(b1)), colC. */
function fixtureRows(collapsed: ReadonlySet<string> = new Set()): readonly CatalogRow[] {
  const unsorted = colNode(UNSORTED_COLLECTION_ID, [epChild('u1'), epChild('u2')]);
  const colB = colNode('colB', [epChild('b1')]);
  const colA = colNode('colA', [epChild('a1'), colChild(colB)]);
  const colC = colNode('colC');
  return buildCatalogRows(unsorted, [colA, colC], collapsed);
}

const CHILD_ORDER: Readonly<Record<string, readonly string[]>> = {
  [ROOT_ORDER_KEY]: ['colA', 'colC'],
  [UNSORTED_COLLECTION_ID]: ['u1', 'u2'],
  colA: ['a1', 'colB'],
  colB: ['b1'],
};

function decisionAt(pointerY: number, draggedId: string, rows = fixtureRows()) {
  return computeDropDecision({
    rows,
    draggedId,
    pointerY,
    rowRects: stackedRects(rows.length),
    listLeft: 0,
    listWidth: 300,
    childOrder: CHILD_ORDER,
  });
}

describe('buildCatalogRows', () => {
  it('mette gli endpoint Unsorted in cima e i sottoalberi radice dopo, con profondità e parentKey', () => {
    const rows = fixtureRows();
    expect(rows.map((r) => `${rowRef(r)}@${r.depth}:${r.parentKey}`)).toEqual([
      `u1@1:${UNSORTED_COLLECTION_ID}`,
      `u2@1:${UNSORTED_COLLECTION_ID}`,
      `colA@0:${ROOT_ORDER_KEY}`,
      'a1@1:colA',
      'colB@1:colA',
      'b1@2:colB',
      `colC@0:${ROOT_ORDER_KEY}`,
    ]);
  });

  it('una cartella collassata nasconde il suo sottoalbero (ma non sé stessa)', () => {
    const rows = fixtureRows(new Set(['colA']));
    expect(rows.map(rowRef)).toEqual(['u1', 'u2', 'colA', 'colC']);
  });

  it('Unsorted collassata nasconde i suoi endpoint', () => {
    const rows = fixtureRows(new Set([UNSORTED_COLLECTION_ID]));
    expect(rows.map(rowRef)).toEqual(['colA', 'a1', 'colB', 'b1', 'colC']);
  });
});

describe('descendantRefs / collectionDescendantIds', () => {
  it('elenca endpoint e collection sotto una riga collection', () => {
    const rows = fixtureRows();
    const colARow = rows.find((r) => rowRef(r) === 'colA')!;
    expect(descendantRefs(colARow).sort()).toEqual(['a1', 'b1', 'colB']);
    const epRow = rows.find((r) => rowRef(r) === 'a1')!;
    expect(descendantRefs(epRow)).toEqual([]);
  });

  it('cammina le collection annidate per il divieto di reparent', () => {
    const all = [
      { id: 'colA', parentId: undefined },
      { id: 'colB', parentId: 'colA' },
      { id: 'colD', parentId: 'colB' },
      { id: 'colC', parentId: undefined },
    ] as unknown as CollectionSummary[];
    expect(collectionDescendantIds('colA', all)).toEqual(['colB', 'colD']);
  });
});

describe('computeDropDecision', () => {
  // Layout righe (30px l'una): 0 u1 · 1 u2 · 2 colA · 3 a1 · 4 colB · 5 b1 · 6 colC

  it('banda centrale di una collection → drop DENTRO', () => {
    // centro della riga colA (indice 2): y = 75
    const d = decisionAt(75, 'u1');
    expect(d).toEqual({ kind: 'into', collectionId: 'colA' });
  });

  it('bordo alto di una collection → linea, non "into"', () => {
    // primo quarto della riga colA (indice 2): y = 61 → relative ~0.03
    const d = decisionAt(61, 'u1');
    expect(d.kind).toBe('line');
  });

  it('sopra sé stesso o il proprio sottoalbero → none', () => {
    // colA occupa gli indici 2..5 (a1, colB, b1): rilascio dentro il suo span
    expect(decisionAt(100, 'colA').kind).toBe('none');
    // e anche subito sotto il proprio sottoalbero (idx == subtreeEnd+1)
    expect(decisionAt(166, 'colA').kind).toBe('none');
  });

  it('endpoint rilasciato in cima alla lista → parent Unsorted, posizione 0', () => {
    const d = decisionAt(0, 'a1');
    expect(d).toMatchObject({ kind: 'line', targetParentKey: UNSORTED_COLLECTION_ID, insertAt: 0 });
  });

  it('collection rilasciata tra gli endpoint Unsorted → rimappata a root', () => {
    // tra u1 e u2: y = 31 (sopra la metà di u2, indice 1) → above=u1 (parent unsorted) → root
    const d = decisionAt(31, 'colC');
    expect(d).toMatchObject({ kind: 'line', targetParentKey: ROOT_ORDER_KEY });
  });

  it('subito sotto una cartella aperta → primo figlio della cartella', () => {
    // tra colA (2) e a1 (3): y = 91 → above=colA, below=a1 (depth maggiore) → dentro colA a posizione 0
    const d = decisionAt(91, 'u1');
    expect(d).toMatchObject({ kind: 'line', targetParentKey: 'colA', insertAt: 0 });
  });

  it('tra due fratelli → insertAt dopo la riga sopra secondo childOrder', () => {
    // tra a1 (3) e colB (4): y = 121 → above=a1 → parent colA, insertAt = indexOf(a1)+1 = 1
    const d = decisionAt(121, 'u1');
    expect(d).toMatchObject({ kind: 'line', targetParentKey: 'colA', insertAt: 1 });
  });

  it("fondo lista → in coda a root (collection) e la linea si aggancia all'ultima riga", () => {
    const rows = fixtureRows();
    const d = decisionAt(500, 'colA', rows);
    // above = colC → fratello a root; colA è filtrata dai ref → insertAt = indexOf(colC)+1 = 1
    expect(d).toMatchObject({ kind: 'line', targetParentKey: ROOT_ORDER_KEY, insertAt: 1, top: rows.length * 30 });
  });

  it('id trascinato sconosciuto → none', () => {
    expect(decisionAt(75, 'manca').kind).toBe('none');
  });
});
