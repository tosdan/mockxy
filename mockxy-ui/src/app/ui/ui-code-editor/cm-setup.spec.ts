import { EditorSelection, EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { EDITOR_PHRASE_KEYS, editorPhrases, languageExtension, selectedTextDecorations, sizeTheme, jsonLinterExtension, staticExtensions } from './cm-setup';
import itDict from '../../../i18n/it.json';
import enDict from '../../../i18n/en.json';
import { scriptCompletionSource } from './cm-script-completions';

// Parti pure dell'editor di codice: sorgente di completamento del contratto script
// e costruttori delle estensioni per linguaggio. Il montaggio CodeMirror completo
// resta fuori (richiede layout reale, verificato dal vivo).

function completionAt(doc: string, pos: number, explicit = false) {
  const state = EditorState.create({ doc });
  return scriptCompletionSource(new CompletionContext(state, pos, explicit));
}

describe('scriptCompletionSource', () => {
  it('propone il contratto handler/middleware mentre si digita una parola', () => {
    const result = completionAt('reso', 4);
    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain('handler');
    expect(labels).toContain('middleware');
    expect(labels).toContain('resolveResponse');
    expect(labels).toContain('sharedState');
    expect(labels).toContain('applyListQuery');
    expect(labels).toContain('transformResponse');
    expect(labels).toContain('jsonBody');
  });

  it('a cursore su spazio vuoto tace, salvo richiesta esplicita (Ctrl+Space)', () => {
    expect(completionAt('x ', 2)).toBeNull();
    expect(completionAt('x ', 2, true)).not.toBeNull();
  });

  it('il from punta all’inizio della parola corrente (il filtro lo fa CodeMirror)', () => {
    const result = completionAt('const x = tra', 13);
    expect(result?.from).toBe(10);
  });
});

describe('estensioni per linguaggio', () => {
  it('json e javascript hanno estensioni dedicate, il testo nessuna', () => {
    expect(languageExtension('json')).toBeTruthy();
    expect(Array.isArray(languageExtension('javascript'))).toBe(true);
    expect(languageExtension('text')).toEqual([]);
  });

  it('le estensioni si montano in uno stato CodeMirror senza errori', () => {
    for (const lang of ['json', 'javascript', 'text'] as const) {
      const state = EditorState.create({
        doc: '{}',
        extensions: [languageExtension(lang), sizeTheme(4, 10)],
      });
      expect(state.doc.toString()).toBe('{}');
    }
    expect(jsonLinterExtension()).toBeTruthy();
  });
});

describe('testo selezionato', () => {
  // Il tema lo scrive col colore pieno: sotto il velo della selezione la sintassi spenta non regge 4.5:1.
  it('segna ogni intervallo selezionato non vuoto, e nient\'altro', () => {
    const state = EditorState.create({
      doc: '{ "a": 1, "b": 2 }',
      selection: EditorSelection.create([EditorSelection.range(2, 5), EditorSelection.cursor(8), EditorSelection.range(10, 13)]),
      extensions: EditorState.allowMultipleSelections.of(true),
    });
    const marks: { from: number; to: number; className: unknown }[] = [];
    selectedTextDecorations(state).between(0, state.doc.length, (from, to, deco) => {
      marks.push({ from, to, className: deco.spec['class'] });
    });
    expect(marks).toEqual([
      { from: 2, to: 5, className: 'cm-selectedText' },
      { from: 10, to: 13, className: 'cm-selectedText' },
    ]);
  });

  it('senza selezione nessun segno', () => {
    const state = EditorState.create({ doc: 'abc' });
    expect(selectedTextDecorations(state).size).toBe(0);
  });
});

// I testi di CodeMirror seguono la lingua dell'app: senza, l'editor restava in inglese.
describe('testi di CodeMirror tradotti', () => {
  it('ogni frase mappata ha la sua traduzione, in italiano e in inglese', () => {
    for (const dict of [itDict.codeEditor, enDict.codeEditor] as Record<string, string>[]) {
      for (const key of Object.values(EDITOR_PHRASE_KEYS)) {
        expect(dict[key], key).toBeTruthy();
      }
    }
  });

  it('lo stato restituisce la frase tradotta, e una frase sconosciuta resta com\'e\'', () => {
    const state = EditorState.create({ extensions: editorPhrases(itDict.codeEditor) });
    expect(state.phrase('Find')).toBe('Cerca');
    expect(state.phrase('replaced $ matches', 3)).toBe('sostituite 3 corrispondenze');
    expect(state.phrase('Frase nuova')).toBe('Frase nuova');
  });

  it('il pannello di ricerca montato non mostra piu\' testi inglesi', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new EditorView({ state: EditorState.create({ doc: '{}', extensions: [...staticExtensions, editorPhrases(itDict.codeEditor)] }), parent });
    try {
      openSearchPanel(view);
      const panel = parent.querySelector('.cm-search') as HTMLElement;
      const placeholders = Array.from(panel.querySelectorAll('input[placeholder]')).map((input) => input.getAttribute('placeholder'));
      const labels = Array.from(panel.querySelectorAll('button, label')).map((el) => (el.textContent ?? '').trim()).filter(Boolean);
      expect(placeholders).toEqual(['Cerca', 'Sostituisci con']);
      expect(labels).toEqual(['successivo', 'precedente', 'tutti', 'maiuscole', 'regex', 'parola intera', 'sostituisci', 'sostituisci tutti', '×']);
      expect(panel.querySelector('button[name="close"]')?.getAttribute('aria-label')).toBe('chiudi');
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
