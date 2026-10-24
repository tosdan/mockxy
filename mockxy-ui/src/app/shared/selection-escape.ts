/**
 * Esc che annulla una selezione multipla (catalogo, Monitor, Storico). Vale da qualunque punto della
 * pagina, ma non da un campo o un editor, ne' da un menu o un dialog (overlay CDK), che con Esc
 * chiudono se stessi; ne' quando qualcuno ha gia' gestito il tasto.
 */
export function isSelectionEscape(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return false;
  return !target?.closest?.('.cdk-overlay-container');
}
