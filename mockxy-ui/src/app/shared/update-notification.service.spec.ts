import { TestBed } from '@angular/core/testing';
import { DesktopService, type UpdateState } from './desktop.service';
import { UpdateNotificationService } from './update-notification.service';

function state(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    status: 'available',
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
    ...overrides,
  };
}

describe('UpdateNotificationService', () => {
  let automaticListener: ((update: UpdateState) => void) | null;
  let currentState: UpdateState;
  let manualState: UpdateState;
  let ignoredVersion: string | null;
  let opened: boolean;

  beforeEach(() => {
    automaticListener = null;
    currentState = state();
    manualState = state();
    ignoredVersion = null;
    opened = false;
    const desktop = {
      isDesktop: true,
      getUpdateState: async () => currentState,
      checkForUpdates: async () => manualState,
      ignoreUpdate: async (version: string) => {
        ignoredVersion = version;
        return state({ ignored: true });
      },
      openUpdate: async () => {
        opened = true;
        return true;
      },
      onUpdateAvailable: (listener: (update: UpdateState) => void) => {
        automaticListener = listener;
        return () => undefined;
      },
    };
    TestBed.configureTestingModule({
      providers: [{ provide: DesktopService, useValue: desktop }],
    });
  });

  it('mostra una release disponibile e reagisce alla notifica automatica', async () => {
    currentState = state({ status: 'up-to-date', latestVersion: '1.1.0' });
    const service = TestBed.inject(UpdateNotificationService);
    await service.start();
    expect(service.available()).toBeNull();

    automaticListener?.(state());
    expect(service.available()?.latestVersion).toBe('1.2.0');
  });

  it('non ripropone una versione ignorata all’avvio, ma la mostra su controllo manuale', async () => {
    currentState = state({ ignored: true });
    manualState = state({ ignored: true });
    const service = TestBed.inject(UpdateNotificationService);

    await service.start();
    expect(service.available()).toBeNull();
    await service.checkManually();
    expect(service.available()?.latestVersion).toBe('1.2.0');
  });

  it('ignora la versione corrente e apre la release tramite il main process', async () => {
    const service = TestBed.inject(UpdateNotificationService);
    await service.start();

    await expect(service.openCurrent()).resolves.toBe(true);
    expect(opened).toBe(true);
    await service.ignoreCurrent();
    expect(ignoredVersion).toBe('1.2.0');
    expect(service.available()).toBeNull();
  });
});
