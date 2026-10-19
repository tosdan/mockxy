/** Pezzo di un testo: `match` se corrisponde al termine cercato. */
export interface TextPart {
  readonly text: string;
  readonly match: boolean;
}

/**
 * Spezza `text` nei pezzi che corrispondono a `term` e in quelli attorno, nell'ordine. Con un
 * termine vuoto, o assente dal testo, torna il testo intero come unico pezzo.
 *
 * Il confronto e' quello del filtro del catalogo, `toLowerCase()` piu' `includes()`, cosi' una
 * riga trovata ha sempre il suo pezzo evidenziato. Ma la minuscola di un carattere puo' essere piu'
 * lunga ("İ" diventa "i" piu' un punto combinante): per tagliare il testo originale nei punti
 * giusti, ogni unita' del testo minuscolo ricorda il carattere originale da cui viene. Un pezzo
 * evidenziato copre sempre caratteri interi: cercando "i", di "İ" si evidenzia tutta la lettera.
 */
export function highlightParts(text: string, term: string): readonly TextPart[] {
  const needle = term.trim().toLowerCase();
  if (needle === '') {
    return [{ text, match: false }];
  }

  let perChar = '';
  const charStart: number[] = [];
  const charEnd: number[] = [];
  for (const char of text) {
    const start = charStart.length === 0 ? 0 : charEnd[charEnd.length - 1];
    const folded = char.toLowerCase();
    for (let unit = 0; unit < folded.length; unit += 1) {
      charStart.push(start);
      charEnd.push(start + char.length);
    }
    perChar += folded;
  }
  // Il testo intero in minuscolo e' quello che vede il filtro, e puo' differire carattere per
  // carattere da quello costruito qui sopra: la sigma finale greca diventa "ς", non "σ". Ha la stessa
  // lunghezza, quindi la mappa resta valida; il controllo copre un caso che oggi non esiste.
  const whole = text.toLowerCase();
  const lower = whole.length === perChar.length ? whole : perChar;

  const parts: TextPart[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
    const start = charStart[at];
    // Una corrispondenza che comincia dentro un carattere gia' evidenziato non ne apre un'altra.
    if (start < from) continue;
    const end = charEnd[at + needle.length - 1];
    if (start > from) {
      parts.push({ text: text.slice(from, start), match: false });
    }
    parts.push({ text: text.slice(start, end), match: true });
    from = end;
  }
  if (from < text.length || parts.length === 0) {
    parts.push({ text: text.slice(from), match: false });
  }
  return parts;
}
