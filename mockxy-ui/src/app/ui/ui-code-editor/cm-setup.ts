// Configurazione di CodeMirror 6 per l'editor di codice dell'app.
//
// Qui vivono le parti STATICHE e riusabili: il tema (agganciato ai token colore dell'app, così
// l'editor combacia con la vista in sola lettura), lo stile di evidenziazione, le estensioni sempre
// attive, e i piccoli costruttori per le parti che cambiano a runtime (linguaggio, lint, dimensioni).
// Il componente Angular monta tutto questo e gestisce il doppio legame col valore.

import { type Extension } from '@codemirror/state';
import {
  type Command,
  EditorView,
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
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--brand) 28%, transparent)',
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
