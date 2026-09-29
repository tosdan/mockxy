import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { of } from 'rxjs';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RuntimeConfigState } from '../mock-admin-api.types';
import { fakeRuntimeSync } from '../testing/runtime-sync-testing';
import { runtimeConfigState } from '../testing/runtime-config-testing';
import { translocoTesting } from '../testing/transloco-testing';
import { DesktopService, type WorkspaceInfo } from './desktop.service';
import { WorkspaceSettingsDialog } from './workspace-settings-dialog';

const WORKSPACE: WorkspaceInfo = {
  root: '/w/shop',
  name: 'shop',
  title: null,
  port: 3000,
  backendUrl: 'http://localhost:8080',
  host: '127.0.0.1',
  caseInsensitiveFilters: true,
  proxyFallbackEnabled: true,
  corsEnabled: false,
  adaptProxyCookies: true,
  rewriteProxyRedirects: true,
  globalDelayMs: 0,
  delayAllRequests: false,
  requestTimeoutMs: 15000,
  monitorDumpIntervalMs: 30000,
  monitorDumpThreshold: 100,
  monitorDumpMaxFileBytes: 52428800,
  monitorDumpMaxTotalBytes: 1073741824,
};

// Impostazioni di avvio del desktop accanto agli override temporanei (piano agent/API, §13 C8).
describe('WorkspaceSettingsDialog', () => {
  let state: RuntimeConfigState;
  const updateWorkspace = vi.fn();

  beforeEach(async () => {
    state = runtimeConfigState();
    updateWorkspace.mockReset();
    updateWorkspace.mockResolvedValue({ ok: true, name: 'shop', port: 3000 });
    await TestBed.configureTestingModule({
      imports: [WorkspaceSettingsDialog, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        fakeRuntimeSync().provider,
        { provide: MockAdminApiService, useValue: { getRuntimeConfig: () => of(state) } },
        { provide: DesktopService, useValue: { updateWorkspace } },
        { provide: DialogRef, useValue: { close: vi.fn() } },
        { provide: DIALOG_DATA, useValue: WORKSPACE },
      ],
    }).compileComponents();
  });

  function create() {
    const fixture = TestBed.createComponent(WorkspaceSettingsDialog);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance as any, root: fixture.nativeElement as HTMLElement };
  }

  const text = (element: Element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('si dichiara impostazioni di avvio e, senza override, non mostra valori in uso né avvisi', () => {
    const { fixture, c, root } = create();
    expect(text(root)).toContain('Impostazioni di avvio');
    expect(root.querySelector('[data-override]')).toBeNull();

    c.corsEnabled.set(true);
    fixture.detectChanges();
    expect(root.querySelector('[role="status"]')).toBeNull();
  });

  it('accanto a un campo con un override dice il valore in uso, ma il campo resta quello salvato', () => {
    state = runtimeConfigState({ backendUrl: 'http://localhost:9090', corsEnabled: true });
    const { root } = create();

    const overrides = Array.from(root.querySelectorAll('[data-override]')).map((element) => [element.getAttribute('data-override'), text(element)]);
    expect(overrides).toEqual([
      ['backendUrl', 'In uso ora: http://localhost:9090 (override temporaneo, non salvato)'],
      ['corsEnabled', 'In uso ora: attivo (override temporaneo, non salvato)'],
    ]);
    const backendInput = root.querySelector('input[placeholder="http://localhost:8080"]') as HTMLInputElement;
    expect(backendInput.value).toBe('http://localhost:8080');
  });

  it('un salvataggio che riavvia il motore avvisa che tutti gli override si perdono; il solo titolo no', async () => {
    state = runtimeConfigState({ corsEnabled: true, globalDelayMs: 500 });
    const { fixture, c, root } = create();

    c.title.set('Negozio');
    fixture.detectChanges();
    expect(root.querySelector('[role="status"]')).toBeNull();

    c.requestTimeoutMs.set('20000');
    fixture.detectChanges();
    expect(text(root.querySelector('[role="status"]')!)).toBe(
      'Salvando, il motore riparte: i 2 override temporanei attivi vengono eliminati, anche quelli dei campi che non hai cambiato, e non vengono riapplicati.',
    );

    // Il salvataggio manda solo i campi cambiati: gli override non finiscono nelle impostazioni.
    await c.save();
    expect(updateWorkspace).toHaveBeenCalledWith('/w/shop', { name: 'Negozio', requestTimeoutMs: 20000 });
  });
});
