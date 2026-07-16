import { ResponseDraft } from './response-draft';
import { JSON_CONTENT_TYPE, RESPONSE_PRESETS } from '../response-presets';
import { scriptTemplate } from '../script-templates';

describe('ResponseDraft', () => {
  let draft: ResponseDraft;

  beforeEach(() => {
    draft = new ResponseDraft();
  });

  describe('validazione body', () => {
    it('segnala JSON non valido solo in modalità json e per i mock', () => {
      draft.body.set('{oops');
      expect(draft.bodyInvalid()).toBe(true);
      draft.payloadType.set('text');
      expect(draft.bodyInvalid()).toBe(false);
      draft.payloadType.set('json');
      draft.scriptType.set('handler');
      expect(draft.bodyInvalid()).toBe(false);
    });
  });

  describe('seed', () => {
    it('seedForCreate mock: body JSON di partenza con content-type esplicito', () => {
      draft.seedForCreate('mock');
      expect(draft.isScript()).toBe(false);
      expect(draft.headers()).toEqual([{ key: 'content-type', value: 'application/json; charset=utf-8' }]);
      expect(draft.bodyInvalid()).toBe(false);
    });

    it('seedForCreate script: template del tipo scelto, o sorgente seminata', () => {
      draft.seedForCreate('middleware');
      expect(draft.scriptType()).toBe('middleware');
      expect(draft.body()).toBe(scriptTemplate('middleware'));
      draft.seedForCreate('handler', 'module.exports = {};');
      expect(draft.body()).toBe('module.exports = {};');
    });

    it('seedForEdit ripristina i campi e azzera file/preset in sospeso', () => {
      draft.file.set(new File(['x'], 'x.bin'));
      draft.pendingPreset.set(RESPONSE_PRESETS[0]);
      draft.seedForEdit({ title: 't', status: 418, delay: 5, headers: [], payloadType: 'text', body: 'ciao', scriptType: null });
      expect(draft.title()).toBe('t');
      expect(draft.status()).toBe(418);
      expect(draft.file()).toBeNull();
      expect(draft.pendingPreset()).toBeNull();
    });
  });

  describe('formato body e content-type', () => {
    it('passando a Testo aggiorna il content-type di default, senza calpestare uno custom', () => {
      draft.seedForCreate('mock');
      draft.setBodyFormat('text');
      expect(draft.headers()[0].value).toBe('text/plain; charset=utf-8');
      draft.setHeaderValue(0, 'application/xml');
      draft.setBodyFormat('json');
      expect(draft.headers()[0].value).toBe('application/xml');
    });

    it('aggiunge il content-type se manca; il formato File non lo tocca', () => {
      draft.setBodyFormat('json');
      expect(draft.headers()).toEqual([{ key: 'content-type', value: 'application/json; charset=utf-8' }]);
      draft.headers.set([]);
      draft.setBodyFormat('file');
      expect(draft.headers()).toEqual([]);
    });
  });

  describe('preset', () => {
    it('applica subito il preset su un body di default, chiede conferma su un body reale', () => {
      const preset = RESPONSE_PRESETS[0];
      draft.seedForCreate('mock');
      draft.choosePreset(preset);
      expect(draft.status()).toBe(preset.status);
      expect(draft.pendingPreset()).toBeNull();
      expect(draft.headers().some((h) => h.value === JSON_CONTENT_TYPE)).toBe(true);

      draft.body.set('{"dati":"veri"}');
      const altro = RESPONSE_PRESETS[1];
      draft.choosePreset(altro);
      expect(draft.pendingPreset()).toBe(altro);
      draft.applyPendingPreset();
      expect(draft.status()).toBe(altro.status);
      expect(draft.pendingPreset()).toBeNull();
    });
  });

  describe('payload verso l\'API', () => {
    it('update mock json: oggetto completo con body parsato e header senza chiavi vuote', () => {
      draft.seedForEdit({
        title: ' ok ',
        status: 201,
        delay: 7,
        headers: [{ key: 'x-a', value: '1' }, { key: '  ', value: 'scartato' }],
        payloadType: 'json',
        body: '{"a":1}',
        scriptType: null,
      });
      expect(draft.buildUpdatePayload()).toEqual({ type: 'mock', title: 'ok', status: 201, headers: { 'x-a': '1' }, delayMs: 7, body: { a: 1 }, templated: false });
    });

    it('update con JSON rotto → null (il salvataggio non parte)', () => {
      draft.body.set('{rotto');
      expect(draft.buildUpdatePayload()).toBeNull();
      expect(draft.buildCreatePayload()).toBeNull();
    });

    it('update script: solo tipo, titolo e sorgente', () => {
      draft.seedForEdit({ title: 'h', status: null, delay: 0, headers: [], payloadType: 'json', body: 'src', scriptType: 'handler' });
      expect(draft.buildUpdatePayload()).toEqual({ type: 'handler', title: 'h', source: 'src' });
    });

    it('update file-mode: solo metadati, nessun body', () => {
      draft.seedForEdit({ title: 'f', status: 200, delay: 0, headers: [], payloadType: 'file', body: '', scriptType: null });
      expect(draft.buildUpdatePayload()).toEqual({ type: 'mock', title: 'f', status: 200, headers: {}, delayMs: 0 });
    });

    it('create file-mode: body segnaposto vuoto (il file arriva con l\'upload successivo)', () => {
      draft.seedForEdit({ title: 'f', status: 200, delay: 0, headers: [], payloadType: 'file', body: '', scriptType: null });
      expect(draft.buildCreatePayload()).toEqual({ type: 'mock', title: 'f', status: 200, headers: {}, delayMs: 0, body: {} });
    });

    it('update testo: il body resta stringa grezza', () => {
      draft.seedForEdit({ title: 't', status: 200, delay: 0, headers: [], payloadType: 'text', body: 'non json {', scriptType: null });
      expect(draft.buildUpdatePayload()).toEqual({ type: 'mock', title: 't', status: 200, headers: {}, delayMs: 0, body: 'non json {', templated: false });
    });

    it('templated: seminato dalla response, incluso nel payload; mai in modalità file', () => {
      draft.seedForEdit({ title: '', status: 200, delay: 0, headers: [], payloadType: 'json', body: '{}', scriptType: null, templated: true });
      expect(draft.templated()).toBe(true);
      expect(draft.buildUpdatePayload()).toEqual(expect.objectContaining({ templated: true }));
      expect(draft.buildCreatePayload()).toEqual(expect.objectContaining({ templated: true }));

      // File-mode: il campo non parte (i payload file non si templano).
      draft.seedForEdit({ title: '', status: 200, delay: 0, headers: [], payloadType: 'file', body: '', scriptType: null, templated: true });
      expect(draft.buildUpdatePayload()).not.toHaveProperty('templated');
    });

    it('templated: seedForCreate riparte spento', () => {
      draft.templated.set(true);
      draft.seedForCreate('mock');
      expect(draft.templated()).toBe(false);
    });
  });
});
