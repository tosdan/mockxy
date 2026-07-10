import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { languageExtension, sizeTheme, jsonLinterExtension } from './cm-setup';
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
