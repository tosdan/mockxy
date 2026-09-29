import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RequestMonitorEntry, RequestMonitorStreamEvent } from '../mock-admin-api.types';
import { ToastService } from '../ui/ui-toast/ui-toast';
import { fakeRuntimeSync } from '../testing/runtime-sync-testing';
import { translocoTesting } from '../testing/transloco-testing';
import { MonitorStreamStore } from './monitor-stream.store';

function entry(id: string): RequestMonitorEntry {
  return { id } as unknown as RequestMonitorEntry;
}

describe('MonitorStreamStore — sincronizzazione', () => {
  let streams: Subject<RequestMonitorStreamEvent>[];
  let toast: { show: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  let sync: ReturnType<typeof fakeRuntimeSync>;

  function create() {
    streams = [];
    toast = { show: vi.fn(), dismiss: vi.fn() };
    sync = fakeRuntimeSync();
    TestBed.configureTestingModule({
      imports: [translocoTesting()],
      providers: [
        sync.provider,
        {
          provide: MockAdminApiService,
          useValue: {
            streamRequestMonitoring: () => {
              const stream = new Subject<RequestMonitorStreamEvent>();
              streams.push(stream);
              return stream;
            },
          },
        },
        { provide: ToastService, useValue: toast },
      ],
    });
    return TestBed.inject(MonitorStreamStore);
  }

  it('a un nuovo runtime riapre lo stream: l’istantanea nuova sostituisce lo storico', () => {
    const store = create();
    streams[0].next({ type: 'snapshot', items: [entry('1'), entry('2')] });

    sync.runtime();
    expect(streams).toHaveLength(2);
    expect(streams[0].observed).toBe(false);
    streams[1].next({ type: 'snapshot', items: [] });

    expect(store.entries()).toEqual([]);
    expect(store.streaming()).toBe(true);
  });

  it('dopo un’interruzione si riapre quando il motore torna, con un solo avviso', () => {
    const store = create();
    streams[0].error(new Error('down'));
    expect(store.streaming()).toBe(false);

    sync.resync();
    streams[1].error(new Error('ancora giù'));
    sync.resync();
    streams[2].next({ type: 'snapshot', items: [entry('3')] });

    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(store.streaming()).toBe(true);
    expect(store.entries()).toEqual([entry('3')]);
  });

  it('in pausa voluta resta in pausa anche a un nuovo runtime', () => {
    const store = create();
    store.setStreaming(false);
    sync.runtime();
    sync.resync();
    expect(streams).toHaveLength(1);
    expect(store.streaming()).toBe(false);
  });
});
