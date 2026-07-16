import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { MocksNextSseConsole } from './mocks-next-sse-console';
import { translocoTesting } from '../../../testing/transloco-testing';
import { MockAdminApiService } from '../../../mock-admin-api.service';
import { ToastService } from '../../../ui/ui-toast/ui-toast';
import type { MockDetail, SseStateResponse } from '../../../mock-admin-api.types';

function sseDetail(): MockDetail {
  return {
    id: 'id-sse',
    type: 'sse',
    method: 'GET',
    path: '/api/feed',
    status: null,
    disabled: false,
    configFilePath: 'feed/GET.endpoint.json',
    editable: true,
    sse: {
      retryMs: null,
      script: [{ afterMs: 0, event: 'hello', data: { n: 1 } }],
      onEnd: 'keep-open',
      presets: [{ label: 'Promo', event: 'notifica', data: { tipo: 'promo' } }],
    },
  };
}

function stateWith(overrides: Partial<SseStateResponse> = {}): SseStateResponse {
  return {
    connections: [{ id: 1, startedAt: 1000, eventsSent: 2, scriptIndex: 1, scriptLength: 1 }],
    history: [{ at: 1000, origin: 'script', connectionId: 1, event: 'hello', data: { n: 1 } }],
    ...overrides,
  };
}

describe('MocksNextSseConsole', () => {
  let api: { getSseState: ReturnType<typeof vi.fn>; pushSse: ReturnType<typeof vi.fn> };
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };

  function create() {
    api = {
      getSseState: vi.fn(() => of(stateWith())),
      pushSse: vi.fn(() => of({ delivered: 1, connections: 1 })),
    };
    toast = { show: vi.fn(), dismiss: vi.fn() };
    TestBed.configureTestingModule({
      imports: [MocksNextSseConsole, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: MockAdminApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    const fixture = TestBed.createComponent(MocksNextSseConsole);
    fixture.componentRef.setInput('detail', sseDetail());
    fixture.detectChanges();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { fixture, c: fixture.componentInstance as any };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('al primo render carica lo stato (connessioni + storico)', () => {
    const { c, fixture } = create();
    expect(api.getSseState).toHaveBeenCalledWith('id-sse');
    expect(c.connections()).toHaveLength(1);
    expect(c.history()).toHaveLength(1);
    fixture.destroy();
  });

  it('invia il messaggio composto: data JSON se interpretabile, con event opzionale', () => {
    const { c, fixture } = create();
    c.eventName.set('notifica');
    c.dataText.set('{"tipo":"promo"}');
    c.send();
    expect(api.pushSse).toHaveBeenCalledWith('id-sse', { event: 'notifica', data: { tipo: 'promo' } });

    c.eventName.set('');
    c.dataText.set('testo non json');
    c.send();
    expect(api.pushSse).toHaveBeenLastCalledWith('id-sse', { data: 'testo non json' });
    fixture.destroy();
  });

  it('senza data non invia', () => {
    const { c, fixture } = create();
    c.dataText.set('   ');
    expect(c.canSend()).toBe(false);
    c.send();
    expect(api.pushSse).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('re-invio dallo storico e macro preset', () => {
    const { c, fixture } = create();
    c.resend({ at: 1, origin: 'manual', event: 'hello', data: { n: 1 } });
    expect(api.pushSse).toHaveBeenCalledWith('id-sse', { event: 'hello', data: { n: 1 }, id: undefined });

    c.sendPreset({ label: 'Promo', event: 'notifica', data: { tipo: 'promo' } });
    expect(api.pushSse).toHaveBeenLastCalledWith('id-sse', { event: 'notifica', data: { tipo: 'promo' }, id: undefined });
    fixture.destroy();
  });

  it('push senza pubblico (delivered 0): toast di avviso', () => {
    const { c, fixture } = create();
    api.pushSse.mockReturnValueOnce(of({ delivered: 0, connections: 0 }));
    c.dataText.set('"x"');
    c.send();
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'warning' }));
    fixture.destroy();
  });

  it('push fallito: toast di errore', () => {
    const { c, fixture } = create();
    api.pushSse.mockReturnValueOnce(throwError(() => new Error('boom')));
    c.dataText.set('"x"');
    c.send();
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    fixture.destroy();
  });
});
