// Configurazione di CodeMirror 6 per l'editor di codice dell'app.
//
// Qui vivono le parti STATICHE e riusabili: il tema (agganciato ai token colore dell'app, così
// l'editor combacia con la vista in sola lettura), lo stile di evidenziazione, le estensioni sempre
// attive, e i piccoli costruttori per le parti che cambiano a runtime (linguaggio, lint, dimensioni).
// Il componente Angular monta tutto questo e gestisce il doppio legame col valore.

import { EditorState, type Extension } from '@codemirror/state';
import {
  type Command,
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentSelection, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { lintGutter, lintKeymap, linter } from '@codemirror/lint';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { tags as t } from '@lezer/highlight';
import { scriptCompletionSource } from './cm-script-completions';

export type EditorLanguage = 'json' | 'javascript' | 'text';

// Tema: stesso sfondo/colore della famiglia "code" (token --code, --foreground, --json-gutter, ...).
const appEditorTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--foreground)',
      backgroundColor: 'var(--code)',
      fontSize: '12.5px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-content': {
      fontFamily: 'var(--font-mono)',
      padding: '12px 0',
      caretColor: 'var(--foreground)',
    },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.7', overflow: 'auto' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--json-gutter)',
      border: 'none',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '2.5ch' },
    '.cm-foldGutter .cm-gutterElement': { padding: '0 2px' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--foreground) 4%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
    // Il primo selettore ricalca quello di CodeMirror per l'editor a fuoco: piu' specifico, vinceva
    // e colorava la selezione col suo verde scuro.
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--brand) 28%, transparent)',
    },
    // Negli stati evidenziati il testo si scrive col colore pieno, come la ricerca del catalogo:
    // sotto un velo i colori spenti della sintassi (commenti, punteggiatura) scendono sotto 4.5:1, e
    // schiariti abbastanza diventerebbero tutti lo stesso grigio. Anche i discendenti: il segno puo'
    // stare fuori o dentro lo span della sintassi.
    [[
      '.cm-selectedText',
      '.cm-selectionMatch',
      '.cm-matchingBracket',
      '.cm-nonmatchingBracket',
      '.cm-searchMatch',
    ].flatMap((selector) => [selector, `${selector} *`]).join(', ')]: { color: 'var(--foreground)' },
    // Risultati della ricerca col velo ambra della ricerca del catalogo, al posto del ciano e del
    // magenta pieni di CodeMirror. Quello corrente e' anche selezionato, e i due veli si sommano:
    // lo distingue soprattutto il bordo, e il velo resta leggero perche' il testo tenga 4.5:1.
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--highlight) 20%, transparent)',
      borderRadius: '2px',
    },
    '.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--highlight) 25%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--highlight) 70%, transparent)',
    },
    '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--brand) 16%, transparent)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'color-mix(in srgb, var(--brand) 22%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--brand) 45%, transparent)',
    },
    // Pannelli (ricerca) e popup di completamento sui token dell'app. Font leggibile: CodeMirror di
    // default rimpicciolisce molto etichette e controlli del pannello di ricerca.
    '.cm-panels': {
      backgroundColor: 'var(--card)',
      color: 'var(--foreground)',
      fontFamily: 'var(--font-sans)',
      fontSize: '13px',
    },
    '.cm-panel.cm-search': { padding: '6px 8px' },
    '.cm-panel.cm-search label': { fontSize: '13px' },
    '.cm-panel.cm-search input, .cm-panel.cm-search button': {
      fontFamily: 'var(--font-sans)',
      fontSize: '13px',
      backgroundColor: 'var(--code)',
      color: 'var(--foreground)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      padding: '2px 8px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete': {
      backgroundColor: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'color-mix(in srgb, var(--brand) 22%, transparent)',
      color: 'var(--foreground)',
    },
  },
  { dark: true },
);

// Segna il testo selezionato con la classe cm-selectedText, per il colore pieno del tema: la
// selezione e' disegnata in un livello dietro al testo, che da solo non sa di esserci sopra.
const selectedTextMark = Decoration.mark({ class: 'cm-selectedText' });

export function selectedTextDecorations(state: EditorState): DecorationSet {
  return Decoration.set(state.selection.ranges.filter((range) => !range.empty).map((range) => selectedTextMark.range(range.from, range.to)));
}

const selectedText = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = selectedTextDecorations(view.state);
    }
    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged) this.decorations = selectedTextDecorations(update.state);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// Evidenziazione: mappa i tag di sintassi sui token --json-* (coerente con la vista read-only).
const appHighlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--json-key)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--json-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--json-number)' },
  {
    tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.self],
    color: 'var(--json-key)',
  },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--json-gutter)', fontStyle: 'italic' },
  {
    tag: [t.punctuation, t.separator, t.bracket, t.brace, t.squareBracket, t.paren],
    color: 'var(--json-punct)',
  },
  { tag: t.operator, color: 'var(--json-punct)' },
  { tag: [t.typeName, t.className, t.definition(t.variableName)], color: 'var(--json-key)' },
]);

// Formattazione JSON completa: riordina il documento se è JSON valido; altrimenti restituisce false
// (così il comando combinato può ripiegare sulla ri-indentazione).
const formatJsonCommand: Command = (view) => {
  const current = view.state.doc.toString();
  try {
    const formatted = JSON.stringify(JSON.parse(current), null, 2);
    if (formatted !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: formatted } });
    }
    return true;
  } catch {
    return false;
  }
};

// Ri-indenta l'intero documento secondo le regole del linguaggio (per JS/testo, dove non c'è una
// formattazione "vera" integrata). Usa indentSelection di CodeMirror, che ricalcola riga per riga in
// modo incrementale (gestisce correttamente l'annidamento). Selezioniamo tutto, re-indentiamo e poi
// riportiamo il cursore sulla sua riga; la modifica resta un singolo passo di annulla.
const reindentCommand: Command = (view) => {
  const saved = view.state.selection.main;
  const savedLine = view.state.doc.lineAt(saved.head).number;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  const changed = indentSelection(view);
  const line = view.state.doc.line(Math.min(savedLine, view.state.doc.lines));
  view.dispatch({ selection: { anchor: line.from } });
  return changed;
};

// Shift+Alt+F: formattazione JSON completa; sugli altri linguaggi ripiega sulla ri-indentazione.
const formatCommand: Command = (view) => formatJsonCommand(view) || reindentCommand(view);

// Estensioni sempre attive (indipendenti da linguaggio/stato): gutter, storia, parentesi, completamento,
// ricerca, tema, tasti.
export const staticExtensions: Extension[] = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  foldGutter(),
  drawSelection(),
  selectedText,
  history(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  search({ top: true }),
  lintGutter(),
  syntaxHighlighting(appHighlightStyle),
  EditorView.lineWrapping,
  appEditorTheme,
  keymap.of([
    { key: 'Shift-Alt-f', run: formatCommand },
    indentWithTab,
    ...closeBracketsKeymap,
    ...completionKeymap,
    ...searchKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...lintKeymap,
  ]),
];

/**
 * Testi di CodeMirror da tradurre (pannello di ricerca e sostituzione, "vai alla riga", lint,
 * ripiegamento, completamento, annunci per lo screen reader): frase inglese di CodeMirror -> chiave
 * della sezione `codeEditor` delle traduzioni. Senza, l'editor restava in inglese anche in italiano.
 */
export const EDITOR_PHRASE_KEYS: Readonly<Record<string, string>> = {
  'Find': 'find',
  'Replace': 'replace',
  'next': 'next',
  'previous': 'previous',
  'all': 'all',
  'match case': 'matchCase',
  'regexp': 'regexp',
  'by word': 'byWord',
  'replace': 'replaceOne',
  'replace all': 'replaceAll',
  'close': 'close',
  'current match': 'currentMatch',
  'on line': 'onLine',
  'replaced match on line $': 'replacedMatchOnLine',
  'replaced $ matches': 'replacedMatches',
  'Go to line': 'goToLine',
  'go': 'go',
  'Diagnostics': 'diagnostics',
  'No diagnostics': 'noDiagnostics',
  'folded code': 'foldedCode',
  'unfold': 'unfold',
  'Fold line': 'foldLine',
  'Unfold line': 'unfoldLine',
  'Folded lines': 'foldedLines',
  'Unfolded lines': 'unfoldedLines',
  'to': 'to',
  'Completions': 'completions',
  'Selection deleted': 'selectionDeleted',
  'Control character': 'controlCharacter',
};

/** Le frasi tradotte per CodeMirror, dalla sezione `codeEditor` della lingua attiva. */
export function editorPhrases(translations: Readonly<Record<string, string>>): Extension {
  const phrases: Record<string, string> = {};
  for (const [phrase, key] of Object.entries(EDITOR_PHRASE_KEYS)) {
    if (translations[key]) phrases[phrase] = translations[key];
  }
  return EditorState.phrases.of(phrases);
}

// Estensione del linguaggio (ricaricabile via compartment dal componente). Per JavaScript aggancia
// anche il completamento del contratto handler/middleware.
export function languageExtension(language: EditorLanguage): Extension {
  if (language === 'json') return json();
  if (language === 'javascript') {
    return [javascript(), javascriptLanguage.data.of({ autocomplete: scriptCompletionSource })];
  }
  return [];
}

// Lint inline del JSON: sottolinea gli errori di parsing direttamente sulla riga.
export function jsonLinterExtension(): Extension {
  return linter(jsonParseLinter());
}

// Altezza min/max ricavata dal numero di righe, per ricreare l'auto-dimensionamento della textarea.
const ROW_PX = 22; // ~12.5px * 1.7 di interlinea
export function sizeTheme(minRows: number, maxRows: number): Extension {
  return EditorView.theme({
    '.cm-scroller': {
      minHeight: `${Math.max(1, minRows) * ROW_PX}px`,
      maxHeight: `${Math.max(minRows, maxRows) * ROW_PX}px`,
    },
  });
}
