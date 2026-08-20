import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { RuntimeStatus } from './runtime-status';
import { ServerStatusStore } from './server-status.store';
import { MonitorStreamStore } from './monitor-stream.store';
import { MonitorDumpStore } from './monitor-dump.store';
import { translocoTesting } from '../testing/transloco-testing';

/** Doppi degli store globali: i veri parlano col motore appena costruiti. */
function stubs() {
  return {
    server: {
      serverEnabled: signal(true),
      proxyAll: signal(false),
      loading: signal(false),
      setServerEnabled: () => {},
      setProxyAll: () => {},
    },
    stream: { streaming: signal(true), setStreaming: () => {} },
    dump: {
      available: signal(true),
      enabled: signal(false),
      busy: signal(false),
      pendingCount: signal(0),
      setEnabled: () => {},
      flush: () => {},
    },
  };
}

describe('RuntimeStatus', () => {
  let store: ReturnType<typeof stubs>;

  beforeEach(async () => {
    store = stubs();
    await TestBed.configureTestingModule({
      imports: [RuntimeStatus, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        { provide: ServerStatusStore, useValue: store.server },
        { provide: MonitorStreamStore, useValue: store.stream },
        { provide: MonitorDumpStore, useValue: store.dump },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(RuntimeStatus);
    fixture.detectChanges();
    return fixture;
  }

  function triggerText(fixture: ReturnType<typeof create>): string {
    return fixture.nativeElement.querySelector('button')!.textContent!.replace(/\s+/g, ' ').trim();
  }

  it('mostra i quattro stati come indicatori, senza interruttori in barra', () => {
    const fixture = create();
    expect(triggerText(fixture)).toContain('Server');
    expect(triggerText(fixture)).toContain('Monitor live');
    expect(triggerText(fixture)).toContain('Dump off');
    expect(fixture.nativeElement.querySelectorAll('ui-switch').length).toBe(0);
  });

  it('col server spento l indicatore dice "spento" invece dell indirizzo', () => {
    const fixture = create();
    store.server.serverEnabled.set(false);
    fixture.detectChanges();
    expect(triggerText(fixture)).toContain('Server spento');
  });

  it('senza dump disponibile l indicatore del dump non compare', () => {
    const fixture = create();
    store.dump.available.set(false);
    fixture.detectChanges();
    expect(triggerText(fixture)).not.toContain('Dump');
  });

  it('il gruppo apre il popover con gli interruttori', () => {
    const fixture = create();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    fixture.nativeElement.querySelector('button')!.click();
    fixture.detectChanges();

    const panel = document.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel!.querySelectorAll('ui-switch').length).toBe(4);
  });

  it('il proxy spento si racconta come "mock attivi"', () => {
    const fixture = create();
    expect(triggerText(fixture)).toContain('mock attivi');

    store.server.proxyAll.set(true);
    fixture.detectChanges();
    expect(triggerText(fixture)).toContain('dritto al backend');
  });
});
