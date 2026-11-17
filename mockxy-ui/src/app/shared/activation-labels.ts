import type { ActivationItem } from '../mock-admin-api.types';

/** Una variante in breve: il titolo (o il nome del file, se non ne ha) e lo status quando c'è. */
export function variantLabel(title: string | undefined, status: number | null | undefined, fileName: string | null | undefined): string {
  const name = title || fileName || '';
  return status != null ? `${name} ${status}` : name;
}

/**
 * I due lati di un'attivazione temporanea, per i soli campi che tocca: cosa risponde ora e cosa
 * dice il file. `saved` è null finché il file dell'endpoint non si legge: non c'è con cosa
 * confrontare. `word` traduce «acceso» / «spento».
 */
export function activationSides(item: ActivationItem, word: (enabled: boolean) => string): { now: string; saved: string | null } {
  const now: string[] = [];
  const saved: string[] = [];
  if (item.enabled !== undefined) {
    now.push(word(item.enabled));
    if (item.saved) saved.push(word(item.saved.enabled));
  }
  if (item.responseFile !== undefined) {
    now.push(variantLabel(item.responseTitle, item.responseStatus, item.responseFile));
    if (item.saved) saved.push(variantLabel(item.saved.responseTitle, item.saved.responseStatus, item.saved.responseFile));
  }
  return { now: now.join(' · '), saved: item.saved ? saved.join(' · ') : null };
}
