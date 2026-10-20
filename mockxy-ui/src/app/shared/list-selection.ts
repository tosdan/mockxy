/** Esito di una spunta in una lista: le voci spuntate e la nuova ancora degli intervalli. */
export interface ListSelectionChange {
  readonly selected: ReadonlySet<string>;
  readonly anchor: string;
}

/**
 * Spunta o toglie la spunta a `id`, come il clic sulla casella di una riga. Con `range` (shift)
 * spunta invece tutto l'intervallo fra l'ancora e `id`, nell'ordine di `orderedIds`: le voci che
 * si vedono, cosi' sotto filtro l'intervallo e' quello visibile. Se l'ancora non e' fra le voci,
 * la spunta torna singola. L'ancora diventa sempre `id`.
 */
export function toggleListSelection(
  selected: ReadonlySet<string>,
  orderedIds: readonly string[],
  id: string,
  anchor: string | null,
  range: boolean,
): ListSelectionChange {
  const next = new Set(selected);
  const from = range && anchor != null ? orderedIds.indexOf(anchor) : -1;
  const to = orderedIds.indexOf(id);
  if (from >= 0 && to >= 0) {
    const [start, end] = from <= to ? [from, to] : [to, from];
    for (const rangeId of orderedIds.slice(start, end + 1)) next.add(rangeId);
  } else if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return { selected: next, anchor: id };
}

/**
 * Riga di destinazione di un tasto di navigazione in una lista: la successiva, la precedente, la
 * prima o l'ultima; null per gli altri tasti o se non c'e' dove andare.
 */
export function listNavigationTarget(key: string, orderedIds: readonly string[], currentId: string | null): string | null {
  if (orderedIds.length === 0) return null;
  const index = currentId == null ? -1 : orderedIds.indexOf(currentId);
  switch (key) {
    case 'ArrowDown':
      return orderedIds[Math.min(index + 1, orderedIds.length - 1)] ?? null;
    case 'ArrowUp':
      return index <= 0 ? orderedIds[0] : orderedIds[index - 1];
    case 'Home':
      return orderedIds[0];
    case 'End':
      return orderedIds[orderedIds.length - 1];
    default:
      return null;
  }
}
