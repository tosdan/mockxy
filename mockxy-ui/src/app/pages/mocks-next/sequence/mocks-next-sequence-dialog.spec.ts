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
import type { MockDetail, SequenceVariantConfig } from '../../../mock-admin-api.types';

const EXISTING_SEQUENCE: SequenceVariantConfig = {
  steps: [
    { response: '001.response.json', times: 2 },
    { response: '002.response.json', forMs: 500 },
  ],
  onEnd: 'loop',
  resetAfterMs: 30000,
};

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
  };
  let api: {
    getSequenceState: ReturnType<typeof vi.fn>;
    resetSequence: ReturnType<typeof vi.fn>;
  };
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  function create(detail: MockDetail, mode: SequenceDialogData['mode']) {
    store = {
      savingId: signal<string | undefined>(undefined),
      error: signal<string | undefined>(undefined),
      createSequence: vi.fn(),
      updateSequence: vi.fn(),
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
    );
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
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('se il reset fallisce conserva lo snapshot e mostra un errore', () => {
    const { c } = create(editDetail(), 'edit');
    api.resetSequence.mockReturnValueOnce(throwError(() => new Error('boom')));
    c.resetSequence();
    expect(c.sequenceState().stepIndex).toBe(1);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
  });
});
