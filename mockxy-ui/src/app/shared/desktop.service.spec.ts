import { TestBed } from '@angular/core/testing';
import { DesktopService } from './desktop.service';

describe('DesktopService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    delete (window as any).desktop;
  });

  it("fuori da Electron: isDesktop è false, getWorkspace null e le liste vuote", async () => {
    delete (window as any).desktop;
    const svc = TestBed.inject(DesktopService);
    expect(svc.isDesktop).toBe(false);
    await expect(svc.getWorkspace()).resolves.toBeNull();
    await expect(svc.listWorkspaces()).resolves.toEqual([]);
    await expect(svc.listRecent()).resolves.toEqual([]);
  });

  it('in Electron: isDesktop è true e getWorkspace inoltra al bridge', async () => {
    (window as any).desktop = {
      isDesktop: true,
      getWorkspace: async () => ({ root: '/ws/demo', name: 'demo' }),
    };
    const svc = TestBed.inject(DesktopService);
    expect(svc.isDesktop).toBe(true);
    await expect(svc.getWorkspace()).resolves.toEqual({ root: '/ws/demo', name: 'demo' });
  });

  it('getWorkspace ingoia gli errori del bridge e torna null', async () => {
    (window as any).desktop = {
      isDesktop: true,
      getWorkspace: async () => {
        throw new Error('boom');
      },
    };
    const svc = TestBed.inject(DesktopService);
    await expect(svc.getWorkspace()).resolves.toBeNull();
  });

  it('listWorkspaces e listRecent inoltrano al bridge', async () => {
    (window as any).desktop = {
      isDesktop: true,
      listWorkspaces: async () => [{ root: '/ws/a', name: 'a', port: 3001, active: true }],
      listRecent: async () => [{ root: '/ws/a', name: 'a' }],
    };
    const svc = TestBed.inject(DesktopService);
    await expect(svc.listWorkspaces()).resolves.toEqual([
      { root: '/ws/a', name: 'a', port: 3001, active: true },
    ]);
    await expect(svc.listRecent()).resolves.toEqual([{ root: '/ws/a', name: 'a' }]);
  });

  it('openWorkspace e switchWorkspace chiamano il bridge', () => {
    let opened = false;
    let switchedTo = '';
    (window as any).desktop = {
      isDesktop: true,
      openWorkspace: () => {
        opened = true;
      },
      switchWorkspace: (root: string) => {
        switchedTo = root;
      },
    };
    const svc = TestBed.inject(DesktopService);
    svc.openWorkspace();
    svc.switchWorkspace('/ws/b');
    expect(opened).toBe(true);
    expect(switchedTo).toBe('/ws/b');
  });

  it('closeWorkspace chiama il bridge', async () => {
    let closed = '';
    (window as any).desktop = {
      isDesktop: true,
      closeWorkspace: async (root: string) => {
        closed = root;
      },
    };
    const svc = TestBed.inject(DesktopService);
    await svc.closeWorkspace('/ws/c');
    expect(closed).toBe('/ws/c');
  });

  it('getAppPreferences inoltra al bridge; fuori da Electron torna null', async () => {
    delete (window as any).desktop;
    await expect(TestBed.inject(DesktopService).getAppPreferences()).resolves.toBeNull();

    (window as any).desktop = {
      isDesktop: true,
      getAppPreferences: async () => ({ errorLogEnabled: true, logsDir: '/opt/mockxy/logs' }),
    };
    const svc = TestBed.inject(DesktopService);
    await expect(svc.getAppPreferences()).resolves.toEqual({ errorLogEnabled: true, logsDir: '/opt/mockxy/logs' });
  });

  it('updateAppPreferences inoltra la patch al bridge e restituisce lo stato aggiornato', async () => {
    let patched: unknown = null;
    (window as any).desktop = {
      isDesktop: true,
      updateAppPreferences: async (patch: unknown) => {
        patched = patch;
        return { errorLogEnabled: false, logsDir: '/opt/mockxy/logs' };
      },
    };
    const svc = TestBed.inject(DesktopService);
    const result = await svc.updateAppPreferences({ errorLogEnabled: false });
    expect(patched).toEqual({ errorLogEnabled: false });
    expect(result).toEqual({ errorLogEnabled: false, logsDir: '/opt/mockxy/logs' });
  });

  it('updateWorkspace inoltra root e patch al bridge e restituisce l\'esito', async () => {
    let calledWith: [string, unknown] | null = null;
    (window as any).desktop = {
      isDesktop: true,
      updateWorkspace: (root: string, patch: unknown) => {
        calledWith = [root, patch];
        return Promise.resolve({ ok: false, error: 'port-in-use', port: 4500 });
      },
    };
    const svc = TestBed.inject(DesktopService);
    const result = await svc.updateWorkspace('/ws/c', { name: 'API staging', port: 4500 });
    expect(calledWith).toEqual(['/ws/c', { name: 'API staging', port: 4500 }]);
    expect(result).toEqual({ ok: false, error: 'port-in-use', port: 4500 });
  });

  it('inoltra stato, controllo, ignore, apertura e notifiche degli aggiornamenti', async () => {
    const available = {
      status: 'available' as const,
      currentVersion: '1.1.0',
      latestVersion: '1.2.0',
      releaseName: 'Mockxy 1.2.0',
      publishedAt: null,
      checkedAt: '2026-07-29T12:00:00Z',
      ignored: false,
      reason: null,
      checksEnabled: true,
      automaticChecksEnabled: true,
      distributionChannel: 'portable',
    };
    let ignored = '';
    const listener: { callback?: (state: typeof available) => void } = {};
    let unsubscribed = false;
    (window as any).desktop = {
      isDesktop: true,
      getUpdateState: async () => available,
      checkForUpdates: async () => available,
      ignoreUpdate: async (version: string) => {
        ignored = version;
        return { ...available, ignored: true };
      },
      openUpdate: async () => ({ opened: true }),
      onUpdateAvailable: (callback: (state: typeof available) => void) => {
        listener.callback = callback;
        return () => {
          unsubscribed = true;
        };
      },
    };
    const svc = TestBed.inject(DesktopService);
    const received: typeof available[] = [];
    const unsubscribe = svc.onUpdateAvailable((state) => received.push(state as typeof available));

    await expect(svc.getUpdateState()).resolves.toEqual(available);
    await expect(svc.checkForUpdates()).resolves.toEqual(available);
    await expect(svc.ignoreUpdate('1.2.0')).resolves.toMatchObject({ ignored: true });
    await expect(svc.openUpdate()).resolves.toBe(true);
    expect(ignored).toBe('1.2.0');
    listener.callback?.(available);
    expect(received).toEqual([available]);
    unsubscribe();
    expect(unsubscribed).toBe(true);
  });
});
