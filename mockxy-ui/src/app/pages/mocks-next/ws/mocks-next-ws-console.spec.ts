import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { MocksNextWsConsole } from './mocks-next-ws-console';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import type { MockDetail, WsStateResponse } from '../../../mock-admin-api.types';

function wsDetail(): MockDetail {
  return {
    id: 'id-ws',
    type: 'ws',
    method: 'GET',
    path: '/api/canale',
    status: null,
    disabled: false,
    configFilePath: 'canale/GET.endpoint.json',
    editable: true,
    ws: {
      script: [{ afterMs: 0, data: { n: 1 } }],
      onEnd: 'keep-open',
      closeCode: null,
      closeReason: null,
      rules: [{ match: { equals: 'ping' }, reply: [{ afterMs: 0, data: 'pong' }] }],
      presets: [{ label: 'Promo', data: { tipo: 'promo' } }],
    },
  };
}

function stateWith(overrides: Partial<WsStateResponse> = {}): WsStateResponse {
  return {
    connections: [
      {
        id: 1,
        startedAt: 1000,
        messagesSent: 2,
        messagesReceived: 1,
        scriptIndex: 1,
        scriptLength: 1,
      },
    ],
    transcript: [
      { at: 1000, direction: 'out', origin: 'script', connectionId: 1, data: { n: 1 } },
      { at: 1001, direction: 'in', origin: 'received', connectionId: 1, data: 'ping' },
      { at: 1002, direction: 'out', origin: 'rule', connectionId: 1, data: 'pong' },
    ],
    ...overrides,
  };
}

describe('MocksNextWsConsole', () => {
  let api: { getWsState: ReturnType<typeof vi.fn>; pushWs: ReturnType<typeof vi.fn> };
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };

  function create() {
    api = {
      getWsState: vi.fn(() => of(stateWith())),
      pushWs: vi.fn(() => of({ delivered: 1, connections: 1 })),
    };
    toast = { show: vi.fn(), dismiss: vi.fn() };
    TestBed.configureTestingModule({
      imports: [MocksNextWsConsole, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: MockAdminApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(MocksNextWsConsole);
    fixture.componentRef.setInput('detail', wsDetail());
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, c: fixture.componentInstance as any };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('al primo render carica lo stato (connessioni + transcript bidirezionale)', () => {
    const { c, fixture } = create();
    expect(api.getWsState).toHaveBeenCalledWith('id-ws');
    expect(c.connections()).toHaveLength(1);
    expect(c.transcript()).toHaveLength(3);
    fixture.destroy();
  });

  it('invia il messaggio composto: data JSON se interpretabile, altrimenti testo', () => {
    const { c, fixture } = create();
    c.dataText.set('{"tipo":"promo"}');
    c.send();
    expect(api.pushWs).toHaveBeenCalledWith('id-ws', { data: { tipo: 'promo' } });

    c.dataText.set('testo non json');
    c.send();
    expect(api.pushWs).toHaveBeenLastCalledWith('id-ws', { data: 'testo non json' });
    fixture.destroy();
  });

  it('senza data non invia', () => {
    const { c, fixture } = create();
    c.dataText.set('   ');
    c.send();
    expect(api.pushWs).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('ricliccare una voce del transcript re-invia il payload, anche per i messaggi ricevuti', () => {
    const { c, fixture } = create();
    c.resend({ at: 1001, direction: 'in', origin: 'received', connectionId: 1, data: 'ping' });
    expect(api.pushWs).toHaveBeenCalledWith('id-ws', { data: 'ping' });
    fixture.destroy();
  });

  it('le macro (presets) inviano il loro payload', () => {
    const { c, fixture } = create();
    c.sendPreset({ label: 'Promo', data: { tipo: 'promo' } });
    expect(api.pushWs).toHaveBeenCalledWith('id-ws', { data: { tipo: 'promo' } });
    fixture.destroy();
  });

  it('push a zero consegne: toast di avviso (regia senza pubblico)', () => {
    const { c, fixture } = create();
    api.pushWs.mockReturnValue(of({ delivered: 0, connections: 0 }));
    c.dataText.set('ciao');
    c.send();
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warning' }));
    fixture.destroy();
  });

  it('errore di push: toast di errore e sending azzerato', () => {
    const { c, fixture } = create();
    api.pushWs.mockReturnValue(throwError(() => new Error('boom')));
    c.dataText.set('ciao');
    c.send();
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(c.sending()).toBe(false);
    fixture.destroy();
  });

  it("l'errore di refresh non esplode (endpoint cambiato o variante non più ws)", () => {
    const { fixture } = create();
    api.getWsState.mockReturnValue(throwError(() => new Error('404')));
    expect(() => fixture.detectChanges()).not.toThrow();
    fixture.destroy();
  });
});
