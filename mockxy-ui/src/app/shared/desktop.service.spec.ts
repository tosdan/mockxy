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
});
