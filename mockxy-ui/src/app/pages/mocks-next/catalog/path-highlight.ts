/** Pezzo di un testo: `match` se corrisponde al termine cercato. */
export interface TextPart {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Spezza `text` nei pezzi che corrispondono a `term` e in quelli attorno, nell'ordine, senza
 * distinguere maiuscole e minuscole (come la ricerca del catalogo). I pezzi conservano le lettere
 * di `text`. Con un termine vuoto, o assente dal testo, torna il testo intero come unico pezzo.
 */
export function highlightParts(text: string, term: string): readonly TextPart[] {
  const needle = term.trim().toLowerCase();
  if (needle === '') {
    return [{ text, match: false }];
  }
  const haystack = text.toLowerCase();
  const parts: TextPart[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, from)) {
    if (at > from) {
      parts.push({ text: text.slice(from, at), match: false });
    }
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length || parts.length === 0) {
    parts.push({ text: text.slice(from), match: false });
  }
  return parts;
}
