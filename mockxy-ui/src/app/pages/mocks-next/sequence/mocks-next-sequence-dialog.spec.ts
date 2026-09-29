import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { of, throwError } from 'rxjs';
import { MocksNextSequenceDialog, type SequenceDialogData } from './mocks-next-sequence-dialog';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { MocksStore } from '../mocks-next.store';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import type { DraftSave } from '../mocks-next.store';
import type { MockDetail, ResponseVariantRead, SequenceVariantConfig } from '../../../mock-admin-api.types';

const EXISTING_SEQUENCE: SequenceVariantConfig = {
  steps: [
    { response: '001.response.json', times: 2 },
    { response: '002.response.json', forMs: 500 },
  ],
  onEnd: 'loop',
  resetAfterMs: 30000,
};
const REV_SEQ = `rev-v1:${'a'.repeat(64)}`;
/** Bersaglio della bozza in modifica: la variante aperta con la revisione letta. */
const SEQ_DRAFT = expect.objectContaining({
  target: { endpointId: 'id-1', responseFile: '004.response.json', baseRevision: REV_SEQ },
});

function detailWith(overrides: Partial<MockDetail> = {}): MockDetail {
  return {
    id: 'id-1',
    type: 'mock',
    method: 'GET',
    path: '/api/operazioni',
    status: 202,
    disabled: false,
    configFilePath: 'operazioni/GET.endpoint.json',
    editable: true,
    selectedResponseFile: '001.response.json',
    responses: [
      { fileName: '001.response.json', type: 'mock', title: 'Processing' },
      { fileName: '002.response.json', type: 'handler', title: 'Completed' },
      { fileName: '003.response.json', type: 'middleware', title: 'Mw' },
      { fileName: '004.response.json', type: 'sequence', title: 'Existing sequence' },
      { fileName: '005.response.json', type: 'sse', title: 'Stream' },
    ],
    endpoint: {
      method: 'GET',
      path: '/api/operazioni',
      enabled: true,
      responseFiles: [
        '001.response.json',
        '002.response.json',
        '003.response.json',
        '004.response.json',
        '005.response.json',
      ],
      selectedResponseFile: '001.response.json',
    },
    ...overrides,
  };
}

function editDetail(overrides: Partial<MockDetail> = {}): MockDetail {
  return detailWith({
    type: 'sequence',
    status: null,
    payloadType: 'none',
    selectedResponseFile: '004.response.json',
    sequence: EXISTING_SEQUENCE,
    sequenceState: { stepIndex: 1, servedInStep: 3, stepStartedAt: 1, lastRequestAt: 2 },
    responseRevision: REV_SEQ,
    endpoint: {
      ...detailWith().endpoint!,
      selectedResponseFile: '004.response.json',
    },
    ...overrides,
  });
}

describe('MocksNextSequenceDialog', () => {
  let store: {
    savingId: ReturnType<typeof signal<string | undefined>>;
    error: ReturnType<typeof signal<string | undefined>>;
    createSequence: ReturnType<typeof vi.fn>;
    updateSequence: ReturnType<typeof vi.fn>;
    detailReadErrorMessage: ReturnType<typeof vi.fn>;
    selected: ReturnType<typeof signal<MockDetail | undefined>>;
    selectedGone: ReturnType<typeof signal<boolean>>;
    staleWorkspace: ReturnType<typeof signal<boolean>>;
    syncTick: ReturnType<typeof signal<number>>;
  };
  let api: {
    getSequenceState: ReturnType<typeof vi.fn>;
    resetSequence: ReturnType<typeof vi.fn>;
    getResponse: ReturnType<typeof vi.fn>;
  };
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  function create(detail: MockDetail, mode: SequenceDialogData['mode'], setup?: (s: typeof store) => void) {
    store = {
      savingId: signal<string | undefined>(undefined),
      error: signal<string | undefined>(undefined),
      createSequence: vi.fn(),
      updateSequence: vi.fn(),
      detailReadErrorMessage: vi.fn(() => 'lettura fallita'),
      // Il dialog si apre sul dettaglio appena riletto dallo store: stessa versione.
      selected: signal<MockDetail | undefined>(detail),
      selectedGone: signal(false),
      staleWorkspace: signal(false),
      syncTick: signal(0),
    };
    const initialState = detail.sequenceState ?? {
      stepIndex: 0,
      servedInStep: 0,
      stepStartedAt: null,
      lastRequestAt: null,
    };
    api = {
      getSequenceState: vi.fn(() => of({ sequenceFile: detail.selectedResponseFile ?? '', sequenceState: initialState })),
      resetSequence: vi.fn(() => of({
        sequenceFile: detail.selectedResponseFile ?? '',
        sequenceState: { stepIndex: 0, servedInStep: 0, stepStartedAt: null, lastRequestAt: null },
      })),
      getResponse: vi.fn(),
    };
    toast = { show: vi.fn(), dismiss: vi.fn() };
    dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [MocksNextSequenceDialog, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: MocksStore, useValue: store },
        { provide: MockAdminApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: DialogRef, useValue: dialogRef },
        { provide: DIALOG_DATA, useValue: { detail, mode } satisfies SequenceDialogData },
      ],
    });
    setup?.(store);
    const fixture = TestBed.createComponent(MocksNextSequenceDialog);
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, c: fixture.componentInstance as any };
  }

  it('in creazione propone titolo vuoto, reset iniziale e i primi due target eleggibili', () => {
    const { c } = create(detailWith(), 'create');
    expect(c.title()).toBe('');
    expect(c.onEnd()).toBe('stay');
    expect(c.resetAfterMs()).toBe('30000');
    expect(c.steps()).toEqual([
      { response: '001.response.json', mode: 'times', value: '3' },
      { response: '002.response.json', mode: 'times', value: '' },
    ]);
    expect(c.variantOptions.map((option: { value: string }) => option.value)).toEqual([
      '001.response.json',
      '002.response.json',
    ]);
  });

  it('espone nomi accessibili per i controlli ripetuti degli step', () => {
    const { fixture } = create(detailWith(), 'create');
    const root = fixture.nativeElement as HTMLElement;
    const responseSelectors = root.querySelectorAll('ui-select button[role="combobox"]');
    expect(responseSelectors[0].getAttribute('aria-label')).toBe('Response dello step 1');
    expect(responseSelectors[1].getAttribute('aria-label')).toBe('Response dello step 2');
    expect(root.querySelector('ui-toggle-group')?.getAttribute('aria-label')).toBe('Alla fine');
    expect(root.querySelector('button[aria-label="Sposta su"]')).not.toBeNull();
    expect(root.querySelector('button[aria-label="Elimina step"]')).not.toBeNull();
  });

  it('in modifica conserva criteri times e forMs distinti per step', () => {
    const { c } = create(editDetail(), 'edit');
    expect(c.title()).toBe('Existing sequence');
    expect(c.steps()).toEqual([
      { response: '001.response.json', mode: 'times', value: '2' },
      { response: '002.response.json', mode: 'forMs', value: '500' },
    ]);
    expect(c.canSave()).toBe(false);
    c.setStepValue(1, '750');
    expect(c.canSave()).toBe(true);
  });

  it('cambiare il criterio di uno step non modifica gli altri', () => {
    const { c } = create(editDetail(), 'edit');
    c.setStepMode(0, 'forMs');
    expect(c.steps()).toEqual([
      { response: '001.response.json', mode: 'forMs', value: '15000' },
      { response: '002.response.json', mode: 'forMs', value: '500' },
    ]);
  });

  it('con meno di due target mock/handler la bozza non è salvabile', () => {
    const detail = detailWith({ responses: [{ fileName: '001.response.json', type: 'mock', title: '' }] });
    const { c } = create(detail, 'create');
    expect(c.hasEnoughVariants).toBe(false);
    expect(c.validationError()).toBe('sequenceDialog.errMinVariants');
    expect(c.canSave()).toBe(false);
  });

  it('valida criterio e auto-reset', () => {
    const { c } = create(detailWith(), 'create');
    c.setStepValue(0, '');
    expect(c.validationError()).toBe('sequenceDialog.errStepValue');
    c.setStepValue(0, '3');
    c.resetAfterMs.set('0');
    expect(c.validationError()).toBe('sequenceDialog.errAutoReset');
  });

  it('passando a loop assegna un criterio anche all’ultimo step', () => {
    const { c } = create(detailWith(), 'create');
    c.setOnEnd('loop');
    expect(c.isTerminalStep(1)).toBe(false);
    expect(c.steps()[1]).toEqual({ response: '002.response.json', mode: 'times', value: '3' });
    expect(c.validationError()).toBeNull();
  });

  it('in creazione invia una response sequence senza enabled', () => {
    const { c } = create(detailWith(), 'create');
    store.createSequence.mockImplementation((_sequence: unknown, onSuccess: () => void) => onSuccess());
    c.title.set('Polling');
    c.save();
    expect(store.createSequence).toHaveBeenCalledWith(
      {
        type: 'sequence',
        title: 'Polling',
        steps: [{ response: '001.response.json', times: 3 }, { response: '002.response.json' }],
        onEnd: 'stay',
        resetAfterMs: 30000,
      },
      expect.any(Function),
    );
    expect(dialogRef.close).toHaveBeenCalledWith('saved');
  });

  it('in creazione senza «Attiva subito» prepara la sequence con select false', () => {
    const { c } = create(detailWith(), 'create');
    store.createSequence.mockImplementation((_sequence: unknown, onSuccess: () => void) => onSuccess());
    c.title.set('Alternativa');
    c.activateNow.set(false);
    c.save();
    expect(store.createSequence).toHaveBeenCalledWith(expect.objectContaining({ type: 'sequence', title: 'Alternativa', select: false }), expect.any(Function));
    expect(dialogRef.close).toHaveBeenCalledWith('saved');
  });

  it('in modifica usa la rotta della response e mantiene il criterio misto', () => {
    const { c } = create(editDetail(), 'edit');
    store.updateSequence.mockImplementation((_sequence: unknown, onSuccess: () => void) => onSuccess());
    c.title.set('Polling v2');
    c.save();
    expect(store.updateSequence).toHaveBeenCalledWith(
      {
        type: 'sequence',
        title: 'Polling v2',
        steps: [
          { response: '001.response.json', times: 2 },
          { response: '002.response.json', forMs: 500 },
        ],
        onEnd: 'loop',
        resetAfterMs: 30000,
      },
      expect.any(Function),
      SEQ_DRAFT,
    );
  });

  it('conserva il criterio legale dell’ultimo step con onEnd stay invece di scartarlo', () => {
    // Combinazione ammessa dal formato (il criterio è inerte a runtime, non lo si mostra):
    // aprendo il dialog non deve risultare già modificato, e il Save non deve perderlo.
    const detail = editDetail({
      sequence: {
        steps: [
          { response: '001.response.json', times: 2 },
          { response: '002.response.json', times: 3 },
        ],
        onEnd: 'stay',
        resetAfterMs: 30000,
      },
    });
    const { c } = create(detail, 'edit');

    expect(c.isTerminalStep(1)).toBe(true);
    expect(c.canSave()).toBe(false);

    store.updateSequence.mockImplementation((_sequence: unknown, onSuccess: () => void) => onSuccess());
    c.title.set('Polling v2');
    c.save();
    expect(store.updateSequence).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [
          { response: '001.response.json', times: 2 },
          { response: '002.response.json', times: 3 },
        ],
        onEnd: 'stay',
      }),
      expect.any(Function),
      SEQ_DRAFT,
    );
  });

  // Piano agent/API, §13 C4: la bozza della sequence resta sulla variante aperta, e un conflitto
  // si risolve con un confronto o una ricarica deliberati, mai con un merge automatico.
  describe('conflitto della bozza in modifica', () => {
    const REV_B = `rev-v1:${'b'.repeat(64)}`;
    const CURRENT: ResponseVariantRead = {
      id: 'id-1',
      responseFile: '004.response.json',
      selected: true,
      active: true,
      response: {
        type: 'sequence',
        title: 'Dell’agent',
        steps: [
          { response: '002.response.json', times: 4 },
          { response: '001.response.json', forMs: 900 },
        ],
        onEnd: 'loop',
        resetAfterMs: null,
      },
      source: null,
      fileInfo: null,
      revision: REV_B,
    };

    function conflicted() {
      const created = create(editDetail(), 'edit');
      store.updateSequence.mockImplementationOnce((_sequence: unknown, _ok: unknown, draft: DraftSave) => draft.onConflict!({
        code: 'REVISION_CONFLICT',
        resource: { kind: 'response', endpointId: 'id-1', responseFile: '004.response.json' },
        expectedRevision: REV_SEQ,
        currentRevision: REV_B,
      }));
      created.c.title.set('Mia');
      created.c.save();
      created.fixture.detectChanges();
      return created;
    }

    it('conserva la bozza e salva la propria versione contro la revisione mostrata', () => {
      const { fixture, c } = conflicted();
      expect(dialogRef.close).not.toHaveBeenCalled();
      expect(c.title()).toBe('Mia');
      api.getResponse.mockReturnValue(of(CURRENT));

      c.guard.compare();
      fixture.detectChanges();
      expect(api.getResponse).toHaveBeenCalledWith('id-1', '004.response.json');
      expect((fixture.nativeElement as HTMLElement).querySelector('mocks-next-draft-conflict ui-code')?.textContent).toContain('Dell’agent');
      expect(c.title()).toBe('Mia');

      store.updateSequence.mockImplementation((_sequence: unknown, onSuccess: () => void) => onSuccess());
      c.save(REV_B);
      expect(store.updateSequence).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Mia' }),
        expect.any(Function),
        expect.objectContaining({ target: { endpointId: 'id-1', responseFile: '004.response.json', baseRevision: REV_B } }),
      );
      expect(dialogRef.close).toHaveBeenCalledWith('saved');
    });

    it('«Ricarica» sostituisce bozza e base con la versione corrente', () => {
      const { c } = conflicted();
      api.getResponse.mockReturnValue(of(CURRENT));

      c.guard.confirmReload();

      expect(c.title()).toBe('Dell’agent');
      expect(c.onEnd()).toBe('loop');
      expect(c.resetAfterMs()).toBe('');
      expect(c.steps()).toEqual([
        { response: '002.response.json', mode: 'times', value: '4' },
        { response: '001.response.json', mode: 'forMs', value: '900' },
      ]);
      // Ricaricata, la bozza coincide con la sua nuova base: nulla da salvare finché non cambia.
      expect(c.canSave()).toBe(false);

      c.title.set('Dell’agent, ritoccata');
      c.save();
      expect(store.updateSequence).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.any(Function),
        expect.objectContaining({ target: expect.objectContaining({ baseRevision: REV_B }) }),
      );
    });

    it('una rilettura che trova la sequence cambiata sul server lo segnala, la bozza resta', () => {
      const { fixture, c } = create(editDetail(), 'edit');
      c.title.set('Mia');
      store.selected.set(editDetail({
        responseRevision: REV_B,
        response: { type: 'sequence', title: 'Dell’agent', steps: CURRENT.response['steps'], onEnd: 'loop', resetAfterMs: null },
      }));
      fixture.detectChanges();

      expect(c.guard.remoteChanged()).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('La versione sul server è cambiata');
      expect(c.title()).toBe('Mia');
    });

    it('aperto col workspace cambiato non salva sul bersaglio del precedente', () => {
      const { c } = create(editDetail(), 'edit', (s) => s.staleWorkspace.set(true));
      c.title.set('Mia');
      expect(c.guard.blocked()).toBe(true);
      expect(c.canSave()).toBe(false);
    });

    it('con la variante sparita il salvataggio resta disabilitato', () => {
      const { c } = create(editDetail(), 'edit');
      store.updateSequence.mockImplementationOnce((_sequence: unknown, _ok: unknown, draft: DraftSave) => draft.onMissing!());
      c.title.set('Mia');
      c.save();

      expect(c.canSave()).toBe(false);
      expect(c.title()).toBe('Mia');
    });
  });

  it('un errore del poll di stato non propaga e riporta lo stato a sconosciuto', () => {
    const { c } = create(editDetail(), 'edit');
    expect(c.sequenceState().stepIndex).toBe(1);

    // L'endpoint cambia sotto i piedi (variante deselezionata altrove, backend riavviato):
    // il tick non deve sollevare nel global handler di Angular.
    api.getSequenceState.mockReturnValueOnce(throwError(() => new Error('boom')));
    c.refreshState();

    expect(c.sequenceState()).toBeNull();
    expect(c.stateStepLabel()).toBe('-');
  });

  it('aggiunge, sposta ed elimina step mantenendone criterio e valore', () => {
    const { c } = create(detailWith(), 'create');
    c.addStep();
    expect(c.steps()[1]).toEqual({ response: '002.response.json', mode: 'times', value: '3' });
    c.moveStep(2, -1);
    expect(c.steps()[1]).toEqual({ response: '001.response.json', mode: 'times', value: '' });
    c.removeStep(1);
    expect(c.steps()).toHaveLength(2);
  });

  it('in edit legge lo stato live e il reset aggiorna lo snapshot', () => {
    const { c } = create(editDetail(), 'edit');
    expect(api.getSequenceState).toHaveBeenCalledWith('id-1');
    expect(c.sequenceState().stepIndex).toBe(1);
    c.resetSequence();
    expect(api.resetSequence).toHaveBeenCalledWith('id-1');
    expect(c.sequenceState().stepIndex).toBe(0);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({
      tone: 'success',
      title: expect.stringContaining('runtime'),
    }));
  });

  it('se il reset fallisce conserva lo snapshot e mostra un errore', () => {
    const { c } = create(editDetail(), 'edit');
    api.resetSequence.mockReturnValueOnce(throwError(() => new Error('boom')));
    c.resetSequence();
    expect(c.sequenceState().stepIndex).toBe(1);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
  });
});
