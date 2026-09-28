import '@angular/compiler';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MocksNextDetail } from './mocks-next-detail';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { MocksStore } from '../mocks-next.store';
import type { DraftSave } from '../mocks-next.store';
import type { MockDetail, ResponseVariantRead, RevisionConflict } from '../../../mock-admin-api.types';

function detail(overrides: Partial<MockDetail> = {}): MockDetail {
  return {
    id: 'e1',
    type: 'mock',
    method: 'GET',
    path: '/api/operazioni',
    status: 200,
    disabled: false,
    configFilePath: 'operazioni/GET.endpoint.json',
    editable: true,
    selectedResponseFile: '001.response.json',
    responses: [{ fileName: '001.response.json', type: 'mock', title: 'Ok', selected: true }],
    endpoint: {
      method: 'GET',
      path: '/api/operazioni',
      enabled: true,
      responseFiles: ['001.response.json'],
      selectedResponseFile: '001.response.json',
    },
    config: { method: 'GET', path: '/api/operazioni', status: 200, disabled: false, headers: {}, delayMs: 0 },
    body: { ok: true },
    ...overrides,
  };
}

describe('MocksNextDetail', () => {
  let store: {
    selected: ReturnType<typeof signal<MockDetail | undefined>>;
    detailUnavailable: ReturnType<typeof signal<string | undefined>>;
    detailLoading: ReturnType<typeof signal<boolean>>;
    savingId: ReturnType<typeof signal<string | undefined>>;
    error: ReturnType<typeof signal<string | undefined>>;
    reloadSelectedDetail: ReturnType<typeof vi.fn>;
    collections: ReturnType<typeof signal<{ id: string; label: string }[]>>;
    saveResponse: ReturnType<typeof vi.fn>;
    assignCollection: ReturnType<typeof vi.fn>;
    addResponse: ReturnType<typeof vi.fn>;
    uploadResponseFile: ReturnType<typeof vi.fn>;
    saveDescription: ReturnType<typeof vi.fn>;
    detailReadErrorMessage: ReturnType<typeof vi.fn>;
  };
  let api: { getMock: ReturnType<typeof vi.fn>; getResponse: ReturnType<typeof vi.fn> };

  function create() {
    store = {
      selected: signal<MockDetail | undefined>(detail()),
      detailUnavailable: signal<string | undefined>(undefined),
      detailLoading: signal(false),
      savingId: signal<string | undefined>(undefined),
      error: signal<string | undefined>(undefined),
      reloadSelectedDetail: vi.fn(),
      collections: signal<{ id: string; label: string }[]>([]),
      saveResponse: vi.fn(),
      assignCollection: vi.fn(),
      addResponse: vi.fn(),
      uploadResponseFile: vi.fn(),
      saveDescription: vi.fn(),
      detailReadErrorMessage: vi.fn(() => 'lettura fallita'),
    };
    api = { getMock: vi.fn(), getResponse: vi.fn() };
    TestBed.configureTestingModule({
      imports: [MocksNextDetail, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: MocksStore, useValue: store },
        { provide: MockAdminApiService, useValue: api },
      ],
    });
    const fixture = TestBed.createComponent(MocksNextDetail);
    fixture.detectChanges();
    return fixture;
  }

  // Il flag templated cambia il significato del body che si sta guardando: senza, i segnaposto
  // sono testo letterale. Viveva solo dentro il form di modifica, quindi in vista il body era
  // ambiguo. Il backend lo cancella sulle varianti file-backed: li' il controllo non va mostrato.
  describe('stato Template nella testata del body', () => {
    function chip(fixture: ReturnType<typeof create>): HTMLElement | null {
      return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span')).find(
        (el) => /Template/i.test(el.textContent ?? '') && el.querySelector('ui-switch') != null,
      ) as HTMLElement | undefined ?? null;
    }

    it('compare su una variante mock e riflette il flag', () => {
      const fixture = create();
      expect(chip(fixture)).not.toBeNull();
      expect(chip(fixture)!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('false');

      store.selected.set(detail({ config: { method: 'GET', path: '/api/operazioni', status: 200, disabled: false, headers: {}, delayMs: 0, templated: true } }));
      fixture.detectChanges();
      expect(chip(fixture)!.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
    });

    it('commutarlo manda una PUT parziale, senza toccare il resto della variante', () => {
      const fixture = create();
      (fixture.componentInstance as unknown as { onTemplatedChange(v: boolean): void }).onTemplatedChange(true);

      expect(store.saveResponse).toHaveBeenCalledWith({ type: 'mock', status: 200, templated: true });
    });

    it('non compare su una variante agganciata a un file: li il backend cancella il flag', () => {
      const fixture = create();
      store.selected.set(detail({ payloadType: 'file', fileInfo: { name: 'logo.png' } } as never));
      fixture.detectChanges();

      expect(chip(fixture)).toBeNull();
    });

    it('non compare su handler e middleware, che la risposta la producono da codice', () => {
      const fixture = create();
      for (const type of ['handler', 'middleware'] as const) {
        store.selected.set(detail({ type, source: 'module.exports = {};' }));
        fixture.detectChanges();
        expect(chip(fixture)).toBeNull();
      }
    });

    it('su un endpoint non modificabile lo mostra solo se acceso, e non lo lascia commutare', () => {
      const fixture = create();
      store.selected.set(detail({ editable: false }));
      fixture.detectChanges();
      expect(chip(fixture)).toBeNull();

      store.selected.set(detail({ editable: false, config: { method: 'GET', path: '/api/operazioni', status: 200, disabled: false, headers: {}, delayMs: 0, templated: true } }));
      fixture.detectChanges();
      expect(chip(fixture)).not.toBeNull();
      // Che sia disabilitato si vede dal fatto che non scrive: e' quello che conta.
      chip(fixture)!.querySelector<HTMLElement>('[role="switch"]')!.click();
      expect(store.saveResponse).not.toHaveBeenCalled();
    });
  });

  // Status e delay sono le due cose che si ritoccano di continuo: modificarle qui deve costare una
  // PUT PARZIALE, cosi' il merge del backend lascia intatti body, headers, titolo e flag template.
  describe('status e delay modificabili in posto', () => {
    function statusButton(fixture: ReturnType<typeof create>): HTMLButtonElement {
      return (fixture.nativeElement as HTMLElement).querySelector('mocks-next-status-combobox button')!;
    }
    function delayInput(fixture: ReturnType<typeof create>): HTMLInputElement | null {
      return (fixture.nativeElement as HTMLElement).querySelector('input[type="number"]');
    }

    it('cambiare lo status manda solo tipo e status', () => {
      const fixture = create();
      (fixture.componentInstance as unknown as { onStatusChange(s: number | null): void }).onStatusChange(500);

      expect(store.saveResponse).toHaveBeenCalledTimes(1);
      expect(store.saveResponse).toHaveBeenCalledWith({ type: 'mock', status: 500 });
    });

    it('cambiare il delay rispedisce lo status corrente, che il tipo della richiesta esige', () => {
      const fixture = create();
      (fixture.componentInstance as unknown as { onDelayChange(v: string): void }).onDelayChange('250');

      expect(store.saveResponse).toHaveBeenCalledWith({ type: 'mock', status: 200, delayMs: 250 });
    });

    it('non manda nulla per un valore uguale a quello corrente o non valido', () => {
      const fixture = create();
      const api = fixture.componentInstance as unknown as {
        onStatusChange(s: number | null): void;
        onDelayChange(v: string): void;
      };

      api.onStatusChange(200);
      api.onStatusChange(null);
      api.onDelayChange('0');
      api.onDelayChange('-5');
      api.onDelayChange('abc');

      expect(store.saveResponse).not.toHaveBeenCalled();
    });

    it('un handler non offre i controlli in posto: non ha uno status suo da riscrivere', () => {
      const fixture = create();
      store.selected.set(detail({ type: 'handler', source: 'module.exports = {};' }));
      fixture.detectChanges();

      expect(delayInput(fixture)).toBeNull();
      expect(statusButton(fixture)?.getAttribute('aria-disabled') ?? 'assente').toBeDefined();
    });

    it('un endpoint non modificabile li mostra in sola lettura', () => {
      const fixture = create();
      store.selected.set(detail({ editable: false }));
      fixture.detectChanges();

      expect(delayInput(fixture)).toBeNull();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('delay');
    });
  });

  // Creare una variante senza attivarla (piano agent/API, §13 C3): la risposta servita non cambia.
  describe('nuova response: Attiva subito', () => {
    it('di default attiva la variante creata, come prima', () => {
      const fixture = create();
      const c = fixture.componentInstance as any;
      c.createResponseOfType('mock');
      c.saveEditResponse();
      expect(store.addResponse).toHaveBeenCalledTimes(1);
      expect(store.addResponse.mock.calls[0][0]).not.toHaveProperty('select');
    });

    it('senza spunta prepara la variante con select false', () => {
      const fixture = create();
      const c = fixture.componentInstance as any;
      c.createResponseOfType('mock');
      c.activateNewResponse.set(false);
      c.saveEditResponse();
      expect(store.addResponse).toHaveBeenCalledWith(expect.objectContaining({ type: 'mock', select: false }), expect.any(Function));
    });

    it('in modalità file carica il file sulla variante creata, non su quella selezionata', () => {
      const fixture = create();
      const c = fixture.componentInstance as any;
      c.createResponseOfType('mock');
      c.activateNewResponse.set(false);
      c.draft.payloadType.set('file');
      const file = new File(['x'], 'logo.png', { type: 'image/png' });
      c.draft.file.set(file);
      store.addResponse.mockImplementation((_payload: unknown, onSuccess: (created?: string) => void) => onSuccess('002.response.json'));
      c.saveEditResponse();
      expect(store.uploadResponseFile).toHaveBeenCalledWith(file, expect.any(Function), '002.response.json');
    });

    it('senza filename creato una variante preparata non riceve l’upload e l’errore è esplicito', () => {
      const fixture = create();
      const c = fixture.componentInstance as any;
      c.createResponseOfType('mock');
      c.activateNewResponse.set(false);
      c.draft.payloadType.set('file');
      c.draft.file.set(new File(['x'], 'logo.png', { type: 'image/png' }));
      store.addResponse.mockImplementation((_payload: unknown, onSuccess: (created?: string) => void) => onSuccess(undefined));
      c.saveEditResponse();
      expect(store.uploadResponseFile).not.toHaveBeenCalled();
      expect(store.error()).toContain('carica il file dalla variante');
    });

    it('riaprendo il form l’opzione torna attiva', () => {
      const fixture = create();
      const c = fixture.componentInstance as any;
      c.createResponseOfType('mock');
      c.activateNewResponse.set(false);
      c.createResponseOfType('mock');
      expect(c.activateNewResponse()).toBe(true);
    });
  });

  // Piano agent/API, §13 C4: ogni bozza tiene endpoint, variante e revisione dell'apertura. Al
  // conflitto il testo resta, e l'utente sceglie fra confronto, ricarica e la propria versione.
  describe('bozze protette da revisione', () => {
    const REV_A = `rev-v1:${'a'.repeat(64)}`;
    const REV_B = `rev-v1:${'b'.repeat(64)}`;
    const CONFLICT: RevisionConflict = {
      code: 'REVISION_CONFLICT',
      resource: { kind: 'response', endpointId: 'e1', responseFile: '001.response.json' },
      expectedRevision: REV_A,
      currentRevision: REV_B,
    };
    const CURRENT: ResponseVariantRead = {
      id: 'e1',
      responseFile: '001.response.json',
      selected: false,
      active: false,
      response: { type: 'mock', title: 'Ok', status: 201, headers: { 'x-agent': '1' }, body: { fromAgent: true }, delayMs: 0 },
      source: null,
      fileInfo: null,
      revision: REV_B,
    };
    type Detail = {
      startEditResponse(): void;
      saveEditResponse(): void;
      uploadResponseFile(file: File): void;
      startEditDescription(): void;
      saveDescription(): void;
      draftDescription: { (): string; set(v: string): void };
      draft: { body: { (): string; set(v: string): void }; status(): number | null };
      editingResponse(): boolean;
    };

    function editableDetail(overrides: Partial<MockDetail> = {}): MockDetail {
      return detail({
        responseRevision: REV_A,
        descriptionRevision: REV_A,
        responses: [
          { fileName: '001.response.json', type: 'mock', title: 'Ok', selected: true },
          { fileName: '002.response.json', type: 'mock', title: 'Ko' },
        ],
        ...overrides,
      });
    }

    function button(fixture: ReturnType<typeof create>, label: string): HTMLButtonElement {
      fixture.detectChanges();
      const found = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(
        (el) => el.textContent?.trim() === label,
      );
      if (!found) throw new Error(`pulsante ${label} assente`);
      return found as HTMLButtonElement;
    }

    function lastDraft(mock: ReturnType<typeof vi.fn>): DraftSave {
      return mock.mock.calls.at(-1)![2] as DraftSave;
    }

    function openConflict() {
      const fixture = create();
      store.selected.set(editableDetail());
      fixture.detectChanges();
      const c = fixture.componentInstance as unknown as Detail;
      c.startEditResponse();
      c.draft.body.set('{"mine":true}');
      store.saveResponse.mockImplementationOnce((_payload: unknown, _ok: unknown, draft: DraftSave) => draft.onConflict!(CONFLICT));
      c.saveEditResponse();
      fixture.detectChanges();
      return { fixture, c };
    }

    it('la bozza della variante resta sulla variante aperta mentre l’agent ne attiva un’altra', () => {
      const fixture = create();
      store.selected.set(editableDetail());
      fixture.detectChanges();
      const c = fixture.componentInstance as unknown as Detail;
      c.startEditResponse();
      c.draft.body.set('{"mine":true}');

      store.selected.set(editableDetail({ selectedResponseFile: '002.response.json', responseRevision: REV_B }));
      fixture.detectChanges();
      c.saveEditResponse();

      expect(store.saveResponse).toHaveBeenCalledWith(
        expect.objectContaining({ body: { mine: true } }),
        expect.any(Function),
        expect.objectContaining({ target: { endpointId: 'e1', responseFile: '001.response.json', baseRevision: REV_A } }),
      );
    });

    it('al conflitto conserva il testo, mostra il pannello e gli passa il focus', () => {
      const { fixture, c } = openConflict();
      const panel = (fixture.nativeElement as HTMLElement).querySelector('mocks-next-draft-conflict section');

      expect(c.editingResponse()).toBe(true);
      expect(c.draft.body()).toBe('{"mine":true}');
      expect(panel?.textContent).toContain('La versione è cambiata mentre la modificavi');
      expect(document.activeElement).toBe(panel);
    });

    it('«Confronta» mostra la versione corrente accanto; «Salva la mia versione» usa la sua revisione', () => {
      const { fixture, c } = openConflict();
      api.getResponse.mockReturnValue(of(CURRENT));

      button(fixture, 'Confronta').click();
      fixture.detectChanges();

      expect(api.getResponse).toHaveBeenCalledWith('e1', '001.response.json');
      expect((fixture.nativeElement as HTMLElement).querySelector('mocks-next-draft-conflict ui-code')?.textContent).toContain('fromAgent');
      expect(c.draft.body()).toBe('{"mine":true}');

      button(fixture, 'Salva la mia versione').click();

      expect(store.saveResponse).toHaveBeenCalledTimes(2);
      expect(store.saveResponse.mock.calls[1][0]).toEqual(expect.objectContaining({ body: { mine: true } }));
      expect(lastDraft(store.saveResponse).target).toEqual({ endpointId: 'e1', responseFile: '001.response.json', baseRevision: REV_B });
    });

    it('«Ricarica» chiede conferma su una bozza modificata, poi la sostituisce e ne sposta la base', () => {
      const { fixture, c } = openConflict();
      api.getResponse.mockReturnValue(of(CURRENT));

      button(fixture, 'Ricarica').click();
      fixture.detectChanges();
      expect(api.getResponse).not.toHaveBeenCalled();
      expect(document.activeElement?.textContent?.trim()).toBe('Sostituisci');

      button(fixture, 'Sostituisci').click();
      fixture.detectChanges();

      expect(JSON.parse(c.draft.body())).toEqual({ fromAgent: true });
      expect(c.draft.status()).toBe(201);
      c.saveEditResponse();
      expect(lastDraft(store.saveResponse).target.baseRevision).toBe(REV_B);
    });

    it('annullando la ricarica la bozza resta e il focus torna su «Ricarica»', () => {
      const { fixture, c } = openConflict();

      button(fixture, 'Ricarica').click();
      button(fixture, 'Tieni la bozza').click();
      fixture.detectChanges();

      expect(c.draft.body()).toBe('{"mine":true}');
      expect(document.activeElement?.textContent?.trim()).toBe('Ricarica');
    });

    it('con la variante sparita il testo resta copiabile e il salvataggio è disabilitato', () => {
      const fixture = create();
      store.selected.set(editableDetail());
      fixture.detectChanges();
      const c = fixture.componentInstance as unknown as Detail;
      c.startEditResponse();
      c.draft.body.set('{"mine":true}');
      store.saveResponse.mockImplementationOnce((_payload: unknown, _ok: unknown, draft: DraftSave) => draft.onMissing!());
      c.saveEditResponse();

      expect(button(fixture, 'Salva').disabled).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Questa risorsa non esiste più');
      expect(c.draft.body()).toBe('{"mine":true}');
      c.saveEditResponse();
      expect(store.saveResponse).toHaveBeenCalledTimes(1);
    });

    it('l’upload in modifica va sulla variante della bozza con la sua revisione', () => {
      const fixture = create();
      store.selected.set(editableDetail({ payloadType: 'file', fileInfo: { name: 'logo.png' } } as never));
      fixture.detectChanges();
      const c = fixture.componentInstance as unknown as Detail;
      c.startEditResponse();
      const file = new File(['x'], 'nuovo.png');

      c.uploadResponseFile(file);

      expect(store.uploadResponseFile).toHaveBeenCalledWith(
        file,
        expect.any(Function),
        undefined,
        expect.objectContaining({ target: { endpointId: 'e1', responseFile: '001.response.json', baseRevision: REV_A } }),
      );
    });

    it('la descrizione salva con la sua revisione e al conflitto confronta la versione corrente', () => {
      const fixture = create();
      store.selected.set(editableDetail());
      fixture.detectChanges();
      const c = fixture.componentInstance as unknown as Detail;
      c.startEditDescription();
      c.draftDescription.set('mia');
      store.saveDescription.mockImplementationOnce((_text: unknown, _ok: unknown, draft: DraftSave) =>
        draft.onConflict!({ ...CONFLICT, resource: { kind: 'description', endpointId: 'e1' } }));

      c.saveDescription();
      expect(store.saveDescription).toHaveBeenCalledWith('mia', expect.any(Function), expect.objectContaining({
        target: { endpointId: 'e1', responseFile: null, baseRevision: REV_A },
      }));

      api.getMock.mockReturnValue(of(editableDetail({
        descriptionRevision: REV_B,
        endpoint: { ...editableDetail().endpoint!, description: 'dell’agent' },
      })));
      button(fixture, 'Confronta').click();
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('mocks-next-draft-conflict ui-code')?.textContent).toContain('dell’agent');
      expect(c.draftDescription()).toBe('mia');

      button(fixture, 'Salva la mia versione').click();
      expect(store.saveDescription).toHaveBeenLastCalledWith('mia', expect.any(Function), expect.objectContaining({
        target: { endpointId: 'e1', responseFile: null, baseRevision: REV_B },
      }));
    });
  });

  it('con dettaglio leggibile mostra l’endpoint', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('/api/operazioni');
  });

  it('mostra la sorgente di un handler con il linguaggio JavaScript', () => {
    const fixture = create();
    store.selected.set(
      detail({
        type: 'handler',
        source: 'module.exports = { async resolveResponse() { return { status: 200 }; } };',
      }),
    );
    fixture.detectChanges();

    const code = fixture.debugElement.query(By.css('ui-code'));
    expect(code).not.toBeNull();
    expect(code.componentInstance.language()).toBe('javascript');
    expect(code.nativeElement.querySelector('[style*="--json-key"]')).not.toBeNull();
  });

  // Il pannello non deve mostrare il dettaglio precedente dopo una mutazione riuscita di cui non
  // si riesce a leggere l'esito: al suo posto dichiara l'illeggibilità e offre di rileggere.
  it('con dettaglio non componibile sostituisce il pannello, mostra il motivo e offre la rilettura', () => {
    const fixture = create();
    store.detailUnavailable.set('Invalid JSON in /mocks/operazioni/GET.responses/002.response.json');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Invalid JSON in /mocks/operazioni/GET.responses/002.response.json');
    expect(root.textContent).not.toContain('/api/operazioni');

    const retry = Array.from(root.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Rileggi'),
    );
    expect(retry).toBeTruthy();
    retry?.click();
    expect(store.reloadSelectedDetail).toHaveBeenCalledTimes(1);
  });

  it('una variante illeggibile è elencata come tale e non è selezionabile', () => {
    const fixture = create();
    store.selected.set(
      detail({
        responses: [
          { fileName: '001.response.json', type: 'mock', title: 'Ok', selected: true },
          { fileName: '002.response.json', invalid: true, error: 'Invalid JSON in 002.response.json' },
        ],
      }),
    );
    fixture.detectChanges();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (fixture.componentInstance as any).responseOptions();
    expect(options[1]).toMatchObject({ value: '002.response.json', disabled: true });
    expect(options[1].label).toContain('non leggibile');
  });
});
