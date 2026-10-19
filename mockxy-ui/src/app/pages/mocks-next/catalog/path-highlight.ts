/** Pezzo di un testo: `match` se corrisponde al termine cercato. */
export interface TextPart {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Spezza `text` nei pezzi che corrispondono a `term` e in quelli attorno, nell'ordine, senza
 * distinguere maiuscole e minuscole (come la ricerca del catalogo). I pezzi conservano le lettere
 * di `text`. Con un termine vuoto, o assente dal testo, torna il testo intero come unico pezzo.
 *
 * Il confronto e' una regex con il flag `i` sul testo originale, non un indexOf sul testo portato
 * in minuscolo: per alcuni caratteri la minuscola cambia lunghezza ("İ" diventa due unita'), e gli
 * indici trovati li' non varrebbero piu' sul testo da tagliare.
 */
export function highlightParts(text: string, term: string): readonly TextPart[] {
  const needle = term.trim();
  if (needle === '') {
    return [{ text, match: false }];
  }
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const parts: TextPart[] = [];
  let from = 0;
  for (const found of text.matchAll(pattern)) {
    const at = found.index;
    if (at > from) {
      parts.push({ text: text.slice(from, at), match: false });
    }
    parts.push({ text: found[0], match: true });
    from = at + found[0].length;
  }
  if (from < text.length || parts.length === 0) {
    parts.push({ text: text.slice(from), match: false });
  }
  return parts;
}
