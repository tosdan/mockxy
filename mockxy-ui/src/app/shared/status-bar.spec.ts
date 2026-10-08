import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { StatusBar } from './status-bar';
import { WorkspaceSummaryStore } from './workspace-summary.store';
import { translocoTesting } from '../testing/transloco-testing';
import { fakeRuntimeSync } from '../testing/runtime-sync-testing';
import { MockAdminApiService } from '../mock-admin-api.service';
import type { RuntimeStatusReport } from '../mock-admin-api.types';
import { runtimeConfigState } from '../testing/runtime-config-testing';
import { of } from 'rxjs';

describe('StatusBar', () => {
  let summary: WorkspaceSummaryStore;
  let sync: ReturnType<typeof fakeRuntimeSync>;
  let runtimeReport: RuntimeStatusReport;

  beforeEach(async () => {
    sync = fakeRuntimeSync();
    runtimeReport = { runtimeId: 'r1', lastAttempt: null, lastAppliedAttemptId: 1, errors: [], fatalError: null };
    await TestBed.configureTestingModule({
      imports: [StatusBar, translocoTesting()],
      providers: [
        provideNoopAnimations(),
        sync.provider,
        { provide: MockAdminApiService, useValue: { getRuntimeStatus: () => of(runtimeReport), getRuntimeConfig: () => of(runtimeConfigState({ corsEnabled: true })) } },
      ],
    }).compileComponents();
    summary = TestBed.inject(WorkspaceSummaryStore);
  });

  function create() {
    const fixture = TestBed.createComponent(StatusBar);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ReturnType<typeof create>): string {
    return fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim();
  }

  function buttonWith(fixture: ReturnType<typeof create>, label: string): HTMLButtonElement | undefined {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) => b.textContent?.includes(label));
  }

  it('senza riepilogo non inventa conteggi, ma annuncia comunque la scorciatoia', () => {
    const fixture = create();
    // La palette risponde anche prima che il catalogo sia stato aperto: il suggerimento
    // non dipende dal riepilogo.
    expect(text(fixture)).toContain('Comandi');
    expect(text(fixture)).not.toContain('endpoint');
    expect(fixture.nativeElement.querySelector('div')).not.toBeNull();
  });

  it('mostra i conteggi del workspace appena il riepilogo arriva', () => {
    const fixture = create();
    summary.set({ endpoints: 16, collections: 4, active: 15, loadErrors: [] });
    fixture.detectChanges();

    expect(text(fixture)).toContain('16 endpoint');
    expect(text(fixture)).toContain('4 collection');
    expect(text(fixture)).toContain('15 attivi');
  });

  it('senza definizioni scartate non mostra l avviso', () => {
    const fixture = create();
    summary.set({ endpoints: 3, collections: 0, active: 3, loadErrors: [] });
    fixture.detectChanges();

    expect(buttonWith(fixture, 'non caricat')).toBeUndefined();
  });

  it('apre in un pannello l elenco delle definizioni scartate, con file e motivo', () => {
    const fixture = create();
    summary.set({
      endpoints: 3,
      collections: 0,
      active: 3,
      loadErrors: [{ configFilePath: 'api/rotta/GET.endpoint.json', message: 'status must be a number.' }],
    });
    fixture.detectChanges();

    const button = buttonWith(fixture, 'definizione non caricata')!;
    expect(button.textContent).toContain('1 definizione non caricata');

    button.click();
    fixture.detectChanges();

    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('api/rotta/GET.endpoint.json');
    expect(panel.textContent).toContain('status must be a number.');
  });

  it('mostra da ogni view la configurazione del runtime, con gli override attivi', () => {
    const fixture = create();
    expect(buttonWith(fixture, '1 override attivo')).toBeTruthy();
  });

  describe('collegamento e runtime', () => {
    it('col motore che non risponde dice che i dati possono non essere aggiornati', () => {
      const fixture = create();
      expect(text(fixture)).not.toContain('Non aggiornato');

      sync.connected.set(false);
      fixture.detectChanges();
      expect(text(fixture)).toContain('Non aggiornato');
      expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('Il motore non risponde');

      sync.connected.set(true);
      fixture.detectChanges();
      expect(text(fixture)).not.toContain('Non aggiornato');
    });

    it('mostra gli errori del runtime e cosa serve al loro posto, anche con la vecchia rotta attiva', () => {
      runtimeReport = {
        ...runtimeReport,
        errors: [{ endpointId: 'e1', filePath: 'users/GET.endpoint.json', message: "Unexpected token '{'", serving: 'retained' }],
      };
      const fixture = create();
      const trigger = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) =>
        b.textContent?.includes('Runtime: 1 errore'),
      );
      expect(trigger).toBeTruthy();

      trigger!.click();
      fixture.detectChanges();
      const panel = document.querySelector('[role="dialog"]');
      expect(panel?.textContent).toContain('users/GET.endpoint.json');
      expect(panel?.textContent).toContain('servita la versione precedente');
    });

    it('un caricamento fallito nel suo insieme prevale sul conteggio', () => {
      runtimeReport = { ...runtimeReport, fatalError: { message: 'mocks folder unreadable' } };
      const fixture = create();
      expect(text(fixture)).toContain('Runtime: caricamento fallito');
    });

    it('mostra gli avvisi del runtime a parte, senza presentarli come errori', () => {
      runtimeReport = {
        ...runtimeReport,
        warnings: [{ code: 'SCRIPT_ENTRYPOINT_IMPORTED', endpointId: 'e1', filePath: 'riuso/GET.endpoint.json', message: 'handler and middleware scripts are entry points' }],
      };
      const fixture = create();
      expect(text(fixture)).not.toContain('errore');
      const trigger = buttonWith(fixture, 'Runtime: 1 avviso');
      expect(trigger).toBeTruthy();

      trigger!.click();
      fixture.detectChanges();
      const panel = document.querySelector('[role="dialog"]');
      expect(panel?.textContent).toContain('riuso/GET.endpoint.json');
      expect(panel?.textContent).toContain('SCRIPT_ENTRYPOINT_IMPORTED');
      expect(panel?.textContent).toContain('entry points');
    });

    it('un motore che non riporta avvisi (precedente alla 1.6.0) non rompe la barra', () => {
      const fixture = create();
      expect(text(fixture)).not.toContain('avvis');
    });

    it('senza problemi del runtime non mostra niente', () => {
      const fixture = create();
      expect(text(fixture)).not.toContain('Runtime');
    });
  });
});
