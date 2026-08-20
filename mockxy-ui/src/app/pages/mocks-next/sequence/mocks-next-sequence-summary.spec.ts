import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { MocksNextSequenceSummary, formatAgo } from './mocks-next-sequence-summary';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import type { MockDetail, SequenceState, SequenceVariantConfig } from '../../../mock-admin-api.types';

/** Tre step: due a richieste, l'ultimo terminale (onEnd "stay" non gli dà criterio). */
function sequence(overrides: Partial<SequenceVariantConfig> = {}): SequenceVariantConfig {
  return {
    steps: [{ response: '001.json', times: 3 }, { response: '002.json', times: 2 }, { response: '003.json' }],
    onEnd: 'stay',
    resetAfterMs: null,
    ...overrides,
  };
}

function detailWith(sequenceState: SequenceState, config = sequence()): MockDetail {
  return {
    id: 'id-seq',
    type: 'sequence',
    method: 'GET',
    path: '/api/polling',
    status: null,
    disabled: false,
    configFilePath: 'polling/GET.endpoint.json',
    editable: true,
    sequence: config,
    sequenceState,
  };
}

const VIRGIN: SequenceState = { stepIndex: 0, servedInStep: 0, stepStartedAt: null, lastRequestAt: null };

describe('MocksNextSequenceSummary', () => {
  let api: { getSequenceState: ReturnType<typeof vi.fn>; resetSequence: ReturnType<typeof vi.fn> };
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };

  function create(detail: MockDetail) {
    api = {
      // Il poll rilegge lo stesso stato che il dettaglio porta già: i test controllano
      // la derivazione, non il trasporto.
      getSequenceState: vi.fn(() => of({ sequenceFile: 'seq.json', sequenceState: detail.sequenceState ?? null })),
      resetSequence: vi.fn(() => of({ sequenceFile: 'seq.json', sequenceState: VIRGIN })),
    };
    toast = { show: vi.fn(), dismiss: vi.fn() };
    TestBed.configureTestingModule({
      imports: [MocksNextSequenceSummary, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: MockAdminApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(MocksNextSequenceSummary);
    fixture.componentRef.setInput('detail', detail);
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, c: fixture.componentInstance as any };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('al primo render legge il cursore dal motore', () => {
    const { c, fixture } = create(detailWith(VIRGIN));
    expect(api.getSequenceState).toHaveBeenCalledWith('id-seq');
    expect(c.cursor().kind).toBe('never');
    fixture.destroy();
  });

  it('mai servita: nessuno step è corrente, il cursore non descrive un giro in corso', () => {
    const { c, fixture } = create(detailWith(VIRGIN));
    expect(c.cursor().kind).toBe('never');
    expect(c.stepViews().map((s: { phase: string }) => s.phase)).toEqual(['pending', 'pending', 'pending']);
    fixture.destroy();
  });

  it('lo stepIndex è lo step della PROSSIMA richiesta: quelli prima risultano serviti', () => {
    const state: SequenceState = { stepIndex: 1, servedInStep: 1, stepStartedAt: Date.now() - 4000, lastRequestAt: Date.now() - 4000 };
    const { c, fixture } = create(detailWith(state));

    expect(c.cursor().kind).toBe('running');
    expect(c.cursor().stepIndex).toBe(1);
    expect(c.cursor().response).toBe('002.json');
    expect(c.stepViews().map((s: { phase: string }) => s.phase)).toEqual(['done', 'current', 'pending']);
    fixture.destroy();
  });

  it('step a richieste: la barra è servite su quota', () => {
    const state: SequenceState = { stepIndex: 1, servedInStep: 1, stepStartedAt: Date.now(), lastRequestAt: Date.now() };
    const { c, fixture } = create(detailWith(state));

    const current = c.stepViews()[1];
    expect(current.served).toBe(1);
    expect(current.progress).toBe(50);
    expect(current.waitingFirstRequest).toBe(false);
    fixture.destroy();
  });

  it('step a tempo non ancora toccato: il timer non è partito, niente barra', () => {
    const config = sequence({ steps: [{ response: '001.json', times: 1 }, { response: '002.json', forMs: 10000 }, { response: '003.json' }] });
    const state: SequenceState = { stepIndex: 1, servedInStep: 0, stepStartedAt: null, lastRequestAt: Date.now() - 1000 };
    const { c, fixture } = create(detailWith(state, config));

    const current = c.stepViews()[1];
    expect(current.waitingFirstRequest).toBe(true);
    expect(current.progress).toBeNull();
    expect(current.elapsedMs).toBeNull();
    fixture.destroy();
  });

  it('step a tempo avviato: la barra è il tempo trascorso sulla finestra', () => {
    const config = sequence({ steps: [{ response: '001.json', times: 1 }, { response: '002.json', forMs: 10000 }, { response: '003.json' }] });
    const state: SequenceState = { stepIndex: 1, servedInStep: 2, stepStartedAt: Date.now() - 5000, lastRequestAt: Date.now() - 500 };
    const { c, fixture } = create(detailWith(state, config));

    const current = c.stepViews()[1];
    expect(current.waitingFirstRequest).toBe(false);
    expect(current.elapsedMs).toBeGreaterThanOrEqual(5000);
    expect(current.progress).toBeGreaterThanOrEqual(50);
    expect(current.progress).toBeLessThan(60);
    fixture.destroy();
  });

  it('con onEnd "stay" sull\'ultimo step il cursore è terminale', () => {
    const state: SequenceState = { stepIndex: 2, servedInStep: 7, stepStartedAt: Date.now() - 9000, lastRequestAt: Date.now() - 100 };
    const { c, fixture } = create(detailWith(state));

    expect(c.cursor().terminal).toBe(true);
    expect(c.stepViews()[2].progress).toBeNull();
    expect(c.stepViews()[2].served).toBe(7);
    fixture.destroy();
  });

  it('con onEnd "loop" l\'ultimo step non è terminale', () => {
    const state: SequenceState = { stepIndex: 2, servedInStep: 1, stepStartedAt: Date.now(), lastRequestAt: Date.now() };
    const { c, fixture } = create(detailWith(state, sequence({ onEnd: 'loop' })));

    expect(c.cursor().terminal).toBe(false);
    fixture.destroy();
  });

  it('finestra di auto-reset scaduta: lo stato letto è stantio, la prossima richiesta riparte da capo', () => {
    // Il motore applica l'auto-reset ALLA richiesta successiva: da fermo il cursore su disco
    // dice ancora "step 2", ma nessuna richiesta lo servirà più.
    const state: SequenceState = { stepIndex: 1, servedInStep: 1, stepStartedAt: Date.now() - 60000, lastRequestAt: Date.now() - 45000 };
    const { c, fixture } = create(detailWith(state, sequence({ resetAfterMs: 30000 })));

    expect(c.cursor().kind).toBe('staleReset');
    expect(c.stepViews().every((s: { phase: string }) => s.phase === 'pending')).toBe(true);
    fixture.destroy();
  });

  it('dentro la finestra di auto-reset il giro è ancora quello', () => {
    const state: SequenceState = { stepIndex: 1, servedInStep: 1, stepStartedAt: Date.now() - 6000, lastRequestAt: Date.now() - 5000 };
    const { c, fixture } = create(detailWith(state, sequence({ resetAfterMs: 30000 })));

    expect(c.cursor().kind).toBe('running');
    expect(c.stepViews()[1].phase).toBe('current');
    fixture.destroy();
  });

  it('lettura fallita: la banda sparisce invece di mostrare un cursore inventato', () => {
    const { c, fixture } = create(detailWith(VIRGIN));
    api.getSequenceState.mockReturnValueOnce(throwError(() => new Error('boom')));
    c.refresh();

    expect(c.cursor()).toBeNull();
    expect(c.stepViews().every((s: { phase: string }) => s.phase === 'pending')).toBe(true);
    fixture.destroy();
  });

  it('azzera: chiama il motore e adotta lo stato vergine che torna', () => {
    const state: SequenceState = { stepIndex: 1, servedInStep: 1, stepStartedAt: Date.now(), lastRequestAt: Date.now() };
    const { c, fixture } = create(detailWith(state));
    expect(c.cursor().kind).toBe('running');

    c.reset();

    expect(api.resetSequence).toHaveBeenCalledWith('id-seq');
    expect(c.cursor().kind).toBe('never');
    expect(c.resetting()).toBe(false);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
    fixture.destroy();
  });

  it('azzeramento fallito: nessuna bugia sullo stato, solo l\'errore', () => {
    const state: SequenceState = { stepIndex: 1, servedInStep: 1, stepStartedAt: Date.now(), lastRequestAt: Date.now() };
    const { c, fixture } = create(detailWith(state));
    api.resetSequence.mockReturnValueOnce(throwError(() => new Error('boom')));

    c.reset();

    expect(c.cursor().kind).toBe('running');
    expect(c.resetting()).toBe(false);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    fixture.destroy();
  });

  it('cambio endpoint: il cursore del precedente non resta a schermo', () => {
    const state: SequenceState = { stepIndex: 1, servedInStep: 1, stepStartedAt: Date.now(), lastRequestAt: Date.now() };
    const { c, fixture } = create(detailWith(state));
    expect(c.cursor().stepIndex).toBe(1);

    api.getSequenceState.mockReturnValue(of({ sequenceFile: 'seq.json', sequenceState: VIRGIN }));
    fixture.componentRef.setInput('detail', { ...detailWith(VIRGIN), id: 'id-altro' });
    fixture.detectChanges();

    expect(api.getSequenceState).toHaveBeenLastCalledWith('id-altro');
    expect(c.cursor().kind).toBe('never');
    fixture.destroy();
  });
});

describe('formatAgo', () => {
  it('sotto il minuto conta i secondi', () => {
    expect(formatAgo(0)).toBe('0 s');
    expect(formatAgo(8000)).toBe('8 s');
    expect(formatAgo(59_999)).toBe('59 s');
  });

  it('poi passa a minuti e ore', () => {
    expect(formatAgo(60_000)).toBe('1 min');
    expect(formatAgo(3_599_999)).toBe('59 min');
    expect(formatAgo(3_600_000)).toBe('1 h');
  });

  it('orologi sfasati (UI su un\'altra macchina): mai un intervallo negativo', () => {
    expect(formatAgo(-5000)).toBe('0 s');
  });
});
