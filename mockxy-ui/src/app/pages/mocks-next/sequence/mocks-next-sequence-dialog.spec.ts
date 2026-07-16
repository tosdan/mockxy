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
import type { MockDetail, SequenceConfig } from '../../../mock-admin-api.types';

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
    responses: [
      { fileName: '001.response.json', type: 'mock', title: 'Processing' },
      { fileName: '002.response.json', type: 'mock', title: 'Completed' },
      { fileName: '003.response.json', type: 'middleware', title: 'Mw' },
    ],
    endpoint: {
      method: 'GET',
      path: '/api/operazioni',
      enabled: true,
      responseFiles: ['001.response.json', '002.response.json', '003.response.json'],
      selectedResponseFile: '001.response.json',
    },
    ...overrides,
  };
}

const EXISTING_SEQUENCE: SequenceConfig = {
  enabled: true,
  steps: [{ response: '001.response.json', times: 2 }, { response: '002.response.json' }],
  onEnd: 'stay',
  resetAfterMs: 30000,
};

describe('MocksNextSequenceDialog', () => {
  let store: { savingId: ReturnType<typeof signal<string | undefined>>; error: ReturnType<typeof signal<string | undefined>>; updateSequence: ReturnType<typeof vi.fn> };
  let api: { resetSequence: ReturnType<typeof vi.fn> };
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  function create(detail: MockDetail) {
    store = { savingId: signal<string | undefined>(undefined), error: signal<string | undefined>(undefined), updateSequence: vi.fn() };
    api = { resetSequence: vi.fn(() => of({ sequenceState: { stepIndex: 0, servedInStep: 0, stepStartedAt: null, lastRequestAt: null } })) };
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
        { provide: DIALOG_DATA, useValue: { detail } satisfies SequenceDialogData },
      ],
    });
    const fixture = TestBed.createComponent(MocksNextSequenceDialog);
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, c: fixture.componentInstance as any };
  }

  it('senza sequenza esistente: bozza attiva precompilata con le prime due varianti eleggibili', () => {
    const { c } = create(detailWith());
    expect(c.enabled()).toBe(true);
    expect(c.mode()).toBe('times');
    expect(c.onEnd()).toBe('stay');
    expect(c.resetAfterMs()).toBe('30000');
    expect(c.steps()).toEqual([
      { response: '001.response.json', value: '3' },
      { response: '002.response.json', value: '' },
    ]);
    // Le varianti middleware non sono eleggibili come step.
    expect(c.variantOptions.map((o: { value: string }) => o.value)).toEqual(['001.response.json', '002.response.json']);
  });

  it('con sequenza esistente: la bozza riflette la definizione e canSave è falso finché non cambia qualcosa', () => {
    const { c } = create(detailWith({ endpoint: { ...detailWith().endpoint!, sequence: EXISTING_SEQUENCE } }));
    expect(c.steps()).toEqual([
      { response: '001.response.json', value: '2' },
      { response: '002.response.json', value: '' },
    ]);
    expect(c.canSave()).toBe(false);
    c.setStepValue(0, '5');
    expect(c.canSave()).toBe(true);
  });

  it('con meno di due varianti eleggibili tutto è disabilitato', () => {
    const detail = detailWith({ responses: [{ fileName: '001.response.json', type: 'mock', title: '' }] });
    const { c } = create(detail);
    expect(c.hasEnoughVariants).toBe(false);
    expect(c.editingEnabled()).toBe(false);
    expect(c.canSave()).toBe(false);
  });

  it('validazione: step non finale senza valore, e auto-reset malformato', () => {
    const { c } = create(detailWith());
    c.setStepValue(0, '');
    expect(c.validationError()).toBe('sequenceDialog.errStepValue');
    c.setStepValue(0, '3');
    expect(c.validationError()).toBeNull();
    c.resetAfterMs.set('0');
    expect(c.validationError()).toBe('sequenceDialog.errAutoReset');
  });

  it('con onEnd loop anche l’ultimo step richiede un valore', () => {
    const { c } = create(detailWith());
    c.onEnd.set('loop');
    expect(c.isTerminalStep(1)).toBe(false);
    expect(c.validationError()).toBe('sequenceDialog.errStepValue');
    c.setStepValue(1, '1');
    expect(c.validationError()).toBeNull();
  });

  it('salvataggio: costruisce la definizione con il criterio della modalità corrente', () => {
    const { c } = create(detailWith());
    store.updateSequence.mockImplementation((_seq: unknown, onSuccess: () => void) => onSuccess());
    c.save();
    expect(store.updateSequence).toHaveBeenCalledWith(
      {
        enabled: true,
        steps: [{ response: '001.response.json', times: 3 }, { response: '002.response.json' }],
        onEnd: 'stay',
        resetAfterMs: 30000,
      },
      expect.any(Function),
    );
    expect(dialogRef.close).toHaveBeenCalledWith('saved');
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('modalità a tempo: i valori ripartono dal default e il salvataggio usa forMs', () => {
    const { c } = create(detailWith());
    c.setMode('forMs');
    expect(c.steps()[0].value).toBe('15000');
    store.updateSequence.mockImplementation((_seq: unknown, onSuccess: () => void) => onSuccess());
    c.save();
    expect(store.updateSequence).toHaveBeenCalledWith(
      expect.objectContaining({ steps: [{ response: '001.response.json', forMs: 15000 }, { response: '002.response.json' }] }),
      expect.any(Function),
    );
  });

  it('aggiungi step: il vecchio terminale riceve il default e il nuovo diventa finale', () => {
    const { c } = create(detailWith());
    c.addStep();
    expect(c.steps()).toEqual([
      { response: '001.response.json', value: '3' },
      { response: '002.response.json', value: '3' },
      { response: '001.response.json', value: '' },
    ]);
  });

  it('sposta ed elimina step', () => {
    const { c } = create(detailWith());
    c.addStep();
    c.moveStep(2, -1);
    expect(c.steps()[1]).toEqual({ response: '001.response.json', value: '' });
    c.removeStep(1);
    expect(c.steps()).toHaveLength(2);
  });

  it('spegnere una sequenza esistente è salvabile e conserva la definizione', () => {
    const { c } = create(detailWith({ endpoint: { ...detailWith().endpoint!, sequence: EXISTING_SEQUENCE } }));
    c.enabled.set(false);
    expect(c.canSave()).toBe(true);
    store.updateSequence.mockImplementation((_seq: unknown, onSuccess: () => void) => onSuccess());
    c.save();
    expect(store.updateSequence).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), expect.any(Function));
  });

  it('reset: chiama l’API, aggiorna lo stato mostrato e avvisa col toast', () => {
    const { c } = create(
      detailWith({
        endpoint: { ...detailWith().endpoint!, sequence: EXISTING_SEQUENCE },
        sequenceState: { stepIndex: 1, servedInStep: 3, stepStartedAt: 1, lastRequestAt: 2 },
      }),
    );
    expect(c.sequenceState()!.stepIndex).toBe(1);
    c.resetSequence();
    expect(api.resetSequence).toHaveBeenCalledWith('id-1');
    expect(c.sequenceState()!.stepIndex).toBe(0);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('reset fallito: toast d’errore e stato invariato', () => {
    const { c } = create(
      detailWith({
        endpoint: { ...detailWith().endpoint!, sequence: EXISTING_SEQUENCE },
        sequenceState: { stepIndex: 1, servedInStep: 3, stepStartedAt: 1, lastRequestAt: 2 },
      }),
    );
    api.resetSequence.mockReturnValueOnce(throwError(() => new Error('boom')));
    c.resetSequence();
    expect(c.sequenceState()!.stepIndex).toBe(1);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
  });
});
