import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError, type Observable } from 'rxjs';
import type { Mock } from 'vitest';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RuntimeInfo } from '../mock-admin-api.types';
import { RUNTIME_POLL_MS, RuntimeSyncStore, affects, type RuntimeSyncEvent } from './runtime-sync.store';

function info(overrides: Partial<RuntimeInfo> = {}, revisions: Partial<RuntimeInfo['revisions']> = {}): RuntimeInfo {
  return {
    version: '1.4.0',
    runtimeId: 'runtime-1',
    startedAt: '2026-09-29T08:00:00.000Z',
    workspace: { id: `workspace-v1:${'a'.repeat(64)}`, root: null, mocksDir: '/w/mocks', filesDir: null },
    listener: { host: '127.0.0.1', port: 3000 },
    watcher: { state: 'ready', polling: false, lastError: null },
    revisions: { catalog: 1, server: 1, dump: 1, diagnostics: 1, config: 1, ...revisions },
    ...overrides,
  };
}

describe('RuntimeSyncStore', () => {
  let getRuntimeInfo: Mock<() => Observable<RuntimeInfo>>;
  let store: RuntimeSyncStore;
  let events: RuntimeSyncEvent[];

  function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    getRuntimeInfo = vi.fn(() => of(info()));
    TestBed.configureTestingModule({
      providers: [{ provide: MockAdminApiService, useValue: { getRuntimeInfo } }],
    });
    store = TestBed.inject(RuntimeSyncStore);
    events = [];
    store.events$.subscribe((event) => events.push(event));
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('la prima lettura fa da base; poi pubblica solo le revisioni cresciute', () => {
    store.check(false);
    expect(events).toEqual([]);

    getRuntimeInfo.mockReturnValueOnce(of(info({}, { catalog: 2, dump: 5 })));
    store.check(false);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.kind).toBe('revisions');
    expect(affects(event, 'catalog')).toBe(true);
    expect(affects(event, 'dump')).toBe(true);
    expect(affects(event, 'server')).toBe(false);

    getRuntimeInfo.mockReturnValueOnce(of(info({}, { catalog: 2, dump: 5 })));
    store.check(false);
    expect(events).toHaveLength(1);
  });

  it('un nuovo runtimeId chiede di rileggere tutto e dice se il workspace è cambiato', () => {
    store.check(false);
    getRuntimeInfo.mockReturnValueOnce(of(info({ runtimeId: 'runtime-2' })));
    store.check(false);
    getRuntimeInfo.mockReturnValueOnce(of(info({
      runtimeId: 'runtime-3',
      workspace: { id: `workspace-v1:${'b'.repeat(64)}`, root: null, mocksDir: '/altro/mocks', filesDir: null },
    })));
    store.check(false);

    expect(events.map((e) => e.kind === 'runtime' && e.workspaceChanged)).toEqual([false, true]);
    expect(affects(events[0], 'server')).toBe(true);
  });

  it('al focus rilegge tutto anche a revisioni invariate', () => {
    store.check(false);
    store.check(true);
    expect(events.map((e) => e.kind)).toEqual(['resync']);
  });

  it('una lettura fallita segna il collegamento perso; al ritorno si rilegge tutto', () => {
    store.check(false);
    getRuntimeInfo.mockReturnValueOnce(throwError(() => new Error('down')));
    store.check(false);
    expect(store.connected()).toBe(false);
    expect(events).toEqual([]);

    store.check(false);
    expect(store.connected()).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(['resync']);
  });

  it('una richiesta alla volta: il focus durante una lettura in volo la fa seguire da una rilettura completa', () => {
    const slow = new Subject<RuntimeInfo>();
    store.check(false);
    getRuntimeInfo.mockReturnValueOnce(slow);
    store.check(false);
    store.check(true);
    store.check(false);
    expect(getRuntimeInfo).toHaveBeenCalledTimes(2);

    slow.next(info());
    slow.complete();

    expect(getRuntimeInfo).toHaveBeenCalledTimes(3);
    expect(events.map((e) => e.kind)).toEqual(['resync']);
  });

  it('interroga ogni 2 secondi mentre la finestra è visibile, senza sovrapporsi', () => {
    vi.useFakeTimers();
    const slow = new Subject<RuntimeInfo>();
    store.start();
    expect(getRuntimeInfo).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(RUNTIME_POLL_MS);
    expect(getRuntimeInfo).toHaveBeenCalledTimes(2);

    // Una lettura lenta: niente nuove richieste finché non termina.
    getRuntimeInfo.mockReturnValueOnce(slow);
    vi.advanceTimersByTime(RUNTIME_POLL_MS);
    expect(getRuntimeInfo).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(RUNTIME_POLL_MS * 3);
    expect(getRuntimeInfo).toHaveBeenCalledTimes(3);
    slow.next(info());
    slow.complete();
    vi.advanceTimersByTime(RUNTIME_POLL_MS);
    expect(getRuntimeInfo).toHaveBeenCalledTimes(4);
  });

  it('nascosta non interroga; tornando visibile rilegge subito tutto', () => {
    vi.useFakeTimers();
    store.start();
    setVisibility('hidden');
    vi.advanceTimersByTime(RUNTIME_POLL_MS * 5);
    expect(getRuntimeInfo).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    expect(getRuntimeInfo).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.kind)).toEqual(['resync']);

    window.dispatchEvent(new Event('focus'));
    expect(getRuntimeInfo).toHaveBeenCalledTimes(3);
  });

  it('una lettura che termina a finestra nascosta non programma la successiva', () => {
    vi.useFakeTimers();
    const slow = new Subject<RuntimeInfo>();
    getRuntimeInfo.mockReturnValueOnce(slow);
    store.start();
    setVisibility('hidden');
    slow.next(info());
    slow.complete();

    vi.advanceTimersByTime(RUNTIME_POLL_MS * 5);
    expect(getRuntimeInfo).toHaveBeenCalledTimes(1);
  });

  it('allo smontaggio smette di interrogare', () => {
    vi.useFakeTimers();
    store.start();
    TestBed.resetTestingModule();

    vi.advanceTimersByTime(RUNTIME_POLL_MS * 3);
    window.dispatchEvent(new Event('focus'));
    expect(getRuntimeInfo).toHaveBeenCalledTimes(1);
  });
});
