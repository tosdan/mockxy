import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { RuntimeInfo } from '../mock-admin-api.types';
import { RuntimeSyncStore, type RevisionKey, type RuntimeSyncEvent } from '../shared/runtime-sync.store';

const INFO: RuntimeInfo = {
  version: '1.4.0',
  runtimeId: 'runtime-1',
  startedAt: '2026-09-29T08:00:00.000Z',
  workspace: { id: `workspace-v1:${'a'.repeat(64)}`, root: null, mocksDir: '/w/mocks', filesDir: null },
  listener: { host: '127.0.0.1', port: 3000 },
  watcher: { state: 'ready', polling: false, lastError: null },
  revisions: { catalog: 1, server: 1, dump: 1, diagnostics: 1, config: 1 },
};

/**
 * RuntimeSyncStore finto per i test degli store che ascoltano la sincronizzazione: nessun
 * polling, gli eventi si emettono a mano.
 */
export function fakeRuntimeSync() {
  const events = new Subject<RuntimeSyncEvent>();
  const connected = signal(true);
  return {
    provider: { provide: RuntimeSyncStore, useValue: { events$: events.asObservable(), connected, info: signal(INFO) } },
    connected,
    revisions: (...keys: RevisionKey[]) => events.next({ kind: 'revisions', info: INFO, changed: new Set(keys) }),
    resync: () => events.next({ kind: 'resync', info: INFO }),
    runtime: (workspaceChanged = false) =>
      events.next({ kind: 'runtime', info: { ...INFO, runtimeId: 'runtime-2' }, workspaceChanged }),
  };
}
